"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  StrokeTracker,
  createHeightField,
  stampDab,
  stampHeightDab,
  stampRestoreDab,
  type HeightField,
  type Rgb,
} from "@/lib/paint/brush";
import { deriveNormalRegion, deriveNormalFull, blendNormalsAdditive } from "@/lib/paint/heightToNormal";
import { PaintUndoStack, canvasSurface, heightFieldSurface } from "@/lib/paint/undo";

export type ViewChannel = "combined" | "albedo" | "normal" | "ao";
export type PaintChannel = "albedo" | "relief";

export type BrushSettings = {
  size: number;
  opacity: number;
  hardness: number;
  color: Rgb;
  reliefStrength: number;
};

export type LightInfo = {
  id: string;
  intensity: number;
  distance: number;
};

export type PaintViewerHandle = {
  undo: () => void;
  redo: () => void;
  getExport: () => { albedoCanvas: HTMLCanvasElement; normalImage: ImageData } | null;
  addLight: () => void;
  deleteSelectedLight: () => void;
  deleteAllLights: () => void;
  setSelectedLightIntensity: (v: number) => void;
  setSelectedLightDistance: (v: number) => void;
  setLightsGizmosVisible: (v: boolean) => void;
};

type Props = {
  data: ArrayBuffer | null;
  seedAlbedo: ImageBitmap | null;
  seedBaseNormal: ImageData | null;
  seedAO: ImageBitmap | null;
  seedMetallicRoughness: ImageBitmap | null;
  roughnessFactor: number;
  metallicFactor: number;
  textureSize: number;
  viewChannel: ViewChannel;
  paintChannel: PaintChannel;
  erasing: boolean;
  brush: BrushSettings;
  paintMode: boolean;
  showGrid?: boolean;
  onUndoRedoChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  onLoadError?: (message: string) => void;
  onLightSelect?: (light: LightInfo | null) => void;
};

type LightEntry = {
  id: string;
  pointLight: THREE.PointLight;
  gizmoGroup: THREE.Group;
  coreSphere: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
};

// Objects on this layer are "bloom sources" and survive the darken pass.
const BLOOM_LAYER = 1;
const BLOOM_LAYERS = new THREE.Layers();
BLOOM_LAYERS.set(BLOOM_LAYER);

// HDR white — well above the bloom threshold of 0 used in the bloom composer.
const BALL_COLOR = new THREE.Color(4, 4, 4);
const BALL_COLOR_SELECTED = new THREE.Color(5, 4, 1.5); // warm gold when selected

