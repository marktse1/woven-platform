"use client";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient } from "@/lib/supabase";

type GradPair = [string, string];
const pal: GradPair[] = [
  ["#2a6aa0", "#7d4bd0"], ["#e0823a", "#c43a6a"], ["#1f9d8a", "#2c5fb0"],
  ["#3a8f5a", "#216b7a"], ["#b8923a", "#7a4a2a"], ["#6a4bd0", "#b03a8a"],
  ["#d0552a", "#9a2a4a"], ["#8a3a4a", "#3a3a6a"], ["#2a8aa0", "#5a3ab0"],
  ["#3a6a8a", "#2a9a8a"], ["#3a5ad0", "#2a9ad0"], ["#5aa03a", "#2a8a6a"],
];

type Game = {
  id: string;
  title: string;
  tags: string[];
  pass_included: boolean;
  a: string;
  b: string;
};

type LibraryRow = {
  game_id: string;
  source: string;
  games: {
    id: string;
    title: string;
    tags: string[];
    pass_included: boolean;
  } | null;
};

const collections = ["All", "Recently played", "Favorites", "Unplayed", "Co-op", "Cozy"];

function GradArt({ a, b, className = "", children }: { a: string; b: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(140deg, ${a}, ${b})` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 26% 16%, rgba(255,255,255,.28), transparent 60%)" }} />
      <div className="absolute inset-0 opacity-[.10] mix-blend-overlay"
        style={{ backgroundImage: "repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 9px)" }} />
      {children}
    </div>
  );
}

export default function LibraryPage() {
  const { user, isLoaded } = useUser();
  const [selected, setSelected] = useState(0);
  const [activeCol, setActiveCol] = useState("All");
  const [search, setSearch] = useState("");
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user?.id) { setLoading(false); return; }
    const supabase = getSupabaseClient();
    if (!supabase) { setLoading(false); return; }
    supabase
      .from("user_library")
      .select("game_id, source, games(id, title, tags, pass_included)")
      .eq("clerk_user_id", user.id)
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as LibraryRow[];
        const mapped: Game[] = rows
          .filter(r => r.games !== null)
          .map((r, i) => ({
            id: r.games!.id,
            title: r.games!.title,
            tags: r.games!.tags ?? [],
            pass_included: r.games!.pass_included,
            a: pal[i % pal.length][0],
            b: pal[i % pal.length][1],
          }));
        setGames(mapped);
        setLoading(false);
      });
  }, [isLoaded, user?.id]);

  const g = games[selected] ?? null;

  const filtered = games.filter(game =>
    (activeCol === "All" || true) &&
    (search === "" || game.title.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-16">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Your Library</h1>

        {/* Stats */}
        <div className="flex items-end gap-8 mt-0.5 mb-4.5">
          {[[String(games.length), "Games owned"], ["—", "Total playtime"], ["—", "Recently played"], ["—", "Achievements"]].map(([n, l]) => (
            <div key={l}>
              <div className="text-[24px] font-extrabold tracking-[-0.02em]">{n}</div>
              <div className="text-[12px] text-dim mt-0.5">{l}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 items-start grid-cols-1 lg:grid-cols-[330px_1fr]">
          {/* Left rail */}
          <div className="sticky top-4 bg-panel border border-line rounded-[10px] p-5">
            {/* Search */}
            <div className="relative mb-3">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim text-[13px]">⌕</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search your library…"
                className="bg-[#0a0e13] border border-line rounded-lg pl-8 pr-3 py-2.5 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]"
              />
            </div>

            {/* Collection chips */}
            <div className="flex flex-wrap gap-1.5 mb-3.5">
              {collections.map(c => {
                const on = activeCol === c;
                return (
                  <button key={c} onClick={() => setActiveCol(c)}
                    className="inline-flex items-center text-[13px] px-3 py-1.5 rounded-full border cursor-pointer transition-all"
                    style={{ background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" }}>
                    {c}
                  </button>
                );
              })}
            </div>

            <p className="text-[12.5px] font-bold tracking-[.08em] uppercase text-muted mb-2">
              All games · {filtered.length}
            </p>

            {/* Game list */}
            <div className="flex flex-col gap-0.5 max-h-[560px] overflow-y-auto pr-1"
              style={{ scrollbarWidth: "thin", scrollbarColor: "#324a61 transparent" }}>
              {loading ? (
                <div className="text-dim text-[13px] p-2">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="text-dim text-[13px] p-2">
                  {search ? "No games matched your search." : "Your library is empty. Buy a game to get started!"}
                </div>
              ) : filtered.map((game) => {
                const idx = games.indexOf(game);
                const on = selected === idx;
                return (
                  <button key={game.id} onClick={() => setSelected(idx)}
                    className="flex items-center gap-2.5 p-2 rounded-[9px] cursor-pointer text-left w-full transition-colors"
                    style={{ background: on ? "rgba(86,166,232,.14)" : "transparent" }}>
                    <GradArt a={game.a} b={game.b} className="w-[46px] h-[46px] rounded-[7px] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13.5px] truncate">{game.title}</div>
                      <div className="text-[11.5px] text-dim mt-0.5">{game.tags.slice(0, 2).join(" · ")}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail */}
          <div>
            {g ? (
              <>
                {/* Hero */}
                <GradArt a={g.a} b={g.b} className="h-[220px] sm:h-[280px] lg:h-[340px] rounded-[14px] border border-line">
                  <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,12,17,0) 30%, rgba(8,12,17,.55) 64%, rgba(8,12,17,.96) 100%)" }} />
                  <div className="absolute left-6 right-6 bottom-5 z-10">
                    <p className="text-[12px] font-bold tracking-[.10em] uppercase text-[#cfe6fb]">{g.tags.slice(0, 2).join(" · ")}</p>
                    <h1 className="text-[24px] sm:text-[32px] lg:text-[38px] font-extrabold tracking-[-0.02em] leading-none my-1.5">{g.title}</h1>
                    <p className="text-[13.5px] text-muted">WebGL build</p>
                  </div>
                </GradArt>

                {/* Play bar */}
                <div className="flex items-center gap-3 my-4">
                  <button className="flex items-center gap-2 px-8 py-3.5 rounded-[9px] font-bold text-[16px] cursor-pointer border-none"
                    style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}>
                    <span className="text-[13px]">▶</span> Play in browser
                  </button>
                  <button className="px-4 py-3.5 rounded-[9px] font-bold text-[14px] cursor-pointer bg-transparent border border-line text-ink">···</button>
                </div>

                {/* 3-col cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Achievements */}
                  <div className="bg-panel border border-line rounded-[10px] p-4.5">
                    <div className="flex items-center justify-between mb-3.5">
                      <span className="text-[12.5px] font-bold tracking-[.08em] uppercase text-muted">Achievements</span>
                    </div>
                    <div className="text-[14px] text-dim">No achievements tracked yet.</div>
                  </div>

                  {/* Cloud saves */}
                  <div className="bg-panel border border-line rounded-[10px] p-4.5">
                    <div className="flex items-center justify-between mb-3.5">
                      <span className="text-[12.5px] font-bold tracking-[.08em] uppercase text-muted">Cloud saves</span>
                    </div>
                    <div className="text-[14px] text-dim">No saves yet.</div>
                  </div>

                  {/* Friends */}
                  <div className="bg-panel border border-line rounded-[10px] p-4.5">
                    <div className="flex items-center justify-between mb-3.5">
                      <span className="text-[12.5px] font-bold tracking-[.08em] uppercase text-muted">Friends who play</span>
                    </div>
                    <div className="text-[14px] text-dim">No friends data yet.</div>
                  </div>
                </div>

                {/* News */}
                <div className="mt-4 bg-panel border border-line rounded-[10px]">
                  <div className="px-6 py-4 border-b border-line font-bold text-[15px]">Updates & news from the creator</div>
                  <div className="px-6 py-4 text-dim text-[13px]">No news posts yet.</div>
                </div>
              </>
            ) : !loading && (
              <div className="h-[340px] rounded-[14px] border border-line bg-panel flex items-center justify-center text-dim text-[13px]">
                Select a game from your library to see details.
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
