"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StoreSubNav from "@/components/shell/StoreSubNav";
import RatingBadge from "@/components/RatingBadge";
import { listStoreGames, formatPrice, discountPercent, type GameRow, type StoreSort } from "@/lib/games";
import { GAME_TAGS } from "@/lib/gameTags";

type GradPair = [string, string];
const pal: GradPair[] = [
  ["#3a7fc4", "#7d4bd0"], ["#2aa6c4", "#15527a"], ["#5cb85c", "#1e7a4a"],
  ["#e8794b", "#b8431a"], ["#4b7fd0", "#2a3f7a"], ["#c44b9a", "#6a2a7a"],
];

function GradArt({ pair, className = "" }: { pair: GradPair; className?: string }) {
  return (
    <div className={`relative overflow-hidden shrink-0 ${className}`}
      style={{ background: `linear-gradient(140deg, ${pair[0]}, ${pair[1]})` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 25% 14%, rgba(255,255,255,.30), transparent 60%)" }} />
    </div>
  );
}

const sortTabs: { value: StoreSort; label: string }[] = [
  { value: "trending", label: "✦ New & Trending" },
  { value: "top_sellers", label: "▲ Top Sellers" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

function GameRowItem({ game }: { game: GameRow }) {
  const pct = discountPercent(game.price_cents, game.original_price_cents);
  return (
    <Link href={`/game/${game.slug}`}
      className="grid items-center px-4.5 py-3 border-b border-line last:border-none cursor-pointer hover:bg-white/[.025] transition-colors gap-3 grid-cols-[1fr_auto] sm:grid-cols-[64px_1fr_auto_auto] no-underline text-inherit">
      <GradArt pair={pal[game.title.length % pal.length]} className="hidden sm:block w-16 h-10 rounded-md" />
      <div className="min-w-0">
        <div className="font-semibold text-[14px] truncate">{game.title}</div>
        <div className="text-[11.5px] text-dim mt-0.5">{game.tags.slice(0, 2).join(" · ")}</div>
      </div>
      <div className="hidden sm:block"><RatingBadge rating={game.rating} /></div>
      <div className="flex items-center gap-1.5 justify-end">
        {pct != null && (
          <>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[rgba(123,194,74,.16)] text-[#a6e06a]">-{pct}%</span>
            <span className="text-dim text-[12px] line-through">{formatPrice(game.original_price_cents!)}</span>
          </>
        )}
        <span className="font-bold text-[14px]">{formatPrice(game.price_cents)}</span>
      </div>
    </Link>
  );
}

export default function BrowsePage() {
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [onSale, setOnSale] = useState(false);
  const [sort, setSort] = useState<StoreSort>("trending");

  useEffect(() => {
    async function readParams() {
      const params = new URLSearchParams(window.location.search);
      const sortParam = params.get("sort") as StoreSort | null;
      if (sortParam && ["trending", "top_sellers", "newest", "price_asc", "price_desc"].includes(sortParam)) setSort(sortParam);
      const tagParam = params.get("tag");
      if (tagParam) setActiveTag(tagParam);
      if (params.get("sale") === "1") setOnSale(true);
    }
    readParams();
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const rows = await listStoreGames({ tag: activeTag ?? undefined, onSale: onSale || undefined, sort });
        if (active) setGames(rows);
      } catch {
        // empty state below covers a failed fetch
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [activeTag, onSale, sort]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? games.filter((g) => g.title.toLowerCase().includes(q)) : games),
    [games, q],
  );

  return (
    <>
      <StoreSubNav />
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-16">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Browse</h1>
        <p className="text-muted text-[15px] mt-2 mb-4">Every live game on Woven, filterable and sortable.</p>

        {/* Search */}
        <div className="relative mb-3.5 max-w-[420px]">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim text-[14px]">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games…"
            className="bg-[#0a0e13] border border-line rounded-lg pl-9 pr-3 py-2.5 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]" />
        </div>

        {/* Genre chips */}
        <div className="flex flex-wrap gap-2 mb-3.5">
          <button onClick={() => setActiveTag(null)}
            className="inline-flex items-center text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
            style={{ background: activeTag === null ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: activeTag === null ? "#56a6e8" : "#26384a", color: activeTag === null ? "#cfe6fb" : "#e7eef4" }}>
            All
          </button>
          {GAME_TAGS.map((tag) => {
            const on = activeTag === tag;
            return (
              <button key={tag} onClick={() => setActiveTag(tag)}
                className="inline-flex items-center text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
                style={{ background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" }}>
                {tag}
              </button>
            );
          })}
          <button onClick={() => setOnSale((v) => !v)}
            className="inline-flex items-center text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
            style={{ background: onSale ? "rgba(123,194,74,.16)" : "#1b2836", borderColor: onSale ? "#7bc24a" : "#26384a", color: onSale ? "#a6e06a" : "#e7eef4" }}>
            🏷 On sale
          </button>
        </div>

        {/* Sort tabs */}
        <div className="flex items-center gap-1 p-1 rounded-[10px] border border-line w-max mb-5 flex-wrap" style={{ background: "#16202c" }}>
          {sortTabs.map((s) => (
            <button key={s.value} onClick={() => setSort(s.value)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[7px] text-[13px] font-bold cursor-pointer transition-colors"
              style={{ background: sort === s.value ? "#223345" : "transparent", color: sort === s.value ? "#e7eef4" : "#8aa0b4" }}>
              {s.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="bg-panel border border-line rounded-[10px] overflow-hidden">
          {loading && <div className="px-5 py-10 text-center text-muted text-[14px]">Loading…</div>}
          {!loading && visible.length === 0 && (
            <div className="px-5 py-10 text-center text-muted text-[14px]">
              {q ? `No games matching "${query}"` : "No games match these filters."}
            </div>
          )}
          {visible.map((g) => <GameRowItem key={g.id} game={g} />)}
        </div>
      </div>
    </>
  );
}
