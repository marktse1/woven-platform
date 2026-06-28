"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useCreatorStatus } from "@/lib/useCreatorStatus";
import {
  listVisibleAssets,
  uploadAsset,
  signedAssetUrl,
  type AssetRow,
} from "@/lib/assets";
import type { SculptViewerHandle, ViewMode } from "@/components/tools/SculptViewer";
import type { BrushMode } from "@/lib/sculpt/brushes";

// Load SculptViewer client-side only — Three.js requires a DOM
const SculptViewer = dynamic(() => import("@/components/tools/SculptViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-dim text-[13px]">
      Initialising 3D canvas…
    </div>
  ),
});

const BRUSH_MODES: { mode: BrushMode; label: string; desc: string }[] = [
  { mode: "push",    label: "Push",    desc: "Displace outward along normal" },
  { mode: "pull",    label: "Pull",    desc: "Displace inward along normal" },
  { mode: "smooth",  label: "Smooth",  desc: "Blend vertices toward local average" },
  { mode: "flatten", label: "Flatten", desc: "Project to local tangent plane" },
  { mode: "move",    label: "Move",    desc: "Drag a cluster of vertices freely" },
];
const MODE_KEY: Record<string, BrushMode> = { q: "push", w: "pull", e: "smooth", r: "flatten", t: "move" };

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

