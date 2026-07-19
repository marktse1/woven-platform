"use client";

import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { listMyAssets, type AssetRow } from "@/lib/assets";
import { useRegisteredLoader } from "./ActiveLoaderContext";
import { NATIVE_TOOLS } from "@/lib/tools/registry";
import AssetLibraryRow from "./AssetLibraryRow";

const DEFAULT_ACCENT = "#c47be8";

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
  const loaderCtx = useRegisteredLoader();
  const pathname = usePathname();

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
        </div>
        {loading ? (
          <div className="px-3.5 py-6 text-[13px] text-dim">Loading…</div>
        ) : error ? (
          <div className="px-3.5 py-6 text-[13px]" style={{ color: "var(--color-bad)" }}>{error}</div>
        ) : assets.length === 0 ? (
          <div className="px-3.5 py-6 text-[13px] text-dim">No assets saved yet — save one from any creator tool and it&apos;ll show up here.</div>
        ) : (
          assets.map((a) => (
            <AssetLibraryRow
              key={a.id}
              asset={a}
              onChange={refresh}
              onLoad={loader?.onLoad}
              loadable={loader ? (loader.accepts ? loader.accepts(a) : true) : false}
              accent={accent}
            />
          ))
        )}
      </div>
    </>
  );
}
