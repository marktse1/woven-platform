"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useCreatorStatus } from "@/lib/useCreatorStatus";
import { useActiveLoader } from "@/components/assets/ActiveLoaderContext";
import {
  uploadAsset,
  overwriteAssetBytes,
  signedAssetUrl,
  type AssetRow,
} from "@/lib/assets";
import type { SculptViewerHandle, ViewMode, PrimitiveType, EditMode, SelectMode, PolyEditSelectTool, TransformMode, HighlightMode, BoneViewerMode, TransformField } from "@/components/tools/SculptViewer";
import type { ControlAttachment } from "@/lib/sculpt/curve";
import type { BrushMode } from "@/lib/sculpt/brushes";
import type * as THREE from "three";

const SculptViewer = dynamic(() => import("@/components/tools/SculptViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-dim text-[13px]">
      Initialising 3D canvas…
    </div>
  ),
});

// ── Brush icons (all inline SVG — no external files needed) ─────────────────
function BrushIcon({ mode, active }: { mode: BrushMode; active: boolean }) {
  const s = active ? "#ffffff" : "#8aa0b4";
  const w = "1.6";
  const ICON_PNGS: Partial<Record<BrushMode, string>> = { clay_buildup: "/claybuildup.png", push: "/inflate.png", flatten: "/flatten.png", move: "/move.png", pinch: "/pinch.png", slice: "/slice.png", smooth: "/smooth.png", paint: "/paint.png", mask: "/mask.png" };
  const png = ICON_PNGS[mode];
  if (png) return (
    <Image src={png} alt={mode} width={64} height={64}
      style={{ filter: active ? "brightness(1.2) drop-shadow(0 0 6px rgba(196,123,232,0.6))" : "brightness(0.9) saturate(0.6)", transition: "filter 0.15s" }} />
  );
  if (mode === "clay_buildup") return (
    <svg width="64" height="64" viewBox="0 0 22 22" fill="none">
      {/* mound */}
      <path d="M3 16 Q11 4 19 16 Z" fill={active ? "#ffffff33" : "#8aa0b422"} stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      {/* upward arrow from tip */}
      <line x1="11" y1="10" x2="11" y2="4" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="8.5,6.5 11,4 13.5,6.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
  if (mode === "push") return (
    <svg width="64" height="64" viewBox="0 0 22 22" fill="none">
      <path d="M3 16 Q11 3 19 16" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <line x1="11" y1="8" x2="11" y2="2" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="8.5,4.5 11,2 13.5,4.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );

  if (mode === "flatten") return (
    <svg width="64" height="64" viewBox="0 0 22 22" fill="none">
      {/* flat line */}
      <line x1="2" y1="11" x2="20" y2="11" stroke={s} strokeWidth="2" strokeLinecap="round" />
      {/* vertices being pressed toward it */}
      <line x1="6"  y1="7"  x2="6"  y2="10" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <line x1="11" y1="5"  x2="11" y2="10" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <line x1="16" y1="7"  x2="16" y2="10" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="4,8.5 6,11 8,8.5"   stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="9,7.5 11,10 13,7.5"  stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="14,8.5 16,11 18,8.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
  if (mode === "move") return (
    <svg width="64" height="64" viewBox="0 0 22 22" fill="none">
      {/* center dot */}
      <circle cx="11" cy="11" r="1.5" fill={s} />
      {/* four arrows */}
      <line x1="11" y1="9.5"  x2="11" y2="3"  stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="8.5,5.5 11,3 13.5,5.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="11" y1="12.5" x2="11" y2="19" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="8.5,16.5 11,19 13.5,16.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="9.5"  y1="11" x2="3"  y2="11" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="5.5,8.5 3,11 5.5,13.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="12.5" y1="11" x2="19" y2="11" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="16.5,8.5 19,11 16.5,13.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
  // smooth (default fallback)
  return (
    <svg width="64" height="64" viewBox="0 0 22 22" fill="none">
      <path d="M2 15 Q5 9 8 15 Q11 21 14 15 Q17 9 20 15" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <line x1="2" y1="8" x2="20" y2="8" stroke={s} strokeWidth={w} strokeLinecap="round" strokeDasharray="2.5 2.5" />
    </svg>
  );
}
// ─────────────────────────────────────────────────────────────────────────────


type BrushDef = { mode: BrushMode; label: string; desc: string; shortcut: string; invertHint?: string };

const BRUSH_MODES: BrushDef[] = [
  { mode: "clay_buildup", label: "Clay",    desc: "Build up clay material along the surface normal",   shortcut: "C", invertHint: "Alt = dig in" },
  { mode: "push",         label: "Inflate", desc: "Puff vertices outward along their own normals (Alt = deflate)", shortcut: "Q", invertHint: "Alt = deflate" },
  { mode: "smooth",       label: "Smooth",  desc: "Blend vertices toward local average",                shortcut: "E" },
  { mode: "flatten",      label: "Flatten", desc: "Project vertices to local tangent plane",            shortcut: "R" },
  { mode: "pinch",        label: "Pinch",   desc: "Pull vertices toward the brush's center line, sharpening ridges and creases", shortcut: "N", invertHint: "Alt = spread apart" },
  { mode: "slice",        label: "Slice",   desc: "Carve a narrow gouge into the surface along the brush's normal", shortcut: "G" },
  { mode: "move",         label: "Move",    desc: "Drag a cluster of vertices freely in any direction", shortcut: "T" },
  { mode: "paint",        label: "Paint",   desc: "Paint color onto UV albedo texture without changing geometry", shortcut: "P" },
  { mode: "mask",         label: "Mask",    desc: "Paint a region to Extract or Detach as a new, separate submesh", shortcut: "K", invertHint: "Alt = erase" },
];

const MODE_KEY: Record<string, BrushMode> = {
  c: "clay_buildup", q: "push", e: "smooth", r: "flatten", n: "pinch", g: "slice", t: "move", p: "paint", k: "mask",
};

// "wireframe" is no longer a selectable view mode here — it's superseded by
// the independent Wireframe toggle (below), which overlays on top of any of
// these instead of being its own mutually-exclusive mode.
const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "combined",  label: "Combined" },
  { mode: "clay",      label: "Clay" },
  { mode: "albedo",    label: "Albedo" },
  { mode: "ao",        label: "AO" },
];

const CLAY_PRESETS = [
  { color: "#ebe7e1", label: "Clay" },
  { color: "#c4a882", label: "Warm" },
  { color: "#3a3735", label: "Dark" },
];

const PRIMITIVES: { type: PrimitiveType; label: string; icon: string }[] = [
  { type: "human",    label: "Human",    icon: "H" },
  { type: "sphere",   label: "Sphere",   icon: "O" },
  { type: "box",      label: "Box",      icon: "B" },
  { type: "cylinder", label: "Cylinder", icon: "C" },
  { type: "cone",     label: "Cone",     icon: "▲" },
  { type: "torus",    label: "Torus",    icon: "◎" },
  { type: "capsule",  label: "Capsule",  icon: "I" },
  { type: "plane",    label: "Plane",    icon: "—" },
];

const PURPLE = "#c47be8";

/** Picks a "nice" (1/2/5 × power of 10) frame interval for the
 * timeline ruler's major tick marks, aiming for roughly `targetTicks`
 * of them across whatever range is currently visible — keeps the ruler
 * readable whether zoomed out to a 500-frame clip or zoomed into a
 * 10-frame window. */
function niceTickInterval(span: number, targetTicks = 10): number {
  const rough = Math.max(span / targetTicks, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const mult = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return Math.max(1, Math.round(mult * mag));
}

export default function MeshSculptClient() {
  const { user, isLoaded } = useUser();
  const creatorStatus = useCreatorStatus();

  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);
  const [glbData, setGlbData] = useState<ArrayBuffer | null>(null);
  const [vertexCount, setVertexCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadingAsset, setLoadingAsset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const [brushMode, setBrushMode] = useState<BrushMode>("clay_buildup");
  const [brushRadius, setBrushRadius] = useState(0.25);
  const [brushInnerRadius, setBrushInnerRadius] = useState(0.3);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [paintColor, setPaintColor] = useState<string>("#e8925a");
  const [maskThreshold, setMaskThreshold] = useState(0.5);
  const [maskThickness, setMaskThickness] = useState(0.1);
  const [extractMsg, setExtractMsg] = useState("");
  const [conformMsg, setConformMsg] = useState("");
  const [submeshes, setSubmeshes] = useState<Array<{ id: string; name: string; visible: boolean; vertexCount: number }>>([]);
  const [submeshSaving, setSubmeshSaving] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("combined");
  const [subdivLevel, setSubdivLevel] = useState(0);
  const [exportLevel, setExportLevel] = useState(0);
  const [showPrimitives, setShowPrimitives] = useState(false);
  const [clayColor, setClayColor] = useState("#ebe7e1");
  const [dynTopo, setDynTopo] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("all");
  const [smoothSubdivide, setSmoothSubdivide] = useState(true);
  const [mirrorMode, setMirrorMode] = useState(false);
  const [xrayEnabled, setXrayEnabled] = useState(false);
  const [boneViewerMode, setBoneViewerMode] = useState<BoneViewerMode>("off");
  const [compressKtx2, setCompressKtx2] = useState(true);

  const [editMode, setEditMode] = useState<EditMode>("sculpt");
  const [selectMode, setSelectMode] = useState<SelectMode>("vertex");
  const [polyEditSelectTool, setPolyEditSelectTool] = useState<PolyEditSelectTool>("click");
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [selectionCount, setSelectionCount] = useState(0);
  const [extrudeDistance, setExtrudeDistance] = useState(0.1);
  const [extrudeMsg, setExtrudeMsg] = useState("");
  const [loopPreview, setLoopPreview] = useState<{ edgeCount: number; boundary: boolean; closed: boolean } | null>(null);

  // Pose mode: only populated when the loaded model actually has a
  // skeleton (e.g. an AccuRIG-exported GLB) — most loads won't.
  const [bones, setBones] = useState<Array<{ entryId: string; id: string; name: string; depth: number }>>([]);
  // Auto-detected biped controls: "bone" entries are a direct FK
  // quick-select (Hip/COG, plus each IK chain's own effector bone — the
  // foot/hand itself, for rotating its own ankle-flex/wrist-twist
  // independent of where IK has positioned it) and "ik" entries select an
  // IK chain's draggable target. One-click shortcuts to bones/chains
  // without hunting through the raw Bones list. Empty for any skeleton
  // matching neither known naming convention; that's fine, manual bone
  // selection still works.
  const [detectedControls, setDetectedControls] = useState<Array<{ entryId: string; kind: "bone" | "ik"; id: string; label: string }>>([]);
  // Pose-mode control circles (lib/sculpt/curve.ts) — a visual ring skin
  // over a real bone or IK target, auto-populated for detected bipeds
  // (hip/feet/wrists), addable manually for anything else.
  const [controls, setControls] = useState<Array<{ entryId: string; id: string; name: string; attachment: ControlAttachment }>>([]);
  const [controlMsg, setControlMsg] = useState("");
  // Real Channel Box for whatever's currently selected — local Position/
  // Rotation/Scale, editable, multi-select-then-batch-type like Maya's own.
  const [selectedTransform, setSelectedTransform] = useState<{ kind: "bone" | "ikTarget"; position: [number, number, number]; rotationDeg: [number, number, number]; scale: [number, number, number] } | null>(null);
  const [channelSelection, setChannelSelection] = useState<Set<TransformField>>(new Set());
  const [selectedBoneId, setSelectedBoneId] = useState<string | null>(null);
  // "ik" controls select via SculptViewerHandle.selectIKChain (id =
  // chain id) instead of selectBone (id = bone uuid) — local UI state
  // since, unlike bone selection, nothing in the viewport currently
  // changes IK selection except these buttons (no click-to-select-
  // target in the 3D view yet).
  const [selectedIKChainId, setSelectedIKChainId] = useState<string | null>(null);
  const [isOrthographic, setIsOrthographic] = useState(false);

  // Pose-mode timeline — v1 operates on a single "primary" entry (the
  // first skinned one, same simplification `bones` above already makes
  // by flattening every entry's bones into one list). onPoseTimeChange
  // (SculptViewer.tsx) is the source of truth for time/duration/playing
  // (same "event, not polled ref" reasoning as bone selection), not a
  // value this component computes itself.
  const [poseClips, setPoseClips] = useState<Array<{ id: string; name: string; duration: number }>>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [poseTime, setPoseTimeState] = useState(0);
  const [poseDuration, setPoseDuration] = useState(0);
  const [posePlaying, setPosePlayingState] = useState(false);
  const [poseFrameRate, setPoseFrameRate] = useState(30);
  /** Frame numbers (not seconds) with a keyframe marker on the active
   * clip — refreshed alongside poseClips, not an onPoseTimeChange event
   * (keyframe placement doesn't change every frame during playback). */
  const [poseKeyframeFrames, setPoseKeyframeFrames] = useState<number[]>([]);
  /** After Effects-style zoom navigator — which sub-range of the full
   * [0, totalFrames] timeline the main scrubber currently shows, for
   * finer per-pixel scrubbing precision on long clips. Pure view state,
   * doesn't touch clip data at all; reset to the full range below
   * whenever the total length changes so a stale zoom window on a new/
   * shorter clip can't leave the scrubber unreachable. */
  const [viewRangeStart, setViewRangeStart] = useState(0);
  const [viewRangeEnd, setViewRangeEnd] = useState(1);

  // Rig mode: manually-placed joints (lib/sculpt/rig.ts) — distinct from
  // `bones` above (an imported skeleton). Starts empty on every mesh;
  // populated as the user places joints in the viewport.
  const [joints, setJoints] = useState<Array<{ entryId: string; id: string; name: string; depth: number }>>([]);
  const [selectedJointId, setSelectedJointId] = useState<string | null>(null);
  const [editingJointId, setEditingJointId] = useState<string | null>(null);
  // Maya-style parenting: Shift-click a second joint to mark it as the
  // parent-designate (without changing the primary/gizmo selection), then
  // press P to commit via reparentJoint, Shift+P to un-parent.
  const [pendingParentJointId, setPendingParentJointId] = useState<string | null>(null);
  const [rigMsg, setRigMsg] = useState("");

  // Bind Skin: converts the placed joints into a real posable skeleton
  // (lib/sculpt/skinning.ts's two weighting algorithms). rigBindInfo is
  // null when the primary rig entry has no joints at all (nothing to bind).
  const [bindAlgorithm, setBindAlgorithm] = useState<"distance" | "diffusion">("distance");
  const [rigBindInfo, setRigBindInfo] = useState<{ jointCount: number; bound: boolean; boneCount: number } | null>(null);

  const viewerHandleRef = useRef<SculptViewerHandle | null>(null);
  const navigatorBarRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);

  // Mesh Sculptor no longer keeps its own "browse my assets" list — the
  // global My Assets panel (app/layout.tsx) is the universal loader now.
  // Registering here makes clicking a .glb row there call setSelectedAsset,
  // same as the old local list's onClick did.
  const { register, notifyAssetsChanged } = useActiveLoader();
  useEffect(() => {
    return register({
      onLoad: setSelectedAsset,
      accepts: (a) => a.format.toLowerCase() === "glb",
    });
  }, [register]);

  // Uploads a GLB, then optionally runs it through the shared server-side
  // KTX2 compression pass. Compression failure is non-fatal — the
  // already-uploaded uncompressed asset stays valid either way.
  // `overwrite`, when passed, updates that existing asset's bytes in
  // place (same storage_path, same row) instead of minting a new one —
  // used by handleSave when the current mesh was loaded from the library,
  // so repeated saves update the same asset rather than piling up
  // derivatives. Callers with nothing to overwrite (a fresh local import,
  // a submesh extract) just omit it and get the original always-new
  // behavior.
  const uploadAndMaybeCompress = useCallback(async (
    name: string,
    bytes: ArrayBuffer,
    polyCount?: number,
    derivedFromAssetId?: string,
    overwrite?: { id: string; storagePath: string },
  ): Promise<{ asset: AssetRow; compressed: boolean }> => {
    if (!user?.id) throw new Error("Not signed in.");
    const asset = overwrite
      ? await overwriteAssetBytes({ id: overwrite.id, storagePath: overwrite.storagePath, bytes, contentType: "model/gltf-binary" })
      : await uploadAsset({ userId: user.id, name, bytes, visibility: "private", polyCount, derivedFromAssetId });
    if (!compressKtx2) return { asset, compressed: false };
    try {
      const res = await fetch("/api/glb/compress-ktx2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, assetId: asset.id }),
      });
      return { asset, compressed: res.ok };
    } catch {
      return { asset, compressed: false };
    }
  }, [user?.id, compressKtx2]);

  const handleLocalFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    setLoadError(""); setUploadMsg(""); setVertexCount(null); setSubdivLevel(0); setLoadingAsset(true);
    try {
      if (ext === "glb") {
        const buf = await file.arrayBuffer();
        setSelectedAsset(null);
        setGlbData(buf);
        // Upload raw GLB bytes to asset library
        if (user?.id) {
          try {
            setUploadMsg("Uploading to library…");
            await uploadAsset({ userId: user.id, name: file.name, bytes: buf, visibility: "private" });
            notifyAssetsChanged();
            setUploadMsg("Added to library.");
            setTimeout(() => setUploadMsg(""), 3000);
          } catch { setUploadMsg("Loaded locally (library upload failed)."); }
        }
      } else if (ext === "drc") {
        const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js");
        const buf = await file.arrayBuffer();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath("/libs/draco/");
        // DRACOLoader.load needs a URL — create a temporary blob URL
        const blob = new Blob([buf], { type: "application/octet-stream" });
        const blobUrl = URL.createObjectURL(blob);
        const geo = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
          dracoLoader.load(blobUrl, resolve, undefined, reject);
        });
        URL.revokeObjectURL(blobUrl);
        dracoLoader.dispose();
        viewerHandleRef.current?.loadGeometry(geo, file.name);
        // Convert to GLB and upload
        if (user?.id && viewerHandleRef.current) {
          try {
            setUploadMsg("Converting & uploading…");
            const glbBytes = await viewerHandleRef.current.exportGlb();
            const glbName = file.name.replace(/\.drc$/i, ".glb");
            await uploadAndMaybeCompress(glbName, glbBytes.buffer as ArrayBuffer);
            notifyAssetsChanged();
            setUploadMsg("Added to library.");
            setTimeout(() => setUploadMsg(""), 3000);
          } catch { setUploadMsg("Loaded locally (library upload failed)."); }
        }
      } else if (ext === "obj") {
        const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
        const BGU = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
        const text = await file.text();
        const group = new OBJLoader().parse(text);
        const geos: THREE.BufferGeometry[] = [];
        group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) geos.push(m.geometry);
        });
        if (geos.length === 0) throw new Error("OBJ contains no mesh geometry.");
        const merged = geos.length === 1 ? geos[0] : BGU.mergeGeometries(geos, false);
        viewerHandleRef.current?.loadGeometry(merged, file.name);
        // Convert loaded OBJ → GLB via viewer export and upload
        if (user?.id && viewerHandleRef.current) {
          try {
            setUploadMsg("Converting & uploading…");
            const glbBytes = await viewerHandleRef.current.exportGlb();
            const glbName = file.name.replace(/\.obj$/i, ".glb");
            await uploadAndMaybeCompress(glbName, glbBytes.buffer as ArrayBuffer);
            notifyAssetsChanged();
            setUploadMsg("Added to library.");
            setTimeout(() => setUploadMsg(""), 3000);
          } catch { setUploadMsg("Loaded locally (library upload failed)."); }
        }
      } else if (ext === "stl") {
        const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
        const buf = await file.arrayBuffer();
        const geo = new STLLoader().parse(buf);
        viewerHandleRef.current?.loadGeometry(geo, file.name);
        // Convert loaded STL → GLB via viewer export and upload
        if (user?.id && viewerHandleRef.current) {
          try {
            setUploadMsg("Converting & uploading…");
            const glbBytes = await viewerHandleRef.current.exportGlb();
            const glbName = file.name.replace(/\.stl$/i, ".glb");
            await uploadAndMaybeCompress(glbName, glbBytes.buffer as ArrayBuffer);
            notifyAssetsChanged();
            setUploadMsg("Added to library.");
            setTimeout(() => setUploadMsg(""), 3000);
          } catch { setUploadMsg("Loaded locally (library upload failed)."); }
        }
      } else {
        throw new Error(`Unsupported format: .${ext}. Use .glb, .drc, .obj, or .stl`);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load file.");
    } finally { setLoadingAsset(false); }
  }, [user?.id, notifyAssetsChanged, uploadAndMaybeCompress]);

  // "Conform to Reference" — OBJ-only (the realistic export format for a
  // ZBrush subdivision level), deliberately a separate, dedicated file
  // picker rather than reusing handleLocalFile's drop-zone path, since that
  // path always *replaces* the whole mesh — the far more common action —
  // and folding an implicit "replace vs. conform" choice into it would slow
  // down and risk that common case. Reuses the exact same OBJLoader-parsing
  // logic handleLocalFile's .obj branch already uses.
  const conformFileInputRef = useRef<HTMLInputElement | null>(null);
  const handleConformFile = useCallback(async (file: File) => {
    setConformMsg("");
    setLoadError("");
    try {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      const BGU = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
      const text = await file.text();
      const group = new OBJLoader().parse(text);
      const geos: THREE.BufferGeometry[] = [];
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) geos.push(m.geometry);
      });
      if (geos.length === 0) throw new Error("OBJ contains no mesh geometry.");
      const merged = geos.length === 1 ? geos[0] : BGU.mergeGeometries(geos, false);
      viewerHandleRef.current?.conformToReference(merged);
      setConformMsg(`Conformed to ${file.name}.`);
      setTimeout(() => setConformMsg(""), 3000);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to conform to reference.");
    }
  }, []);

  const clearWorkspace = useCallback(() => {
    viewerHandleRef.current?.clearScene();
    setSelectedAsset(null);
    setGlbData(null);
    setVertexCount(null);
    setLoadError("");
    setUploadMsg("");
    setSubdivLevel(0);
    setEditMode("sculpt");
    setSubmeshes([]);
    setExtractMsg("");
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (vertexCount !== null) return; // model already loaded — require clear first
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "glb" && ext !== "drc" && ext !== "obj" && ext !== "stl") {
      setLoadError(`Unsupported format: .${ext}. Drop a .glb, .drc, .obj, or .stl file.`);
      return;
    }
    await handleLocalFile(file);
  }, [vertexCount, handleLocalFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (vertexCount !== null) return; // already loaded — ignore drag
    setIsDragging(true);
  }, [vertexCount]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear if leaving the drop zone entirely (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  // ── Persist brush settings per user in localStorage ──────────────────────
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(`sculpt-prefs-${user.id}`);
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p.radius   === "number") setBrushRadius(p.radius);
        if (typeof p.inner    === "number") setBrushInnerRadius(p.inner);
        if (typeof p.strength === "number") setBrushStrength(p.strength);
      }
    } catch {}
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    localStorage.setItem(`sculpt-prefs-${user.id}`, JSON.stringify({
      radius:   brushRadius,
      inner:    brushInnerRadius,
      strength: brushStrength,
    }));
  }, [user?.id, brushRadius, brushInnerRadius, brushStrength]);
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedAsset) return;
    setLoadError(""); setGlbData(null); setVertexCount(null); setLoadingAsset(true); setSubdivLevel(0);
    (async () => {
      try {
        const url = await signedAssetUrl(selectedAsset.storage_path);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setGlbData(await res.arrayBuffer());
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch asset.";
        // Supabase Storage's createSignedUrl() (inside signedAssetUrl) throws
        // this exact string when the object backing this row's storage_path
        // is gone from the bucket — the DB row is fine, the file isn't. Give
        // a recovery path instead of the raw string: AssetLibraryRow already
        // has a working delete button for exactly this case.
        setLoadError(
          message === "Object not found"
            ? "This file is missing from storage (it may have been removed outside the app). Remove it from My Assets (✕) and try a different one."
            : message,
        );
      } finally { setLoadingAsset(false); }
    })();
  }, [selectedAsset]);

  // Seed the extrude-distance slider from the loaded mesh's own density the
  // moment poly-edit mode is entered, so it starts at a sensible scale
  // instead of an arbitrary constant.
  useEffect(() => {
    if (editMode !== "poly_edit") return;
    const rec = viewerHandleRef.current?.getRecommendedExtrudeDistance();
    if (rec) setExtrudeDistance(rec);
  }, [editMode]);

  // Live "N edges in loop" preview — fired directly from SculptViewer
  // whenever edge-mode selection changes (event-sourced, not polled via a
  // ref during render).
  const handleLoopPreview = useCallback((info: { edgeCount: number; boundary: boolean; closed: boolean } | null) => {
    setLoopPreview(info);
    setExtrudeMsg("");
  }, []);

  const handleExtrude = useCallback(() => {
    const result = viewerHandleRef.current?.extrudeSelection(extrudeDistance);
    if (!result) return;
    setExtrudeMsg(result.ok ? "" : (result.reason ?? "Extrude failed."));
  }, [extrudeDistance]);

  // Re-reads the current scene's mesh list from the viewer — called after
  // any action that can add/remove/rename an entry (load, Extract, Detach, delete).
  const refreshSubmeshes = useCallback(() => {
    setSubmeshes(viewerHandleRef.current?.getMeshEntries() ?? []);
  }, []);

  // Combines every entry's bones (usually just one skinned entry, but not
  // assumed) into one flat list for the Bones panel — each row remembers
  // which entry it came from, since SculptViewerHandle.selectBone/resetPose
  // are per-entry.
  const refreshBones = useCallback(() => {
    const handle = viewerHandleRef.current;
    const entries = handle?.getMeshEntries() ?? [];
    const all: Array<{ entryId: string; id: string; name: string; depth: number }> = [];
    for (const entry of entries) {
      for (const bone of handle?.getBones(entry.id) ?? []) all.push({ entryId: entry.id, ...bone });
    }
    setBones(all);
  }, []);

  // Same combining pattern as refreshBones, for the auto-detected biped
  // controls (hip + IK chain effectors) instead of the raw bone list.
  const refreshDetectedControls = useCallback(() => {
    const handle = viewerHandleRef.current;
    const entries = handle?.getMeshEntries() ?? [];
    const all: Array<{ entryId: string; kind: "bone" | "ik"; id: string; label: string }> = [];
    for (const entry of entries) {
      const hipBoneId = handle?.getHipBoneId(entry.id);
      if (hipBoneId) all.push({ entryId: entry.id, kind: "bone", id: hipBoneId, label: "Hip" });
      for (const chain of handle?.getIKChains(entry.id) ?? []) {
        // id is the CHAIN id here (for selectIKChain), not the
        // effector bone — deliberately different from the "bone" entries.
        all.push({ entryId: entry.id, kind: "ik", id: chain.id, label: chain.name });
        // Direct FK quick-select for the effector bone itself (foot/hand)
        // — separate from the IK target, which controls POSITION; this
        // one lets you rotate the bone's own local orientation (ankle
        // flex, wrist twist) independent of where IK has placed it.
        const effectorLabel = chain.name.replace("Leg IK", "Foot").replace("Arm IK", "Wrist");
        all.push({ entryId: entry.id, kind: "bone", id: chain.effectorBoneId, label: effectorLabel });
      }
    }
    setDetectedControls(all);
  }, []);

  // Same combining pattern as refreshBones, for Rig mode's manually-
  // placed joints instead of an imported skeleton.
  const refreshJoints = useCallback(() => {
    const handle = viewerHandleRef.current;
    const entries = handle?.getMeshEntries() ?? [];
    const all: Array<{ entryId: string; id: string; name: string; depth: number }> = [];
    for (const entry of entries) {
      for (const joint of handle?.getJoints(entry.id) ?? []) all.push({ entryId: entry.id, ...joint });
    }
    setJoints(all);
  }, []);

  // Same combining pattern, for Pose mode's control circles.
  const refreshControls = useCallback(() => {
    const handle = viewerHandleRef.current;
    const entries = handle?.getMeshEntries() ?? [];
    const all: Array<{ entryId: string; id: string; name: string; attachment: ControlAttachment }> = [];
    for (const entry of entries) {
      for (const control of handle?.getControls(entry.id) ?? []) all.push({ entryId: entry.id, ...control });
    }
    setControls(all);
  }, []);

  // The single entry Bind Skin operates on for v1 — same "first entry"
  // simplification primaryPoseEntryId already makes for the pose timeline.
  const primaryRigEntryId = useCallback((): string | null => joints[0]?.entryId ?? null, [joints]);

  const refreshRigBindInfo = useCallback(() => {
    const handle = viewerHandleRef.current;
    const entryId = primaryRigEntryId();
    setRigBindInfo(handle && entryId ? handle.getRigBindInfo(entryId) ?? null : null);
  }, [primaryRigEntryId]);

  // Re-derive whenever `joints` changes (a joint placed/deleted) — same
  // "effect reacts to the dependent state, not a synchronous call right
  // after setJoints" reasoning as refreshPoseClips below.
  useEffect(() => { refreshRigBindInfo(); }, [joints, refreshRigBindInfo]);

  // The single entry the pose timeline operates on for v1 — same
  // "first skinned entry" simplification `bones` already makes by
  // flattening every entry's bones into one combined list.
  const primaryPoseEntryId = useCallback((): string | null => bones[0]?.entryId ?? null, [bones]);

  const refreshPoseClips = useCallback(() => {
    const handle = viewerHandleRef.current;
    const entryId = primaryPoseEntryId();
    if (!handle || !entryId) { setPoseClips([]); setActiveClipId(null); setPoseKeyframeFrames([]); return; }
    setPoseClips(handle.getClips(entryId));
    setActiveClipId(handle.getActiveClipId(entryId));
    setPoseKeyframeFrames(handle.getKeyframeTimes(entryId).map((t) => Math.round(t * poseFrameRate)));
  }, [primaryPoseEntryId, poseFrameRate]);

  // Re-derive whenever `bones` changes (a new skinned entry loaded, or an
  // existing one's bones refreshed) rather than trying to call this
  // synchronously right after refreshBones() — bones is still the
  // pre-update value at that point (React state updates aren't
  // synchronous), so this effect is the correct place to react to it.
  useEffect(() => { refreshPoseClips(); }, [bones, refreshPoseClips]);

  const handleModelLoaded = useCallback((count: number) => {
    setVertexCount(count);
    refreshSubmeshes();
    refreshBones();
    refreshDetectedControls();
    refreshJoints();
    refreshControls();
  }, [refreshSubmeshes, refreshBones, refreshDetectedControls, refreshJoints, refreshControls]);

  const handleSelectedTransformChange = useCallback((info: { kind: "bone" | "ikTarget"; position: [number, number, number]; rotationDeg: [number, number, number]; scale: [number, number, number] } | null) => {
    setSelectedTransform(info);
  }, []);

  // A different selection shouldn't inherit the previous one's multi-field
  // Channel Box selection.
  useEffect(() => { setChannelSelection(new Set()); }, [selectedBoneId, selectedIKChainId]);

  // SculptViewer.tsx's onPoseTimeChange — fired every frame during
  // playback plus once on any scrub/keyframe/clip-switch, so this is
  // the sole source of truth for time/duration/playing (never polled).
  const handlePoseTimeChange = useCallback((_entryId: string, time: number, duration: number, playing: boolean, frameRate: number) => {
    setPoseTimeState(time);
    setPoseDuration(duration);
    setPosePlayingState(playing);
    setPoseFrameRate(frameRate);
  }, []);

  const handleInsertKeyframe = useCallback(() => {
    const entryId = primaryPoseEntryId();
    if (!entryId) return;
    viewerHandleRef.current?.insertKeyframe(entryId, poseTime);
    refreshPoseClips();
  }, [primaryPoseEntryId, poseTime, refreshPoseClips]);

  const handleRemoveKeyframe = useCallback(() => {
    const entryId = primaryPoseEntryId();
    if (!entryId) return;
    viewerHandleRef.current?.removeKeyframe(entryId, poseTime);
    refreshPoseClips();
  }, [primaryPoseEntryId, poseTime, refreshPoseClips]);

  const handleScrub = useCallback((time: number) => {
    const entryId = primaryPoseEntryId();
    if (entryId) viewerHandleRef.current?.setPoseTime(entryId, time);
  }, [primaryPoseEntryId]);

  // The timeline UI is frame-based (per the user's "Maya-style, set the
  // frame count, keyframes are markers on the timeline" direction) —
  // seconds stay the canonical stored unit, frames are just this
  // conversion layer for scrubbing/display.
  const handleScrubFrame = useCallback((frame: number) => {
    handleScrub(frame / poseFrameRate);
  }, [handleScrub, poseFrameRate]);

  const handleTogglePlay = useCallback(() => {
    const entryId = primaryPoseEntryId();
    if (entryId) viewerHandleRef.current?.setPosePlaying(entryId, !posePlaying);
  }, [primaryPoseEntryId, posePlaying]);

  const handleSetFrameCount = useCallback((frameCount: number) => {
    const entryId = primaryPoseEntryId();
    if (!entryId || !Number.isFinite(frameCount) || frameCount < 1) return;
    viewerHandleRef.current?.setClipLength(entryId, Math.round(frameCount), poseFrameRate);
    refreshPoseClips();
  }, [primaryPoseEntryId, poseFrameRate, refreshPoseClips]);

  const handleSetFrameRate = useCallback((fps: number) => {
    const entryId = primaryPoseEntryId();
    if (!entryId) return;
    const currentFrameCount = Math.round(poseDuration * poseFrameRate);
    viewerHandleRef.current?.setClipLength(entryId, currentFrameCount, fps);
    refreshPoseClips();
  }, [primaryPoseEntryId, poseDuration, poseFrameRate, refreshPoseClips]);

  const poseTotalFrames = Math.max(1, Math.round(poseDuration * poseFrameRate));

  // Snap the zoom navigator back to the full range whenever the total
  // length changes (or a different clip becomes active) — a stale zoom
  // window from a previous, longer clip would otherwise leave the new
  // scrubber unable to reach parts of its own range.
  useEffect(() => {
    setViewRangeStart(0);
    setViewRangeEnd(poseTotalFrames);
  }, [poseTotalFrames, activeClipId]);

  // Drags one of the navigator bar's two edge handles — `side` is which
  // edge, `barEl` is the navigator track div (to convert pointer X into
  // a frame position). Native <input type="range"> only exposes one
  // thumb, so these two handles are plain pointer-driven divs instead.
  const dragNavigatorHandle = useCallback((side: "start" | "end", barEl: HTMLDivElement) => {
    const rect = barEl.getBoundingClientRect();
    const onMove = (e: PointerEvent) => {
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const frame = Math.round(pct * poseTotalFrames);
      if (side === "start") {
        setViewRangeStart(Math.min(frame, viewRangeEnd - 1));
      } else {
        setViewRangeEnd(Math.max(frame, viewRangeStart + 1));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [poseTotalFrames, viewRangeStart, viewRangeEnd]);

  // Click-or-drag-anywhere-on-the-ruler-to-scrub — the Maya/Blender
  // interaction model, replacing a single native slider thumb. Takes
  // the already-measured rect (plain data), not the element itself —
  // the pointermove/pointerup listeners below only need coordinates,
  // not a live DOM reference.
  const dragRuler = useCallback((rect: DOMRect) => {
    const scrubAt = (clientX: number) => {
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      handleScrubFrame(Math.round(viewRangeStart + pct * (viewRangeEnd - viewRangeStart)));
    };
    const onMove = (e: PointerEvent) => scrubAt(e.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [handleScrubFrame, viewRangeStart, viewRangeEnd]);

  const handleCreateClip = useCallback(() => {
    const entryId = primaryPoseEntryId();
    if (!entryId) return;
    viewerHandleRef.current?.createAnimationClip(entryId);
    refreshPoseClips();
  }, [primaryPoseEntryId, refreshPoseClips]);

  const handleSelectClip = useCallback((clipId: string) => {
    const entryId = primaryPoseEntryId();
    if (!entryId) return;
    viewerHandleRef.current?.setActiveClip(entryId, clipId);
    refreshPoseClips();
  }, [primaryPoseEntryId, refreshPoseClips]);

  const handleSelectBone = useCallback((entryId: string, boneId: string | null) => {
    viewerHandleRef.current?.selectBone(entryId, boneId);
    // selectBone (SculptViewer.tsx) clears any active IK selection
    // itself when boneId is non-null — mirror that here so the Controls
    // UI's own highlight state stays in sync without a round-trip event.
    if (boneId) setSelectedIKChainId(null);
  }, []);

  const handleSelectIKChain = useCallback((entryId: string, chainId: string | null) => {
    viewerHandleRef.current?.selectIKChain(entryId, chainId);
    setSelectedIKChainId(chainId);
    if (chainId) setSelectedBoneId(null);
  }, []);

  const handleSelectJoint = useCallback((entryId: string, jointId: string | null) => {
    viewerHandleRef.current?.selectJoint(entryId, jointId);
  }, []);

  const handleRenameJoint = useCallback((entryId: string, jointId: string, name: string) => {
    viewerHandleRef.current?.renameJoint(entryId, jointId, name);
    refreshJoints();
  }, [refreshJoints]);

  const handleDeleteJoint = useCallback((entryId: string, jointId: string) => {
    viewerHandleRef.current?.deleteJoint(entryId, jointId);
    refreshJoints();
  }, [refreshJoints]);

  // Shift-click in the viewport or the Joints list marks a second joint as
  // the parent-designate — mirrors Maya's "select child(ren), then
  // shift-select the parent last" order, committed on P (see the keydown
  // handler below).
  const handleMarkPendingParent = useCallback((jointId: string) => {
    setRigMsg("");
    setPendingParentJointId((cur) => (cur === jointId ? null : jointId));
  }, []);

  const handleParentJoint = useCallback((unparent: boolean) => {
    if (!selectedJointId) return;
    const child = joints.find((jt) => jt.id === selectedJointId);
    if (!child) return;
    if (unparent) {
      viewerHandleRef.current?.reparentJoint(child.entryId, child.id, null);
      setRigMsg("");
      refreshJoints();
      return;
    }
    if (!pendingParentJointId || pendingParentJointId === selectedJointId) return;
    const parent = joints.find((jt) => jt.id === pendingParentJointId);
    if (!parent || parent.entryId !== child.entryId) {
      setRigMsg("Parent must be a joint on the same mesh.");
      return;
    }
    const result = viewerHandleRef.current?.reparentJoint(child.entryId, child.id, parent.id);
    if (result && !result.ok) {
      setRigMsg(result.reason ?? "Couldn't reparent.");
      return;
    }
    setRigMsg("");
    setPendingParentJointId(null);
    refreshJoints();
  }, [selectedJointId, pendingParentJointId, joints, refreshJoints]);

  // A selection change in the viewport can also mean a NEW joint was just
  // created (click-to-place auto-selects it) — refresh the list either
  // way rather than needing a separate "a joint was created" event.
  const handleJointSelectionChange = useCallback((jointId: string | null) => {
    setSelectedJointId(jointId);
    setPendingParentJointId(null);
    setRigMsg("");
    refreshJoints();
  }, [refreshJoints]);

  const handleAddControlToBone = useCallback((entryId: string, boneUuid: string) => {
    const result = viewerHandleRef.current?.addControlToBone(entryId, boneUuid);
    if (result && !result.ok) setControlMsg(result.reason ?? "Couldn't add control.");
    else setControlMsg("");
    refreshControls();
  }, [refreshControls]);

  const handleAddControlToIKChain = useCallback((entryId: string, chainId: string) => {
    const result = viewerHandleRef.current?.addControlToIKChain(entryId, chainId, "target");
    if (result && !result.ok) setControlMsg(result.reason ?? "Couldn't add control.");
    else setControlMsg("");
    refreshControls();
  }, [refreshControls]);

  const handleRemoveControl = useCallback((entryId: string, controlId: string) => {
    viewerHandleRef.current?.removeControl(entryId, controlId);
    refreshControls();
  }, [refreshControls]);

  // Click a Channel Box field's label to select just it; Shift-click
  // adds/removes it from the selection — exact Maya gesture, so typing a
  // value into any selected field can apply to all of them at once.
  const handleChannelLabelClick = useCallback((field: TransformField, shiftKey: boolean) => {
    setChannelSelection((cur) => {
      if (shiftKey) {
        const next = new Set(cur);
        if (next.has(field)) next.delete(field); else next.add(field);
        return next;
      }
      return new Set([field]);
    });
  }, []);

  // Enter/blur on a field commits it. If that field is part of a
  // multi-field selection (2+), the typed value applies to every selected
  // field in one batch (one undo snapshot); otherwise just that field.
  const handleCommitChannel = useCallback((field: TransformField, raw: string) => {
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) return;
    const entryId = primaryPoseEntryId();
    if (!entryId) return;
    const targets = channelSelection.has(field) && channelSelection.size > 1 ? Array.from(channelSelection) : [field];
    const fields: Partial<Record<TransformField, number>> = {};
    for (const f of targets) fields[f] = value;
    viewerHandleRef.current?.setSelectedTransformFields(entryId, fields);
  }, [primaryPoseEntryId, channelSelection]);

  const handleBindSkin = useCallback(() => {
    const entryId = primaryRigEntryId();
    if (!entryId) return;
    const result = viewerHandleRef.current?.bindSkin(entryId, bindAlgorithm);
    if (result && !result.ok) setRigMsg(result.reason ?? "Couldn't bind skin.");
    else setRigMsg("");
    refreshRigBindInfo();
    refreshBones();
  }, [primaryRigEntryId, bindAlgorithm, refreshRigBindInfo, refreshBones]);

  const handleUnbindSkin = useCallback(() => {
    const entryId = primaryRigEntryId();
    if (!entryId) return;
    const result = viewerHandleRef.current?.unbindSkin(entryId);
    if (result && !result.ok) setRigMsg(result.reason ?? "Couldn't unbind.");
    else setRigMsg("");
    refreshRigBindInfo();
    refreshBones();
  }, [primaryRigEntryId, refreshRigBindInfo, refreshBones]);

  // "Human" is special-cased to load the real public/human_low_poly.obj
  // asset instead of buildHumanBase()'s crude placeholder (22 merged
  // boxes/spheres/cylinders) — every other primitive type is still built
  // synchronously via loadPrimitive. Mirrors handleLocalFile's existing
  // OBJ-upload path (OBJLoader.parse → collect+merge child meshes) rather
  // than inventing a new loading convention, but fetches from the public
  // folder instead of reading a File, and additionally welds the result
  // (lib/sculpt/weld.ts) so it's seam-free like every other primitive —
  // loadGeometry's own import path deliberately doesn't weld, since an
  // arbitrary uploaded mesh's authored seams might be intentional, but
  // this one is standing in for a primitive, so it should behave like one.
  const handleInsertPrimitive = useCallback(async (type: PrimitiveType) => {
    setSubdivLevel(0);
    setShowPrimitives(false);
    if (type !== "human") {
      viewerHandleRef.current?.loadPrimitive(type);
      return;
    }
    try {
      const [{ OBJLoader }, BGU, { weldGeometryByPosition }, res] = await Promise.all([
        import("three/examples/jsm/loaders/OBJLoader.js"),
        import("three/examples/jsm/utils/BufferGeometryUtils.js"),
        import("@/lib/sculpt/weld"),
        fetch("/human_low_poly.obj"),
      ]);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const text = await res.text();
      const group = new OBJLoader().parse(text);
      const geos: THREE.BufferGeometry[] = [];
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) geos.push(m.geometry);
      });
      if (geos.length === 0) throw new Error("OBJ contains no mesh geometry.");
      const merged = geos.length === 1 ? geos[0] : BGU.mergeGeometries(geos, false);
      const welded = weldGeometryByPosition(merged);
      viewerHandleRef.current?.loadGeometry(welded, "Human");
    } catch (err) {
      console.warn("[MeshSculptClient] Failed to load human_low_poly.obj, falling back to placeholder primitive:", err);
      viewerHandleRef.current?.loadPrimitive("human");
    }
  }, []);

  const handleResetPose = useCallback(() => {
    // Every skinned entry gets reset, not just whichever bone happens to
    // be selected — "Reset Pose" reads as a whole-character action, not
    // a per-bone one, matching Transpose's own "reset" behavior.
    // resetPose(entryId) already walks every bone in that entry's own
    // skeleton, so this only needs to call it once per distinct entry.
    const seen = new Set<string>();
    for (const b of bones) {
      if (seen.has(b.entryId)) continue;
      seen.add(b.entryId);
      viewerHandleRef.current?.resetPose(b.entryId);
    }
  }, [bones]);

  const handleResetBone = useCallback(() => {
    if (!selectedBoneId) return;
    const bone = bones.find((b) => b.id === selectedBoneId);
    if (bone) viewerHandleRef.current?.resetBone(bone.entryId, bone.id);
  }, [bones, selectedBoneId]);

  const handleExtractMask = useCallback(() => {
    const created = viewerHandleRef.current?.extractMask(maskThreshold, maskThickness) ?? 0;
    setExtractMsg(created > 0 ? `Created ${created} submesh${created === 1 ? "" : "es"}.` : "Nothing masked — paint a region first.");
    refreshSubmeshes();
  }, [maskThreshold, maskThickness, refreshSubmeshes]);

  const handleDetachMask = useCallback(() => {
    const created = viewerHandleRef.current?.detachMask(maskThreshold) ?? 0;
    setExtractMsg(created > 0 ? `Detached ${created} submesh${created === 1 ? "" : "es"}.` : "Nothing masked — paint a region first.");
    refreshSubmeshes();
  }, [maskThreshold, refreshSubmeshes]);

  const handleClearMask = useCallback(() => {
    viewerHandleRef.current?.clearMask();
    setExtractMsg("");
  }, []);

  useEffect(() => {
    function onDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Tab") {
        e.preventDefault();
        setEditMode((m) => {
          if (m === "sculpt") return "poly_edit";
          if (m === "poly_edit") return "sculpt";
          return m; // pose/rig: Tab has no meaning here, don't eject the user
        });
        return;
      }
      // Above the poly_edit branch (like Tab) so it works in both modes —
      // ZBrush-style symmetry applies to sculpt strokes and poly-edit alike.
      if (e.key.toLowerCase() === "m") {
        setMirrorMode((m) => !m);
        return;
      }
      if (editMode === "poly_edit" || editMode === "pose" || editMode === "rig") {
        // Blender-style select-mode/transform-mode shortcuts, scoped to
        // poly-edit/pose/rig only — no conflict with the sculpt brush
        // shortcuts below (E/R mean smooth/flatten there) since these
        // modes are mutually exclusive with sculpt and this branch
        // returns before reaching MODE_KEY. Select-mode (1/2/3) is
        // poly-edit-only — pose/rig have no vertex/edge/face concept.
        if (editMode === "poly_edit" && e.key === "1") setSelectMode("vertex");
        else if (editMode === "poly_edit" && e.key === "2") setSelectMode("edge");
        else if (editMode === "poly_edit" && e.key === "3") setSelectMode("face");
        else if (editMode === "rig" && selectedJointId && (e.key === "Backspace" || e.key === "Delete")) {
          e.preventDefault();
          const j = joints.find((jt) => jt.id === selectedJointId);
          if (j) handleDeleteJoint(j.entryId, j.id);
        }
        // Maya's own key for this exact gesture: select child, shift-select
        // parent last, press P. Shift+P un-parents. Reserved — don't rebind.
        else if (editMode === "rig" && selectedJointId && e.key.toLowerCase() === "p") {
          e.preventDefault();
          handleParentJoint(e.shiftKey);
        }
        else if (e.key.toLowerCase() === "w") setTransformMode("translate");
        else if (e.key.toLowerCase() === "e") setTransformMode("rotate");
        else if (e.key.toLowerCase() === "r") setTransformMode("scale");
        return;
      }
      // Power-user shortcut for the Clear Mask button, only while Mask
      // brush mode is active (same gating as the button itself).
      if (brushMode === "mask" && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        handleClearMask();
        return;
      }
      const m = MODE_KEY[e.key.toLowerCase()];
      if (m) setBrushMode(m);
      if (e.key === "Shift") setShiftHeld(true);
      if (e.key === "Alt") { e.preventDefault(); setAltHeld(true); }
    }
    function onUp(e: KeyboardEvent) { if (e.key === "Shift") setShiftHeld(false); if (e.key === "Alt") setAltHeld(false); }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [editMode, brushMode, handleClearMask, selectedJointId, joints, handleDeleteJoint, handleParentJoint]);

  const handleToggleSubmeshVisible = useCallback((id: string, visible: boolean) => {
    viewerHandleRef.current?.setEntryVisible(id, visible);
    refreshSubmeshes();
  }, [refreshSubmeshes]);

  const handleDeleteSubmesh = useCallback((id: string) => {
    const result = viewerHandleRef.current?.deleteEntry(id);
    if (result && !result.ok) { setExtractMsg(result.reason ?? "Couldn't delete."); return; }
    refreshSubmeshes();
    refreshBones();
    refreshJoints();
  }, [refreshSubmeshes, refreshBones, refreshJoints]);

  const handleSaveSubmesh = useCallback(async (id: string, name: string) => {
    if (!viewerHandleRef.current || !user?.id) return;
    setSubmeshSaving(id);
    try {
      const bytes = await viewerHandleRef.current.exportEntryGlb(id);
      await uploadAndMaybeCompress(
        `${selectedAsset?.name ?? "sculpted-mesh"}-${name.toLowerCase().replace(/\s+/g, "-")}.glb`,
        bytes.buffer as ArrayBuffer,
        undefined,
        selectedAsset?.id,
      );
      notifyAssetsChanged();
    } finally {
      setSubmeshSaving(null);
    }
  }, [user?.id, selectedAsset, uploadAndMaybeCompress, notifyAssetsChanged]);

  const handleSave = useCallback(async () => {
    if (!viewerHandleRef.current || !user?.id) return;
    setSaving(true); setSaveMsg("");
    try {
      const bytes = exportLevel === subdivLevel
        ? await viewerHandleRef.current.exportGlb()
        : await viewerHandleRef.current.exportAtLevel(subdivLevel - exportLevel);
      const { compressed } = await uploadAndMaybeCompress(
        `${selectedAsset?.name ?? "sculpted-mesh"}-sculpted${exportLevel > 0 ? `-level${exportLevel}` : ""}.glb`,
        bytes.buffer as ArrayBuffer,
        vertexCount ?? undefined,
        selectedAsset?.id,
        selectedAsset ? { id: selectedAsset.id, storagePath: selectedAsset.storage_path } : undefined,
      );
      setSaveMsg(compressKtx2 && !compressed ? "Saved (uncompressed — texture compression failed)." : "Saved to library.");
      notifyAssetsChanged();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed.");
    } finally { setSaving(false); }
  }, [user?.id, selectedAsset, vertexCount, subdivLevel, exportLevel, compressKtx2, uploadAndMaybeCompress, notifyAssetsChanged]);

  if (!isLoaded || creatorStatus === "loading") return null;

  if (!user) return (
    <main className="tool-min-h bg-[#0c0a08] flex items-center justify-center">
      <div className="text-center">
        <p className="text-dim text-sm mb-4">Sign in to use Mesh Sculptor.</p>
        <Link href="/sign-in" className="px-4 py-2 bg-accent text-white rounded-md text-sm">Sign in</Link>
      </div>
    </main>
  );


  const highVertCount = vertexCount != null && vertexCount > 1_000_000;
  const activeDef = BRUSH_MODES.find((m) => m.mode === brushMode)!;

  return (
    <main className="tool-h bg-[#0c0a08] flex">

      {/* ── LEFT SIDEBAR ── */}
      <aside className="w-60 flex-shrink-0 border-r border-[#2a2320] flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-[#2a2320]">
          <h1 className="text-sm font-semibold text-ink">Mesh Sculptor</h1>
          <p className="text-[11px] text-dim mt-0.5">Brush-based vertex sculpting</p>
        </div>

        <div className="px-4 py-3 border-b border-[#2a2320]">
          <p className="text-[11px] font-medium text-dim uppercase tracking-wide mb-2">Load Mesh</p>
          <p className="text-[11px] text-dim">
            Open the <span className="text-ink">My Assets</span> panel (right edge) to load a saved .glb, or drop a .glb/.drc/.obj/.stl file onto the canvas.
          </p>
          {loadingAsset && <p className="text-[11px] text-dim mt-2">Loading…</p>}
          {loadError    && <p className="text-[11px] text-red-400 mt-2">{loadError}</p>}
          {uploadMsg    && !loadError && <p className="text-[11px] text-green-400 mt-1">{uploadMsg}</p>}
        </div>

        {/* Poly-edit mode: vertex/edge/face selection + transform gizmo */}
        <div className="px-4 py-3 border-b border-[#2a2320]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-medium text-dim uppercase tracking-wide">Mode</p>
            <span className="text-[10px]" style={{ color: "#4a4040" }}>Tab</span>
          </div>
          <div className="flex gap-1 mb-3">
            <button onClick={() => setEditMode("sculpt")}
              className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: editMode === "sculpt" ? PURPLE : "#1e1a17", color: editMode === "sculpt" ? "#fff" : "#8aa0b4" }}>
              Sculpt
            </button>
            <button onClick={() => setEditMode("poly_edit")}
              disabled={vertexCount == null}
              title="Select vertices, edges, or faces and transform them"
              className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: editMode === "poly_edit" ? PURPLE : "#1e1a17", color: editMode === "poly_edit" ? "#fff" : "#8aa0b4" }}>
              Edit
            </button>
            <button onClick={() => { setEditMode("pose"); setTransformMode("rotate"); }}
              disabled={bones.length === 0}
              title={bones.length === 0 ? "Load a rigged model (e.g. an AccuRIG export) to pose it" : "Select and pose bones from the imported rig"}
              className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: editMode === "pose" ? PURPLE : "#1e1a17", color: editMode === "pose" ? "#fff" : "#8aa0b4" }}>
              Pose
            </button>
            <button onClick={() => setEditMode("rig")}
              disabled={vertexCount == null}
              title="Place your own joints and use them as pivots to scale/rotate/move a masked region"
              className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: editMode === "rig" ? PURPLE : "#1e1a17", color: editMode === "rig" ? "#fff" : "#8aa0b4" }}>
              Rig
            </button>
          </div>

          {(editMode === "poly_edit" || editMode === "pose" || editMode === "rig") && (
            <>
              {editMode === "poly_edit" && (
                <>
                  <p className="text-[10px] text-dim uppercase tracking-wide mb-1.5">Select</p>
                  <div className="flex gap-1 mb-3">
                    {([["vertex", "1"], ["edge", "2"], ["face", "3"]] as [SelectMode, string][]).map(([m, key]) => (
                      <button key={m} onClick={() => setSelectMode(m)}
                        title={`${m[0].toUpperCase()}${m.slice(1)} (${key})`}
                        className="flex-1 py-1.5 rounded text-[11px] font-medium capitalize transition-colors"
                        style={{ background: selectMode === m ? "rgba(196,123,232,.22)" : "#1e1a17", color: selectMode === m ? PURPLE : "#8aa0b4" }}>
                        {m}
                      </button>
                    ))}
                  </div>

                  <p className="text-[10px] text-dim uppercase tracking-wide mb-1.5">Selection Tool</p>
                  <div className="flex gap-1 mb-3">
                    {([["click", "Click"], ["box", "Box"], ["lasso", "Lasso"]] as [PolyEditSelectTool, string][]).map(([t, label]) => (
                      <button key={t} onClick={() => setPolyEditSelectTool(t)}
                        title={t === "click" ? "Click one element at a time" : `Ctrl+drag a ${t === "box" ? "rectangle" : "freeform loop"} to select many`}
                        className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors"
                        style={{ background: polyEditSelectTool === t ? "rgba(196,123,232,.22)" : "#1e1a17", color: polyEditSelectTool === t ? PURPLE : "#8aa0b4" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <p className="text-[10px] text-dim uppercase tracking-wide mb-1.5">Transform</p>
              <div className="flex gap-1 mb-2">
                {([["translate", "Move", "W", "/Transform.png"], ["rotate", "Rotate", "E", "/rotate.png"], ["scale", "Scale", "R", "/scale.png"]] as [TransformMode, string, string, string][]).map(([m, label, key, icon]) => (
                  <button key={m} onClick={() => setTransformMode(m)}
                    title={`${label} (${key})`}
                    className="flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded text-[10px] font-medium transition-colors"
                    style={{ background: transformMode === m ? "rgba(196,123,232,.22)" : "#1e1a17", color: transformMode === m ? PURPLE : "#8aa0b4" }}>
                    <Image src={icon} alt={label} width={22} height={22}
                      style={{ filter: transformMode === m ? "brightness(1.2) drop-shadow(0 0 6px rgba(196,123,232,0.6))" : "brightness(0.9) saturate(0.6)", transition: "filter 0.15s" }} />
                    {label}
                  </button>
                ))}
              </div>

              {editMode === "poly_edit" && (
                <>
                  <p className="text-[10.5px]" style={{ color: selectionCount > 0 ? PURPLE : "#6a8098" }}>
                    {selectionCount === 0
                      ? polyEditSelectTool === "click"
                        ? "Click a mesh to select · Shift-click to add"
                        : `Ctrl+drag a ${polyEditSelectTool === "box" ? "box" : "loop"} to select · Shift adds · Alt subtracts`
                      : `${selectionCount} ${selectMode}${selectionCount === 1 ? "" : "s"} selected`}
                  </p>

                  {(selectMode === "face" || selectMode === "edge") && (
                    <div className="mt-3 pt-3 border-t border-[#2a2320]">
                      {selectMode === "edge" && (
                        <p className="text-[10.5px] mb-2" style={{ color: !loopPreview ? "#4a4040" : loopPreview.boundary ? "#6a8098" : "#e0824a" }}>
                          {loopPreview
                            ? loopPreview.boundary
                              ? `${loopPreview.edgeCount} edges in loop${loopPreview.closed ? " (closed)" : ""}`
                              : "Interior loop — not extrudable yet"
                            : "Select a boundary edge to preview its loop"}
                        </p>
                      )}
                      <label className="block mb-2">
                        <div className="flex justify-between mb-1">
                          <span className="text-[11px] text-dim">Extrude Distance</span>
                          <span className="text-[11px] text-ink">{extrudeDistance.toFixed(3)}</span>
                        </div>
                        <input type="range" min={-2} max={2} step={0.01} value={extrudeDistance}
                          onChange={(e) => setExtrudeDistance(Number(e.target.value))}
                          className="w-full accent-[#c47be8]" />
                      </label>
                      <button
                        onClick={handleExtrude}
                        disabled={selectionCount === 0 || (selectMode === "edge" && loopPreview != null && !loopPreview.boundary)}
                        className="w-full py-1.5 rounded text-[11px] font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: PURPLE }}>
                        {selectMode === "face" ? `Extrude Face${selectionCount > 1 ? "s" : ""}` : "Extrude Loop"}
                      </button>
                      {extrudeMsg && <p className="text-[10.5px] mt-1.5 text-amber-400">{extrudeMsg}</p>}
                    </div>
                  )}
                </>
              )}

              {editMode === "pose" && (
                <div className="mt-2">
                  <button
                    onClick={handleResetPose}
                    className="w-full py-1.5 rounded text-[11px] font-semibold text-white transition-colors mb-3"
                    style={{ background: PURPLE }}>
                    Reset Pose
                  </button>

                  <div className="pb-3 mb-3 border-b border-[#2a2320]">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] text-dim uppercase tracking-wide">Clips</p>
                      <button onClick={handleCreateClip} disabled={bones.length === 0}
                        className="text-[10.5px] px-1.5 py-0.5 rounded" style={{ color: PURPLE }}>
                        + New Clip
                      </button>
                    </div>
                    {poseClips.length === 0 ? (
                      <p className="text-[10.5px]" style={{ color: "#4a4040" }}>No clips yet — pose the character and press Add Keyframe (bottom of viewport).</p>
                    ) : (
                      <div className="space-y-0.5">
                        {poseClips.map((clip) => (
                          <button key={clip.id} onClick={() => handleSelectClip(clip.id)}
                            style={{ background: activeClipId === clip.id ? "rgba(196,123,232,.22)" : "transparent", color: activeClipId === clip.id ? PURPLE : "#8aa0b4" }}
                            className="w-full text-left py-1 px-1.5 rounded text-[11px] truncate transition-colors hover:bg-[#1e1a17]">
                            {clip.name} <span className="opacity-60">({clip.duration.toFixed(2)}s)</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {detectedControls.length > 0 && (
                    <div className="pb-3 mb-3 border-b border-[#2a2320]">
                      <p className="text-[10px] text-dim uppercase tracking-wide mb-1.5">Quick Select</p>
                      <div className="flex flex-wrap gap-1">
                        {detectedControls.map((c) => {
                          const active = c.kind === "bone" ? selectedBoneId === c.id : selectedIKChainId === c.id;
                          const hasControl = c.kind === "bone"
                            ? controls.some((ctrl) => ctrl.attachment.kind === "bone" && ctrl.attachment.boneUuid === c.id)
                            : controls.some((ctrl) => ctrl.attachment.kind === "ikTarget" && ctrl.attachment.chainId === c.id);
                          return (
                            <div key={`${c.kind}-${c.id}`} className="flex items-stretch">
                              <button
                                onClick={() => c.kind === "bone"
                                  ? handleSelectBone(c.entryId, active ? null : c.id)
                                  : handleSelectIKChain(c.entryId, active ? null : c.id)}
                                title={c.kind === "bone"
                                  ? "Direct FK handle — drag to rotate/position this bone on its own, independent of any IK chain"
                                  : "IK target — drag the gizmo and the chain solves toward it"}
                                style={{ background: active ? "rgba(196,123,232,.22)" : "#1e1a17", color: active ? PURPLE : "#8aa0b4", border: `1px solid ${active ? PURPLE : "#3a3530"}`, borderRight: hasControl ? "none" : undefined }}
                                className="px-2 py-1 rounded-l text-[10.5px] font-medium transition-colors">
                                {c.label}
                              </button>
                              <button
                                onClick={() => c.kind === "bone" ? handleAddControlToBone(c.entryId, c.id) : handleAddControlToIKChain(c.entryId, c.id)}
                                disabled={hasControl}
                                title={hasControl ? "Already has a control ring" : "Add a control ring"}
                                className="px-1.5 rounded-r text-[10px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                style={{ background: "#1e1a17", color: "#5ac8e8", border: "1px solid #3a3530", borderLeft: "none" }}>
                                {hasControl ? "○" : "+○"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-dim uppercase tracking-wide mb-1.5">Bones</p>
                  <div className="max-h-60 overflow-y-auto space-y-0.5">
                    {bones.map((bone) => {
                      const hasControl = controls.some((ctrl) => ctrl.attachment.kind === "bone" && ctrl.attachment.boneUuid === bone.id);
                      return (
                        <div key={bone.id} className="flex items-center gap-1">
                          <button
                            onClick={() => handleSelectBone(bone.entryId, bone.id === selectedBoneId ? null : bone.id)}
                            style={{ paddingLeft: `${8 + bone.depth * 14}px`, background: selectedBoneId === bone.id ? "rgba(196,123,232,.22)" : "transparent", color: selectedBoneId === bone.id ? PURPLE : "#8aa0b4" }}
                            className="flex-1 text-left py-1 rounded text-[11px] truncate transition-colors hover:bg-[#1e1a17]">
                            {bone.name}
                          </button>
                          <button
                            onClick={() => hasControl ? undefined : handleAddControlToBone(bone.entryId, bone.id)}
                            disabled={hasControl}
                            title={hasControl ? "Already has a control ring" : "Add a control ring"}
                            className="text-[10px] px-1.5 py-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{ color: "#5ac8e8", border: "1px solid #3a3530" }}>
                            {hasControl ? "○" : "+○"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {controlMsg && <p className="text-[10.5px] mt-2" style={{ color: "#e05a4e" }}>{controlMsg}</p>}
                  <p className="text-[10.5px] mt-2" style={{ color: selectedBoneId || selectedIKChainId ? PURPLE : "#6a8098" }}>
                    {selectedBoneId || selectedIKChainId ? "Drag the gizmo (or a control ring) to pose the selection" : "Click a bone/control (in a list, or the viewport) to select it"}
                  </p>
                  {selectedBoneId && (
                    <button
                      onClick={handleResetBone}
                      title="Restore just this bone to its bind pose, leaving every other bone's current pose untouched"
                      className="w-full mt-1.5 py-1 rounded text-[11px] font-medium transition-colors"
                      style={{ background: "#1e1a17", color: "#8aa0b4", border: "1px solid #3a3530" }}>
                      Reset Selected Bone
                    </button>
                  )}

                </div>
              )}

              {editMode === "rig" && (
                <div className="mt-2">
                  <p className="text-[10.5px] mb-3" style={{ color: "#6a8098" }}>
                    Click the mesh to place a joint (click again from a
                    selected joint to chain the next one). To isolate a
                    region for a joint to scale/rotate/move, paint it with
                    the Mask brush first (Sculpt mode). Once you Bind Skin
                    below, posing and control rings live in Pose mode.
                  </p>

                  {joints.length > 0 && (
                    <div className="mb-3 pb-3 border-b border-[#2a2320]">
                      <p className="text-[10px] text-dim uppercase tracking-wide mb-1.5">Bind Skin</p>
                      <p className="text-[10.5px] mb-2" style={{ color: "#6a8098" }}>
                        Turns the placed joints into a real posable
                        skeleton with automatically-computed weights —
                        pose it afterward in Pose mode.
                      </p>
                      <div className="flex gap-1 mb-2">
                        {([["distance", "Distance"], ["diffusion", "Diffusion"]] as [typeof bindAlgorithm, string][]).map(([a, label]) => (
                          <button key={a} onClick={() => setBindAlgorithm(a)}
                            disabled={!!rigBindInfo?.bound}
                            title={a === "distance"
                              ? "Nearest bone segments by inverse distance — fast, but can bleed across thin gaps (fingers, straps)"
                              : "Mesh-aware: spreads influence along the mesh surface graph, not straight-line distance — slower, but respects thin gaps"}
                            className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: bindAlgorithm === a ? "rgba(196,123,232,.22)" : "#1e1a17", color: bindAlgorithm === a ? PURPLE : "#8aa0b4" }}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={rigBindInfo?.bound ? handleUnbindSkin : handleBindSkin}
                        className="w-full py-1.5 rounded text-[11px] font-semibold text-white transition-colors"
                        style={{ background: rigBindInfo?.bound ? "#8a3a3a" : PURPLE }}>
                        {rigBindInfo?.bound ? "Unbind" : "Bind Skin"}
                      </button>
                      {rigBindInfo?.bound && (
                        <p className="text-[10.5px] mt-1.5" style={{ color: "#8ee85a" }}>
                          Bound — {rigBindInfo.boneCount} bone{rigBindInfo.boneCount === 1 ? "" : "s"} · pose it in Pose mode
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] text-dim uppercase tracking-wide mb-1.5">Joints</p>
                  {joints.length === 0 && (
                    <p className="text-[10.5px]" style={{ color: "#4a4040" }}>No joints yet — click the mesh to place one.</p>
                  )}
                  <div className="max-h-60 overflow-y-auto space-y-0.5">
                    {joints.map((joint) => (
                      <div key={joint.id} className="flex items-center gap-1" style={{ paddingLeft: `${8 + joint.depth * 14}px` }}>
                        {editingJointId === joint.id ? (
                          <input
                            autoFocus
                            defaultValue={joint.name}
                            onBlur={(e) => { handleRenameJoint(joint.entryId, joint.id, e.target.value.trim() || joint.name); setEditingJointId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditingJointId(null);
                            }}
                            className="flex-1 py-1 px-1.5 rounded text-[11px] bg-[#1e1a17] text-ink outline-none"
                            style={{ border: `1px solid ${PURPLE}` }}
                          />
                        ) : (
                          <button
                            onClick={(e) => {
                              if (e.shiftKey && selectedJointId && joint.id !== selectedJointId) {
                                handleMarkPendingParent(joint.id);
                                return;
                              }
                              handleSelectJoint(joint.entryId, joint.id === selectedJointId ? null : joint.id);
                            }}
                            onDoubleClick={() => setEditingJointId(joint.id)}
                            style={{
                              background: pendingParentJointId === joint.id ? "rgba(232,168,63,.22)" : selectedJointId === joint.id ? "rgba(196,123,232,.22)" : "transparent",
                              color: pendingParentJointId === joint.id ? "#e8a83f" : selectedJointId === joint.id ? PURPLE : "#8aa0b4",
                            }}
                            className="flex-1 text-left py-1 px-1.5 rounded text-[11px] truncate transition-colors hover:bg-[#1e1a17]"
                            title="Click to select · Shift-click to mark as parent (press P) · Double-click to rename">
                            {joint.name}
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteJoint(joint.entryId, joint.id)}
                          title="Delete joint (children reparent up)"
                          className="text-dim hover:text-red-400 transition-colors px-1">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10.5px] mt-2" style={{ color: rigMsg ? "#e05a4e" : pendingParentJointId ? "#e8a83f" : selectedJointId ? PURPLE : "#6a8098" }}>
                    {rigMsg
                      ? rigMsg
                      : pendingParentJointId
                        ? "Press P to parent the selected joint under this one (Shift+P to un-parent)"
                        : selectedJointId
                          ? "Drag the gizmo to reposition · Shift-click another joint (list or viewport) to mark it as parent, then press P"
                          : "Click a joint (in the list or viewport) to select it"}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Brush settings */}
        {/* min-h-0 overrides the flex default of min-height:auto, which
            otherwise refuses to shrink this item below its content size —
            without it, a tall panel (e.g. Pose mode's bones+clips list)
            pushes the sidebar taller than its fixed height instead of
            scrolling internally. */}
        <div className="px-4 py-3 border-b border-[#2a2320] flex-1 min-h-0 overflow-y-auto">
          {/* Everything below except Undo/Redo is sculpt-brush-specific
              (radius/strength, subdivision, mask extract, etc.) — none of
              it means anything in poly_edit/pose/rig, so it's gated to
              editMode === "sculpt" rather than showing regardless. */}
          {editMode === "sculpt" && (
            <>
              <div className="mb-4">
                <p className="text-[10.5px] leading-relaxed" style={{ color: "#6a8098" }}>
                  <span className="font-semibold" style={{ color: PURPLE }}>{activeDef.label}</span>
                  {" — "}{activeDef.desc}
                </p>
                {activeDef.invertHint && (
                  <p className="text-[10px] mt-1" style={{ color: altHeld ? PURPLE : "#4a4040" }}>
                    {activeDef.invertHint}{altHeld ? " · active" : ""}
                  </p>
                )}
                <p className="text-[10px] mt-1" style={{ color: shiftHeld ? PURPLE : "#4a4040" }}>
                  Shift = smooth{shiftHeld ? " · active" : ""}
                </p>
              </div>

              {[
                { key: "brushRadius",      label: "Radius",       min: 0.02, max: 2,    step: 0.01, val: brushRadius,      set: setBrushRadius,      fmt: (v: number) => v.toFixed(2) },
                { key: "brushInnerRadius", label: "Inner Radius", min: 0,    max: 0.95, step: 0.01, val: brushInnerRadius, set: setBrushInnerRadius, fmt: (v: number) => Math.round(v * 100) + "%" },
                { key: "brushStrength",    label: "Strength",     min: 0.01, max: 1,    step: 0.01, val: brushStrength,    set: setBrushStrength,    fmt: (v: number) => Math.round(v * 100) + "%" },
              ].map(({ key, label, min, max, step, val, set, fmt }) => (
                <label key={key} className="block mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-[11px] text-dim">{label}</span>
                    <span className="text-[11px] text-ink">{fmt(val)}</span>
                  </div>
                  <input type="range" min={min} max={max} step={step} value={val}
                    onChange={(e) => set(Number(e.target.value))}
                    className="w-full accent-[#c47be8]" />
                </label>
              ))}

              {/* Brush-radius vertex highlight density — "all" gets visually
                  noisy on dense/subdivided meshes */}
              <label className="block mb-4">
                <div className="text-[11px] text-dim mb-1">Highlight</div>
                <div className="flex gap-1">
                  {([["center", "Center"], ["all", "All"], ["none", "None"]] as [HighlightMode, string][]).map(([m, label]) => (
                    <button key={m} onClick={() => setHighlightMode(m)}
                      className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors"
                      style={{ background: highlightMode === m ? "rgba(196,123,232,.22)" : "#1e1a17", color: highlightMode === m ? PURPLE : "#8aa0b4" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </label>
            </>
          )}

          <div className="flex gap-2 mt-4">
            <button onClick={() => viewerHandleRef.current?.undo()}
              className="flex-1 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors" title="Ctrl+Z">Undo</button>
            <button onClick={() => viewerHandleRef.current?.redo()}
              className="flex-1 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors" title="Ctrl+Shift+Z">Redo</button>
          </div>

          {editMode === "sculpt" && (
            <>
              {/* Paint Color Picker */}
              {brushMode === "paint" && (
                <div className="mt-4 pt-4 border-t border-[#2a2320]">
                  <p className="text-[11px] text-dim mb-2">Paint Color</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={paintColor}
                      onChange={(e) => setPaintColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent p-0"
                      style={{ appearance: "none", WebkitAppearance: "none" }}
                    />
                    <span className="text-[11px] text-ink font-mono">{paintColor}</span>
                  </div>
                </div>
              )}

              {/* Mask + Extract/Detach — paint a region, then either pull a
                  thickened shell out of it (Extract, source untouched) or pull
                  the already-3D triangles themselves out of it (Detach, source
                  IS mutated — e.g. removing a vehicle door/wheel while keeping
                  the shared UV map). See Submeshes list below. */}
              {brushMode === "mask" && (
                <div className="mt-4 pt-4 border-t border-[#2a2320]">
                  <p className="text-[11px] text-dim mb-2">Extract / Detach</p>
                  {[
                    { key: "maskThreshold", label: "Threshold", min: 0.05, max: 0.95, step: 0.01, val: maskThreshold, set: setMaskThreshold, fmt: (v: number) => Math.round(v * 100) + "%" },
                    { key: "maskThickness", label: "Thickness (Extract only)",  min: -0.5, max: 0.5,  step: 0.005, val: maskThickness, set: setMaskThickness, fmt: (v: number) => v.toFixed(3) },
                  ].map(({ key, label, min, max, step, val, set, fmt }) => (
                    <label key={key} className="block mb-3">
                      <div className="flex justify-between mb-1">
                        <span className="text-[11px] text-dim">{label}</span>
                        <span className="text-[11px] text-ink">{fmt(val)}</span>
                      </div>
                      <input type="range" min={min} max={max} step={step} value={val}
                        onChange={(e) => set(Number(e.target.value))}
                        className="w-full accent-[#c47be8]" />
                    </label>
                  ))}
                  <div className="flex gap-2">
                    <button onClick={handleExtractMask}
                      className="flex-1 py-1.5 rounded-md text-white text-[11px] font-medium transition-colors"
                      style={{ background: PURPLE }}>
                      Extract
                    </button>
                    <button onClick={handleDetachMask}
                      className="flex-1 py-1.5 rounded-md text-white text-[11px] font-medium transition-colors"
                      style={{ background: "#c48b20" }}>
                      Detach
                    </button>
                  </div>
                  <button onClick={handleClearMask}
                    className="w-full mt-2 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors">
                    Clear Mask
                  </button>
                  <p className="text-[10px] text-amber-400 mt-1.5">Detach removes the masked triangles from this mesh — unlike Extract, it edits the mesh you&apos;re on.</p>
                  {extractMsg && <p className="text-[11px] mt-1.5 text-green-400">{extractMsg}</p>}
                </div>
              )}

              {/* Subdivision */}
              <div className="mt-4 pt-4 border-t border-[#2a2320]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-dim">Subdivision</span>
                  <span className="text-[11px] text-ink">Level {subdivLevel}</span>
                </div>
                <div className="flex gap-1 mb-1">
                  <button
                    onClick={() => setSmoothSubdivide(true)}
                    title="Catmull-Clark — rounds the shape as it densifies"
                    className="flex-1 py-1 rounded text-[10.5px] font-medium transition-colors"
                    style={{ background: smoothSubdivide ? "rgba(196,123,232,.22)" : "#1e1a17", color: smoothSubdivide ? PURPLE : "#8aa0b4" }}>
                    Smooth
                  </button>
                  <button
                    onClick={() => setSmoothSubdivide(false)}
                    title="Simple — adds density without changing the shape"
                    className="flex-1 py-1 rounded text-[10.5px] font-medium transition-colors"
                    style={{ background: !smoothSubdivide ? "rgba(196,123,232,.22)" : "#1e1a17", color: !smoothSubdivide ? PURPLE : "#8aa0b4" }}>
                    Simple
                  </button>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      const ok = viewerHandleRef.current?.subdivideDown();
                      if (ok) setSubdivLevel((l) => Math.max(0, l - 1));
                    }}
                    disabled={subdivLevel === 0}
                    className="flex-1 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Step back to previous subdivision level">
                    ▼ Down
                  </button>
                  <button
                    onClick={() => {
                      viewerHandleRef.current?.subdivide();
                      setSubdivLevel((l) => l + 1);
                    }}
                    disabled={vertexCount == null || (vertexCount * 4 > 1_000_000)}
                    className="flex-1 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={smoothSubdivide ? "Catmull-Clark subdivision — each level ≈ 4× triangle count" : "Simple subdivision — adds density without rounding the shape"}>
                    ▲ Up
                  </button>
                </div>
                <button
                  onClick={() => viewerHandleRef.current?.remesh()}
                  disabled={vertexCount == null}
                  className="w-full py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-1"
                  title="Globally redistribute triangles to even edge density">
                  Remesh
                </button>
                <input
                  ref={conformFileInputRef}
                  type="file"
                  accept=".obj"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleConformFile(file);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => conformFileInputRef.current?.click()}
                  disabled={vertexCount == null}
                  className="w-full py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-1"
                  title="Wrap the current mesh onto the surface of a reference OBJ (e.g. an export at a different subdivision level) — position-only, doesn't need matching topology">
                  Conform to Reference…
                </button>
                {conformMsg && <p className="text-[10px] mt-1 text-green-400">{conformMsg}</p>}
                {(vertexCount ?? 0) > 1_000_000 && (
                  <p className="text-[10px] text-amber-400 mt-1">Approaching limit — save before subdividing further</p>
                )}
              </div>
            </>
          )}

          {/* Submeshes — every mesh currently in the scene (the original
              load plus anything Extract/Detach has pulled out of it). Each
              can be hidden, deleted, or saved to the library on its own. */}
          {submeshes.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#2a2320]">
              <p className="text-[11px] text-dim mb-2">Submeshes</p>
              <div className="flex flex-col gap-1.5">
                {submeshes.map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-[#1e1a17]">
                    <button
                      onClick={() => handleToggleSubmeshVisible(t.id, !t.visible)}
                      title={t.visible ? "Hide" : "Show"}
                      className="w-5 h-5 flex items-center justify-center text-[11px] flex-shrink-0"
                      style={{ color: t.visible ? "#8aa0b4" : "#4a4040" }}>
                      {t.visible ? "◉" : "○"}
                    </button>
                    <span className="flex-1 text-[11px] text-ink truncate" title={`${t.name} — ${t.vertexCount.toLocaleString()} vertices`}>
                      {t.name}
                    </span>
                    <button
                      onClick={() => handleSaveSubmesh(t.id, t.name)}
                      disabled={submeshSaving === t.id}
                      title="Save this submesh as its own asset"
                      className="text-[10px] px-1.5 py-0.5 rounded text-dim hover:text-ink transition-colors disabled:opacity-40">
                      {submeshSaving === t.id ? "…" : "Save"}
                    </button>
                    <button
                      onClick={() => handleDeleteSubmesh(t.id)}
                      disabled={submeshes.length <= 1}
                      title={submeshes.length <= 1 ? "Can't delete the last mesh" : "Delete"}
                      className="w-5 h-5 flex items-center justify-center text-[11px] text-dim hover:text-red-400 transition-colors disabled:opacity-30 disabled:hover:text-dim flex-shrink-0">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#2a2320] flex-shrink-0">
          {vertexCount != null && (
            <p className={`text-[11px] mb-2 ${highVertCount ? "text-amber-400" : "text-dim"}`}>
              {vertexCount.toLocaleString()} vertices{highVertCount && " — consider decimating first"}
            </p>
          )}
          {vertexCount != null && (
            <button onClick={clearWorkspace}
              className="w-full py-1.5 rounded-md mb-2 text-[11px] font-medium transition-colors border border-[#3a2a50] text-dim hover:text-red-400 hover:border-red-400/40">
              Clear Workspace
            </button>
          )}
          {subdivLevel > 0 && (
            <label className="block mb-2">
              <div className="text-[10px] text-dim mb-1">Export level</div>
              <select
                value={exportLevel}
                onChange={(e) => setExportLevel(Number(e.target.value))}
                className="w-full px-2 py-1.5 rounded bg-[#1e1a17] text-[11px] text-ink border border-[#3a2a50] outline-none transition-colors"
              >
                {Array.from({ length: subdivLevel + 1 }, (_, i) => (
                  <option key={i} value={i}>
                    Level {i} {i === subdivLevel ? "(current)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={() => setCompressKtx2((v) => !v)}
            className="w-full mb-2 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors text-left"
            style={{ background: compressKtx2 ? "rgba(196,123,232,.18)" : "#1e1a17", color: compressKtx2 ? PURPLE : "#8aa0b4" }}
            title="Compress embedded textures to KTX2 (Basis Universal) on save">
            {compressKtx2 ? "✓ " : ""}Compress textures (KTX2)
          </button>
          <button onClick={handleSave} disabled={saving || vertexCount === null}
            className="w-full py-2 rounded-md disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium transition-colors"
            style={{ background: saving || vertexCount === null ? "#3a2a50" : PURPLE }}>
            {saving ? "Saving…" : `Save to Library${exportLevel > 0 ? ` (level ${exportLevel})` : ""}`}
          </button>
          {saveMsg && (
            <p className={`text-[11px] mt-1.5 ${saveMsg.includes("ailed") ? "text-red-400" : "text-green-400"}`}>{saveMsg}</p>
          )}
        </div>
      </aside>

      {/* ── MAIN PANEL: top toolbar + canvas ── */}
      <section className="flex-1 flex flex-col overflow-hidden">

        {/* TOP TOOLBAR */}
        <div className="flex items-stretch border-b border-[#2a2320] bg-[#100e0c] flex-shrink-0">

          {/* BRUSH SHELF — sculpt mode only; poly-edit's own selection/transform
              controls live in the sidebar (§ Mode panel) instead. */}
          {editMode === "sculpt" ? (
            <div className="flex items-center gap-0.5 px-2 py-1.5">
              {BRUSH_MODES.map(({ mode, label, shortcut, invertHint }) => {
                const active = brushMode === mode;
                const subtracting = active && !!invertHint && altHeld;
                return (
                  <button key={mode} onClick={() => setBrushMode(mode)}
                    title={`${label} (${shortcut})${invertHint ? "  ·  " + invertHint : ""}`}
                    className="relative flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all"
                    style={{
                      background: subtracting ? "rgba(196,123,232,.4)" : active ? "rgba(196,123,232,.22)" : "transparent",
                      color: active ? PURPLE : "#8aa0b4",
                    }}>
                    <BrushIcon mode={mode} active={active} />
                    <span className="text-[10px] font-semibold tracking-wide uppercase leading-none">{label}</span>
                    {subtracting && (
                      <span className="absolute -top-1 -right-1 text-[8px] font-bold px-1 rounded-full leading-tight"
                        style={{ background: PURPLE, color: "#fff" }}>⇩</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center px-4 py-1.5">
              <span className="text-[11px] font-medium" style={{ color: PURPLE }}>Poly Edit</span>
              <span className="text-[10px] text-dim ml-2">Tab to sculpt</span>
            </div>
          )}

          {/* Divider */}
          <div className="w-px self-stretch bg-[#2a2320] mx-1" />

          {/* INSERT PRIMITIVES */}
          <div className="relative flex items-center">
            <button
              onClick={() => setShowPrimitives((v) => !v)}
              className="px-3 py-1.5 text-[11px] font-medium rounded transition-colors mx-1"
              style={{ color: showPrimitives ? PURPLE : "#8aa0b4", background: showPrimitives ? "rgba(196,123,232,.15)" : "transparent" }}>
              Insert +
            </button>
            {showPrimitives && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPrimitives(false)} />
                <div className="absolute top-full left-0 z-50 mt-1 p-2 rounded-xl border border-[#2a2320] bg-[#100e0c] shadow-xl"
                  style={{ width: 220 }}>
                  <p className="text-[10px] text-dim px-1 pb-2 border-b border-[#2a2320] mb-2">Insert primitive</p>
                  <div className="grid grid-cols-4 gap-1">
                    {PRIMITIVES.map(({ type, label, icon }) => (
                      <button key={type}
                        onClick={() => { void handleInsertPrimitive(type); }}
                        className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-[#1e1a17] transition-colors">
                        <span className="text-[18px] leading-none font-bold" style={{ color: "#8aa0b4" }}>{icon}</span>
                        <span className="text-[9px] text-dim">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* DynTopo toggle */}
          <div className="flex items-center px-1">
            <button
              onClick={() => setDynTopo((d) => !d)}
              title="Dynamic Topology: automatically adds geometry where you're sculpting. After each stroke, any triangle stretched past 1.5x the mesh's original edge length gets split — so detail stays smooth exactly where you're working, without needing to pre-subdivide the whole mesh. Areas you haven't touched stay at their original density."
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ background: dynTopo ? PURPLE : "transparent", color: dynTopo ? "#fff" : "#8aa0b4" }}>
              DynTopo
            </button>
          </div>

          {/* Wireframe overlay toggle — independent of view mode, shows on
              top of Combined/Clay/Albedo/AO alike */}
          <div className="flex items-center px-1">
            <button
              onClick={() => setShowWireframe((w) => !w)}
              title="Show mesh wireframe on top of the current view mode"
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ background: showWireframe ? PURPLE : "transparent", color: showWireframe ? "#fff" : "#8aa0b4" }}>
              Wireframe
            </button>
          </div>

          {/* Ground reference grid toggle */}
          <div className="flex items-center px-1">
            <button
              onClick={() => setShowGrid((g) => !g)}
              title="Show the ground reference grid"
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ background: showGrid ? PURPLE : "transparent", color: showGrid ? "#fff" : "#8aa0b4" }}>
              Grid
            </button>
          </div>

          {/* Mirror (X-axis symmetry) toggle — ZBrush-style, mirrors both
              brush strokes and poly-edit selection/transforms */}
          <div className="flex items-center px-1">
            <button
              onClick={() => setMirrorMode((m) => !m)}
              title="Mirror sculpting and poly-edit across the X axis (M)"
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ background: mirrorMode ? PURPLE : "transparent", color: mirrorMode ? "#fff" : "#8aa0b4" }}>
              Mirror
            </button>
          </div>

          {/* Recenter View — frames the selected submesh, or the whole
              scene if nothing's selected */}
          <div className="flex items-center px-1">
            <button
              onClick={() => viewerHandleRef.current?.recenterView()}
              title="Frame the selected submesh, or the whole scene if nothing's selected"
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ color: "#8aa0b4" }}>
              Recenter
            </button>
          </div>

          {/* Perspective/Orthographic projection toggle */}
          <div className="flex items-center px-1">
            <button
              onClick={() => viewerHandleRef.current?.toggleProjection()}
              title="Switch between Perspective and Orthographic projection"
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ background: isOrthographic ? PURPLE : "transparent", color: isOrthographic ? "#fff" : "#8aa0b4" }}>
              {isOrthographic ? "Orthographic" : "Perspective"}
            </button>
          </div>

          {/* Divider */}
          <div className="w-px self-stretch bg-[#2a2320] mx-1" />

          {/* VIEW MODES */}
          <div className="flex items-center gap-0.5 px-1">
            {VIEW_MODES.map(({ mode, label }) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
                style={{
                  background: viewMode === mode ? PURPLE : "transparent",
                  color:      viewMode === mode ? "#fff"  : "#8aa0b4",
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* X-Ray toggle — makes the mesh translucent so interior
              structure (bones, when Bone Viewer is on) is visible through it */}
          <div className="flex items-center px-1">
            <button
              onClick={() => setXrayEnabled((x) => !x)}
              title="Make the mesh translucent, so bones (with Bone Viewer on) are visible through it"
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ background: xrayEnabled ? PURPLE : "transparent", color: xrayEnabled ? "#fff" : "#8aa0b4" }}>
              X-Ray
            </button>
          </div>

          {/* Bone Viewer — 3-state cycle: Off / On (occluded by the mesh,
              pair with X-Ray) / On Top (always visible, ignores mesh depth).
              Shows the imported skeleton (if any) without entering Pose mode. */}
          <div className="flex items-center px-1">
            <button
              onClick={() => setBoneViewerMode((m) => m === "off" ? "on" : m === "on" ? "onTop" : "off")}
              title="Show the mesh's skeleton (if rigged), independent of Pose mode. Cycles Off / On / On Top"
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ background: boneViewerMode !== "off" ? PURPLE : "transparent", color: boneViewerMode !== "off" ? "#fff" : "#8aa0b4" }}>
              {boneViewerMode === "off" ? "Bones" : boneViewerMode === "on" ? "Bones: On" : "Bones: Top"}
            </button>
          </div>

          {viewMode === "clay" && (
            <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-[#2a2320]">
              {CLAY_PRESETS.map((p) => (
                <button key={p.color} title={p.label} onClick={() => setClayColor(p.color)}>
                  <span className="block w-5 h-5 rounded-full border-2 transition-all"
                    style={{ background: p.color, borderColor: clayColor === p.color ? PURPLE : "#3a3530",
                             transform: clayColor === p.color ? "scale(1.15)" : "scale(1)" }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div
          className="flex-1 relative"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* Channel Box — floating/transparent over the viewport, same
              look as World Builder's own panels (lib/world-builder/
              editor.css's .panel rule), not embedded in the sidebar.
              Click a field's axis label to select it, Shift-click to
              multi-select several; typing a value into any selected
              field and hitting Enter/blurring applies it to every
              selected field at once (Maya's own Channel Box gesture). */}
          {editMode === "pose" && (selectedBoneId || selectedIKChainId) && selectedTransform && (
            <div
              className="absolute top-4 right-4 z-20 w-60 p-3"
              style={{
                background: "rgba(7,10,16,0.82)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "8px",
              }}
            >
              <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: "#d3dbe8" }}>Channel Box</p>
              {([
                { label: "Translate", digits: 3, fields: ["px", "py", "pz"] as TransformField[], values: selectedTransform.position },
                ...(selectedTransform.kind === "bone" ? [
                  { label: "Rotate", digits: 1, fields: ["rx", "ry", "rz"] as TransformField[], values: selectedTransform.rotationDeg },
                  { label: "Scale", digits: 3, fields: ["sx", "sy", "sz"] as TransformField[], values: selectedTransform.scale },
                ] : []),
              ]).map((row) => (
                <div key={row.label} className="mb-2 last:mb-0">
                  <p className="text-[9.5px] uppercase tracking-wide mb-1" style={{ color: "#6a8098" }}>{row.label}</p>
                  <div className="grid grid-cols-3 gap-1">
                    {(["X", "Y", "Z"] as const).map((axisLabel, i) => {
                      const field = row.fields[i];
                      const isSelected = channelSelection.has(field);
                      return (
                        <div key={field}>
                          <button
                            onClick={(e) => handleChannelLabelClick(field, e.shiftKey)}
                            title="Click to select · Shift-click to select multiple, then type one value to apply to all"
                            className="w-full text-[9px] rounded-t px-1 py-0.5 text-left transition-colors"
                            style={{ background: isSelected ? "rgba(196,123,232,.3)" : "rgba(255,255,255,0.06)", color: isSelected ? PURPLE : "#8aa0b4" }}>
                            {axisLabel}
                          </button>
                          <input
                            key={`${field}-${selectedBoneId ?? selectedIKChainId ?? ""}`}
                            type="number"
                            step="0.01"
                            defaultValue={row.values[i].toFixed(row.digits)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            onBlur={(e) => handleCommitChannel(field, e.target.value)}
                            className="w-full text-[10.5px] px-1 py-1 text-center outline-none"
                            style={{ background: "#1e1a17", color: "#e8e0d8", border: `1px solid ${isSelected ? PURPLE : "#3a3530"}`, borderTop: "none", borderRadius: "0 0 4px 4px" }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Empty workspace — shows drop zone */}
          {!loadingAsset && vertexCount === null && (
            <div
              className="absolute inset-0 flex items-center justify-center text-center pointer-events-none z-10"
              style={{ transition: "background 0.15s" }}
            >
              <div
                className="rounded-2xl px-10 py-8 flex flex-col items-center gap-2 transition-all"
                style={{
                  border: isDragging ? "2px dashed #c47be8" : "2px dashed #2a2320",
                  background: isDragging ? "rgba(196,123,232,0.07)" : "transparent",
                  transition: "all 0.15s",
                }}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ opacity: isDragging ? 1 : 0.35 }}>
                  <path d="M12 16V4m0 0L8 8m4-4 4 4" stroke={isDragging ? "#c47be8" : "#8aa0b4"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke={isDragging ? "#c47be8" : "#8aa0b4"} strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                <p className="text-sm font-medium" style={{ color: isDragging ? "#c47be8" : "#c0b8b0" }}>
                  {isDragging ? "Drop to load" : "Drop a GLB, DRC, or OBJ here"}
                </p>
                <p className="text-[11px]" style={{ color: "#6a8098" }}>
                  or select a mesh from the sidebar
                </p>
              </div>
            </div>
          )}
          {/* Model loaded — drag is blocked, show a subtle hint */}
          {vertexCount !== null && isDragging && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="rounded-xl px-6 py-4 text-center" style={{ background: "rgba(16,14,12,0.88)", border: "1px solid #3a2a50" }}>
                <p className="text-[12px] text-amber-400">Clear the workspace first before loading a new file.</p>
              </div>
            </div>
          )}
          <SculptViewer
            glbData={glbData}
            brushMode={brushMode}
            brushRadius={brushRadius}
            brushInnerRadius={brushInnerRadius}
            brushStrength={brushStrength}
            viewMode={viewMode}
            clayColor={clayColor}
            dynTopo={dynTopo}
            wireframeOverlay={showWireframe}
            xrayEnabled={xrayEnabled}
            boneViewerMode={boneViewerMode}
            showGrid={showGrid}
            highlightMode={highlightMode}
            smoothSubdivide={smoothSubdivide}
            mirrorMode={mirrorMode}
            editMode={editMode}
            selectMode={selectMode}
            polyEditSelectTool={polyEditSelectTool}
            transformMode={transformMode}
            onModelLoaded={handleModelLoaded}
            onLoadError={setLoadError}
            onSelectionChange={setSelectionCount}
            onLoopPreview={handleLoopPreview}
            onBoneSelect={setSelectedBoneId}
            onJointSelect={handleJointSelectionChange}
            onJointShiftClick={(_entryId, jointId) => handleMarkPendingParent(jointId)}
            onSelectedTransformChange={handleSelectedTransformChange}
            onProjectionChange={setIsOrthographic}
            onPoseTimeChange={handlePoseTimeChange}
            paintColor={paintColor}
            handleRef={viewerHandleRef}
          />
        </div>

        {/* TIME SLIDER — Maya-style: a full-viewport-width bar below the
            canvas (not the sidebar), holding just the frame-scoped
            playback controls. Clip/rig management (New Clip, clip list,
            Bones, Reset Pose) stays in the sidebar's Pose panel, matching
            Maya's own split between the Time Slider and Trax Editor. */}
        {editMode === "pose" && (() => {
          const totalFrames = poseTotalFrames;
          const currentFrame = Math.round(Math.min(poseTime, poseDuration) * poseFrameRate);
          const viewSpan = Math.max(1, viewRangeEnd - viewRangeStart);
          return (
            <div className="border-t border-[#2a2320] bg-[#100e0c] flex-shrink-0">
              {/* Row 1: playback + frame length/rate + keyframe actions */}
              <div className="flex items-center gap-3 px-4 pt-2">
                <button onClick={handleTogglePlay} disabled={!activeClipId}
                  className="px-3 py-1.5 rounded text-[11px] font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: PURPLE }}>
                  {posePlaying ? "Pause" : "Play"}
                </button>
                <span className="text-[11px] tabular-nums" style={{ color: "#8aa0b4" }}>
                  Frame {currentFrame} / {totalFrames}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[10.5px]" style={{ color: "#6a8098" }}>Length</span>
                  <input
                    type="number" min={1} disabled={!activeClipId}
                    value={totalFrames}
                    onChange={(e) => handleSetFrameCount(parseInt(e.target.value, 10))}
                    className="w-14 py-1 px-1.5 rounded text-[11px] bg-[#1e1a17] text-ink outline-none disabled:opacity-40"
                    style={{ border: "1px solid #3a3530" }}
                  />
                  <span className="text-[10.5px]" style={{ color: "#6a8098" }}>frames</span>
                </div>
                <div className="flex items-center gap-0.5">
                  {[24, 30, 60].map((fps) => (
                    <button key={fps} onClick={() => handleSetFrameRate(fps)} disabled={!activeClipId}
                      className="px-2 py-1 rounded text-[10.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: poseFrameRate === fps ? PURPLE : "transparent", color: poseFrameRate === fps ? "#fff" : "#8aa0b4" }}>
                      {fps}
                    </button>
                  ))}
                  <span className="text-[10.5px]" style={{ color: "#6a8098" }}>fps</span>
                </div>
                <div className="flex-1" />
                <button onClick={handleInsertKeyframe} disabled={bones.length === 0}
                  className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "#1e1a17", color: PURPLE, border: `1px solid ${PURPLE}` }}>
                  Add Keyframe
                </button>
                <button onClick={handleRemoveKeyframe} disabled={!activeClipId}
                  className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "#1e1a17", color: "#8aa0b4" }}>
                  Remove Keyframe
                </button>
              </div>

              {/* Row 2: Maya/Blender-style ruler — tick marks + frame
                  labels, a draggable playhead, keyframe diamonds sitting
                  on the ruler at their exact frame. Click or drag
                  anywhere on it to scrub (not a single slider thumb). */}
              <div className="px-4 pb-2 pt-3">
                <div
                  ref={rulerRef}
                  onPointerDown={(e) => {
                    const ruler = rulerRef.current;
                    if (activeClipId && ruler) {
                      const rect = ruler.getBoundingClientRect();
                      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      handleScrubFrame(Math.round(viewRangeStart + pct * viewSpan));
                      dragRuler(rect);
                    }
                  }}
                  className="relative h-9 rounded select-none"
                  style={{ background: "#1e1a17", cursor: activeClipId ? "ew-resize" : "default", opacity: activeClipId ? 1 : 0.4 }}
                >
                  {/* Tick marks + frame labels */}
                  {(() => {
                    const interval = niceTickInterval(viewSpan);
                    const ticks: number[] = [];
                    const first = Math.ceil(viewRangeStart / interval) * interval;
                    for (let f = first; f <= viewRangeEnd; f += interval) ticks.push(f);
                    return ticks.map((f) => (
                      <div key={f} className="absolute top-0 bottom-0 pointer-events-none"
                        style={{ left: `${((f - viewRangeStart) / viewSpan) * 100}%` }}>
                        <div className="absolute top-0 w-px h-2.5" style={{ background: "#4a4040" }} />
                        <span className="absolute top-3 text-[9.5px] tabular-nums -translate-x-1/2" style={{ color: "#6a8098" }}>{f}</span>
                      </div>
                    ));
                  })()}

                  {/* Keyframe diamonds */}
                  {poseKeyframeFrames.filter((f) => f >= viewRangeStart && f <= viewRangeEnd).map((frame) => (
                    <div key={frame}
                      title={`Keyframe at frame ${frame}`}
                      className="absolute bottom-1 w-2 h-2 rotate-45 pointer-events-none"
                      style={{
                        left: `calc(${((frame - viewRangeStart) / viewSpan) * 100}% - 4px)`,
                        background: PURPLE,
                      }}
                    />
                  ))}

                  {/* Playhead */}
                  <div className="absolute top-0 bottom-0 w-px pointer-events-none"
                    style={{ left: `${((currentFrame - viewRangeStart) / viewSpan) * 100}%`, background: "#fff" }}>
                    <div className="absolute -top-0.5 -left-1 w-2.5 h-2.5 rotate-45" style={{ background: "#fff" }} />
                  </div>
                </div>
              </div>

              {/* Row 3: After Effects-style zoom navigator — drag the two
                  handles inward to narrow Row 2's visible range for finer
                  scrubbing precision. View-only, never touches clip data. */}
              <div className="px-4 pb-2">
                <div ref={navigatorBarRef} className="relative h-3 rounded" style={{ background: "#1e1a17" }}>
                  <div className="absolute top-0 bottom-0 rounded"
                    style={{
                      left: `${(viewRangeStart / totalFrames) * 100}%`,
                      right: `${100 - (viewRangeEnd / totalFrames) * 100}%`,
                      background: "rgba(196,123,232,.25)",
                      border: `1px solid ${PURPLE}`,
                    }}
                  />
                  <div
                    onPointerDown={() => navigatorBarRef.current && dragNavigatorHandle("start", navigatorBarRef.current)}
                    className="absolute top-0 bottom-0 w-2 cursor-ew-resize"
                    style={{ left: `calc(${(viewRangeStart / totalFrames) * 100}% - 4px)`, background: PURPLE, borderRadius: 2 }}
                  />
                  <div
                    onPointerDown={() => navigatorBarRef.current && dragNavigatorHandle("end", navigatorBarRef.current)}
                    className="absolute top-0 bottom-0 w-2 cursor-ew-resize"
                    style={{ left: `calc(${(viewRangeEnd / totalFrames) * 100}% - 4px)`, background: PURPLE, borderRadius: 2 }}
                  />
                </div>
              </div>
            </div>
          );
        })()}
      </section>
    </main>
  );
}
