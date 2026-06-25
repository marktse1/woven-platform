"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  /** Brush radius in canvas pixels. */
  size: number;
  opacity: number;
  hardness: number;
  color: Rgb;
  /** Signed -1..1: sign picks raise vs lower for the relief brush. */
  reliefStrength: number;
};

export type PaintViewerHandle = {
  undo: () => void;
  redo: () => void;
  /** Pulls out the final paintable state for export - runs a full-image normal derivation, not just dirty regions. */
  getExport: () => { albedoCanvas: HTMLCanvasElement; normalImage: ImageData } | null;
};

type Props = {
  data: ArrayBuffer | null;
  seedAlbedo: ImageBitmap | null;
  /** Pre-decoded existing normal map, already sized to `textureSize` - the static base layer relief blends onto. Null = flat. */
  seedBaseNormal: ImageData | null;
  seedAO: ImageBitmap | null;
  textureSize: number;
  viewChannel: ViewChannel;
  paintChannel: PaintChannel;
  erasing: boolean;
  brush: BrushSettings;
  /** When true, drag paints; when false, drag orbits. An explicit toggle, not a modifier key. */
  paintMode: boolean;
  onUndoRedoChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /** Called if the GLB fails to parse or has no UV-mapped mesh - without this, a failure left nothing rendered with no visible signal why. */
  onLoadError?: (message: string) => void;
};

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  return found;
}

/** How strongly the height gradient translates into normal tilt - a fixed intensity, decoupled from the brush's raise/lower sign slider. */
const NORMAL_DERIVE_STRENGTH = 8;

function makeFlatNormalImage(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return new ImageData(data, size, size);
}

const PaintViewer = forwardRef<PaintViewerHandle, Props>(function PaintViewer(
  { data, seedAlbedo, seedBaseNormal, seedAO, textureSize, viewChannel, paintChannel, erasing, brush, paintMode, onUndoRedoChange, onLoadError },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

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
  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);
  const undoStackRef = useRef(new PaintUndoStack());
  const activeStrokeRef = useRef(false);
  const albedoDirtyRef = useRef(false);
  const normalDirtyRef = useRef(false);

  // Live-read refs so pointer handlers (attached once) always see current prop values.
  const viewChannelRef = useRef(viewChannel);
  const paintChannelRef = useRef(paintChannel);
  const erasingRef = useRef(erasing);
  const brushRef = useRef(brush);
  const paintModeRef = useRef(paintMode);
  useEffect(() => {
    viewChannelRef.current = viewChannel;
  }, [viewChannel]);
  useEffect(() => {
    paintChannelRef.current = paintChannel;
  }, [paintChannel]);
  useEffect(() => {
    erasingRef.current = erasing;
  }, [erasing]);
  useEffect(() => {
    brushRef.current = brush;
  }, [brush]);
  useEffect(() => {
    paintModeRef.current = paintMode;
    if (controlsRef.current) controlsRef.current.enabled = !paintMode;
  }, [paintMode]);

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
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enabled = !paintModeRef.current;
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
    scene.add(grid);

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
      if (albedoDirtyRef.current && albedoTextureRef.current) {
        albedoTextureRef.current.needsUpdate = true;
        albedoDirtyRef.current = false;
      }
      if (normalDirtyRef.current && normalTextureRef.current) {
        normalTextureRef.current.needsUpdate = true;
        normalDirtyRef.current = false;
      }
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

  // ---- load model + seed paint canvases on data/seed change ----------------
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
        albedoCanvas.width = size;
        albedoCanvas.height = size;
        const actx = albedoCanvas.getContext("2d", { willReadFrequently: true })!;
        if (seedAlbedo) actx.drawImage(seedAlbedo, 0, 0, size, size);
        else {
          actx.fillStyle = "#9aa3ab";
          actx.fillRect(0, 0, size, size);
        }
        albedoCanvasRef.current = albedoCanvas;
        albedoCtxRef.current = actx;
        pristineAlbedoRef.current = actx.getImageData(0, 0, size, size);

        heightFieldRef.current = createHeightField(size, size);
        baseNormalRef.current = seedBaseNormal ?? makeFlatNormalImage(size);

        const normalCanvas = document.createElement("canvas");
        normalCanvas.width = size;
        normalCanvas.height = size;
        const nctx = normalCanvas.getContext("2d", { willReadFrequently: true })!;
        nctx.putImageData(baseNormalRef.current, 0, 0);
        normalCanvasRef.current = normalCanvas;
        normalCtxRef.current = nctx;

        // GLTFLoader sets flipY = false on every texture it loads (confirmed
        // in three.js source) - our canvases are seeded from the same image
        // data GLTFLoader would use, so matching flipY here is what makes
        // Substance Weaver render identically to Mesh Loom's ModelViewer
        // instead of vertically mismatched.
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
          aoCanvas.width = seedAO.width;
          aoCanvas.height = seedAO.height;
          aoCanvas.getContext("2d")!.drawImage(seedAO, 0, 0);
          aoTexture = new THREE.CanvasTexture(aoCanvas);
          aoTexture.flipY = false;
          aoTexture.colorSpace = THREE.NoColorSpace;
        }
        aoTextureRef.current = aoTexture;

        const material = new THREE.MeshStandardMaterial({
          map: albedoTexture,
          normalMap: normalTexture,
          aoMap: aoTexture ?? null,
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

        scene.add(group);
      },
      (err) => {
        console.error("PaintViewer: GLB parse error", err);
        onLoadErrorRef.current?.(err instanceof Error ? err.message : "Could not load this model for painting.");
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, seedAlbedo, seedBaseNormal, seedAO, textureSize]);

  // ---- channel switcher: swap which material is on the mesh -----------------
  useEffect(() => {
    const mesh = meshRef.current;
    const standard = standardMaterialRef.current;
    const debugMat = debugMaterialRef.current;
    if (!mesh || !standard || !debugMat) return;

    if (viewChannel === "combined") {
      mesh.material = standard;
      return;
    }
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

  // ---- pointer-driven painting ------------------------------------------------
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
      // No vertical flip here - consistent with flipY = false on our
      // textures above (matching GLTFLoader), v=0 maps directly to canvas
      // row 0, same orientation the seeded image data already has.
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
      // putImageData's dirty-rect overload writes only this sub-region, even
      // though `blended` covers the whole canvas - no manual slicing needed.
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
        const point = uvToAlbedoPixel(uv); // same canvas-space convention, height field shares albedo's resolution/orientation
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
    }),
    [onUndoRedoChange],
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