// Mix shader: additively composites the bloom texture onto the base render.
const BLOOM_MIX_SHADER = {
  uniforms: { baseTexture: { value: null as THREE.Texture | null }, bloomTexture: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D( baseTexture, vUv ) + texture2D( bloomTexture, vUv );
    }
  `,
};

function makeGizmoGroup(radius: number) {
  const coreMat = new THREE.MeshBasicMaterial({ color: BALL_COLOR.clone() });
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 16), coreMat);
  // Enable bloom layer so the ball is not darkened during the bloom pass.
  core.layers.enable(BLOOM_LAYER);
  const group = new THREE.Group();
  group.layers.enable(BLOOM_LAYER);
  group.add(core);
  return { group, core, coreMat };
}

function disposeLightEntry(entry: LightEntry, scene: THREE.Scene) {
  scene.remove(entry.pointLight);
  entry.gizmoGroup.children.forEach((child) => {
    const m = child as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material)?.dispose();
  });
  scene.remove(entry.gizmoGroup);
}

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  return found;
}

const NORMAL_DERIVE_STRENGTH = 8;

function makeFlatNormalImage(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128; data[i + 1] = 128; data[i + 2] = 255; data[i + 3] = 255;
  }
  return new ImageData(data, size, size);
}

const PaintViewer = forwardRef<PaintViewerHandle, Props>(function PaintViewer(
  {
    data,
    seedAlbedo,
    seedBaseNormal,
    seedAO,
    seedMetallicRoughness,
    roughnessFactor,
    metallicFactor,
    textureSize,
    viewChannel,
    paintChannel,
    erasing,
    brush,
    paintMode,
    showGrid = true,
    onUndoRedoChange,
    onLoadError,
    onLightSelect,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const lightRadiusRef = useRef(6);
  const gizmoRadiusRef = useRef(0.08);

  const userLightsRef = useRef<LightEntry[]>([]);
  const selectedLightIdRef = useRef<string | null>(null);
  const lightsGizmosVisibleRef = useRef(true);

  const albedoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const albedoCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const pristineAlbedoRef = useRef<ImageData | null>(null);
  const heightFieldRef = useRef<HeightField | null>(null);
  const baseNormalRef = useRef<ImageData | null>(null);
  const normalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const normalCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const albedoTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const normalTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const aoTextureRef = useRef<THREE.Texture | null>(null);
  const standardMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const debugMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  const strokeTrackerRef = useRef(new StrokeTracker());
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => { onLoadErrorRef.current = onLoadError; }, [onLoadError]);
  const onLightSelectRef = useRef(onLightSelect);
  useEffect(() => { onLightSelectRef.current = onLightSelect; }, [onLightSelect]);

  const undoStackRef = useRef(new PaintUndoStack());
  const activeStrokeRef = useRef(false);
  const albedoDirtyRef = useRef(false);
  const normalDirtyRef = useRef(false);

  const viewChannelRef = useRef(viewChannel);
  const paintChannelRef = useRef(paintChannel);
  const erasingRef = useRef(erasing);
  const brushRef = useRef(brush);
  const paintModeRef = useRef(paintMode);
  useEffect(() => { viewChannelRef.current = viewChannel; }, [viewChannel]);
  useEffect(() => { paintChannelRef.current = paintChannel; }, [paintChannel]);
  useEffect(() => { erasingRef.current = erasing; }, [erasing]);
  useEffect(() => { brushRef.current = brush; }, [brush]);
  useEffect(() => {
    paintModeRef.current = paintMode;
    if (transformControlsRef.current) {
      const tc = transformControlsRef.current;
      tc.enabled = !paintMode;
      tc.getHelper().visible = !paintMode && tc.object !== undefined;
    }
    if (controlsRef.current) {
      // Orbit is on in orbit mode only when no light is selected (light selection disables it).
      controlsRef.current.enabled = !paintMode && selectedLightIdRef.current === null;
    }
  }, [paintMode]);

  // ---- stable helpers -------------------------------------------------------

  const selectLight = useCallback((id: string | null) => {
    const tc = transformControlsRef.current;
    userLightsRef.current.forEach((e) => {
      e.coreMat.color.copy(e.id === id ? BALL_COLOR_SELECTED : BALL_COLOR);
    });
    selectedLightIdRef.current = id;
    if (tc) {
      if (id) {
        const entry = userLightsRef.current.find((e) => e.id === id);
        if (entry) {
          tc.attach(entry.gizmoGroup);
          if (paintModeRef.current) tc.getHelper().visible = false;
          // Disable orbit so TC owns all pointer events while a light is selected.
          if (controlsRef.current) controlsRef.current.enabled = false;
        } else {
          tc.detach();
        }
      } else {
        tc.detach();
        // Re-enable orbit when nothing is selected (and not painting).
        if (controlsRef.current && !paintModeRef.current) controlsRef.current.enabled = true;
      }
    }
    const entry = id ? userLightsRef.current.find((e) => e.id === id) : null;
    onLightSelectRef.current?.(
      entry ? { id: entry.id, intensity: entry.pointLight.intensity, distance: entry.pointLight.distance } : null,
    );
  }, []);

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
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enabled = !paintModeRef.current;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2230, 1.6));

    // TransformControls for XYZ arrow handles on the selected light.
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setMode("translate");
    tc.enabled = !paintModeRef.current;
    // In Three.js 0.16x+, TransformControls extends Controls (not Object3D).
    // The renderable gizmo is tc.getHelper() — that's what goes in the scene.
    scene.add(tc.getHelper());
    transformControlsRef.current = tc;

    const tcObjectMovedRef = { current: false };
    tc.addEventListener("objectChange", () => {
      const obj = tc.object;
      if (!obj) return;
      const entry = userLightsRef.current.find((l) => l.gizmoGroup === obj);
      if (entry) entry.pointLight.position.copy(obj.position);
      tcObjectMovedRef.current = true;
    });

    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", () => { tcObjectMovedRef.current = false; });
    dom.addEventListener("click", (e: MouseEvent) => {
      if (paintModeRef.current) return;
      if (tcObjectMovedRef.current) return;
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const cores = userLightsRef.current.map((l) => l.coreSphere);
      const hits = ray.intersectObjects(cores);
      if (hits.length > 0) {
        const entry = userLightsRef.current.find((l) => l.coreSphere === hits[0].object);
        if (entry) selectLight(entry.id);
      } else {
        selectLight(null);
      }
    });

    const grid = new THREE.GridHelper(10, 20, 0x26384a, 0x1a2530);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.visible = showGrid;
    gridRef.current = grid;
    scene.add(grid);

    // ---- Selective bloom setup -----------------------------------------------
    //
    // bloomComposer: darken everything not on BLOOM_LAYER, apply UnrealBloomPass,
    //   render offscreen → bloom texture.
    // finalComposer: render scene normally, mix shader additively composites the
    //   bloom texture on top, OutputPass converts to sRGB.
    //
    // Threshold is 0 because only light balls survive the darken pass — no need
    // to rely on luminance cutoff; everything visible should bloom.

    const w0 = mount.clientWidth || 1;
    const h0 = mount.clientHeight || 1;

    const bloomComposer = new EffectComposer(renderer);
    bloomComposer.renderToScreen = false;
    bloomComposer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w0, h0), 1.4, 0.6, 0.0);
    bloomComposer.addPass(bloomPass);

    const mixShader = { ...BLOOM_MIX_SHADER, uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } } };
    const finalComposer = new EffectComposer(renderer);
    finalComposer.addPass(new RenderPass(scene, camera));
    const mixPass = new ShaderPass(new THREE.ShaderMaterial(mixShader), "baseTexture");
    mixPass.needsSwap = true;
    finalComposer.addPass(mixPass);
    finalComposer.addPass(new OutputPass());

    // Darken / restore helpers used around the bloom pass.
    const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const savedMaterials = new Map<string, THREE.Material | THREE.Material[]>();

    function darkenNonBloomed(obj: THREE.Object3D) {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && !mesh.layers.test(BLOOM_LAYERS)) {
        savedMaterials.set(mesh.uuid, mesh.material);
        mesh.material = darkMaterial;
      }
    }
    function restoreMaterials(obj: THREE.Object3D) {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && savedMaterials.has(mesh.uuid)) {
        mesh.material = savedMaterials.get(mesh.uuid) as THREE.Material | THREE.Material[];
        savedMaterials.delete(mesh.uuid);
      }
    }

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      bloomComposer.setSize(w, h);
      finalComposer.setSize(w, h);
      bloomPass.resolution.set(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const tick = () => {
      controls.update();
      if (albedoDirtyRef.current && albedoTextureRef.current) {
        albedoTextureRef.current.needsUpdate = true;
        albedoDirtyRef.current = false;
      }
      if (normalDirtyRef.current && normalTextureRef.current) {
        normalTextureRef.current.needsUpdate = true;
        normalDirtyRef.current = false;
      }
      // Selective bloom: darken non-bloom objects → bloom pass → restore → full render + mix.
      scene.traverse(darkenNonBloomed);
      bloomComposer.render();
      scene.traverse(restoreMaterials);
      finalComposer.render();
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.remove(tc.getHelper());
      tc.dispose();
      userLightsRef.current.forEach((e) => disposeLightEntry(e, scene));
      userLightsRef.current = [];
      bloomComposer.dispose();
      finalComposer.dispose();
      darkMaterial.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- load model + seed paint canvases -------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (groupRef.current) {
      scene.remove(groupRef.current);
      groupRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      groupRef.current = null;
      meshRef.current = null;
    }
    if (!data) return;

    const loader = new GLTFLoader();
    loader.parse(
      data.slice(0),
      "",
      (gltf) => {
        const group = gltf.scene;
        const mesh = findFirstMesh(group);
        if (!mesh || !mesh.geometry.attributes.uv) {
          console.error("PaintViewer: no UV-mapped mesh found in this GLB.");
          onLoadErrorRef.current?.("This model has no UV-mapped mesh to paint on.");
          return;
        }
        meshRef.current = mesh;
        groupRef.current = group;

        const size = textureSize;

        const albedoCanvas = document.createElement("canvas");
        albedoCanvas.width = size; albedoCanvas.height = size;
        const actx = albedoCanvas.getContext("2d", { willReadFrequently: true })!;
        if (seedAlbedo) actx.drawImage(seedAlbedo, 0, 0, size, size);
        else { actx.fillStyle = "#9aa3ab"; actx.fillRect(0, 0, size, size); }
        albedoCanvasRef.current = albedoCanvas;
        albedoCtxRef.current = actx;
        pristineAlbedoRef.current = actx.getImageData(0, 0, size, size);

        heightFieldRef.current = createHeightField(size, size);
        baseNormalRef.current = seedBaseNormal ?? makeFlatNormalImage(size);

        const normalCanvas = document.createElement("canvas");
        normalCanvas.width = size; normalCanvas.height = size;
        const nctx = normalCanvas.getContext("2d", { willReadFrequently: true })!;
        nctx.putImageData(baseNormalRef.current, 0, 0);
        normalCanvasRef.current = normalCanvas;
        normalCtxRef.current = nctx;

        const albedoTexture = new THREE.CanvasTexture(albedoCanvas);
        albedoTexture.flipY = false;
        albedoTexture.colorSpace = THREE.SRGBColorSpace;
        const normalTexture = new THREE.CanvasTexture(normalCanvas);
        normalTexture.flipY = false;
        normalTexture.colorSpace = THREE.NoColorSpace;
        albedoTextureRef.current = albedoTexture;
        normalTextureRef.current = normalTexture;

        let aoTexture: THREE.Texture | null = null;
        if (seedAO) {
          const aoCanvas = document.createElement("canvas");
          aoCanvas.width = seedAO.width; aoCanvas.height = seedAO.height;
          aoCanvas.getContext("2d")!.drawImage(seedAO, 0, 0);
          aoTexture = new THREE.CanvasTexture(aoCanvas);
          aoTexture.flipY = false; aoTexture.colorSpace = THREE.NoColorSpace;
        }
        aoTextureRef.current = aoTexture;

        let metallicRoughnessTexture: THREE.Texture | null = null;
        if (seedMetallicRoughness) {
          const mrCanvas = document.createElement("canvas");
          mrCanvas.width = seedMetallicRoughness.width; mrCanvas.height = seedMetallicRoughness.height;
          mrCanvas.getContext("2d")!.drawImage(seedMetallicRoughness, 0, 0);
          metallicRoughnessTexture = new THREE.CanvasTexture(mrCanvas);
          metallicRoughnessTexture.flipY = false; metallicRoughnessTexture.colorSpace = THREE.NoColorSpace;
        }

        const material = new THREE.MeshStandardMaterial({
          map: albedoTexture,
          normalMap: normalTexture,
          aoMap: aoTexture ?? null,
          roughness: roughnessFactor,
          metalness: metallicFactor,
          roughnessMap: metallicRoughnessTexture,
          metalnessMap: metallicRoughnessTexture,
        });
        standardMaterialRef.current = material;
        debugMaterialRef.current = new THREE.MeshBasicMaterial({ color: 0xffffff });
        mesh.material = material;

        undoStackRef.current = new PaintUndoStack();
        onUndoRedoChange?.({ canUndo: false, canRedo: false });

        const box = new THREE.Box3().setFromObject(group);
        const sizeVec = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z) || 1;
        group.position.sub(center);

        const dist = maxDim * 2.2;
        camera.position.set(dist * 0.7, dist * 0.5, dist);
        camera.near = maxDim / 100;
        camera.far = maxDim * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();

        lightRadiusRef.current = dist;
        gizmoRadiusRef.current = Math.max(0.01, dist * 0.012);

        scene.add(group);
      },
      (err) => {
        console.error("PaintViewer: GLB parse error", err);
        onLoadErrorRef.current?.(err instanceof Error ? err.message : "Could not load this model for painting.");
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, seedAlbedo, seedBaseNormal, seedAO, seedMetallicRoughness, roughnessFactor, metallicFactor, textureSize]);

  // ---- channel switcher -----------------------------------------------------
  useEffect(() => {
    const mesh = meshRef.current;
    const standard = standardMaterialRef.current;
    const debugMat = debugMaterialRef.current;
    if (!mesh || !standard || !debugMat) return;

    if (viewChannel === "combined") { mesh.material = standard; return; }
    const slot: Record<Exclude<ViewChannel, "combined">, { tex: THREE.Texture | null; space: THREE.ColorSpace }> = {
      albedo: { tex: albedoTextureRef.current, space: THREE.SRGBColorSpace },
      normal: { tex: normalTextureRef.current, space: THREE.NoColorSpace },
      ao: { tex: aoTextureRef.current, space: THREE.NoColorSpace },
    };
    const { tex, space } = slot[viewChannel];
    if (tex) tex.colorSpace = space;
    debugMat.map = tex;
    debugMat.color.set(tex ? 0xffffff : 0x333333);
    debugMat.needsUpdate = true;
    mesh.material = debugMat;
  }, [viewChannel]);

  // ---- grid -----------------------------------------------------------------
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  // ---- pointer-driven painting ----------------------------------------------
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    const dom = renderer.domElement;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    function uvAtEvent(e: PointerEvent): { x: number; y: number } | null {
      const mesh = meshRef.current;
      if (!mesh) return null;
      const rect = dom.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera!);
      const hits = raycaster.intersectObject(mesh, false);
      const uv = hits[0]?.uv;
      if (!uv) return null;
      return { x: uv.x, y: uv.y };
    }

    function uvToAlbedoPixel(uv: { x: number; y: number }): { x: number; y: number } {
      const canvas = albedoCanvasRef.current!;
      return { x: uv.x * canvas.width, y: uv.y * canvas.height };
    }

    function recomputeNormalRegion(rect: { x: number; y: number; width: number; height: number }) {
      const heightField = heightFieldRef.current;
      const baseNormal = baseNormalRef.current;
      const normalCtx = normalCtxRef.current;
      if (!heightField || !baseNormal || !normalCtx) return;
      const derived = new ImageData(heightField.width, heightField.height);
      const writtenRegion = deriveNormalRegion(heightField, derived, rect, NORMAL_DERIVE_STRENGTH);
      const blended = blendNormalsAdditive(baseNormal, derived, writtenRegion);
      normalCtx.putImageData(blended, 0, 0, writtenRegion.x, writtenRegion.y, writtenRegion.width, writtenRegion.height);
      normalDirtyRef.current = true;
    }

    function paintAt(uv: { x: number; y: number }) {
      const channel = paintChannelRef.current;
      const erase = erasingRef.current;
      const b = brushRef.current;

      if (channel === "albedo") {
        const ctx = albedoCtxRef.current;
        const pristine = pristineAlbedoRef.current;
        if (!ctx) return;
        const point = uvToAlbedoPixel(uv);
        const points = strokeTrackerRef.current.pointsTo(point, b.size);
        for (const p of points) {
          const surface = canvasSurface(ctx);
          if (erase && pristine) {
            undoStackRef.current.trackDirty(surface, { x: p.x - b.size, y: p.y - b.size, width: b.size * 2, height: b.size * 2 }, ctx.canvas.width, ctx.canvas.height);
            const rect = stampRestoreDab(ctx, pristine, p, { radius: b.size, hardness: b.hardness, opacity: b.opacity });
            strokeTrackerRef.current.addDirty(rect);
          } else {
            undoStackRef.current.trackDirty(surface, { x: p.x - b.size, y: p.y - b.size, width: b.size * 2, height: b.size * 2 }, ctx.canvas.width, ctx.canvas.height);
            const rect = stampDab(ctx, p, { radius: b.size, hardness: b.hardness, opacity: b.opacity, color: b.color });
            strokeTrackerRef.current.addDirty(rect);
          }
        }
        albedoDirtyRef.current = true;
      } else {
        const field = heightFieldRef.current;
        if (!field) return;
        const point = uvToAlbedoPixel(uv);
        const points = strokeTrackerRef.current.pointsTo(point, b.size);
        const sign = erase ? -Math.sign(b.reliefStrength || 1) : Math.sign(b.reliefStrength || 1);
        const magnitude = Math.max(1, Math.abs(b.reliefStrength) * 40);
        for (const p of points) {
          const surface = heightFieldSurface(field);
          undoStackRef.current.trackDirty(surface, { x: p.x - b.size, y: p.y - b.size, width: b.size * 2, height: b.size * 2 }, field.width, field.height);
          const rect = stampHeightDab(field, p, { radius: b.size, hardness: b.hardness, delta: sign * magnitude });
          strokeTrackerRef.current.addDirty(rect);
          recomputeNormalRegion(rect);
        }
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (!paintModeRef.current) return;
      const uv = uvAtEvent(e);
      if (!uv) return;
      dom.setPointerCapture(e.pointerId);
      activeStrokeRef.current = true;
      strokeTrackerRef.current.reset();
      undoStackRef.current.beginStroke(paintChannelRef.current === "albedo" ? "albedo" : "height");
      paintAt(uv);
    }

    function onPointerMove(e: PointerEvent) {
      if (!activeStrokeRef.current) return;
      const uv = uvAtEvent(e);
      if (!uv) return;
      paintAt(uv);
    }

    function endStroke() {
      if (!activeStrokeRef.current) return;
      activeStrokeRef.current = false;
      const channel = paintChannelRef.current;
      if (channel === "albedo" && albedoCtxRef.current) {
        undoStackRef.current.endStroke(canvasSurface(albedoCtxRef.current));
      } else if (channel === "relief" && heightFieldRef.current) {
        undoStackRef.current.endStroke(heightFieldSurface(heightFieldRef.current));
      }
      strokeTrackerRef.current.reset();
      onUndoRedoChange?.({ canUndo: undoStackRef.current.canUndo(), canRedo: undoStackRef.current.canRedo() });
    }

    function onPointerUp(e: PointerEvent) {
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      endStroke();
    }

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointercancel", onPointerUp);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerUp);
    };
  }, [onUndoRedoChange]);

  useImperativeHandle(
    ref,
    () => ({
      undo() {
        const ctx = albedoCtxRef.current;
        const field = heightFieldRef.current;
        const result = undoStackRef.current.undo((id) => (id === "albedo" ? canvasSurface(ctx!) : heightFieldSurface(field!)));
        if (result) {
          if (result.canvas === "albedo") albedoDirtyRef.current = true;
          else recomputeNormalAfterUndo(result.rect);
        }
        onUndoRedoChange?.({ canUndo: undoStackRef.current.canUndo(), canRedo: undoStackRef.current.canRedo() });
      },
      redo() {
        const ctx = albedoCtxRef.current;
        const field = heightFieldRef.current;
        const result = undoStackRef.current.redo((id) => (id === "albedo" ? canvasSurface(ctx!) : heightFieldSurface(field!)));
        if (result) {
          if (result.canvas === "albedo") albedoDirtyRef.current = true;
          else recomputeNormalAfterUndo(result.rect);
        }
        onUndoRedoChange?.({ canUndo: undoStackRef.current.canUndo(), canRedo: undoStackRef.current.canRedo() });
      },
      getExport() {
        const albedoCanvas = albedoCanvasRef.current;
        const heightField = heightFieldRef.current;
        const baseNormal = baseNormalRef.current;
        if (!albedoCanvas || !heightField || !baseNormal) return null;
        const derived = deriveNormalFull(heightField, NORMAL_DERIVE_STRENGTH);
        const normalImage = blendNormalsAdditive(baseNormal, derived);
        return { albedoCanvas, normalImage };
      },
      addLight() {
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (!scene || !camera) return;

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const pos = camera.position.clone().add(forward.multiplyScalar(lightRadiusRef.current * 0.65));

        const id = Math.random().toString(36).slice(2, 10);
        const pointLight = new THREE.PointLight(0xffffff, 2.0, 0);
        pointLight.position.copy(pos);
        scene.add(pointLight);

        const { group, core, coreMat } = makeGizmoGroup(gizmoRadiusRef.current);
        group.position.copy(pos);
        group.visible = lightsGizmosVisibleRef.current;
        scene.add(group);

        userLightsRef.current = [...userLightsRef.current, { id, pointLight, gizmoGroup: group, coreSphere: core, coreMat }];
        selectLight(id);
      },
      deleteSelectedLight() {
        const id = selectedLightIdRef.current;
        const scene = sceneRef.current;
        const tc = transformControlsRef.current;
        if (!id || !scene) return;
        const entry = userLightsRef.current.find((e) => e.id === id);
        if (!entry) return;
        tc?.detach();
        disposeLightEntry(entry, scene);
        userLightsRef.current = userLightsRef.current.filter((e) => e.id !== id);
        selectedLightIdRef.current = null;
        onLightSelectRef.current?.(null);
      },
      deleteAllLights() {
        const scene = sceneRef.current;
        const tc = transformControlsRef.current;
        if (!scene) return;
        tc?.detach();
        userLightsRef.current.forEach((e) => disposeLightEntry(e, scene));
        userLightsRef.current = [];
        selectedLightIdRef.current = null;
        onLightSelectRef.current?.(null);
      },
      setSelectedLightIntensity(v: number) {
        const id = selectedLightIdRef.current;
        if (!id) return;
        const entry = userLightsRef.current.find((e) => e.id === id);
        if (entry) {
          entry.pointLight.intensity = v;
          onLightSelectRef.current?.({ id, intensity: v, distance: entry.pointLight.distance });
        }
      },
      setSelectedLightDistance(v: number) {
        const id = selectedLightIdRef.current;
        if (!id) return;
        const entry = userLightsRef.current.find((e) => e.id === id);
        if (entry) {
          entry.pointLight.distance = v;
          onLightSelectRef.current?.({ id, intensity: entry.pointLight.intensity, distance: v });
        }
      },
      setLightsGizmosVisible(v: boolean) {
        lightsGizmosVisibleRef.current = v;
        userLightsRef.current.forEach((e) => { e.gizmoGroup.visible = v; });
        if (!v) transformControlsRef.current?.detach();
      },
    }),
    [onUndoRedoChange, selectLight],
  );

  function recomputeNormalAfterUndo(rect: { x: number; y: number; width: number; height: number }) {
    const heightField = heightFieldRef.current;
    const baseNormal = baseNormalRef.current;
    const normalCtx = normalCtxRef.current;
    if (!heightField || !baseNormal || !normalCtx) return;
    const derived = deriveNormalFull(heightField, NORMAL_DERIVE_STRENGTH);
    const blended = blendNormalsAdditive(baseNormal, derived, rect);
    normalCtx.putImageData(blended, 0, 0, rect.x, rect.y, rect.width, rect.height);
    normalDirtyRef.current = true;
  }

  return <div ref={mountRef} className="w-full h-full min-h-[260px]" style={{ cursor: paintMode ? "crosshair" : "grab" }} />;
});

export default PaintViewer;
