"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StoreSubNav from "@/components/shell/StoreSubNav";
import { getSupabaseClient } from "@/lib/supabase";
import RatingBadge from "@/components/RatingBadge";

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

type Game = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  price_cents: number;
  pass_included: boolean;
  tags: string[];
  rating: number | null;
};

function formatPrice(priceCents: number, passIncluded: boolean): string {
  if (passIncluded) return "◆ Pass";
  if (priceCents === 0) return "Free";
  return `$${(priceCents / 100).toFixed(2)}`;
}

const categories = ["Cozy", "Roguelike", "Made in Weave Forge", "Multiplayer", "Atmospheric", "Free on Pass"];

export default function StorePage() {
  const [query, setQuery] = useState("");
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setQuery(new URLSearchParams(window.location.search).get("q")?.trim().toLowerCase() ?? "");
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) { setLoading(false); return; }
    supabase
      .from("games")
      .select("id, slug, title, short_description, price_cents, pass_included, tags, rating")
      .eq("status", "live")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setGames(data ?? []);
        setLoading(false);
      });
  }, []);

  const filteredGames = useMemo(
    () => games.filter(g =>
      !query || `${g.title} ${g.tags.join(" ")} ${formatPrice(g.price_cents, g.pass_included)}`.toLowerCase().includes(query)
    ),
    [games, query]
  );

  const filteredCategories = useMemo(
    () => categories.filter(cat => !query || cat.toLowerCase().includes(query)),
    [query]
  );

  const featuredGame = filteredGames[0] ?? null;
  const railGames = filteredGames.slice(1, 7);
  const specials = filteredGames.slice(7, 12);

  return (
    <>
      <StoreSubNav />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-16">
        {query ? (
          <div className="mb-5 rounded-[10px] border border-line bg-panel px-4 py-3 text-[13px] text-dim">
            Search results for <span className="text-ink font-semibold">"{query}"</span>
          </div>
        ) : null}

        {/* Featured */}
        <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">Featured & Recommended</p>
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
                    {featuredGame.pass_included
                      ? "Play free on Pass"
                      : `View · ${formatPrice(featuredGame.price_cents, featuredGame.pass_included)}`}
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
                <div className={`text-[13px] font-bold ${g.pass_included ? "text-accent text-[11px]" : ""}`}>
                  {formatPrice(g.price_cents, g.pass_included)}
                </div>
              </Link>
            ))}
            {!loading && railGames.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-dim text-[13px] p-4">
                More games coming soon.
              </div>
            )}
          </div>
        </section>

        {/* Special Offers — only shown when enough games exist */}
        {specials.length > 0 && (
          <section className="mt-10">
            <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">Special Offers</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {specials.map((s, i) => (
                <Link key={s.id} href={`/game/${s.slug}`}
                  className="block bg-panel border border-line rounded-lg overflow-hidden cursor-pointer transition-[transform,box-shadow] hover:-translate-y-[3px] hover:shadow-[0_12px_30px_rgba(0,0,0,.5)] no-underline text-inherit">
                  <GradArt pair={pal[(i + 2) % pal.length]} className="h-[130px]" />
                  <div className="px-3 pt-2.5 pb-3">
                    <div className="flex items-center gap-1.5">
                      <div className="text-[14px] font-semibold truncate">{s.title}</div>
                      <RatingBadge rating={s.rating} />
                    </div>
                    <div className="text-[11px] text-dim mt-1 mb-2.5">{s.tags.slice(0, 2).join(" · ")}</div>
                    <div className="flex items-center justify-end gap-2">
                      {s.pass_included ? (
                        <span className="text-accent font-bold text-[12px]">◆ Free on Pass</span>
                      ) : (
                        <span className="font-bold text-[13px]">{formatPrice(s.price_cents, s.pass_included)}</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Categories */}
        <section className="mt-10">
          <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">Browse by Category</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredCategories.map((cat, i) => (
              <div key={cat} className="relative h-[84px] rounded-lg overflow-hidden flex items-end p-3 font-bold text-[14px] cursor-pointer border border-line">
                <GradArt pair={pal[(i + 3) % pal.length]} className="absolute inset-0 opacity-85" />
                <span className="relative z-10">{cat}</span>
              </div>
            ))}
            {query && filteredCategories.length === 0 ? (
              <div className="col-span-3 sm:col-span-4 lg:col-span-6 text-dim text-[13px]">No categories matched your search.</div>
            ) : null}
          </div>
        </section>

        {/* Woven Pass Banner */}
        <section className="mt-10 border border-accent2 rounded-[10px] px-4 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
          style={{ background: "linear-gradient(100deg, rgba(86,166,232,.12), rgba(86,166,232,.02))" }}>
          <div className="text-[22px] font-extrabold">◆ Woven Pass</div>
          <div>
            <div className="font-semibold">Play 400+ games for one monthly price.</div>
            <p className="text-muted text-[13px] mt-0.5">Including every game tagged "Free on Pass." Cancel anytime.</p>
          </div>
          <div className="flex-1" />
          <button className="px-5 py-2.5 rounded-lg font-bold text-[14px] cursor-pointer border-none"
            style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
            Try 14 days free
          </button>
        </section>
      </div>
    </>
  );
}
