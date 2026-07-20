"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { listMyAssets, deleteAssets, type AssetRow } from "@/lib/assets";
import { useRegisteredLoader } from "./ActiveLoaderContext";
import { NATIVE_TOOLS } from "@/lib/tools/registry";
import AssetLibraryRow from "./AssetLibraryRow";

const DEFAULT_ACCENT = "#c47be8";

// Resolves each asset to a display parent (if any) so related assets can
// render as a collapsible root + children instead of flat rows — still
// exactly 1 level deep, matching every real relationship this produces
// (a shader + its textures; an edited mesh + the original it came from).
function buildTree(rows: AssetRow[]): { roots: AssetRow[]; childrenOf: Map<string, AssetRow[]> } {
  const byId = new Map(rows.map((a) => [a.id, a]));

  // Within a group_id cluster there's no stored "root" — pick the
  // shader_graph member to display as the parent (textures nest under the
  // shader they belong to); with no shader present, whichever member
  // appears first stands in.
  const groupRoot = new Map<string, string>();
  for (const a of rows) {
    if (!a.group_id) continue;
    const cur = groupRoot.get(a.group_id);
    if (!cur) {
      groupRoot.set(a.group_id, a.id);
    } else if (a.kind === "shader_graph" && byId.get(cur)?.kind !== "shader_graph") {
      groupRoot.set(a.group_id, a.id);
    }
  }

  function parentIdOf(a: AssetRow): string | undefined {
    if (a.derived_from_asset_id && byId.has(a.derived_from_asset_id)) return a.derived_from_asset_id;
    if (a.group_id) {
      const root = groupRoot.get(a.group_id);
      if (root && root !== a.id) return root;
    }
    return undefined;
  }

  const roots: AssetRow[] = [];
  const childrenOf = new Map<string, AssetRow[]>();
  for (const a of rows) {
    const parentId = parentIdOf(a);
    if (!parentId) {
      roots.push(a);
      continue;
    }
    const existing = childrenOf.get(parentId);
    if (existing) existing.push(a);
    else childrenOf.set(parentId, [a]);
  }
  return { roots, childrenOf };
}

