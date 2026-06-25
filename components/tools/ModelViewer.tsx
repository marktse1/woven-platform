"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type SegmentationOverlay = {
  /** One entry per triangle, in mesh/primitive iteration order — see lib/retopo/segment.ts. */
  trianglePerSegment: Int32Array;
  /** Optional explicit hex color per segment id; falls back to a generated palette. */
  segmentColors?: string[];
};

export type TextureChannel = "albedo" | "normal" | "ao" | "roughness" | "metallic";

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
  /** Called if the GLB fails to parse - without this, a failure left the previous model torn down with nothing shown and no visible signal why. */
  onLoadError?: (message: string) => void;
};

/** Deterministic, visually-distinct palette — golden-angle hue stepping needs no lookup table. */
function paletteColor(index: number): THREE.Color {
  const hue = (index * 137.508) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.65, 0.55);
}

/**
 * Paints per-vertex colors from a triangle->segment map and flips
 * `vertexColors` on each mesh's material(s). Assumes `group`'s meshes are
 * traversed in the same mesh/primitive order segmentByConnectivity used to
 * build `trianglePerSegment` (true for the GLTFLoader scene graphs this app
 * produces); revisit with an explicit index if that ever drifts.
 */
function applySegmentationToGroup(group: THREE.Group, segmentation: SegmentationOverlay | null | undefined): void {
  if (!segmentation || !segmentation.trianglePerSegment.length) return;
  let triCursor = 0;
  const colorCache = new Map<number, THREE.Color>();
  const colorFor = (segId: number): THREE.Color => {
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
 */
function applyTextureChannelToGroup(
  group: THREE.Group,
  channel: TextureChannel | null | undefined,
  originalMaterials: WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>,
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

    const slot: Record<TextureChannel, THREE.Texture | null> = {
      albedo: sourceMat.map ?? null,
      normal: sourceMat.normalMap ?? null,
      ao: sourceMat.aoMap ?? null,
      roughness: sourceMat.roughnessMap ?? null,
      metallic: sourceMat.metalnessMap ?? null,
    };
    const tex = slot[channel];
    if (tex) tex.colorSpace = channel === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x333333 });
  });
}

export default function ModelViewer({ data, wireframe, showGrid = true, accent = "#56a6e8", segmentation = null, textureChannel = null, onLoadError }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const wireMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const originalMaterialsRef = useRef<WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>>(new WeakMap());
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  // ---- one-time scene setup -------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0a0e13");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    camera.position.set(2.4, 1.8, 3.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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

    const grid = new THREE.GridHelper(10, 20, 0x26384a, 0x1a2530);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.visible = showGrid;
    gridRef.current = grid;
    scene.add(grid);

    wireMatRef.current = new THREE.LineBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.5,
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
    if (!data) return;

    const loader = new GLTFLoader();
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

        applySegmentationToGroup(group, segmentation);
        applyTextureChannelToGroup(group, textureChannel, originalMaterialsRef.current);

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
  }, [data, wireframe, segmentation, textureChannel]);

  // ---- toggle wireframe overlay ---------------------------------------------
  useEffect(() => {
    const group = modelRef.current;
    if (!group) return;
    group.traverse((o) => {
      if (o.name === "__wire") o.visible = wireframe;
    });
  }, [wireframe]);

  // ---- toggle grid visibility -------------------------------------------------
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  return <div ref={mountRef} className="w-full h-full min-h-[260px]" />;
}
