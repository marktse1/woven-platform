"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type SegmentationOverlay = {
  /** One entry per triangle, in mesh/primitive iteration order — see lib/retopo/segment.ts. */
  trianglePerSegment: Int32Array;
  /** Optional explicit hex color per segment id; falls back to a generated palette. */
  segmentColors?: string[];
};

export type TextureChannel = "albedo" | "normal" | "ao" | "roughness" | "metallic";

// Generates a MatCap sphere texture on a CPU canvas — avoids render-target color space issues.
function generateClayMatcap(color: THREE.Color, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

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
      const ny = 1.0 - (y + 0.5) / size * 2.0;
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
  /** Raw GLB bytes to display, or null for an empty stage. */
  data: ArrayBuffer | null;
  /** Show a wireframe overlay on top of the shaded mesh. */
  wireframe: boolean;
  /** Show the ground-plane grid helper. Defaults to true. */
  showGrid?: boolean;
  accent?: string;
  /** Color-overlay triangles by segment (from segmentByConnectivity or a Tier-2 part-label job). */
  segmentation?: SegmentationOverlay | null;
  /** Preview a single baked PBR channel directly instead of standard shading. */
  textureChannel?: TextureChannel | null;
  /** Replace all materials with a ZBrush-style clay shader to evaluate form. */
  clayMode?: boolean;
  clayColor?: string;
  /** Highlight one segment and dim all others — set from hovering a row in the segment list. */
  focusedSegId?: number | null;
  /** Called if the GLB fails to parse - without this, a failure left the previous model torn down with nothing shown and no visible signal why. */
  onLoadError?: (message: string) => void;
  /** Optional decimated preview mesh shown as a high-contrast x-ray wireframe to preview retopo density. */
  previewData?: ArrayBuffer | null;
};

/** Deterministic, visually-distinct palette — golden-angle hue stepping needs no lookup table. */
function paletteColor(index: number): THREE.Color {
  const hue = (index * 137.508) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.65, 0.55);
}

/**
 * Paints per-vertex colors from a triangle->segment map and flips
 * `vertexColors` on each mesh's material(s). When `focusedSegId` is set,
 * all other segments are dimmed to a dark neutral so the focused one pops.
 */
function applySegmentationToGroup(
  group: THREE.Group,
  segmentation: SegmentationOverlay | null | undefined,
  focusedSegId: number | null = null,
): void {
  if (!segmentation || !segmentation.trianglePerSegment.length) return;
  let triCursor = 0;
  const colorCache = new Map<number, THREE.Color>();
  const DIM = new THREE.Color(0.12, 0.11, 0.10);
  const colorFor = (segId: number): THREE.Color => {
    if (focusedSegId !== null && segId !== focusedSegId) return DIM;
    const explicit = segmentation.segmentColors?.[segId];
    if (explicit) return new THREE.Color(explicit);
    let c = colorCache.get(segId);
    if (!c) {
      c = paletteColor(segId);
      colorCache.set(segId, c);
    }
    return c;
  };

  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry;
    const index = geom.getIndex();
    const position = geom.getAttribute("position");
    if (!index || !position) return;

    const triCount = index.count / 3;
    const colors = new Float32Array(position.count * 3).fill(0.55);
    const indexArray = index.array as Uint16Array | Uint32Array;

    for (let t = 0; t < triCount; t++) {
      const segId = segmentation.trianglePerSegment[triCursor + t] ?? 0;
      const color = colorFor(segId);
      for (let k = 0; k < 3; k++) {
        const vi = indexArray[t * 3 + k];
        colors[vi * 3] = color.r;
        colors[vi * 3 + 1] = color.g;
        colors[vi * 3 + 2] = color.b;
      }
    }

    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      (m as THREE.MeshStandardMaterial).vertexColors = true;
      m.needsUpdate = true;
    }
    triCursor += triCount;
  });
}

/**
 * Swaps each mesh's material for a debug material exposing one raw PBR
 * texture slot, or restores the original material when `channel` is null.
 * Non-color channels (normal/AO/roughness/metallic) are flagged NoColorSpace
 * so they don't get double gamma-corrected the way albedo should be.
 *
 * `channelCache` is a caller-owned Map that persists across calls. Debug
 * materials are created once per (mesh, channel) pair and reused — this
 * prevents a WebGL shader recompile (which causes the mesh to go invisible
 * for a frame) on every mode switch.
 */
