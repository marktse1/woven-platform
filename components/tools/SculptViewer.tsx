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

// ── Clay shader ──────────────────────────────────────────────────────────────
// Half-lambert diffuse + broad specular + fresnel rim — mimics ZBrush clay.
const CLAY_VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormal    = normalize(normalMatrix * normal);
    vViewDir   = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CLAY_FRAG = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uColor;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);

    // Baked light directions: key (upper-left-front), fill (lower-right), back rim
    vec3 L1 = normalize(vec3( 0.6,  1.0,  0.8));
    vec3 L2 = normalize(vec3(-0.5, -0.3,  0.4));
    vec3 L3 = normalize(vec3(-0.3,  0.5, -1.0));

    // Half-lambert on key — wraps light softly around the form (ZBrush clay look)
    float d1 = pow(dot(n, L1) * 0.5 + 0.5, 2.0);
    // Subtle fill
    float d2 = max(0.0, dot(n, L2)) * 0.22;
    // Warm back rim
    float d3 = max(0.0, dot(n, L3)) * 0.35;

    // Broad matte specular — not shiny, just a soft sheen
    vec3 H1   = normalize(L1 + v);
    float spec = pow(max(0.0, dot(n, H1)), 6.0) * 0.10;

    // Cool fresnel glow on silhouette edges
    float fresnel = pow(1.0 - max(0.0, dot(n, v)), 3.5) * 0.14;

    vec3 color = uColor * (d1 * 0.78 + d2 + d3);
    color += vec3(spec);
    color += fresnel * vec3(0.55, 0.65, 0.90);

    gl_FragColor = vec4(color, 1.0);
  }
`;

type Props = {
  glbData: ArrayBuffer | null;
  brushMode: BrushMode;
  brushRadius: number;
  brushInnerRadius: number;
  brushStrength: number;
  clayMode?: boolean;
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
  clayMode = false,
  clayColor = "#c4a882",
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

  // Clay material refs
  const clayMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const originalMaterialsRef = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());
  const clayModeRef = useRef(clayMode);
  const clayColorRef = useRef(clayColor);
  useEffect(() => { clayModeRef.current = clayMode; }, [clayMode]);
  useEffect(() => { clayColorRef.current = clayColor; }, [clayColor]);

  function getClayMat(color: string): THREE.ShaderMaterial {
    if (!clayMatRef.current) {
      clayMatRef.current = new THREE.ShaderMaterial({
        vertexShader: CLAY_VERT,
        fragmentShader: CLAY_FRAG,
        uniforms: { uColor: { value: new THREE.Color(color).convertSRGBToLinear() } },
      });
    } else {
      (clayMatRef.current.uniforms.uColor.value as THREE.Color).set(color).convertSRGBToLinear();
    }
    return clayMatRef.current;
  }

  // ── clay material toggle ─────────────────────────────────────────────────
  useEffect(() => {
    const group = modelRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return;

    if (clayMode) {
      scene.background = new THREE.Color("#1c1c1c");
      const mat = getClayMat(clayColor);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!originalMaterialsRef.current.has(m.uuid)) {
          originalMaterialsRef.current.set(m.uuid, m.material);
        }
        m.material = mat;
      });
    } else {
      scene.background = new THREE.Color("#1a1614");
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const orig = originalMaterialsRef.current.get(m.uuid);
        if (orig !== undefined) m.material = orig;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clayMode, clayColor]);

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

    // Brush indicator ring
    const ringGeo = new THREE.TorusGeometry(1, 0.008, 6, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.visible = false;
    ring.renderOrder = 999;
    scene.add(ring);
    brushIndicatorRef.current = ring;

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

      // If clay mode was already active, apply immediately to new model
      if (clayModeRef.current) {
        const mat = getClayMat(clayColorRef.current);
        group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          originalMaterialsRef.current.set(m.uuid, m.material);
          m.material = mat;
        });
      }

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
      if (!ring) return;
      if (!hit) { ring.visible = false; return; }
      ring.visible = true;
      ring.scale.setScalar(brushRadiusRef.current);
      ring.position.copy(hit.point);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
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
    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
      exporter.parse(
        modelRef.current!,
        (result) => resolve(new Uint8Array(result as ArrayBuffer)),
        reject,
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
