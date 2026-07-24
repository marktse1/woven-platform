"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CreatorSubNav from "@/components/shell/CreatorSubNav";
import MarketplaceAssetCard from "@/components/assets/MarketplaceAssetCard";
import { listMarketplaceAssets, getCreatorDisplayNames, type AssetRow, type MarketplaceSort } from "@/lib/assets";

const kindFilters: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "model", label: "Models" },
  { value: "texture", label: "Textures" },
  { value: "shader_graph", label: "Shaders" },
];

const sortTabs: { value: MarketplaceSort; label: string }[] = [
  { value: "newest", label: "✦ Newest" },
  { value: "price_asc", label: "▲ Price: Low to High" },
  { value: "price_desc", label: "▼ Price: High to Low" },
];

export default function MarketplacePage() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [creators, setCreators] = useState<Record<string, { studio_name: string | null; handle: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState("all");
  const [activeSort, setActiveSort] = useState<MarketplaceSort>("newest");
  const [purchased, setPurchased] = useState(false);

  useEffect(() => {
    async function checkPurchased() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("purchased") === "1") setPurchased(true);
    }
    checkPurchased();
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const rows = await listMarketplaceAssets({ kind: activeKind === "all" ? undefined : activeKind, sort: activeSort });
        if (!active) return;
        setAssets(rows);
        const ids = Array.from(new Set(rows.map((r) => r.clerk_user_id)));
        const names = await getCreatorDisplayNames(ids);
        if (active) setCreators(names);
      } catch {
        // best-effort — the empty state covers a failed/empty fetch either way
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [activeKind, activeSort]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets),
    [assets, q],
  );

  return (
    <>
      <CreatorSubNav />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-16">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Asset Marketplace</h1>
        <p className="text-muted text-[15px] mt-2 mb-4 max-w-[620px]">
          Models, textures, and shader graphs made in Woven&apos;s tools. Creators set their own prices.
        </p>

        {purchased && (
          <div className="mb-4 p-3 rounded-[9px] border text-[13px] text-green" style={{ borderColor: "rgba(123,194,74,.4)", background: "rgba(123,194,74,.08)" }}>
            Purchase complete — find it under &quot;Purchased&quot; in your Assets tab.
          </div>
        )}

        {/* Search */}
        <div className="relative mb-3.5 max-w-[420px]">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim text-[14px]">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            className="bg-[#0a0e13] border border-line rounded-lg pl-9 pr-3 py-2.5 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]" />
        </div>

        {/* Kind chips */}
        <div className="flex flex-wrap gap-2 mb-3.5">
          {kindFilters.map((k) => {
            const on = activeKind === k.value;
            return (
              <button key={k.value} onClick={() => setActiveKind(k.value)}
                className="inline-flex items-center text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
                style={{ background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" }}>
                {k.label}
              </button>
            );
          })}
        </div>

        {/* Sort tabs */}
        <div className="flex items-center gap-1 p-1 rounded-[10px] border border-line w-max mb-5" style={{ background: "#16202c" }}>
          {sortTabs.map((s) => (
            <button key={s.value} onClick={() => setActiveSort(s.value)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[7px] text-[13px] font-bold cursor-pointer transition-colors"
              style={{ background: activeSort === s.value ? "#223345" : "transparent", color: activeSort === s.value ? "#e7eef4" : "#8aa0b4" }}>
              {s.label}
            </button>
          ))}
        </div>

        {loading && <div className="text-center text-muted text-[14px] py-10">Loading…</div>}
        {!loading && visible.length === 0 && (
          <div className="rounded-lg border border-line bg-panel py-10 flex flex-col items-center justify-center gap-3 text-dim text-[13px]">
            {q ? `No assets matching "${query}"` : "No public assets yet."}
            <Link href="/tools/mesh-sculptor" className="text-accent text-[13px] font-semibold no-underline">
              Make something in Mesh Sculptor →
            </Link>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {visible.map((a) => (
              <MarketplaceAssetCard
                key={a.id}
                asset={a}
                creatorName={creators[a.clerk_user_id]?.studio_name ?? creators[a.clerk_user_id]?.handle ?? "Creator"}
                creatorHandle={creators[a.clerk_user_id]?.handle ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