// Global, collapsible right-edge drawer for the signed-in user's own
// creator_assets — mounted once in app/layout.tsx (alongside AccountStrip/
// MainNav) so it's available on every page, not just inside a specific
// tool. Collapsed by default; the vertical tab is the only thing visible
// until opened.
//
// Doubles as the universal asset *loader*: whichever tool is currently
// mounted registers itself via ActiveLoaderContext, and clicking a row here
// loads it straight into that tool instead of each tool keeping its own
// duplicate "browse my assets" list.
export default function AssetLibraryPanel() {
  const { user, isLoaded } = useUser();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const loaderCtx = useRegisteredLoader();
  const pathname = usePathname();

  const { roots, childrenOf } = useMemo(() => buildTree(assets), [assets]);
  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  function jumpToAsset(id: string) {
    rowRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(id);
    setTimeout(() => setHighlightedId((cur) => (cur === id ? null : cur)), 1600);
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const accent = NATIVE_TOOLS.find((t) => t.href && pathname?.startsWith(t.href))?.accent ?? DEFAULT_ACCENT;

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      setAssets(await listMyAssets(user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assets.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) refresh();
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const targets = assets.filter((a) => selectedIds.has(a.id));
    if (targets.length === 0) return;
    if (!confirm(`Delete ${targets.length} asset${targets.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBulkDeleting(true);
    try {
      await deleteAssets(targets);
      setSelectedIds(new Set());
      setSelectMode(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk delete failed.");
    } finally {
      setBulkDeleting(false);
    }
  }

  // Keep the drawer's list in sync when a tool uploads/saves an asset while
  // the panel happens to be open, without the panel needing a direct
  // reference to whatever triggered the change. This is React's documented
  // "adjust state when a prop/context value changes" pattern — compared
  // and updated during render, guarded by state (not a ref: reading a ref's
  // .current during render is itself disallowed) so it fires at most once
  // per version bump rather than looping.
  const [seenVersion, setSeenVersion] = useState(loaderCtx?.assetsVersion ?? 0);
  const currentVersion = loaderCtx?.assetsVersion ?? 0;
  if (open && currentVersion !== seenVersion) {
    setSeenVersion(currentVersion);
    refresh();
  }

  if (!isLoaded || !user) return null;

  // Each piece is independently `fixed` (rather than flex siblings sharing
  // one right-0 wrapper) — a flexed sibling next to the drawer still
  // reserves the drawer's full 300px in the layout even while the drawer
  // itself is transformed off-screen, which pushed the tab 300px away from
  // the real edge while "closed".
  const loader = loaderCtx?.activeLoader ?? null;

  return (
    <>
      <button
        onClick={handleToggle}
        className="fixed top-24 z-40 px-2 py-3 rounded-l-lg border border-r-0 font-bold text-[11px] uppercase tracking-[.08em] hover:text-ink transition-[right,color] duration-200 ease-out [writing-mode:vertical-rl]"
        style={{ right: open ? 300 : 0, background: "var(--color-panel)", borderColor: accent, color: open ? accent : "var(--color-muted)" }}
      >
        {open ? "Close ✕" : "My Assets"}
      </button>

      <div
        className="fixed top-0 right-0 h-screen z-40 overflow-y-auto transition-transform duration-200 ease-out"
        style={{
          width: 300,
          background: "var(--color-panel)",
          borderLeft: `2px solid ${accent}`,
          transform: open ? "translateX(0)" : "translateX(300px)",
        }}
      >
        <div className="px-3.5 py-3 border-b border-line font-bold text-[13px] sticky top-0 flex items-center gap-2" style={{ background: "var(--color-panel)", color: accent }}>
          My Assets
          {loader && <span className="text-[10px] font-medium tracking-[.04em] text-dim normal-case">· click to load</span>}
          <div className="flex-1" />
          {assets.length > 0 && (
            <button
              onClick={toggleSelectMode}
              className="text-[10px] font-medium tracking-[.04em] normal-case text-dim hover:text-ink"
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
          )}
        </div>
        {selectMode && (
          <div className="px-3.5 py-2 border-b border-line flex items-center justify-between gap-2 text-[11.5px]" style={{ background: "var(--color-panel)" }}>
            <span className="text-dim">{selectedIds.size} selected</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedIds(new Set())} className="text-dim hover:text-ink">Select None</button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || bulkDeleting}
                className="px-2 py-1 rounded disabled:opacity-40"
                style={{ color: "var(--color-bad)" }}
              >
                {bulkDeleting ? "Deleting…" : "Delete selected"}
              </button>
            </div>
          </div>
        )}
        {loading ? (
          <div className="px-3.5 py-6 text-[13px] text-dim">Loading…</div>
        ) : error ? (
          <div className="px-3.5 py-6 text-[13px]" style={{ color: "var(--color-bad)" }}>{error}</div>
        ) : assets.length === 0 ? (
          <div className="px-3.5 py-6 text-[13px] text-dim">No assets saved yet — save one from any creator tool and it&apos;ll show up here.</div>
        ) : (
          roots.map((a) => {
            const children = childrenOf.get(a.id) ?? [];
            const expanded = expandedIds.has(a.id);
            return (
              <div key={a.id}>
                <AssetLibraryRow
                  asset={a}
                  onChange={refresh}
                  onLoad={loader?.onLoad}
                  loadable={loader ? (loader.accepts ? loader.accepts(a) : true) : false}
                  accent={accent}
                  selectMode={selectMode}
                  selected={selectedIds.has(a.id)}
                  onToggleSelect={toggleSelect}
                  childCount={children.length}
                  expanded={expanded}
                  onToggleExpanded={children.length > 0 ? () => toggleExpanded(a.id) : undefined}
                  derivedFromName={a.derived_from_asset_id ? assetsById.get(a.derived_from_asset_id)?.name : undefined}
                  onJumpToSource={() => a.derived_from_asset_id && jumpToAsset(a.derived_from_asset_id)}
                  highlighted={highlightedId === a.id}
                  setRowRef={(el) => {
                    if (el) rowRefs.current.set(a.id, el);
                    else rowRefs.current.delete(a.id);
                  }}
                />
                {expanded && children.length > 0 && (
                  <div className="pl-3.5 ml-3.5 border-l border-line">
                    {children.map((c) => (
                      <AssetLibraryRow
                        key={c.id}
                        asset={c}
                        onChange={refresh}
                        onLoad={loader?.onLoad}
                        loadable={loader ? (loader.accepts ? loader.accepts(c) : true) : false}
                        accent={accent}
                        selectMode={selectMode}
                        selected={selectedIds.has(c.id)}
                        onToggleSelect={toggleSelect}
                        nested
                        derivedFromName={c.derived_from_asset_id ? assetsById.get(c.derived_from_asset_id)?.name : undefined}
                        onJumpToSource={() => c.derived_from_asset_id && jumpToAsset(c.derived_from_asset_id)}
                        highlighted={highlightedId === c.id}
                        setRowRef={(el) => {
                          if (el) rowRefs.current.set(c.id, el);
                          else rowRefs.current.delete(c.id);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