export default function MeshSculptClient() {
  const { user, isLoaded } = useUser();
  const creatorStatus = useCreatorStatus();

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);
  const [glbData, setGlbData] = useState<ArrayBuffer | null>(null);
  const [vertexCount, setVertexCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadingAsset, setLoadingAsset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [brushMode, setBrushMode] = useState<BrushMode>("push");
  const [brushRadius, setBrushRadius] = useState(0.25);
  const [brushInnerRadius, setBrushInnerRadius] = useState(0.0);
  const [brushStrength, setBrushStrength] = useState(0.5);

  const [viewMode, setViewMode] = useState<ViewMode>("combined");
  const [clayColor, setClayColor] = useState("#ebe7e1");

  const viewerHandleRef = useRef<SculptViewerHandle | null>(null);

  // Load asset library
  const refreshAssets = useCallback(async () => {
    if (!user?.id) return;
    try {
      const rows = await listVisibleAssets(user.id);
      // Only show GLB assets (raw, decimated, etc.) — not textures / shader graphs
      setAssets(rows.filter((r) => r.format === "glb" || r.format === "GLB"));
    } catch {
      // non-fatal
    }
  }, [user?.id]);

  useEffect(() => {
    if (creatorStatus === "approved" && user?.id) refreshAssets();
  }, [creatorStatus, user?.id, refreshAssets]);

  // Load selected asset into viewer
  useEffect(() => {
    if (!selectedAsset) return;
    setLoadError("");
    setGlbData(null);
    setVertexCount(null);
    setLoadingAsset(true);

    (async () => {
      try {
        const url = await signedAssetUrl(selectedAsset.storage_path);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setGlbData(await res.arrayBuffer());
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to fetch asset.");
      } finally {
        setLoadingAsset(false);
      }
    })();
  }, [selectedAsset]);

  // Keyboard brush mode shortcuts: Q/W/E/R/T
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const m = MODE_KEY[e.key.toLowerCase()];
      if (m) setBrushMode(m);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSave = useCallback(async () => {
    if (!viewerHandleRef.current || !user?.id) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const bytes = await viewerHandleRef.current.exportGlb();
      const baseName = selectedAsset?.name ?? "sculpted-mesh";
      await uploadAsset({
        userId: user.id,
        name: `${baseName}-sculpted.glb`,
        bytes: bytes.buffer as ArrayBuffer,
        visibility: "private",
        polyCount: vertexCount ?? undefined,
      });
      setSaveMsg("Saved to library.");
      await refreshAssets();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [user?.id, selectedAsset, vertexCount, refreshAssets]);

  // ── auth / access guards ──────────────────────────────────────────────────
  if (!isLoaded || creatorStatus === "loading") return null;

  if (!user) {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#0c0a08] flex items-center justify-center">
        <div className="text-center">
          <p className="text-dim text-sm mb-4">Sign in to use Mesh Sculptor.</p>
          <Link href="/sign-in" className="px-4 py-2 bg-accent text-white rounded-md text-sm">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (creatorStatus !== "approved") {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#0c0a08] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="text-ink font-semibold mb-2">Creator access required</p>
          <p className="text-dim text-sm">Apply for creator access to use Mesh Sculptor.</p>
        </div>
      </main>
    );
  }

  const highVertCount = vertexCount != null && vertexCount > 200_000;

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#0c0a08] flex" style={{ height: "calc(100vh - 73px)" }}>
      {/* ── LEFT SIDEBAR ── */}
      <aside className="w-64 flex-shrink-0 border-r border-[#2a2320] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#2a2320]">
          <h1 className="text-sm font-semibold text-ink">Mesh Sculptor</h1>
          <p className="text-[11px] text-dim mt-0.5">Brush-based vertex sculpting</p>
        </div>

        {/* Asset picker */}
        <div className="px-4 py-3 border-b border-[#2a2320]">
          <p className="text-[11px] font-medium text-dim uppercase tracking-wide mb-2">Load GLB</p>
          {assets.length === 0 ? (
            <p className="text-[11px] text-dim">No GLB assets in your library yet. Upload one in Mesh Loom first.</p>
          ) : (
            <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {assets.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAsset(a)}
                  className={`w-full text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
                    selectedAsset?.id === a.id
                      ? "bg-[#c47be8]/20 text-[#c47be8]"
                      : "text-ink hover:bg-[#1e1a17]"
                  }`}
                >
                  <span className="block truncate">{a.name}</span>
                  {a.poly_count != null && (
                    <span className="text-dim">{a.poly_count.toLocaleString()} tris</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {loadingAsset && <p className="text-[11px] text-dim mt-2">Loading…</p>}
          {loadError && <p className="text-[11px] text-red-400 mt-2">{loadError}</p>}
        </div>

        {/* Brush controls */}
        <div className="px-4 py-3 border-b border-[#2a2320] flex-1 overflow-y-auto">
          <p className="text-[11px] font-medium text-dim uppercase tracking-wide mb-3">Brush</p>

          {/* Mode */}
          <div className="grid grid-cols-5 gap-1 mb-4">
            {BRUSH_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                title={label}
                onClick={() => setBrushMode(mode)}
                className={`py-1.5 rounded text-[10px] font-medium transition-colors ${
                  brushMode === mode
                    ? "bg-[#c47be8] text-white"
                    : "bg-[#1e1a17] text-dim hover:text-ink"
                }`}
              >
                {label[0]}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-dim mb-3">
            {BRUSH_MODES.find((m) => m.mode === brushMode)?.desc}
            <span className="ml-1 opacity-50">(Q/W/E/R/T)</span>
          </p>

          {/* Radius */}
          <label className="block mb-3">
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-dim">Radius</span>
              <span className="text-[11px] text-ink">{brushRadius.toFixed(2)}</span>
            </div>
            <input
              type="range" min={0.02} max={2} step={0.01}
              value={brushRadius}
              onChange={(e) => setBrushRadius(Number(e.target.value))}
              className="w-full accent-[#c47be8]"
            />
          </label>

          {/* Inner radius (focal shift) */}
          <label className="block mb-3">
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-dim">Inner Radius</span>
              <span className="text-[11px] text-ink">{Math.round(brushInnerRadius * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={0.95} step={0.01}
              value={brushInnerRadius}
              onChange={(e) => setBrushInnerRadius(Number(e.target.value))}
              className="w-full accent-[#c47be8]"
            />
          </label>

          {/* Strength */}
          <label className="block mb-4">
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-dim">Strength</span>
              <span className="text-[11px] text-ink">{Math.round(brushStrength * 100)}%</span>
            </div>
            <input
              type="range" min={0.01} max={1} step={0.01}
              value={brushStrength}
              onChange={(e) => setBrushStrength(Number(e.target.value))}
              className="w-full accent-[#c47be8]"
            />
          </label>

          {/* Undo / Redo */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => viewerHandleRef.current?.undo()}
              className="flex-1 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors"
              title="Ctrl+Z"
            >
              Undo
            </button>
            <button
              onClick={() => viewerHandleRef.current?.redo()}
              className="flex-1 py-1.5 rounded bg-[#1e1a17] text-[11px] text-dim hover:text-ink transition-colors"
              title="Ctrl+Shift+Z"
            >
              Redo
            </button>
          </div>

        </div>

        {/* Vertex info + save */}
        <div className="px-4 py-3 border-t border-[#2a2320]">
          {vertexCount != null && (
            <p className={`text-[11px] mb-2 ${highVertCount ? "text-amber-400" : "text-dim"}`}>
              {vertexCount.toLocaleString()} vertices
              {highVertCount && " — consider decimating first"}
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !glbData}
            className="w-full py-2 rounded-md bg-[#c47be8] hover:bg-[#b568d6] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium transition-colors"
          >
            {saving ? "Saving…" : "Save to Library"}
          </button>
          {saveMsg && (
            <p className={`text-[11px] mt-1.5 ${saveMsg.includes("ailed") ? "text-red-400" : "text-green-400"}`}>
              {saveMsg}
            </p>
          )}
        </div>
      </aside>

      {/* ── 3D CANVAS + TOP TOOLBAR ── */}
      <section className="flex-1 flex flex-col overflow-hidden">
        {/* View mode toolbar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2a2320] bg-[#100e0c] flex-shrink-0">
          {VIEW_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                viewMode === mode
                  ? "bg-[#c47be8] text-white"
                  : "bg-[#1e1a17] text-dim hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
          {viewMode === "clay" && (
            <div className="flex items-center gap-2 ml-3 pl-3 border-l border-[#2a2320]">
              {CLAY_PRESETS.map((p) => (
                <button
                  key={p.color}
                  title={p.label}
                  onClick={() => setClayColor(p.color)}
                  className="flex flex-col items-center gap-0.5"
                >
                  <span
                    className={`w-5 h-5 rounded-full border-2 transition-all ${
                      clayColor === p.color ? "border-[#c47be8] scale-110" : "border-[#3a3530]"
                    }`}
                    style={{ background: p.color }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          {!selectedAsset && !loadingAsset && (
            <div className="absolute inset-0 flex items-center justify-center text-center pointer-events-none">
              <div>
                <p className="text-ink text-sm mb-1">Select a GLB from the sidebar to begin sculpting</p>
                <p className="text-dim text-[12px]">Works best with meshes under 200K vertices</p>
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
            onModelLoaded={setVertexCount}
            onLoadError={setLoadError}
            handleRef={viewerHandleRef}
          />
        </div>
      </section>
    </main>
  );
}
