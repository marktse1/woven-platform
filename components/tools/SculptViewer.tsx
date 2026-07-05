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
import { computeAvgEdgeLen, dynTopoRefine } from "@/lib/sculpt/dyntopo";
import { detectQuads, catmullClarkSubdivide } from "@/lib/sculpt/catmullclark";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Patch Three.js raycaster to use BVH acceleration
(THREE.Mesh.prototype as THREE.Mesh & { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

type SculptMeshEntry = {
  mesh: THREE.Mesh;
  seams: SeamData;
  paintCanvas?: HTMLCanvasElement;
  paintTexture?: THREE.CanvasTexture;
  paintMat?: THREE.MeshBasicMaterial;
  hasPaint?: boolean;
  baseEdgeLen?: number;
  /** Quad face index buffer for Catmull-Clark subdivision (4 indices per quad, CCW). Empty = Loop fallback. */
  quadIndices?: Uint32Array;
};

const PAINT_TEX_SIZE = 1024;
export type SculptViewerHandle = {
  exportGlb: () => Promise<Uint8Array>;
  undo: () => void;
  redo: () => void;
  subdivide: () => void;
  loadPrimitive: (type: PrimitiveType) => void;
  remesh: () => void;
  loadGeometry: (geo: THREE.BufferGeometry, name?: string) => void;
  clearScene: () => void;
};

export type ViewMode = "combined" | "clay" | "wireframe" | "albedo" | "ao";
export type PrimitiveType = "sphere" | "box" | "cylinder" | "cone" | "torus" | "capsule" | "plane" | "human";

// ── MatCap clay texture generator (CPU / canvas) ──────────────────────────────
// Generates a 256×256 sphere image on a canvas using view-space lighting.
// Canvas approach avoids WebGL render-target color-space issues entirely.
// ── Primitive geometry helpers ────────────────────────────────────────────────
function buildHumanBase(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  function add(geo: THREE.BufferGeometry, x: number, y: number, z: number) {
    geo.translate(x, y, z); parts.push(geo);
  }
  add(new THREE.SphereGeometry(0.13, 10, 8),           0,     1.65, 0);      // head
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.10, 8), 0,     1.52, 0);     // neck
  add(new THREE.BoxGeometry(0.42, 0.52, 0.22),          0,     1.10, 0);     // torso
  add(new THREE.BoxGeometry(0.40, 0.22, 0.22),          0,     0.75, 0);     // hips
  add(new THREE.SphereGeometry(0.08, 8, 6),            -0.24,  1.32, 0);     // L shoulder
  add(new THREE.SphereGeometry(0.08, 8, 6),             0.24,  1.32, 0);     // R shoulder
  add(new THREE.CylinderGeometry(0.065, 0.06, 0.28, 8),-0.30, 1.10, 0);     // L upper arm
  add(new THREE.CylinderGeometry(0.065, 0.06, 0.28, 8), 0.30, 1.10, 0);     // R upper arm
  add(new THREE.SphereGeometry(0.065, 8, 6),           -0.30,  0.94, 0);     // L elbow
  add(new THREE.SphereGeometry(0.065, 8, 6),            0.30,  0.94, 0);     // R elbow
  add(new THREE.CylinderGeometry(0.055, 0.05, 0.26, 8),-0.30, 0.82, 0);     // L forearm
  add(new THREE.CylinderGeometry(0.055, 0.05, 0.26, 8), 0.30, 0.82, 0);     // R forearm
  add(new THREE.BoxGeometry(0.10, 0.14, 0.05),         -0.30,  0.66, 0);     // L hand
  add(new THREE.BoxGeometry(0.10, 0.14, 0.05),          0.30,  0.66, 0);     // R hand
  add(new THREE.CylinderGeometry(0.105, 0.095, 0.38, 10),-0.12,0.47, 0);    // L thigh
  add(new THREE.CylinderGeometry(0.105, 0.095, 0.38, 10), 0.12,0.47, 0);    // R thigh
  add(new THREE.SphereGeometry(0.09, 8, 6),            -0.12,  0.27, 0);     // L knee
  add(new THREE.SphereGeometry(0.09, 8, 6),             0.12,  0.27, 0);     // R knee
  add(new THREE.CylinderGeometry(0.08, 0.065, 0.36, 10),-0.12, 0.08, 0);    // L shin
  add(new THREE.CylinderGeometry(0.08, 0.065, 0.36, 10), 0.12, 0.08, 0);    // R shin
  add(new THREE.SphereGeometry(0.07, 8, 6),            -0.12, -0.11, 0);     // L ankle
  add(new THREE.SphereGeometry(0.07, 8, 6),             0.12, -0.11, 0);     // R ankle
  add(new THREE.BoxGeometry(0.12, 0.07, 0.22),         -0.12, -0.155,0.04);  // L foot
  add(new THREE.BoxGeometry(0.12, 0.07, 0.22),          0.12, -0.155,0.04);  // R foot
  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  merged.translate(0, -0.795, 0); // center vertically
  return merged;
}

