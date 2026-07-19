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
  signedAssetUrl,
  type AssetRow,
} from "@/lib/assets";
import type { SculptViewerHandle, ViewMode, PrimitiveType, EditMode, SelectMode, TransformMode } from "@/components/tools/SculptViewer";
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
  const ICON_PNGS: Partial<Record<BrushMode, string>> = { clay_buildup: "/claybuildup.png", push: "/inflate.png", flatten: "/flatten.png", move: "/move.png", smooth: "/smooth.png", paint: "/paint.png" };
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
  { mode: "move",         label: "Move",    desc: "Drag a cluster of vertices freely in any direction", shortcut: "T" },
  { mode: "paint",        label: "Paint",   desc: "Paint color onto UV albedo texture without changing geometry", shortcut: "P" },
];

const MODE_KEY: Record<string, BrushMode> = {
  c: "clay_buildup", q: "push", e: "smooth", r: "flatten", t: "move", p: "paint",
};

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "combined",  label: "Combined" },
  { mode: "wireframe", label: "Wireframe" },
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

  const [viewMode, setViewMode] = useState<ViewMode>("combined");
  const [subdivLevel, setSubdivLevel] = useState(0);
  const [exportLevel, setExportLevel] = useState(0);
  const [showPrimitives, setShowPrimitives] = useState(false);
  const [clayColor, setClayColor] = useState("#ebe7e1");
  const [dynTopo, setDynTopo] = useState(false);
  const [compressKtx2, setCompressKtx2] = useState(true);

  const [editMode, setEditMode] = useState<EditMode>("sculpt");
  const [selectMode, setSelectMode] = useState<SelectMode>("vertex");
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [selectionCount, setSelectionCount] = useState(0);
  const [extrudeDistance, setExtrudeDistance] = useState(0.1);
  const [extrudeMsg, setExtrudeMsg] = useState("");
  const [loopPreview, setLoopPreview] = useState<{ edgeCount: number; boundary: boolean; closed: boolean } | null>(null);

  const viewerHandleRef = useRef<SculptViewerHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const uploadAndMaybeCompress = useCallback(async (
    name: string,
    bytes: ArrayBuffer,
    polyCount?: number,
  ): Promise<{ asset: AssetRow; compressed: boolean }> => {
    if (!user?.id) throw new Error("Not signed in.");
    const asset = await uploadAsset({ userId: user.id, name, bytes, visibility: "private", polyCount });
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

  const clearWorkspace = useCallback(() => {
    viewerHandleRef.current?.clearScene();
    setSelectedAsset(null);
    setGlbData(null);
    setVertexCount(null);
    setLoadError("");
    setUploadMsg("");
    setSubdivLevel(0);
    setEditMode("sculpt");
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
        setLoadError(e instanceof Error ? e.message : "Failed to fetch asset.");
      } finally { setLoadingAsset(false); }
    })();
  }, [selectedAsset]);

  useEffect(() => {
    function onDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Tab") {
        e.preventDefault();
        setEditMode((m) => (m === "sculpt" ? "poly_edit" : "sculpt"));
        return;
      }
      if (editMode === "poly_edit") {
        // Blender-style select-mode/transform-mode shortcuts, scoped to
        // poly-edit only — no conflict with the sculpt brush shortcuts below
        // (E/R mean smooth/flatten there) since the two modes are mutually
        // exclusive and this branch returns before reaching MODE_KEY.
        if (e.key === "1") setSelectMode("vertex");
        else if (e.key === "2") setSelectMode("edge");
        else if (e.key === "3") setSelectMode("face");
        else if (e.key.toLowerCase() === "w") setTransformMode("translate");
        else if (e.key.toLowerCase() === "e") setTransformMode("rotate");
        else if (e.key.toLowerCase() === "r") setTransformMode("scale");
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
  }, [editMode]);

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
      );
      setSaveMsg(compressKtx2 && !compressed ? "Saved (uncompressed — texture compression failed)." : "Saved to library.");
      notifyAssetsChanged();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed.");
    } finally { setSaving(false); }
  }, [user?.id, selectedAsset, vertexCount, subdivLevel, exportLevel, compressKtx2, uploadAndMaybeCompress, notifyAssetsChanged]);

  if (!isLoaded || creatorStatus === "loading") return null;

  if (!user) return (
    <main className="min-h-[calc(100vh-73px)] bg-[#0c0a08] flex items-center justify-center">
      <div className="text-center">
        <p className="text-dim text-sm mb-4">Sign in to use Mesh Sculptor.</p>
        <Link href="/sign-in" className="px-4 py-2 bg-accent text-white rounded-md text-sm">Sign in</Link>
      </div>
    </main>
  );


  const highVertCount = vertexCount != null && vertexCount > 1_000_000;
  const activeDef = BRUSH_MODES.find((m) => m.mode === brushMode)!;

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#0c0a08] flex" style={{ height: "calc(100vh - 73px)" }}>

      {/* ── LEFT SIDEBAR ── */}
      <aside className="w-60 flex-shrink-0 border-r border-[#2a2320] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a2320]">
          <h1 className="text-sm font-semibold text-ink">Mesh Sculptor</h1>
          <p className="text-[11px] text-dim mt-0.5">Brush-based vertex sculpting</p>
        </div>

        <div className="px-4 py-3 border-b border-[#2a2320]">
          <p className="text-[11px] font-medium text-dim uppercase tracking-wide mb-2">Load Mesh</p>
          <p className="text-[11px] text-dim">
            Open the <span className="text-ink">My Assets</span> panel (right edge) to load a saved .glb, or import a file directly:
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.drc,.obj,.stl"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLocalFile(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full mt-2 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors"
            title="Load a .glb, .drc, .obj, or .stl file directly from disk">
            Load from disk…
          </button>
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
          </div>

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

              <p className="text-[10px] text-dim uppercase tracking-wide mb-1.5">Transform</p>
              <div className="flex gap-1 mb-2">
                {([["translate", "Move", "W"], ["rotate", "Rotate", "E"], ["scale", "Scale", "R"]] as [TransformMode, string, string][]).map(([m, label, key]) => (
                  <button key={m} onClick={() => setTransformMode(m)}
                    title={`${label} (${key})`}
                    className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors"
                    style={{ background: transformMode === m ? "rgba(196,123,232,.22)" : "#1e1a17", color: transformMode === m ? PURPLE : "#8aa0b4" }}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px]" style={{ color: selectionCount > 0 ? PURPLE : "#6a8098" }}>
                {selectionCount === 0
                  ? "Click a mesh to select · Shift-click to add"
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
        </div>

        {/* Brush settings */}
        <div className="px-4 py-3 border-b border-[#2a2320] flex-1 overflow-y-auto">
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

          <div className="flex gap-2 mt-4">
            <button onClick={() => viewerHandleRef.current?.undo()}
              className="flex-1 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors" title="Ctrl+Z">Undo</button>
            <button onClick={() => viewerHandleRef.current?.redo()}
              className="flex-1 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors" title="Ctrl+Shift+Z">Redo</button>
          </div>

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

          {/* Subdivision */}
          <div className="mt-4 pt-4 border-t border-[#2a2320]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-dim">Subdivision</span>
              <span className="text-[11px] text-ink">Level {subdivLevel}</span>
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
                title="Catmull-Clark subdivision — each level ≈ 4× triangle count">
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
            {(vertexCount ?? 0) > 1_000_000 && (
              <p className="text-[10px] text-amber-400 mt-1">Approaching limit — save before subdividing further</p>
            )}
          </div>
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
                        onClick={() => {
                          viewerHandleRef.current?.loadPrimitive(type);
                          setSubdivLevel(0);
                          setShowPrimitives(false);
                        }}
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
              title="Dynamic Topology — auto-splits long edges after each stroke"
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{ background: dynTopo ? PURPLE : "transparent", color: dynTopo ? "#fff" : "#8aa0b4" }}>
              DynTopo
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
            editMode={editMode}
            selectMode={selectMode}
            transformMode={transformMode}
            onModelLoaded={setVertexCount}
            onLoadError={setLoadError}
            onSelectionChange={setSelectionCount}
            onLoopPreview={handleLoopPreview}
            paintColor={paintColor}
            handleRef={viewerHandleRef}
          />
        </div>
      </section>
    </main>
  );
}
