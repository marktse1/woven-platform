"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import "three-mesh-bvh"; // pulls in BufferGeometry.boundsTree augmentation
import { buildSeamData, type SeamData } from "@/lib/sculpt/seams";
import { applyBrush, type BrushMode, type BrushHit } from "@/lib/sculpt/brushes";
import { SculptUndoStack } from "@/lib/sculpt/undo";

// Patch Three.js raycaster to use BVH acceleration
(THREE.Mesh.prototype as THREE.Mesh & { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

type SculptMeshEntry = {
  mesh: THREE.Mesh;
  seams: SeamData;
};

export type SculptViewerHandle = {
  exportGlb: () => Promise<Uint8Array>;
  undo: () => void;
  redo: () => void;
};

export type ViewMode = "combined" | "clay" | "wireframe" | "albedo" | "ao";

// ── MatCap clay texture generator (CPU / canvas) ──────────────────────────────
// Generates a 256×256 sphere image on a canvas using view-space lighting.
// Canvas approach avoids WebGL render-target color-space issues entirely.
function generateClayMatcap(color: THREE.Color, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  // View-space light directions (normalized)
  const l1 = new THREE.Vector3(0.2, 0.7, 0.6).normalize();
  const l2 = new THREE.Vector3(-0.35, 0.15, 0.8).normalize();
  const l3 = new THREE.Vector3(0.0, -0.5, 0.6).normalize();
  const v  = new THREE.Vector3(0, 0, 1);
  const h1 = new THREE.Vector3().addVectors(l1, v).normalize();
  const cr = color.r, cg = color.g, cb = color.b;

  const n = new THREE.Vector3();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2.0 - 1.0;
      const ny = 1.0 - (y + 0.5) / size * 2.0; // canvas Y flipped vs sphere up
      const r2 = nx * nx + ny * ny;
      const i = (y * size + x) * 4;
      if (r2 >= 1.0) { d[i] = d[i+1] = d[i+2] = d[i+3] = 0; continue; }
      n.set(nx, ny, Math.sqrt(1.0 - r2)).normalize();

      const d1 = (n.dot(l1) * 0.5 + 0.5) ** 2 * 0.75;
      const d2 = Math.max(0, n.dot(l2)) * 0.25;
      const d3 = Math.max(0, n.dot(l3)) * 0.18;
      const spec = Math.max(0, n.dot(h1)) ** 12 * 0.12;
      const fres = (1.0 - n.z) ** 3.5 * 0.18;

      let r = cr * (d1 + d2) + cr * d3 * 1.05 + spec + fres * 0.50;
      let g = cg * (d1 + d2) + cg * d3 * 0.95 + spec + fres * 0.62;
      let b = cb * (d1 + d2) + cb * d3 * 0.85 + spec + fres * 0.90;

      // linear → sRGB gamma encode for canvas storage
      d[i]   = Math.round(Math.min(1, r) ** (1 / 2.2) * 255);
      d[i+1] = Math.round(Math.min(1, g) ** (1 / 2.2) * 255);
      d[i+2] = Math.round(Math.min(1, b) ** (1 / 2.2) * 255);
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type Props = {
  glbData: ArrayBuffer | null;
  brushMode: BrushMode;
  brushRadius: number;
  brushInnerRadius: number;
  brushStrength: number;
  viewMode?: ViewMode;
  clayColor?: string;
  onModelLoaded?: (vertexCount: number) => void;
  onLoadError?: (msg: string) => void;
  handleRef?: React.RefObject<SculptViewerHandle | null>;
};

export default function SculptViewer({
  glbData,
  brushMode,
  brushRadius,
  brushInnerRadius,
  brushStrength,
  viewMode = "combined",
  clayColor = "#ebe7e1",
  onModelLoaded,
  onLoadError,
  handleRef,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const meshEntriesRef = useRef<SculptMeshEntry[]>([]);
  const undoRef = useRef(new SculptUndoStack());
  const brushIndicatorRef = useRef<THREE.Mesh | null>(null);
  const brushInnerIndicatorRef = useRef<THREE.Mesh | null>(null);
  const strokeActiveRef = useRef(false);
  const lastHitRef = useRef<BrushHit | null>(null);

  // Keep latest brush params accessible from pointer handlers without stale closures
  const brushModeRef = useRef(brushMode);
  const brushRadiusRef = useRef(brushRadius);
  const brushInnerRadiusRef = useRef(brushInnerRadius);
  const brushStrengthRef = useRef(brushStrength);
  useEffect(() => { brushModeRef.current = brushMode; }, [brushMode]);
  useEffect(() => { brushRadiusRef.current = brushRadius; }, [brushRadius]);
  useEffect(() => { brushInnerRadiusRef.current = brushInnerRadius; }, [brushInnerRadius]);
  useEffect(() => { brushStrengthRef.current = brushStrength; }, [brushStrength]);

  const onModelLoadedRef = useRef(onModelLoaded);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => { onModelLoadedRef.current = onModelLoaded; }, [onModelLoaded]);
  useEffect(() => { onLoadErrorRef.current = onLoadError; }, [onLoadError]);

  // Material / view-mode refs
  const clayMatRef = useRef<THREE.MeshMatcapMaterial | null>(null);
  const clayMatcapTexRef = useRef<THREE.CanvasTexture | null>(null);
  const lastClayColorRef = useRef<string>("");
  const channelMatsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const wireMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const originalMaterialsRef = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());
  const viewModeRef = useRef<ViewMode>(viewMode);
  const clayColorRef = useRef(clayColor);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { clayColorRef.current = clayColor; }, [clayColor]);

  function getClayMat(color: string): THREE.MeshMatcapMaterial {
    if (!clayMatRef.current || lastClayColorRef.current !== color) {
      clayMatcapTexRef.current?.dispose();
      const tex = generateClayMatcap(new THREE.Color(color).convertSRGBToLinear());
      clayMatcapTexRef.current = tex;
      if (!clayMatRef.current) {
        clayMatRef.current = new THREE.MeshMatcapMaterial({ matcap: tex });
      } else {
        clayMatRef.current.matcap = tex;
        clayMatRef.current.needsUpdate = true;
      }
      lastClayColorRef.current = color;
    }
    return clayMatRef.current!;
  }

  function applyViewToGroup(group: THREE.Group, scene: THREE.Scene, vm: ViewMode, cc: string) {
    channelMatsRef.current.forEach(m => m.dispose());
    channelMatsRef.current = [];
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name === "__wire") { m.visible = vm === "wireframe"; return; }
      const orig = originalMaterialsRef.current.get(m.uuid);
      if (orig !== undefined) m.material = orig;
    });
    if (vm === "clay") {
      scene.background = new THREE.Color("#1c1c1c");
      const mat = getClayMat(cc);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.name === "__wire") return;
        m.material = mat;
      });
    } else if (vm === "albedo" || vm === "ao") {
      scene.background = new THREE.Color("#1a1614");
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.name === "__wire") return;
        const orig = originalMaterialsRef.current.get(m.uuid);
        const src = (Array.isArray(orig) ? orig[0] : orig) as THREE.MeshStandardMaterial | undefined;
        if (!src) return;
        const tex = vm === "albedo" ? (src.map ?? null) : (src.aoMap ?? null);
        if (tex) tex.colorSpace = vm === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        const cm = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x888888 });
        channelMatsRef.current.push(cm);
        m.material = cm;
      });
    } else {
      scene.background = new THREE.Color("#1a1614");
    }
  }

  // ── view mode / clay color change ─────────────────────────────────────────
  useEffect(() => {
    viewModeRef.current = viewMode;
    const group = modelRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return;
    applyViewToGroup(group, scene, viewMode, clayColor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, clayColor]);

  // ── one-time scene setup ──────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1614");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    camera.position.set(2.4, 1.8, 3.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2230, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fc6f0, 1.0);
    rim.position.set(-5, 2, -4);
    scene.add(rim);

    const grid = new THREE.GridHelper(10, 20, 0x6b5d52, 0x3d3530);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    scene.add(grid);

    // Brush indicator rings: outer = full radius, inner = focal zone
    const ringGeo = new THREE.TorusGeometry(1, 0.008, 6, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.visible = false;
    ring.renderOrder = 999;
    scene.add(ring);
    brushIndicatorRef.current = ring;

    const innerRingGeo = new THREE.TorusGeometry(1, 0.006, 6, 48);
    const innerRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.35 });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.visible = false;
    innerRing.renderOrder = 999;
    scene.add(innerRing);
    brushInnerIndicatorRef.current = innerRing;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      clayMatcapTexRef.current?.dispose();
      clayMatRef.current?.dispose();
      channelMatsRef.current.forEach(m => m.dispose());
      wireMatRef.current?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  // ── load / replace model ──────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) { m.geometry.boundsTree = undefined; m.geometry.dispose(); }
      });
      modelRef.current = null;
    }
    meshEntriesRef.current = [];
    undoRef.current.clear();

    if (!glbData) return;

    const loader = new GLTFLoader();
    loader.parse(glbData.slice(0), "", (gltf) => {
      const group = gltf.scene;
      let totalVerts = 0;

      if (!wireMatRef.current) {
        wireMatRef.current = new THREE.LineBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.3, depthTest: false,
        });
      }

      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;

        // Extract positions via getX/getY/getZ so interleaved buffers (common in
        // GLTFLoader output) are handled correctly. pos.array for an interleaved
        // attribute is the full shared buffer — copying it raw and treating it as
        // itemSize=3 scrambles every vertex after the first.
        const posAttr = mesh.geometry.attributes.position;
        const vCount = posAttr.count;
        const posData = new Float32Array(vCount * 3);
        for (let i = 0; i < vCount; i++) {
          posData[i * 3]     = posAttr.getX(i);
          posData[i * 3 + 1] = posAttr.getY(i);
          posData[i * 3 + 2] = posAttr.getZ(i);
        }
        mesh.geometry.setAttribute("position", new THREE.BufferAttribute(posData, 3));

        // Ensure indexed for BVH (use vertex count, not raw array length)
        if (!mesh.geometry.index) {
          const idx = new Uint32Array(vCount);
          for (let i = 0; i < vCount; i++) idx[i] = i;
          mesh.geometry.setIndex(new THREE.BufferAttribute(idx, 1));
        }

        mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);

        const posArr = mesh.geometry.attributes.position.array as Float32Array;
        const seams = buildSeamData(posArr);
        meshEntriesRef.current.push({ mesh, seams });
        totalVerts += mesh.geometry.attributes.position.count;

        // Wireframe overlay — excluded from GLB export, hidden by default
        const wire = new THREE.LineSegments(
          new THREE.WireframeGeometry(mesh.geometry),
          wireMatRef.current!,
        );
        wire.name = "__wire";
        wire.visible = false;
        wire.renderOrder = 999;
        mesh.add(wire);
      });

      // Frame model
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      group.position.sub(center);

      const dist = maxDim * 2.2;
      camera.position.set(dist * 0.7, dist * 0.5, dist);
      camera.near = maxDim / 100;
      camera.far = maxDim * 100;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();

      scene.add(group);
      modelRef.current = group;
      originalMaterialsRef.current.clear();
      channelMatsRef.current.forEach(m => m.dispose());
      channelMatsRef.current = [];

      // Store all original GLTF materials before any view override
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.name !== "__wire") {
          originalMaterialsRef.current.set(m.uuid, m.material);
        }
      });

      // Apply whichever view mode is currently active
      applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);

      onModelLoadedRef.current?.(totalVerts);
    }, (err) => {
      console.error("[SculptViewer] GLB parse error", err);
      onLoadErrorRef.current?.(err instanceof Error ? err.message : "Could not load model.");
    });
  }, [glbData]);

  // ── pointer events ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current || !rendererRef.current) return;
    const mount: HTMLDivElement = mountRef.current;
    const renderer = rendererRef.current;

    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    const ndc = new THREE.Vector2();

    function getHitFromEvent(e: PointerEvent): BrushHit | null {
      const rect = renderer!.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, cameraRef.current!);

      let nearest: THREE.Intersection | null = null;
      for (const { mesh } of meshEntriesRef.current) {
        const hits = raycaster.intersectObject(mesh, false);
        if (hits.length && (!nearest || hits[0].distance < nearest.distance)) {
          nearest = hits[0];
        }
      }
      if (!nearest || !nearest.face) return null;

      const normal = nearest.face.normal.clone()
        .transformDirection(nearest.object.matrixWorld)
        .normalize();
      return { point: nearest.point.clone(), normal };
    }

    function updateIndicator(hit: BrushHit | null) {
      const ring = brushIndicatorRef.current;
      const innerRing = brushInnerIndicatorRef.current;
      if (!ring) return;
      if (!hit) {
        ring.visible = false;
        if (innerRing) innerRing.visible = false;
        return;
      }
      const r = brushRadiusRef.current;
      const ir = brushInnerRadiusRef.current;
      const normal = hit.normal;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

      ring.visible = true;
      ring.scale.setScalar(r);
      ring.position.copy(hit.point);
      ring.quaternion.copy(q);

      if (innerRing) {
        innerRing.visible = ir > 0.01;
        if (ir > 0.01) {
          innerRing.scale.setScalar(r * ir);
          innerRing.position.copy(hit.point);
          innerRing.quaternion.copy(q);
        }
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const hit = getHitFromEvent(e);
      if (!hit) return;

      // Take undo snapshot before first displacement
      undoRef.current.push(meshEntriesRef.current.map((e) => e.mesh));

      strokeActiveRef.current = true;
      lastHitRef.current = hit;
      controlsRef.current!.enabled = false;
      mount.setPointerCapture(e.pointerId);

      // Apply on first down too
      for (const entry of meshEntriesRef.current) {
        applyBrush({
          mode: brushModeRef.current,
          radius: brushRadiusRef.current,
          innerRadius: brushInnerRadiusRef.current,
          strength: brushStrengthRef.current,
          hit,
          mesh: entry.mesh,
          seams: entry.seams,
        });
      }
    }

    function onPointerMove(e: PointerEvent) {
      const hit = getHitFromEvent(e);
      updateIndicator(hit);

      if (!strokeActiveRef.current || !hit) return;
      const prevHit = lastHitRef.current ?? undefined;

      for (const entry of meshEntriesRef.current) {
        applyBrush({
          mode: brushModeRef.current,
          radius: brushRadiusRef.current,
          innerRadius: brushInnerRadiusRef.current,
          strength: brushStrengthRef.current,
          hit,
          prevHit,
          mesh: entry.mesh,
          seams: entry.seams,
        });
      }
      lastHitRef.current = hit;
    }

    function onPointerUp(e: PointerEvent) {
      if (!strokeActiveRef.current) return;
      strokeActiveRef.current = false;
      lastHitRef.current = null;
      controlsRef.current!.enabled = true;
      mount.releasePointerCapture(e.pointerId);
    }

    function onPointerLeave() {
      const ring = brushIndicatorRef.current;
      if (ring) ring.visible = false;
    }

    const el = mount;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  // ── keyboard undo/redo ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      const stack = undoRef.current;
      const applySnap = (snaps: ReturnType<typeof stack.undo>) => {
        if (!snaps) return;
        for (const { mesh, positions } of snaps) {
          (mesh.geometry.attributes.position.array as Float32Array).set(positions);
          mesh.geometry.attributes.position.needsUpdate = true;
          mesh.geometry.computeVertexNormals();
        }
      };
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); applySnap(stack.undo()); }
      if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); applySnap(stack.redo()); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── expose handle for parent (export, undo buttons) ───────────────────────
  const exportGlb = useCallback(async (): Promise<Uint8Array> => {
    if (!modelRef.current) throw new Error("No model loaded.");

    // Temporarily detach wire overlays so they aren't baked into the exported GLB
    const detached: Array<{ parent: THREE.Object3D; obj: THREE.Object3D }> = [];
    modelRef.current.traverse((o) => {
      if (o.name === "__wire" && o.parent) {
        detached.push({ parent: o.parent, obj: o });
      }
    });
    detached.forEach(({ parent, obj }) => parent.remove(obj));

    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
      exporter.parse(
        modelRef.current!,
        (result) => {
          detached.forEach(({ parent, obj }) => parent.add(obj));
          resolve(new Uint8Array(result as ArrayBuffer));
        },
        (err) => {
          detached.forEach(({ parent, obj }) => parent.add(obj));
          reject(err);
        },
        { binary: true },
      );
    });
  }, []);

  const undo = useCallback(() => {
    const snaps = undoRef.current.undo();
    if (!snaps) return;
    for (const { mesh, positions } of snaps) {
      (mesh.geometry.attributes.position.array as Float32Array).set(positions);
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  }, []);

  const redo = useCallback(() => {
    const snaps = undoRef.current.redo();
    if (!snaps) return;
    for (const { mesh, positions } of snaps) {
      (mesh.geometry.attributes.position.array as Float32Array).set(positions);
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  }, []);

  useEffect(() => {
    if (handleRef) {
      (handleRef as React.MutableRefObject<SculptViewerHandle | null>).current = { exportGlb, undo, redo };
    }
  }, [handleRef, exportGlb, undo, redo]);

  return <div ref={mountRef} className="w-full h-full" style={{ touchAction: "none" }} />;
}
