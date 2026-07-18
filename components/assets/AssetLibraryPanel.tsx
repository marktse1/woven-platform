"use client";

import { useCallback, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { listMyAssets, type AssetRow } from "@/lib/assets";
import AssetLibraryRow from "./AssetLibraryRow";

// Global, collapsible right-edge drawer for the signed-in user's own
// creator_assets — mounted once in app/layout.tsx (alongside AccountStrip/
// MainNav) so it's available on every page, not just inside a specific
// tool. Collapsed by default; the vertical tab is the only thing visible
// until opened.
export default function AssetLibraryPanel() {
  const { user, isLoaded } = useUser();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!isLoaded || !user) return null;

  // Each piece is independently `fixed` (rather than flex siblings sharing
  // one right-0 wrapper) — a flexed sibling next to the drawer still
  // reserves the drawer's full 300px in the layout even while the drawer
  // itself is transformed off-screen, which pushed the tab 300px away from
  // the real edge while "closed".
  return (
    <>
      <button
        onClick={handleToggle}
        className="fixed top-24 z-40 px-2 py-3 rounded-l-lg border border-r-0 border-line font-bold text-[11px] uppercase tracking-[.08em] text-muted hover:text-ink transition-[right] duration-200 ease-out [writing-mode:vertical-rl]"
        style={{ right: open ? 300 : 0, background: "var(--color-panel)" }}
      >
        {open ? "Close ✕" : "My Assets"}
      </button>

      <div
        className="fixed top-0 right-0 h-screen z-40 border-l border-line overflow-y-auto transition-transform duration-200 ease-out"
        style={{
          width: 300,
          background: "var(--color-panel)",
          transform: open ? "translateX(0)" : "translateX(300px)",
        }}
      >
        <div className="px-3.5 py-3 border-b border-line font-bold text-[13px] text-ink sticky top-0" style={{ background: "var(--color-panel)" }}>
          My Assets
        </div>
        {loading ? (
          <div className="px-3.5 py-6 text-[13px] text-dim">Loading…</div>
        ) : error ? (
          <div className="px-3.5 py-6 text-[13px]" style={{ color: "var(--color-bad)" }}>{error}</div>
        ) : assets.length === 0 ? (
          <div className="px-3.5 py-6 text-[13px] text-dim">No assets saved yet — save one from any creator tool and it&apos;ll show up here.</div>
        ) : (
          assets.map((a) => <AssetLibraryRow key={a.id} asset={a} onChange={refresh} />)
        )}
      </div>
    </>
  );
}
