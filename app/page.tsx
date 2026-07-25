"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StoreSubNav from "@/components/shell/StoreSubNav";
import RatingBadge from "@/components/RatingBadge";
import { listStoreGames, formatPrice, discountPercent, type GameRow } from "@/lib/games";

type GradPair = [string, string];
const pal: GradPair[] = [
  ["#3a7fc4", "#7d4bd0"], ["#2aa6c4", "#15527a"], ["#5cb85c", "#1e7a4a"],
  ["#e8794b", "#b8431a"], ["#4b7fd0", "#2a3f7a"], ["#c44b9a", "#6a2a7a"],
  ["#d0a93a", "#7a5a1a"], ["#3ac4a6", "#1a5a52"],
];

function GradArt({ pair, children, className = "" }: { pair: GradPair; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(140deg, ${pair[0]}, ${pair[1]})` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 25% 14%, rgba(255,255,255,.30), transparent 60%)" }} />
      <div className="absolute inset-0 opacity-[.12] mix-blend-overlay"
        style={{ backgroundImage: "repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 9px)" }} />
      {children}
    </div>
  );
}

function PriceTag({ game, className = "" }: { game: GameRow; className?: string }) {
  const pct = discountPercent(game.price_cents, game.original_price_cents);
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {pct != null && (
        <>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[rgba(123,194,74,.16)] text-[#a6e06a]">-{pct}%</span>
          <span className="text-dim text-[11px] line-through">{formatPrice(game.original_price_cents!)}</span>
        </>
      )}
      <span className="font-bold text-[13px]">{formatPrice(game.price_cents)}</span>
    </div>
  );
}

export default function StorePage() {
  const [query, setQuery] = useState("");
  const [featured, setFeatured] = useState<GameRow[]>([]);
  const [onSale, setOnSale] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setQuery(new URLSearchParams(window.location.search).get("q")?.trim().toLowerCase() ?? "");
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [trending, sale] = await Promise.all([
          listStoreGames({ sort: "trending" }),
          listStoreGames({ onSale: true }),
        ]);
        if (!active) return;
        setFeatured(trending);
        setOnSale(sale.slice(0, 5));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  const filteredGames = useMemo(
    () => featured.filter((g) =>
      !query || `${g.title} ${g.tags.join(" ")}`.toLowerCase().includes(query)
    ),
    [featured, query]
  );

  const featuredGame = filteredGames[0] ?? null;
  const railGames = filteredGames.slice(1, 7);

  return (
    <>
      <StoreSubNav />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-16">
        {query ? (
          <div className="mb-5 rounded-[10px] border border-line bg-panel px-4 py-3 text-[13px] text-dim">
            Search results for <span className="text-ink font-semibold">&quot;{query}&quot;</span>
          </div>
        ) : null}

        {/* Featured */}
        <div className="flex items-center justify-between mb-3.5">
          <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted">Featured & Recommended</p>
          <Link href="/browse" className="text-[13px] text-accent font-semibold no-underline hover:underline">Browse all games →</Link>
        </div>
        <section className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr_320px]">
          {featuredGame ? (
            <Link href={`/game/${featuredGame.slug}`} className="no-underline text-inherit">
            <GradArt pair={pal[0]} className="rounded-lg border border-line min-h-[280px] lg:min-h-[440px]">
              <span className="absolute left-3.5 top-3 font-mono text-[11px] text-white bg-black/40 px-2 py-1 rounded-md z-10">
                banner art · 16:9
              </span>
              <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(5,8,11,.92))" }} />
              <div className="absolute left-6 right-6 bottom-5 flex items-end justify-between gap-5 z-10">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-[22px] sm:text-[28px] lg:text-[34px] font-extrabold tracking-[-0.02em]">{featuredGame.title}</h2>
                    <RatingBadge rating={featuredGame.rating} />
                  </div>
                  {featuredGame.short_description && (
                    <p className="text-[#c2d2e0] text-sm mt-1.5 max-w-[420px]">{featuredGame.short_description}</p>
                  )}
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {featuredGame.tags.map(tag => (
                      <span key={tag} className="text-xs bg-white/10 px-2.5 py-1 rounded-md">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center shrink-0 rounded-lg overflow-hidden">
                  <span className="self-stretch flex items-center px-5 font-extrabold text-[14px] cursor-pointer"
                    style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}>
                    View · {formatPrice(featuredGame.price_cents)}
                  </span>
                </div>
              </div>
            </GradArt>
            </Link>
          ) : (
            <div className="rounded-lg border border-line bg-panel min-h-[440px] flex items-center justify-center">
              <span className="text-dim text-[13px]">
                {loading ? "Loading games…" : "No games published yet. Check back soon!"}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {railGames.map((g, i) => (
              <Link key={g.id} href={`/game/${g.slug}`}
                className="flex gap-2.5 p-2 rounded-[7px] cursor-pointer items-center border transition-colors bg-panel border-transparent hover:bg-panel2 hover:border-line no-underline text-inherit">
                <GradArt pair={pal[(i + 1) % pal.length]} className="w-[88px] h-12 rounded-md shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="text-[13px] font-semibold truncate">{g.title}</div>
                    <RatingBadge rating={g.rating} />
                  </div>
                  <div className="text-[11px] text-dim mt-0.5">{g.tags.slice(0, 2).join(" · ")}</div>
                </div>
                <PriceTag game={g} />
              </Link>
            ))}
            {!loading && railGames.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-dim text-[13px] p-4">
                More games coming soon.
              </div>
            )}
          </div>
        </section>

        {/* On sale — only shown when something is actually discounted */}
        {onSale.length > 0 && (
          <section className="mt-10">
            <div className="flex items-center justify-between mb-3.5">
              <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted">🏷 On Sale</p>
              <Link href="/browse?sale=1" className="text-[13px] text-accent font-semibold no-underline hover:underline">See all →</Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {onSale.map((s, i) => (
                <Link key={s.id} href={`/game/${s.slug}`}
                  className="block bg-panel border border-line rounded-lg overflow-hidden cursor-pointer transition-[transform,box-shadow] hover:-translate-y-[3px] hover:shadow-[0_12px_30px_rgba(0,0,0,.5)] no-underline text-inherit">
                  <GradArt pair={pal[(i + 2) % pal.length]} className="h-[130px]" />
                  <div className="px-3 pt-2.5 pb-3">
                    <div className="flex items-center gap-1.5">
                      <div className="text-[14px] font-semibold truncate">{s.title}</div>
                      <RatingBadge rating={s.rating} />
                    </div>
                    <div className="text-[11px] text-dim mt-1 mb-2.5">{s.tags.slice(0, 2).join(" · ")}</div>
                    <div className="flex items-center justify-end">
                      <PriceTag game={s} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
