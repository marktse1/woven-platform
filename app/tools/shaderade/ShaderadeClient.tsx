"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useCreatorStatus } from "@/lib/useCreatorStatus";
import { uploadAsset, signedAssetUrl, listVisibleAssets, type AssetRow } from "@/lib/assets";
import { compile, type CompileResult } from "@/lib/shader-graph/compiler";
import type { Node, Edge } from "@xyflow/react";

// Load canvas and preview client-side only (Three.js + React Flow need DOM)
const NodeCanvas = dynamic(() => import("./NodeCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-dim text-[13px]">
      Initialising node canvas…
    </div>
  ),
});

const ShaderPreview = dynamic(() => import("./ShaderPreview"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-[#0e0b08]" />,
});

const ExportPanel = dynamic(() => import("./ExportPanel"), { ssr: false });

export default function ShaderadeClient() {
  const { user, isLoaded } = useUser();
  const creatorStatus = useCreatorStatus();

  const [compiled, setCompiled] = useState<CompileResult | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [graphName, setGraphName] = useState("My Shader");
  const [savedAssets, setSavedAssets] = useState<AssetRow[]>([]);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);

  // Debounce timer ref
  const compileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest nodes/edges refs so debounced compile always uses fresh data
  const latestNodes = useRef<Node[]>([]);
  const latestEdges = useRef<Edge[]>([]);

  const scheduleCompile = useCallback((nodes: Node[], edges: Edge[]) => {
    latestNodes.current = nodes;
    latestEdges.current = edges;
    if (compileTimer.current) clearTimeout(compileTimer.current);
    compileTimer.current = setTimeout(() => {
      const result = compile({ nodes: latestNodes.current, edges: latestEdges.current });
      setCompiled(result);
    }, 200);
  }, []);

  const handleGraphChange = useCallback(
    (nodes: Node[], edges: Edge[]) => scheduleCompile(nodes, edges),
    [scheduleCompile],
  );

  // Load saved shader graph assets
  const refreshSaved = useCallback(async () => {
    if (!user?.id) return;
    try {
      const rows = await listVisibleAssets(user.id);
      setSavedAssets(rows.filter((r) => r.kind === "shader_graph"));
    } catch { /* non-fatal */ }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) refreshSaved();
  }, [creatorStatus, user?.id, refreshSaved]);

  const handleSave = useCallback(async () => {
    if (!user?.id || !compiled || !compiled.ok) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const graphJson = JSON.stringify({
        nodes: latestNodes.current,
        edges: latestEdges.current,
        fragmentShader: compiled.fragmentShader,
        vertexShader: compiled.vertexShader,
      });
      const bytes = new TextEncoder().encode(graphJson);
      await uploadAsset({
        userId: user.id,
        name: `${graphName}.shader.json`,
        bytes: bytes.buffer as ArrayBuffer,
        visibility: "private",
        meta: { kind: "shader_graph", outputMode: "unlit" },
      });
      setSaveMsg("Saved to library.");
      await refreshSaved();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [user?.id, compiled, graphName, refreshSaved]);

  const handleLoad = useCallback(async (asset: AssetRow) => {
    setLoadMenuOpen(false);
    try {
      const url = await signedAssetUrl(asset.storage_path);
      const res = await fetch(url);
      const json = await res.json() as { nodes: Node[]; edges: Edge[] };
      // Trigger recompile with loaded data
      scheduleCompile(json.nodes ?? [], json.edges ?? []);
      setGraphName(asset.name.replace(/\.shader\.json$/, ""));
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Load failed.");
    }
  }, [scheduleCompile]);

  // ── Auth guards ───────────────────────────────────────────────────────────
  if (!isLoaded || creatorStatus === "loading") return null;

  if (!user) {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#0e0b08] flex items-center justify-center">
        <div className="text-center">
          <p className="text-dim text-sm mb-4">Sign in to use Shaderade.</p>
          <Link href="/sign-in" className="px-4 py-2 bg-[#e8875a] text-[#0e0b08] rounded-md text-sm font-semibold">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      className="bg-[#0e0b08] flex flex-col"
      style={{ height: "calc(100vh - 73px)" }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2a2320] shrink-0">
        <span className="text-[13px] font-bold text-[#e8875a]">Shaderade</span>
        <span className="text-dim text-[11px]">visual shader graph</span>
        <div className="flex-1" />

        {/* Compile status indicator */}
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${
          !compiled ? "text-dim" :
          compiled.ok ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
        }`}>
          {!compiled ? "no graph" : compiled.ok ? "compiled" : "error"}
        </span>

        {/* Graph name */}
        <input
          value={graphName}
          onChange={(e) => setGraphName(e.target.value)}
          className="bg-[#18141c] border border-[#2a2320] rounded px-2 py-1 text-[11px] text-ink w-36"
          placeholder="Shader name"
        />

        {/* Load */}
        <div className="relative">
          <button
            onClick={() => setLoadMenuOpen((o) => !o)}
            className="px-3 py-1.5 rounded bg-[#18141c] border border-[#2a2320] text-[11px] text-dim hover:text-ink transition-colors"
          >
            Load ▾
          </button>
          {loadMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-[#18141c] border border-[#2a2320] rounded shadow-lg z-50">
              {savedAssets.length === 0 ? (
                <p className="text-[11px] text-dim px-3 py-2">No saved shaders yet.</p>
              ) : (
                savedAssets.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleLoad(a)}
                    className="w-full text-left px-3 py-2 text-[11px] text-ink hover:bg-[#2a2320] transition-colors truncate"
                  >
                    {a.name.replace(/\.shader\.json$/, "")}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || !compiled?.ok}
          className="px-3 py-1.5 rounded bg-[#e8875a] hover:bg-[#d4713f] disabled:opacity-40 disabled:cursor-not-allowed text-[#0e0b08] text-[11px] font-semibold transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {saveMsg && (
          <span className={`text-[11px] ${saveMsg.includes("ailed") ? "text-red-400" : "text-green-400"}`}>
            {saveMsg}
          </span>
        )}
      </div>

      {/* Body: node canvas (left 60%) | right panel (40%) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Node canvas + palette */}
        <div className="flex-[3] min-w-0 border-r border-[#2a2320]">
          <NodeCanvas onGraphChange={handleGraphChange} />
        </div>

        {/* Right: preview (top) + export (bottom) */}
        <div className="flex-[2] min-w-0 flex flex-col">
          {/* 3D preview sphere */}
          <div className="flex-1 min-h-0">
            <ShaderPreview compiled={compiled} />
          </div>
          {/* Export code */}
          <div style={{ height: 260 }}>
            <ExportPanel compiled={compiled} />
          </div>
        </div>
      </div>
    </main>
  );
}