function buildPrimitiveGeometry(type: PrimitiveType): THREE.BufferGeometry {
  switch (type) {
    case "sphere":   return new THREE.SphereGeometry(1, 16, 12);
    case "box":      return new THREE.BoxGeometry(1.8, 1.8, 1.8);
    case "cylinder": return new THREE.CylinderGeometry(0.8, 0.8, 2, 16);
    case "cone":     return new THREE.ConeGeometry(1, 2, 16);
    case "torus":    return new THREE.TorusGeometry(0.8, 0.35, 12, 24);
    case "capsule":  return new THREE.CapsuleGeometry(0.7, 1.4, 8, 16);
    case "plane":    return new THREE.PlaneGeometry(2, 2, 4, 4);
    case "human":    return buildHumanBase();
    default:         return new THREE.SphereGeometry(1, 16, 12);
  }
}
// ─────────────────────────────────────────────────────────────────────────────
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
  paintColor?: string;
  dynTopo?: boolean;
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
  paintColor = "#e8925a",
  dynTopo = false,
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
  const lastUVRef = useRef<{ uv: THREE.Vector2; mesh: THREE.Mesh } | null>(null);
  const altDownRef = useRef(false);
  const shiftDownRef = useRef(false);
  const dynTopoRef = useRef(false);
  useEffect(() => { dynTopoRef.current = dynTopo; }, [dynTopo]);

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
  const paintColorRef = useRef(paintColor);
  useEffect(() => { paintColorRef.current = paintColor; }, [paintColor]);

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
      // Handle wire overlays first — LineSegments are not isMesh
      if (o.name === "__wire") { o.visible = vm === "wireframe"; return; }
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
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

  // ── paint brush mode: swap mesh materials ──────────────────────────────────
  useEffect(() => {
    const group = modelRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return;
    if (brushMode === "paint") {
      meshEntriesRef.current.forEach((entry) => {
        if (entry.paintMat) entry.mesh.material = entry.paintMat;
      });
    } else {
      applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushMode]);


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
        const baseEdgeLen = computeAvgEdgeLen(mesh.geometry);
        // Build paint canvas — getContext("2d") can return null in some environments.
        // Skip drawImage seeding (CORS taints canvas); always use a flat grey base.
        let paintEntry: Partial<SculptMeshEntry> = {};
        try {
          const pc = document.createElement("canvas"); pc.width = pc.height = PAINT_TEX_SIZE;
          const pCtx = pc.getContext("2d");
          if (pCtx) {
            pCtx.fillStyle = "#888888"; pCtx.fillRect(0, 0, PAINT_TEX_SIZE, PAINT_TEX_SIZE);
            const pt = new THREE.CanvasTexture(pc); pt.colorSpace = THREE.SRGBColorSpace;
            const pm = new THREE.MeshBasicMaterial({ map: pt });
            paintEntry = { paintCanvas: pc, paintTexture: pt, paintMat: pm };
          }
        } catch { /* canvas context unavailable */ }
        const quadIndices = detectQuads(mesh.geometry);
        meshEntriesRef.current.push({ mesh, seams, baseEdgeLen, quadIndices, ...paintEntry });
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
      lastUVRef.current = nearest.uv ? { uv: nearest.uv.clone(), mesh: nearest.object as THREE.Mesh } : null;
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


    // ── UV texture painting ──────────────────────────────────────────────────
    function applyPaintDab() {
      const uvHit = lastUVRef.current;
      if (!uvHit) return;
      const entry = meshEntriesRef.current.find((e) => e.mesh === uvHit.mesh);
      if (!entry?.paintCanvas || !entry.paintTexture) return;
      const canvas = entry.paintCanvas;
      const ctx = canvas.getContext("2d")!;
      const u = uvHit.uv.x;
      const v = 1 - uvHit.uv.y; // flip Y for canvas
      const cx = u * PAINT_TEX_SIZE;
      const cy = v * PAINT_TEX_SIZE;
      const r = Math.max(1, brushRadiusRef.current * 80);
      const innerR = r * brushInnerRadiusRef.current;
      const hex = paintColorRef.current;
      const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, r);
      grad.addColorStop(0, hex);
      grad.addColorStop(1, hex + "00");
      ctx.save();
      ctx.globalAlpha = brushStrengthRef.current;
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      entry.paintTexture.needsUpdate = true;
      entry.hasPaint = true;
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


      // Apply on first down
      const isPaint = brushModeRef.current === "paint";
      if (isPaint) {
        applyPaintDab();
      } else {
        const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 1.0;
        for (const entry of meshEntriesRef.current) {
          applyBrush({
            mode: shiftDownRef.current ? "smooth" : brushModeRef.current,
            radius: brushRadiusRef.current,
            innerRadius: brushInnerRadiusRef.current,
            strength: brushStrengthRef.current * pressure,
            hit,
            mesh: entry.mesh,
            seams: entry.seams,
            invert: altDownRef.current,
          });
        }
      }
    }

    function onPointerMove(e: PointerEvent) {
      const hit = getHitFromEvent(e);
      updateIndicator(hit);

      if (!strokeActiveRef.current || !hit) return;
      const prevHit = lastHitRef.current ?? undefined;


      if (brushModeRef.current === "paint") {
        applyPaintDab();
      } else {
        const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 1.0;
        for (const entry of meshEntriesRef.current) {
          applyBrush({
            mode: shiftDownRef.current ? "smooth" : brushModeRef.current,
            radius: brushRadiusRef.current,
            innerRadius: brushInnerRadiusRef.current,
            strength: brushStrengthRef.current * pressure,
            hit,
            prevHit,
            mesh: entry.mesh,
            seams: entry.seams,
            invert: altDownRef.current,
          });
        }
      }
      lastHitRef.current = hit;
      lastHitRef.current = hit;
    }

    function onPointerUp(e: PointerEvent) {
      if (!strokeActiveRef.current) return;
      strokeActiveRef.current = false;
      lastHitRef.current = null;
      controlsRef.current!.enabled = true;
      mount.releasePointerCapture(e.pointerId);

      if (dynTopoRef.current && meshEntriesRef.current.length > 0) {
        let totalVerts = 0;
        let anyChanged = false;
        for (const entry of meshEntriesRef.current) {
          const changed = dynTopoRefine(
            entry.mesh.geometry,
            entry.baseEdgeLen ?? 0.05,
            { maxNewVerts: 2000, passes: 3 },
          );
          if (changed) {
            anyChanged = true;
            entry.mesh.geometry.boundsTree = new MeshBVH(entry.mesh.geometry);
            entry.seams = buildSeamData(entry.mesh.geometry.attributes.position.array as Float32Array);
            const wire = entry.mesh.children.find((c) => c.name === "__wire");
            if (wire) {
              entry.mesh.remove(wire);
              const newWire = new THREE.LineSegments(
                new THREE.WireframeGeometry(entry.mesh.geometry),
                (wire as THREE.LineSegments).material as THREE.Material,
              );
              newWire.name = "__wire";
              newWire.visible = (wire as THREE.Object3D).visible;
              newWire.renderOrder = 999;
              entry.mesh.add(newWire);
            }
          }
          totalVerts += entry.mesh.geometry.attributes.position.count;
        }
        // Topology changed — old position snapshots are now invalid
        if (anyChanged) {
          undoRef.current.clear();
          onModelLoadedRef.current?.(totalVerts);
        }
      }
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

  // Modifier key tracking: Shift = smooth override, Alt/Option = invert
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.key === "Shift") shiftDownRef.current = true; if (e.key === "Alt") altDownRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shiftDownRef.current = false; if (e.key === "Alt") altDownRef.current = false; };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
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

    // If any mesh has been painted, bake the paint canvas into the export material.
    // Prefer cloning the original GLTF MeshStandardMaterial and patching only its
    // albedo slot so roughness/metallic/normals/AO are preserved. Fall back to the
    // plain MeshBasicMaterial for primitives (whose original is a clay matcap).
    const swapped: Array<{ mesh: THREE.Mesh; prev: THREE.Material | THREE.Material[] }> = [];
    for (const entry of meshEntriesRef.current) {
      if (!entry.hasPaint || !entry.paintTexture) continue;
      const origMat = originalMaterialsRef.current.get(entry.mesh.uuid);
      if (origMat && (origMat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        const baked = (origMat as THREE.MeshStandardMaterial).clone();
        baked.map = entry.paintTexture;
        baked.needsUpdate = true;
        swapped.push({ mesh: entry.mesh, prev: entry.mesh.material });
        entry.mesh.material = baked;
      } else if (entry.paintMat && entry.mesh.material !== entry.paintMat) {
        swapped.push({ mesh: entry.mesh, prev: entry.mesh.material });
        entry.mesh.material = entry.paintMat;
      }
    }

    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
      exporter.parse(
        modelRef.current!,
        (result) => {
          detached.forEach(({ parent, obj }) => parent.add(obj));
          swapped.forEach(({ mesh, prev }) => { mesh.material = prev; });
          resolve(new Uint8Array(result as ArrayBuffer));
        },
        (err) => {
          detached.forEach(({ parent, obj }) => parent.add(obj));
          swapped.forEach(({ mesh, prev }) => { mesh.material = prev; });
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

  const subdivide = useCallback(() => {
    if (meshEntriesRef.current.length === 0) return;
    // Vertex cap — Loop subdivision ≈ 4× vertex count; block before hitting WebGL limits
    const currentVerts = meshEntriesRef.current.reduce(
      (s, e) => s + e.mesh.geometry.attributes.position.count, 0,
    );
    if (currentVerts * 4 > 1_000_000) {
      onLoadErrorRef.current?.("Subdivide would exceed 1M vertices — save and reduce the mesh first.");
      return;
    }
    // Subdivision changes topology (new vertex count), so position snapshots from previous
    // sculpt strokes would be invalid after this point. Clear rather than push.
    undoRef.current.clear();
    let totalVerts = 0;
    for (const entry of meshEntriesRef.current) {
      const { mesh } = entry;
      const { geometry: subdivided, newQuadIndices } = catmullClarkSubdivide(
        mesh.geometry,
        entry.quadIndices ?? new Uint32Array(0),
      );
      mesh.geometry.dispose();
      mesh.geometry = subdivided;
      mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
      entry.quadIndices = newQuadIndices; // 4× quads for the next level
      const posArr = mesh.geometry.attributes.position.array as Float32Array;
      entry.seams = buildSeamData(posArr);
      // Rebuild wireframe overlay
      const wire = mesh.children.find((c) => c.name === "__wire");
      if (wire) {
        mesh.remove(wire);
        const newWire = new THREE.LineSegments(
          new THREE.WireframeGeometry(mesh.geometry),
          (wire as THREE.LineSegments).material as THREE.Material,
        );
        newWire.name = "__wire";
        newWire.visible = (wire as THREE.Object3D).visible;
        newWire.renderOrder = 999;
        mesh.add(newWire);
      }
      totalVerts += mesh.geometry.attributes.position.count;
    }
    onModelLoadedRef.current?.(totalVerts);
  }, []);

  const remesh = useCallback(() => {
    if (meshEntriesRef.current.length === 0) return;
    undoRef.current.clear();
    let totalVerts = 0;
    for (const entry of meshEntriesRef.current) {
      const changed = dynTopoRefine(
        entry.mesh.geometry,
        entry.baseEdgeLen ?? 0.05,
        { maxNewVerts: 10_000, passes: 6 },
      );
      if (changed) {
        entry.mesh.geometry.boundsTree = new MeshBVH(entry.mesh.geometry);
        entry.seams = buildSeamData(entry.mesh.geometry.attributes.position.array as Float32Array);
        const wire = entry.mesh.children.find((c) => c.name === "__wire");
        if (wire) {
          entry.mesh.remove(wire);
          const newWire = new THREE.LineSegments(
            new THREE.WireframeGeometry(entry.mesh.geometry),
            (wire as THREE.LineSegments).material as THREE.Material,
          );
          newWire.name = "__wire";
          newWire.visible = (wire as THREE.Object3D).visible;
          newWire.renderOrder = 999;
          entry.mesh.add(newWire);
        }
      }
      totalVerts += entry.mesh.geometry.attributes.position.count;
    }
    onModelLoadedRef.current?.(totalVerts);
  }, []);

  const loadPrimitive = useCallback((type: PrimitiveType) => {
    const scene   = sceneRef.current;
    const camera  = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    // Clear existing
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
    // Build geometry
    const geo = buildPrimitiveGeometry(type);
    geo.computeVertexNormals();
    if (!geo.index) {
      const vCount = geo.attributes.position.count;
      const idx = new Uint32Array(vCount);
      for (let i = 0; i < vCount; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    geo.boundsTree = new MeshBVH(geo);
    const mat = clayMatRef.current ?? new THREE.MeshMatcapMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    if (!wireMatRef.current) {
      wireMatRef.current = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthTest: false });
    }
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), wireMatRef.current);
    wire.name = "__wire"; wire.visible = false; wire.renderOrder = 999;
    mesh.add(wire);
    const posArr = geo.attributes.position.array as Float32Array;
    const seams = buildSeamData(posArr);
    const pc2 = document.createElement("canvas"); pc2.width = pc2.height = PAINT_TEX_SIZE;
    const pCtx2 = pc2.getContext("2d")!; pCtx2.fillStyle = "#888888"; pCtx2.fillRect(0, 0, PAINT_TEX_SIZE, PAINT_TEX_SIZE);
    const pt2 = new THREE.CanvasTexture(pc2); pt2.colorSpace = THREE.SRGBColorSpace;
    const pm2 = new THREE.MeshBasicMaterial({ map: pt2 });
    const primQuadIndices = detectQuads(geo);
    meshEntriesRef.current.push({ mesh, seams, baseEdgeLen: computeAvgEdgeLen(geo), quadIndices: primQuadIndices, paintCanvas: pc2, paintTexture: pt2, paintMat: pm2 });
    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);
    modelRef.current = group;
    originalMaterialsRef.current.clear();
    originalMaterialsRef.current.set(mesh.uuid, mesh.material);
    channelMatsRef.current.forEach((m) => m.dispose());
    channelMatsRef.current = [];
    // Frame camera
    const box = new THREE.Box3().setFromObject(group);
    const sz  = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
    const dist = maxDim * 2.2;
    camera.position.set(dist * 0.7, dist * 0.5, dist);
    camera.near = maxDim / 100; camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0); controls.update();
    applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);
    onModelLoadedRef.current?.(geo.attributes.position.count);
  }, []);


  const loadGeometry = useCallback((geo: THREE.BufferGeometry, _name?: string) => {
    const scene    = sceneRef.current;
    const camera   = cameraRef.current;
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

    geo.computeVertexNormals();
    if (!geo.index) {
      const vCount = geo.attributes.position.count;
      const idx = new Uint32Array(vCount);
      for (let i = 0; i < vCount; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    geo.boundsTree = new MeshBVH(geo);
    const mat = clayMatRef.current ?? new THREE.MeshMatcapMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    if (!wireMatRef.current) {
      wireMatRef.current = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthTest: false });
    }
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), wireMatRef.current);
    wire.name = "__wire"; wire.visible = false; wire.renderOrder = 999;
    mesh.add(wire);
    const posArr = geo.attributes.position.array as Float32Array;
    const seams = buildSeamData(posArr);
    const pc = document.createElement("canvas"); pc.width = pc.height = PAINT_TEX_SIZE;
    const pCtx = pc.getContext("2d")!; pCtx.fillStyle = "#888888"; pCtx.fillRect(0, 0, PAINT_TEX_SIZE, PAINT_TEX_SIZE);
    const pt = new THREE.CanvasTexture(pc); pt.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.MeshBasicMaterial({ map: pt });
    meshEntriesRef.current.push({ mesh, seams, baseEdgeLen: computeAvgEdgeLen(geo), quadIndices: detectQuads(geo), paintCanvas: pc, paintTexture: pt, paintMat: pm });
    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);
    modelRef.current = group;
    originalMaterialsRef.current.clear();
    originalMaterialsRef.current.set(mesh.uuid, mesh.material);
    channelMatsRef.current.forEach((m) => m.dispose());
    channelMatsRef.current = [];
    const box = new THREE.Box3().setFromObject(group);
    const sz  = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
    const dist = maxDim * 2.2;
    camera.position.set(dist * 0.7, dist * 0.5, dist);
    camera.near = maxDim / 100; camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0); controls.update();
    applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);
    onModelLoadedRef.current?.(geo.attributes.position.count);
  }, []);

  const clearScene = useCallback(() => {
    const scene = sceneRef.current;
    if (modelRef.current && scene) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) { m.geometry.boundsTree = undefined; m.geometry.dispose(); }
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => mat.dispose());
        }
      });
      modelRef.current = null;
    }
    meshEntriesRef.current = [];
    undoRef.current.clear();
    originalMaterialsRef.current.clear();
    channelMatsRef.current.forEach((m) => m.dispose());
    channelMatsRef.current = [];
    onModelLoadedRef.current?.(0);
  }, []);

  useEffect(() => {
    if (handleRef) {
      (handleRef as React.MutableRefObject<SculptViewerHandle | null>).current = { exportGlb, undo, redo, subdivide, loadPrimitive, remesh, loadGeometry, clearScene };
    }
  }, [handleRef, exportGlb, undo, redo, subdivide, loadPrimitive, remesh, loadGeometry, clearScene]);

  return <div ref={mountRef} className="w-full h-full" style={{ touchAction: "none" }} />;
}
