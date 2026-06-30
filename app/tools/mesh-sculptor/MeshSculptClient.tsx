"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
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
  const ICON_PNGS: Partial<Record<BrushMode, string>> = { clay_buildup: "/claybuildup.png", flatten: "/flatten.png", move: "/move.png" };
  const png = ICON_PNGS[mode];
  if (png) return (
    <Image src={png} alt={mode} width={40} height={40} className="rounded" style={{ filter: active ? "brightness(1.1)" : "brightness(0.55) saturate(0.3)", transition: "filter 0.15s" }} />
  );
  if (mode === "clay_buildup") return (
    <svg width="40" height="40" viewBox="0 0 22 22" fill="none">
      {/* mound */}
      <path d="M3 16 Q11 4 19 16 Z" fill={active ? "#ffffff33" : "#8aa0b422"} stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      {/* upward arrow from tip */}
      <line x1="11" y1="10" x2="11" y2="4" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="8.5,6.5 11,4 13.5,6.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
  if (mode === "push") return (
    <svg width="40" height="40" viewBox="0 0 22 22" fill="none">
      <path d="M3 16 Q11 3 19 16" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <line x1="11" y1="8" x2="11" y2="2" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="8.5,4.5 11,2 13.5,4.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
  if (mode === "pull") return (
    <svg width="40" height="40" viewBox="0 0 22 22" fill="none">
      <path d="M3 6 Q11 19 19 6" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <line x1="11" y1="14" x2="11" y2="20" stroke={s} strokeWidth={w} strokeLinecap="round" />
      <polyline points="8.5,17.5 11,20 13.5,17.5" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
  if (mode === "flatten") return (
    <svg width="40" height="40" viewBox="0 0 22 22" fill="none">
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
    <svg width="40" height="40" viewBox="0 0 22 22" fill="none">
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
    <svg width="40" height="40" viewBox="0 0 22 22" fill="none">
      <path d="M2 15 Q5 9 8 15 Q11 21 14 15 Q17 9 20 15" stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <line x1="2" y1="8" x2="20" y2="8" stroke={s} strokeWidth={w} strokeLinecap="round" strokeDasharray="2.5 2.5" />
    </svg>
  );
}
// ─────────────────────────────────────────────────────────────────────────────


type BrushDef = { mode: BrushMode; label: string; desc: string; shortcut: string; invertHint?: string };

const BRUSH_MODES: BrushDef[] = [
  { mode: "clay_buildup", label: "Clay",    desc: "Build up clay material along the surface normal",   shortcut: "C", invertHint: "Shift = subtract" },
  { mode: "push",         label: "Push",    desc: "Displace outward along normal",                      shortcut: "Q" },
  { mode: "pull",         label: "Pull",    desc: "Displace inward along normal",                       shortcut: "W" },
  { mode: "smooth",       label: "Smooth",  desc: "Blend vertices toward local average",                shortcut: "E" },
  { mode: "flatten",      label: "Flatten", desc: "Project vertices to local tangent plane",            shortcut: "R" },
  { mode: "move",         label: "Move",    desc: "Drag a cluster of vertices freely in any direction", shortcut: "T" },
];

const MODE_KEY: Record<string, BrushMode> = {
  c: "clay_buildup", q: "push", w: "pull", e: "smooth", r: "flatten", t: "move",
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

const PURPLE = "#c47be8";

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

  const [brushMode, setBrushMode] = useState<BrushMode>("clay_buildup");
  const [brushRadius, setBrushRadius] = useState(0.25);
  const [brushInnerRadius, setBrushInnerRadius] = useState(0.3);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [shiftHeld, setShiftHeld] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("combined");
  const [clayColor, setClayColor] = useState("#ebe7e1");

  const viewerHandleRef = useRef<SculptViewerHandle | null>(null);

  const refreshAssets = useCallback(async () => {
    if (!user?.id) return;
    try {
      const rows = await listVisibleAssets(user.id);
      setAssets(rows.filter((r) => r.format === "glb" || r.format === "GLB"));
    } catch { /* non-fatal */ }
  }, [user?.id]);

  useEffect(() => {
    if (creatorStatus === "approved" && user?.id) refreshAssets();
  }, [creatorStatus, user?.id, refreshAssets]);

  useEffect(() => {
    if (!selectedAsset) return;
    setLoadError(""); setGlbData(null); setVertexCount(null); setLoadingAsset(true);
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
      const m = MODE_KEY[e.key.toLowerCase()];
      if (m) setBrushMode(m);
      if (e.key === "Shift") setShiftHeld(true);
    }
    function onUp(e: KeyboardEvent) { if (e.key === "Shift") setShiftHeld(false); }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);

  const handleSave = useCallback(async () => {
    if (!viewerHandleRef.current || !user?.id) return;
    setSaving(true); setSaveMsg("");
    try {
      const bytes = await viewerHandleRef.current.exportGlb();
      await uploadAsset({
        userId: user.id,
        name: `${selectedAsset?.name ?? "sculpted-mesh"}-sculpted.glb`,
        bytes: bytes.buffer as ArrayBuffer,
        visibility: "private",
        polyCount: vertexCount ?? undefined,
      });
      setSaveMsg("Saved to library.");
      await refreshAssets();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed.");
    } finally { setSaving(false); }
  }, [user?.id, selectedAsset, vertexCount, refreshAssets]);

  if (!isLoaded || creatorStatus === "loading") return null;

  if (!user) return (
    <main className="min-h-[calc(100vh-73px)] bg-[#0c0a08] flex items-center justify-center">
      <div className="text-center">
        <p className="text-dim text-sm mb-4">Sign in to use Mesh Sculptor.</p>
        <Link href="/sign-in" className="px-4 py-2 bg-accent text-white rounded-md text-sm">Sign in</Link>
      </div>
    </main>
  );

  if (creatorStatus !== "approved") return (
    <main className="min-h-[calc(100vh-73px)] bg-[#0c0a08] flex items-center justify-center">
      <div className="text-center max-w-sm">
        <p className="text-ink font-semibold mb-2">Creator access required</p>
        <p className="text-dim text-sm">Apply for creator access to use Mesh Sculptor.</p>
      </div>
    </main>
  );

  const highVertCount = vertexCount != null && vertexCount > 200_000;
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
          <p className="text-[11px] font-medium text-dim uppercase tracking-wide mb-2">Load GLB</p>
          {assets.length === 0 ? (
            <p className="text-[11px] text-dim">No GLB assets yet. Upload one in Mesh Loom first.</p>
          ) : (
            <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {assets.map((a) => (
                <button key={a.id} onClick={() => setSelectedAsset(a)}
                  className={`w-full text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
                    selectedAsset?.id === a.id ? "bg-[#c47be8]/20 text-[#c47be8]" : "text-ink hover:bg-[#1e1a17]"
                  }`}>
                  <span className="block truncate">{a.name}</span>
                  {a.poly_count != null && <span className="text-dim">{a.poly_count.toLocaleString()} tris</span>}
                </button>
              ))}
            </div>
          )}
          {loadingAsset && <p className="text-[11px] text-dim mt-2">Loading…</p>}
          {loadError    && <p className="text-[11px] text-red-400 mt-2">{loadError}</p>}
        </div>

        {/* Brush settings */}
        <div className="px-4 py-3 border-b border-[#2a2320] flex-1 overflow-y-auto">
          <div className="mb-4">
            <p className="text-[10.5px] leading-relaxed" style={{ color: "#6a8098" }}>
              <span className="font-semibold" style={{ color: PURPLE }}>{activeDef.label}</span>
              {" — "}{activeDef.desc}
            </p>
            {activeDef.invertHint && (
              <p className="text-[10px] mt-1" style={{ color: shiftHeld ? PURPLE : "#4a4040" }}>
                {activeDef.invertHint}{shiftHeld ? " · active" : ""}
              </p>
            )}
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
        </div>

        <div className="px-4 py-3 border-t border-[#2a2320]">
          {vertexCount != null && (
            <p className={`text-[11px] mb-2 ${highVertCount ? "text-amber-400" : "text-dim"}`}>
              {vertexCount.toLocaleString()} vertices{highVertCount && " — consider decimating first"}
            </p>
          )}
          <button onClick={handleSave} disabled={saving || !glbData}
            className="w-full py-2 rounded-md disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium transition-colors"
            style={{ background: saving || !glbData ? "#3a2a50" : PURPLE }}>
            {saving ? "Saving…" : "Save to Library"}
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

          {/* BRUSH SHELF */}
          <div className="flex items-center gap-0.5 px-2 py-1.5">
            {BRUSH_MODES.map(({ mode, label, shortcut, invertHint }) => {
              const active = brushMode === mode;
              const subtracting = active && !!invertHint && shiftHeld;
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
