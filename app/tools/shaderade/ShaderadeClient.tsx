"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useCreatorStatus } from "@/lib/useCreatorStatus";
import { uploadAsset, overwriteAssetBytes, signedAssetUrl, listVisibleAssets, getAsset, type AssetRow } from "@/lib/assets";
import { useActiveLoader } from "@/components/assets/ActiveLoaderContext";
import { compile, type CompileResult } from "@/lib/shader-graph/compiler";
import { getNodeDef } from "@/lib/shader-graph/nodes";
import { detectMap, type MapType } from "@/lib/shader-graph/mapDetect";
import { buildPbrGraph } from "@/lib/shader-graph/autoBuild";
import type { NodeCanvasHandle } from "./NodeCanvas";
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

// ── GLB export channel classification ────────────────────────────────────
// A glTF material can only represent a flat factor or one texture per
// channel — it can't express arbitrary node-graph logic (Noise, math
// chains, etc). Mirrors compiler.ts's own edge-resolution approach so the
// classification can't drift from what the graph actually compiles to.

type ChannelInput3 = { kind: "texture"; assetId: string } | { kind: "literal"; rgb: [number, number, number] } | null;
type ChannelInput1 = { kind: "texture"; assetId: string } | { kind: "literal"; value: number } | null;

type ExportChannels = {
  albedo: ChannelInput3;
  normal: ChannelInput3;
  roughness: ChannelInput1;
  metallic: ChannelInput1;
  ao: ChannelInput1;
  emissive: ChannelInput3;
};

function gatherExportChannels(nodes: Node[], edges: Edge[]): { channels: ExportChannels; unsupported: string[] } | null {
  const outputNode = nodes.find((n) => n.type === "OutputPBR");
  if (!outputNode) return null;

  const targetToSource = new Map<string, { source: string; sourceHandle: string }>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    targetToSource.set(`${e.target}::${e.targetHandle}`, { source: e.source, sourceHandle: e.sourceHandle ?? "" });
  }
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const unsupported: string[] = [];

  function resolveSource(slot: string): Node | undefined {
    const link = targetToSource.get(`${outputNode!.id}::${slot}`);
    return link ? nodesById.get(link.source) : undefined;
  }

  function resolve3(slot: string): ChannelInput3 {
    const src = resolveSource(slot);
    if (!src) return null;
    if (src.type === "Texture2D") {
      const assetId = (src.data as Record<string, unknown> | undefined)?.assetId as string | undefined;
      if (!assetId) {
        unsupported.push(`"${slot}" uses an unsaved texture — save it via Import Texture Set first`);
        return null;
      }
      return { kind: "texture", assetId };
    }
    if (src.type === "Color") {
      const d = (src.data ?? {}) as Record<string, unknown>;
      return { kind: "literal", rgb: [(d.r as number) ?? 1, (d.g as number) ?? 1, (d.b as number) ?? 1] };
    }
    unsupported.push(`"${slot}" is driven by a ${getNodeDef(src.type as string)?.label ?? src.type} node — GLB export only supports flat colors or textures`);
    return null;
  }

  function resolve1(slot: string): ChannelInput1 {
    const src = resolveSource(slot);
    if (!src) return null;
    if (src.type === "Texture2D") {
      const assetId = (src.data as Record<string, unknown> | undefined)?.assetId as string | undefined;
      if (!assetId) {
        unsupported.push(`"${slot}" uses an unsaved texture — save it via Import Texture Set first`);
        return null;
      }
      return { kind: "texture", assetId };
    }
    if (src.type === "Float") {
      const d = (src.data ?? {}) as Record<string, unknown>;
      return { kind: "literal", value: (d.value as number) ?? 0.5 };
    }
    unsupported.push(`"${slot}" is driven by a ${getNodeDef(src.type as string)?.label ?? src.type} node — GLB export only supports flat values or textures`);
    return null;
  }

  return {
    channels: {
      albedo: resolve3("albedo"),
      normal: resolve3("normal"),
      roughness: resolve1("roughness"),
      metallic: resolve1("metallic"),
      ao: resolve1("ao"),
      emissive: resolve3("emissive"),
    },
    unsupported,
  };
}