function applyTextureChannelToGroup(
  group: THREE.Group,
  channel: TextureChannel | null | undefined,
  originalMaterials: WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>,
  channelCache: Map<string, THREE.MeshBasicMaterial>,
): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, mesh.material);

    if (!channel) {
      const original = originalMaterials.get(mesh);
      if (original) mesh.material = original;
      return;
    }

    const original = originalMaterials.get(mesh);
    const sourceMat = (Array.isArray(original) ? original[0] : original) as THREE.MeshStandardMaterial | undefined;
    if (!sourceMat) return;

    const cacheKey = `${mesh.uuid}-${channel}`;
    let debugMat = channelCache.get(cacheKey);
    if (!debugMat) {
      const slot: Record<TextureChannel, THREE.Texture | null> = {
        albedo: sourceMat.map ?? null,
        normal: sourceMat.normalMap ?? null,
        ao: sourceMat.aoMap ?? null,
        roughness: sourceMat.roughnessMap ?? null,
        metallic: sourceMat.metalnessMap ?? null,
      };
      const tex = slot[channel];
      if (tex) tex.colorSpace = channel === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      debugMat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x333333 });
      channelCache.set(cacheKey, debugMat);
    }
    mesh.material = debugMat;
  });
}

export default function ModelViewer({ data, wireframe, showGrid = true, accent = "#56a6e8", segmentation = null, textureChannel = null, clayMode = false, clayColor = "#ebe7e1", focusedSegId = null, onLoadError, previewData }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const ktx2LoaderRef = useRef<KTX2Loader | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const wireMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const previewMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const previewGroupRef = useRef<THREE.Group | null>(null);
  const originalMaterialsRef = useRef<WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>>(new WeakMap());
  const clayMatRef = useRef<THREE.MeshMatcapMaterial | null>(null);
  const clayMatcapTexRef = useRef<THREE.Texture | null>(null);
  const lastClayColorRef = useRef<string>("");
  const clayOriginalMatsRef = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());
  const channelMaterialCacheRef = useRef<Map<string, THREE.MeshBasicMaterial>>(new Map());
  const onLoadErrorRef = useRef(onLoadError);
  const segmentationRef = useRef(segmentation);
  const textureChannelRef = useRef(textureChannel);
  const focusedSegIdRef = useRef(focusedSegId);
  useEffect(() => { onLoadErrorRef.current = onLoadError; }, [onLoadError]);
  useEffect(() => { segmentationRef.current = segmentation; }, [segmentation]);
  useEffect(() => { textureChannelRef.current = textureChannel; }, [textureChannel]);
  useEffect(() => { focusedSegIdRef.current = focusedSegId; }, [focusedSegId]);

  // ---- one-time scene setup -------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#241f1b");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    camera.position.set(2.4, 1.8, 3.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath("/basis/");
    ktx2Loader.detectSupport(renderer);
    ktx2LoaderRef.current = ktx2Loader;

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
    (grid.material as THREE.Material).opacity = 0.6;
    grid.visible = showGrid;
    gridRef.current = grid;
    scene.add(grid);

    wireMatRef.current = new THREE.LineBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.5,
    });
    previewMatRef.current = new THREE.LineBasicMaterial({
      color: new THREE.Color("#00ffcc"),
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });

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
      ktx2LoaderRef.current?.dispose();
      ktx2LoaderRef.current = null;
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- load / replace model on data (or overlay) change ---------------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      modelRef.current = null;
    }
    originalMaterialsRef.current = new WeakMap();
    clayOriginalMatsRef.current.clear();
    for (const mat of channelMaterialCacheRef.current.values()) mat.dispose();
    channelMaterialCacheRef.current.clear();
    if (!data) return;

    const loader = new GLTFLoader();
    if (ktx2LoaderRef.current) loader.setKTX2Loader(ktx2LoaderRef.current);
    loader.parse(
      data.slice(0),
      "",
      (gltf) => {
        const group = gltf.scene;

        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          const wire = new THREE.LineSegments(
            new THREE.WireframeGeometry(mesh.geometry),
            wireMatRef.current!,
          );
          wire.name = "__wire";
          wire.visible = wireframe;
          mesh.add(wire);
        });

        applySegmentationToGroup(group, segmentationRef.current, focusedSegIdRef.current);
        applyTextureChannelToGroup(group, textureChannelRef.current, originalMaterialsRef.current, channelMaterialCacheRef.current);

        // frame the model
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
      },
      (err) => {
        console.error("GLB parse error", err);
        onLoadErrorRef.current?.(err instanceof Error ? err.message : "Could not render this model.");
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ---- toggle wireframe overlay ---------------------------------------------
  useEffect(() => {
    const group = modelRef.current;
    if (!group) return;
    group.traverse((o) => {
      if (o.name === "__wire") o.visible = wireframe;
    });
  }, [wireframe]);

  // ---- x-ray preview wireframe (density preview for retopo target) ----------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove previous preview
    if (previewGroupRef.current) {
      scene.remove(previewGroupRef.current);
      previewGroupRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if ((m as unknown as THREE.LineSegments).isLineSegments) {
          (m.material as THREE.Material)?.dispose();
        }
      });
      previewGroupRef.current = null;
    }

    if (!previewData) return;

    const loader = new GLTFLoader();
    if (ktx2LoaderRef.current) loader.setKTX2Loader(ktx2LoaderRef.current);
    loader.parse(
      previewData.slice(0),
      "",
      (gltf) => {
        const group = gltf.scene;
        // Center using same strategy as the main model
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        group.position.sub(center);

        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          // Hide the surface — we only want the wireframe
          (mesh.material as THREE.Material).visible = false;
          const wire = new THREE.LineSegments(
            new THREE.WireframeGeometry(mesh.geometry),
            previewMatRef.current!,
          );
          wire.name = "__preview_wire";
          mesh.add(wire);
        });

        previewGroupRef.current = group;
        scene.add(group);
      },
      (err) => console.warn("preview GLB parse error", err),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewData]);

  // ---- live texture channel switch — no model reload -----------------------
  useEffect(() => {
    const group = modelRef.current;
    if (!group) return;
    // Pass the material cache so debug materials are reused across switches,
    // avoiding the WebGL shader recompile that makes the mesh flicker invisible.
    applyTextureChannelToGroup(group, textureChannel, originalMaterialsRef.current, channelMaterialCacheRef.current);
    // No needsUpdate needed: mesh.material reassignment is detected automatically.
  }, [textureChannel]);

  // ---- live segmentation update — no model reload --------------------------
  useEffect(() => {
    const group = modelRef.current;
    if (!group) return;
    applySegmentationToGroup(group, segmentation, focusedSegId);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat.needsUpdate = true;
      }
    });
  }, [segmentation, focusedSegId]);

  // ---- toggle grid visibility -------------------------------------------------
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  // ---- clay material toggle ---------------------------------------------------
  useEffect(() => {
    const group = modelRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return;

    if (clayMode) {
      if (!clayMatRef.current || lastClayColorRef.current !== clayColor) {
        clayMatcapTexRef.current?.dispose();
        const tex = generateClayMatcap(new THREE.Color(clayColor).convertSRGBToLinear());
        clayMatcapTexRef.current = tex;
        if (!clayMatRef.current) {
          clayMatRef.current = new THREE.MeshMatcapMaterial({ matcap: tex });
        } else {
          clayMatRef.current.matcap = tex;
          clayMatRef.current.needsUpdate = true;
        }
        lastClayColorRef.current = clayColor;
      }
      scene.background = new THREE.Color("#1c1c1c");
      const mat = clayMatRef.current;
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.name === "__wire") return;
        if (!clayOriginalMatsRef.current.has(m.uuid)) {
          clayOriginalMatsRef.current.set(m.uuid, m.material);
        }
        m.material = mat;
      });
    } else {
      scene.background = new THREE.Color("#241f1b");
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.name === "__wire") return;
        const orig = clayOriginalMatsRef.current.get(m.uuid);
        if (orig !== undefined) m.material = orig;
      });
      clayOriginalMatsRef.current.clear();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clayMode, clayColor]);

  // ---- wireframe color: dark grey in clay mode, accent otherwise ------------
  useEffect(() => {
    if (wireMatRef.current) {
      wireMatRef.current.color.set(clayMode ? "#3d3838" : accent);
      wireMatRef.current.opacity = clayMode ? 0.7 : 0.5;
      wireMatRef.current.needsUpdate = true;
    }
  }, [clayMode, accent]);

  return <div ref={mountRef} className="w-full h-full min-h-[260px]" />;
}