// Derives a material name from a set of imported PBR filenames by taking
// their longest common prefix (e.g. "brick_albedo.png"/"brick_normal.png"
// -> "brick"), falling back to a timestamped generic name when the files
// don't share a usable prefix (too short, or entirely unrelated names).
function deriveMaterialName(filenames: string[]): string {
  const stems = filenames.map((f) => f.replace(/\.[^.]+$/, ""));
  let prefix = stems[0] ?? "";
  for (const s of stems.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i].toLowerCase() === s[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  prefix = prefix.replace(/[-_.\s]+$/, "").trim();
  if (prefix.length >= 3) return prefix;
  return `Imported Material ${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

export default function ShaderadeClient() {
  const { user, isLoaded } = useUser();
  const creatorStatus = useCreatorStatus();

  const [compiled, setCompiled] = useState<CompileResult | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [graphName, setGraphName] = useState("My Shader");
  const [savedAssets, setSavedAssets] = useState<AssetRow[]>([]);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [bgLightness, setBgLightness] = useState(0.05);
  // The asset "Save" currently overwrites — set on load, and on any
  // successful save (including the auto-save after a texture import) so a
  // subsequent Save updates that same asset instead of minting a new one.
  const [loadedAsset, setLoadedAsset] = useState<AssetRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  // Debounce timer ref
  const compileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest nodes/edges refs so debounced compile always uses fresh data
  const latestNodes = useRef<Node[]>([]);
  const latestEdges = useRef<Edge[]>([]);
  const nodeCanvasHandleRef = useRef<NodeCanvasHandle | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const { notifyAssetsChanged } = useActiveLoader();

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

  // Shared upload body — used by the manual Save button, "Save As New", and
  // the texture-import auto-save. Overwrites the currently tracked
  // `loadedAsset` in place unless `forceNew` is set (first-ever save, an
  // explicit "Save As New", or a texture import — which always builds a
  // genuinely new material and must never clobber whatever was previously
  // loaded). Returns the resulting asset so callers can start/keep tracking
  // it; throws on failure, callers decide how to surface that.
  const saveGraphAsset = useCallback(async (
    name: string,
    nodes: Node[],
    edges: Edge[],
    result: CompileResult,
    options?: { groupId?: string; forceNew?: boolean },
  ): Promise<AssetRow | undefined> => {
    if (!user?.id || !result.ok) return undefined;
    const graphJson = JSON.stringify({
      nodes,
      edges,
      fragmentShader: result.fragmentShader,
      vertexShader: result.vertexShader,
    });
    const bytes = new TextEncoder().encode(graphJson);
    // Derive from the actual output node rather than hardcoding — the
    // previous version always wrote "unlit" here regardless of which
    // output node the graph actually used.
    const outputNode = nodes.find((n) => getNodeDef(n.type as string)?.category === "output");
    const outputMode = (outputNode?.data as Record<string, unknown> | undefined)?.outputMode ?? "unlit";

    if (!options?.forceNew && loadedAsset) {
      return overwriteAssetBytes({
        id: loadedAsset.id,
        storagePath: loadedAsset.storage_path,
        bytes: bytes.buffer as ArrayBuffer,
        contentType: "application/json",
        meta: { outputMode },
      });
    }

    return uploadAsset({
      userId: user.id,
      name: `${name}.shader.json`,
      bytes: bytes.buffer as ArrayBuffer,
      visibility: "private",
      kind: "shader_graph",
      format: "json",
      contentType: "application/json",
      meta: { outputMode },
      groupId: options?.groupId,
    });
  }, [user?.id, loadedAsset]);

  const handleSave = useCallback(async () => {
    if (!user?.id || !compiled || !compiled.ok) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const asset = await saveGraphAsset(graphName, latestNodes.current, latestEdges.current, compiled);
      if (asset) setLoadedAsset(asset);
      setSaveMsg("Saved to library.");
      await refreshSaved();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [user?.id, compiled, graphName, refreshSaved, saveGraphAsset]);

  const handleSaveAsNew = useCallback(async () => {
    if (!user?.id || !compiled || !compiled.ok) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const asset = await saveGraphAsset(graphName, latestNodes.current, latestEdges.current, compiled, { forceNew: true });
      if (asset) setLoadedAsset(asset);
      setSaveMsg("Saved as a new asset.");
      await refreshSaved();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [user?.id, compiled, graphName, refreshSaved, saveGraphAsset]);

  // Exports the compiled PBR material as a standalone GLB (a sphere carrying
  // the material) — the way Three.js/Babylon.js/PlayCanvas actually receive
  // a "pure PBR" material via their glTF loaders. Force-saves the graph
  // first (same convention as the texture-import auto-save) so there's
  // always a real shader_graph asset to link the GLB back to via
  // derived_from_asset_id — respects the normal overwrite-if-tracked
  // behavior rather than forking, so exporting doesn't leave behind
  // duplicate saves.
  const handleExportGlb = useCallback(async () => {
    if (!user?.id || !compiled || !compiled.ok) return;
    setExporting(true);
    setExportMsg("");
    try {
      const gathered = gatherExportChannels(latestNodes.current, latestEdges.current);
      if (!gathered) {
        setExportMsg("GLB export only supports PBR materials — add an Output (PBR) node.");
        return;
      }
      if (gathered.unsupported.length > 0) {
        setExportMsg(`Can't export as GLB: ${gathered.unsupported.join("; ")}`);
        return;
      }

      const asset = await saveGraphAsset(graphName, latestNodes.current, latestEdges.current, compiled);
      if (!asset) throw new Error("Could not save the shader before export.");
      setLoadedAsset(asset);

      const outputNode = latestNodes.current.find((n) => n.type === "OutputPBR");
      const outputData = (outputNode?.data ?? {}) as Record<string, unknown>;

      const res = await fetch("/api/tools/shaderade/export-glb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          materialName: graphName,
          shaderGraphAssetId: asset.id,
          channels: gathered.channels,
          normalYFlip: (outputData.normalYFlip as boolean) === true,
          normalStrength: (outputData.normalStrength as number) ?? 1,
          aoStrength: (outputData.aoStrength as number) ?? 1,
          roughnessStrength: (outputData.roughnessStrength as number) ?? 1,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Export failed.");

      notifyAssetsChanged();
      setExportMsg("Exported as GLB — saved to My Assets.");
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }, [user?.id, compiled, graphName, saveGraphAsset, notifyAssetsChanged]);

  const handleLoad = useCallback(async (asset: AssetRow) => {
    setLoadMenuOpen(false);
    try {
      const url = await signedAssetUrl(asset.storage_path);
      const res = await fetch(url);
      const json = await res.json() as { nodes: Node[]; edges: Edge[] };
      const nodes = json.nodes ?? [];

      // Texture URLs baked into node data at save time are signed and
      // expire (1hr default) — reopening a shader after that leaves every
      // texture-backed channel silently sampling as black (no throw, just
      // a failed fetch the preview already tolerates) instead of showing
      // the material. Re-resolve a fresh URL for any texture node we still
      // have an assetId for before handing the graph to the canvas.
      const freshUrlCache = new Map<string, string>();
      for (const node of nodes) {
        if (node.type !== "Texture2D") continue;
        const data = node.data as Record<string, unknown> | undefined;
        const assetId = data?.assetId as string | undefined;
        if (!assetId) continue;
        try {
          let freshUrl = freshUrlCache.get(assetId);
          if (!freshUrl) {
            const texAsset = await getAsset(assetId);
            if (!texAsset) continue;
            freshUrl = await signedAssetUrl(texAsset.storage_path);
            freshUrlCache.set(assetId, freshUrl);
          }
          node.data = { ...data, imageUrl: freshUrl };
        } catch {
          // Non-fatal — leave the stale URL in place rather than blocking
          // the whole load; worst case that one texture renders black,
          // same as before this fix.
        }
      }

      // Push into the actual editable canvas (not just the preview — the
      // canvas owns its own graph state, so a bare scheduleCompile() here
      // used to recompile the preview from stale data while leaving
      // whatever was on-screen untouched).
      nodeCanvasHandleRef.current?.loadGraph(nodes, json.edges ?? []);
      setGraphName(asset.name.replace(/\.shader\.json$/, ""));
      setLoadedAsset(asset);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Load failed.");
    }
  }, []);

  // Bulk PBR texture import: upload every file individually to the shared
  // library (kind: "texture", so it's reusable in future materials too),
  // detect which map each one is from its filename, then auto-wire the
  // recognized ones into a fresh graph and drop it straight into the
  // editable canvas. Height/preview files still upload (nothing from the
  // set is lost) but aren't wired — no displacement slot exists yet.
  const handleImportTextures = useCallback(async (files: FileList) => {
    if (!user?.id) return;
    setImporting(true);
    setImportMsg("");
    try {
      const maps: Partial<Record<MapType, string>> = {};
      const mapAssetIds: Partial<Record<MapType, string>> = {};
      let normalConvention: "directx" | "opengl" | undefined;
      let uploadedCount = 0;
      // Shared across every texture from this import AND the shader_graph
      // asset it produces below, so the asset panel can show them as one
      // associated group instead of unrelated flat rows.
      const groupId = crypto.randomUUID();

      for (const file of Array.from(files)) {
        const { mapType, normalConvention: conv } = detectMap(file.name);
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const bytes = await file.arrayBuffer();
        const asset = await uploadAsset({
          userId: user.id,
          name: file.name,
          bytes,
          visibility: "private",
          kind: "texture",
          format: ext,
          contentType: file.type || `image/${ext}`,
          meta: mapType ? { mapType, normalConvention: conv } : {},
          groupId,
        });
        uploadedCount++;
        if (mapType && mapType !== "height") {
          maps[mapType] = await signedAssetUrl(asset.storage_path);
          mapAssetIds[mapType] = asset.id;
          if (mapType === "normal") normalConvention = conv;
        }
      }

      notifyAssetsChanged();

      if (Object.keys(maps).length === 0) {
        setImportMsg(`Uploaded ${uploadedCount} file(s), but none matched a known PBR map name — nothing to auto-wire.`);
        return;
      }

      const { nodes, edges } = buildPbrGraph(maps, mapAssetIds, { normalConvention });
      nodeCanvasHandleRef.current?.loadGraph(nodes, edges);
      latestNodes.current = nodes;
      latestEdges.current = edges;

      // Compile synchronously rather than waiting on the 200ms debounced
      // compile (triggered indirectly once the canvas picks up loadGraph) —
      // we need a result right now both to sync the preview immediately and
      // to save it below.
      const wiredCount = Object.keys(maps).length;
      const importResult = compile({ nodes, edges });
      setCompiled(importResult);

      if (importResult.ok) {
        const autoName = deriveMaterialName(Array.from(files).map((f) => f.name));
        setGraphName(autoName);
        try {
          // Always a genuinely new material — must never overwrite whatever
          // was previously loaded/tracked.
          const asset = await saveGraphAsset(autoName, nodes, edges, importResult, { groupId, forceNew: true });
          if (asset) setLoadedAsset(asset);
          await refreshSaved();
          setImportMsg(`Imported ${uploadedCount} file(s), wired ${wiredCount} into a new PBR material — saved as "${autoName}".`);
        } catch (e) {
          setImportMsg(`Imported ${uploadedCount} file(s) and wired the material, but auto-save failed: ${e instanceof Error ? e.message : "unknown error"}`);
        }
      } else {
        setImportMsg(`Imported ${uploadedCount} file(s), wired ${wiredCount}, but the graph didn't compile — not auto-saved.`);
      }
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }, [user, notifyAssetsChanged, saveGraphAsset, refreshSaved]);

  // ── Auth guards ───────────────────────────────────────────────────────────
  if (!isLoaded || creatorStatus === "loading") return null;

  if (!user) {
    return (
      <main className="tool-min-h bg-[#0e0b08] flex items-center justify-center">
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
    <main className="tool-h bg-[#0e0b08] flex flex-col">
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

        {/* Bulk PBR texture import */}
        <input
          ref={importInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) handleImportTextures(files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => importInputRef.current?.click()}
          disabled={importing}
          title="Upload a PBR texture set (albedo/normal/roughness/metallic/AO) and auto-build a material from it"
          className="px-3 py-1.5 rounded bg-[#18141c] border border-[#2a2320] text-[11px] text-dim hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {importing ? "Importing…" : "Import Texture Set"}
        </button>

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

        {/* Save — overwrites loadedAsset in place once something's tracked */}
        <button
          onClick={handleSave}
          disabled={saving || !compiled?.ok}
          title={loadedAsset ? `Overwrites "${loadedAsset.name.replace(/\.shader\.json$/, "")}"` : "Saves as a new asset"}
          className="px-3 py-1.5 rounded bg-[#e8875a] hover:bg-[#d4713f] disabled:opacity-40 disabled:cursor-not-allowed text-[#0e0b08] text-[11px] font-semibold transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {/* Save As New — always forks a fresh asset, even if one is tracked */}
        {loadedAsset && (
          <button
            onClick={handleSaveAsNew}
            disabled={saving || !compiled?.ok}
            title="Save a copy as a new asset, without touching the loaded one"
            className="px-3 py-1.5 rounded bg-[#18141c] border border-[#2a2320] text-[11px] text-dim hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save As New
          </button>
        )}

        {/* Export GLB — a standalone material-on-a-sphere asset, the way
            Three.js/Babylon/PlayCanvas actually receive PBR materials */}
        <button
          onClick={handleExportGlb}
          disabled={exporting || !compiled?.ok}
          title="Export this material as a standalone GLB (sphere + material), saved to My Assets"
          className="px-3 py-1.5 rounded bg-[#18141c] border border-[#2a2320] text-[11px] text-dim hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? "Exporting…" : "Export GLB"}
        </button>

      </div>

      {/* Status messages — their own row, not truncated: the export/import
          errors in particular can be long and actionable (e.g. naming which
          channel/node is the problem), and clipping them defeats the point. */}
      {(saveMsg || importMsg || exportMsg) && (
        <div className="flex flex-col gap-0.5 px-4 py-1.5 border-b border-[#2a2320] shrink-0">
          {saveMsg && (
            <span className={`text-[11px] whitespace-normal ${saveMsg.includes("ailed") ? "text-red-400" : "text-green-400"}`}>
              {saveMsg}
            </span>
          )}
          {importMsg && (
            <span className={`text-[11px] whitespace-normal ${importMsg.includes("ailed") ? "text-red-400" : "text-green-400"}`}>
              {importMsg}
            </span>
          )}
          {exportMsg && (
            <span className={`text-[11px] whitespace-normal ${exportMsg.includes("ailed") || exportMsg.startsWith("Can't") ? "text-red-400" : "text-green-400"}`}>
              {exportMsg}
            </span>
          )}
        </div>
      )}

      {/* Body: node canvas (left 60%) | right panel (40%) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Node canvas + palette */}
        <div className="flex-[3] min-w-0 border-r border-[#2a2320]">
          <NodeCanvas onGraphChange={handleGraphChange} handleRef={nodeCanvasHandleRef} />
        </div>

        {/* Right: preview (top) + export (bottom) */}
        <div className="flex-[2] min-w-0 flex flex-col">
          {/* 3D preview sphere */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0">
              <ShaderPreview compiled={compiled} bgLightness={bgLightness} />
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[#2a2320] shrink-0">
              <span className="text-[10px] text-dim uppercase tracking-wider">Background</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={bgLightness}
                onChange={(e) => setBgLightness(Number(e.target.value))}
                className="flex-1"
                style={{ accentColor: "#e8875a", colorScheme: "dark" }}
              />
            </div>
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
