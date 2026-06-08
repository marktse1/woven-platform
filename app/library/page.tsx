"use client";
import { useState } from "react";
import LibrarySubNav from "@/components/shell/LibrarySubNav";

type Game = {
  name: string; dev: string; a: string; b: string;
  genre: string; hours: string; last: string;
  online: boolean; ach: number; achTotal: number;
};

const games: Game[] = [
  { name: "Hollow Tide",      dev: "Lantern Few",       a: "#2a6aa0", b: "#7d4bd0", genre: "Atmospheric · Exploration", hours: "14.2 hrs", last: "2 days ago",   online: true,  ach: 12, achTotal: 30 },
  { name: "Paper Astronauts", dev: "Tin Robot",          a: "#e0823a", b: "#c43a6a", genre: "Cozy · Sandbox",            hours: "41.0 hrs", last: "Yesterday",    online: true,  ach: 24, achTotal: 24 },
  { name: "Drift Capital",    dev: "Neon Ferry",         a: "#1f9d8a", b: "#2c5fb0", genre: "Racing · Arcade",           hours: "7.6 hrs",  last: "5 days ago",   online: false, ach: 5,  achTotal: 18 },
  { name: "Mossglow",         dev: "Fernlight",          a: "#3a8f5a", b: "#216b7a", genre: "Puzzle · Cozy",             hours: "22.3 hrs", last: "Today",        online: true,  ach: 16, achTotal: 20 },
  { name: "Tin Can Kingdom",  dev: "Brassworks",         a: "#b8923a", b: "#7a4a2a", genre: "Strategy · Builder",        hours: "58.7 hrs", last: "3 days ago",   online: true,  ach: 31, achTotal: 40 },
  { name: "Static Garden",    dev: "Hum Collective",     a: "#6a4bd0", b: "#b03a8a", genre: "Ambient · Music",           hours: "3.1 hrs",  last: "2 weeks ago",  online: false, ach: 2,  achTotal: 12 },
  { name: "Foxfire Relay",    dev: "Ember & Co",         a: "#d0552a", b: "#9a2a4a", genre: "Co-op · Platformer",        hours: "19.8 hrs", last: "4 days ago",   online: true,  ach: 14, achTotal: 26 },
  { name: "Cinder Court",     dev: "Ashgrove",           a: "#8a3a4a", b: "#3a3a6a", genre: "Roguelike · Action",        hours: "33.4 hrs", last: "1 week ago",   online: false, ach: 20, achTotal: 35 },
  { name: "Loom & Lantern",   dev: "Weft Studio",        a: "#2a8aa0", b: "#5a3ab0", genre: "Narrative · Puzzle",        hours: "11.0 hrs", last: "6 days ago",   online: true,  ach: 9,  achTotal: 22 },
  { name: "Saltmarsh",        dev: "Low Tide Games",     a: "#3a6a8a", b: "#2a9a8a", genre: "Survival · Sim",            hours: "27.5 hrs", last: "Today",        online: true,  ach: 18, achTotal: 30 },
  { name: "Pocket Aurora",    dev: "Northlight",         a: "#3a5ad0", b: "#2a9ad0", genre: "Cozy · Idle",               hours: "9.2 hrs",  last: "1 week ago",   online: false, ach: 7,  achTotal: 15 },
  { name: "Glasshouse",       dev: "Verdigris",          a: "#5aa03a", b: "#2a8a6a", genre: "Sim · Builder",             hours: "15.6 hrs", last: "3 days ago",   online: true,  ach: 11, achTotal: 28 },
];

const collections = ["All", "Recently played", "Favorites", "Unplayed", "Co-op", "Cozy"];

const friends = [
  { name: "orrin_q",     status: "Playing now · Ch. 6", a: "#e0823a", b: "#c43a6a" },
  { name: "pixel_wren",  status: "28 hrs · Completed",  a: "#3a8f5a", b: "#216b7a" },
  { name: "deepfen",     status: "6 hrs · 2 days ago",  a: "#3a5ad0", b: "#2a9ad0" },
];

const newsPosts = [
  { tag: "Patch 1.4.2", title: "The Lantern Update — diving, depth, and new tides", body: "Free-dive into the trench, a reworked map, and three new ambient scores by the Lantern Few audio team.", date: "Lantern Few · 3 days ago", a: "#2a6aa0", b: "#7d4bd0" },
  { tag: "Event",       title: "Tideglass photo contest — share your best vista",   body: "Post a screenshot in the Hollow Tide hub before Sunday for a chance at an exclusive lantern skin.",       date: "Lantern Few · 1 week ago", a: "#1f9d8a", b: "#2c5fb0" },
];

const dlc = [
  { name: "Deeptide Expansion", desc: "New region · 4–6 hrs", a: "#3a3a6a", b: "#7d4bd0", price: "$6.99",  owned: false },
  { name: "Original Soundtrack", desc: "22 tracks · FLAC",    a: "#b8923a", b: "#7a4a2a", price: "$4.99",  owned: false },
  { name: "Lantern Skins Pack",  desc: "Owned",               a: "#2a8aa0", b: "#5a3ab0", price: "",        owned: true  },
];

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
  const [selected, setSelected] = useState(0);
  const [activeCol, setActiveCol] = useState("All");
  const [search, setSearch] = useState("");

  const g = games[selected];
  const achPct = Math.round((g.ach / g.achTotal) * 100);

  const filtered = games.filter(g =>
    (activeCol === "All" || true) &&
    (search === "" || g.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <LibrarySubNav />
      <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Your Library</h1>

        {/* Stats */}
        <div className="flex items-end gap-8 mt-0.5 mb-4.5">
          {[["42", "Games owned"], ["318 hrs", "Total playtime"], ["12", "Recently played"], ["186", "Achievements"]].map(([n, l]) => (
            <div key={l}>
              <div className="text-[24px] font-extrabold tracking-[-0.02em]">{n}</div>
              <div className="text-[12px] text-dim mt-0.5">{l}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 items-start" style={{ gridTemplateColumns: "330px 1fr" }}>
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
              {filtered.map((game, i) => {
                const idx = games.indexOf(game);
                const on = selected === idx;
                return (
                  <button key={game.name} onClick={() => setSelected(idx)}
                    className="flex items-center gap-2.5 p-2 rounded-[9px] cursor-pointer text-left w-full transition-colors"
                    style={{ background: on ? "rgba(86,166,232,.14)" : "transparent" }}>
                    <GradArt a={game.a} b={game.b} className="w-[46px] h-[46px] rounded-[7px] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13.5px] truncate">{game.name}</div>
                      <div className="flex items-center gap-1.5 text-[11.5px] text-dim mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${game.online ? "bg-green" : "bg-line2"}`} />
                        {game.hours} · {game.last}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail */}
          <div>
            {/* Hero */}
            <GradArt a={g.a} b={g.b} className="h-[340px] rounded-[14px] border border-line">
              <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,12,17,0) 30%, rgba(8,12,17,.55) 64%, rgba(8,12,17,.96) 100%)" }} />
              <div className="absolute left-6 right-6 bottom-5 z-10">
                <p className="text-[12px] font-bold tracking-[.10em] uppercase text-[#cfe6fb]">{g.genre}</p>
                <h1 className="text-[38px] font-extrabold tracking-[-0.02em] leading-none my-1.5">{g.name}</h1>
                <p className="text-[13.5px] text-muted">by <strong className="text-ink font-semibold">{g.dev}</strong> · WebGL build · 1.4.2</p>
              </div>
            </GradArt>

            {/* Play bar */}
            <div className="flex items-center gap-3 my-4">
              <button className="flex items-center gap-2 px-8 py-3.5 rounded-[9px] font-bold text-[16px] cursor-pointer border-none"
                style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}>
                <span className="text-[13px]">▶</span> Play in browser
              </button>
              <button className="px-5 py-3.5 rounded-[9px] font-bold text-[14px] cursor-pointer bg-panel2 border border-line text-ink">
                ↻ Continue · 02:14 in
              </button>
              <button className="px-4 py-3.5 rounded-[9px] font-bold text-[14px] cursor-pointer bg-transparent border border-line text-ink">···</button>
              <div className="ml-auto text-right">
                <div className="font-bold text-[14px]">{g.hours}</div>
                <div className="text-[12.5px] text-dim">Last played {g.last}</div>
              </div>
            </div>

            {/* 3-col cards */}
            <div className="grid grid-cols-3 gap-4">
              {/* Achievements */}
              <div className="bg-panel border border-line rounded-[10px] p-4.5">
                <div className="flex items-center justify-between mb-3.5">
                  <span className="text-[12.5px] font-bold tracking-[.08em] uppercase text-muted">Achievements</span>
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                    style={{ background: "rgba(86,166,232,.14)", color: "#8fc6f0" }}>{achPct}%</span>
                </div>
                <div className="text-[30px] font-extrabold tracking-[-0.02em]">
                  {g.ach}<span className="text-[16px] text-dim font-bold">/{g.achTotal}</span>
                </div>
                <div className="h-[7px] rounded-full overflow-hidden my-3" style={{ background: "#223345" }}>
                  <div className="h-full rounded-full" style={{ width: `${achPct}%`, background: "linear-gradient(90deg, #56a6e8, #2c6aa0)" }} />
                </div>
                <div className="flex gap-2">
                  {["🌊", "🗺️", "🔱"].map(e => (
                    <div key={e} className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-[16px]"
                      style={{ background: "#223345", border: "1px solid #26384a" }}>{e}</div>
                  ))}
                  {["🔒", "🔒"].map((e, i) => (
                    <div key={i} className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-[16px] opacity-30 grayscale"
                      style={{ background: "#223345", border: "1px solid #26384a" }}>{e}</div>
                  ))}
                </div>
              </div>

              {/* Cloud saves */}
              <div className="bg-panel border border-line rounded-[10px] p-4.5">
                <div className="flex items-center justify-between mb-3.5">
                  <span className="text-[12.5px] font-bold tracking-[.08em] uppercase text-muted">Cloud saves</span>
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                    style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>Synced</span>
                </div>
                {[
                  { ico: "☁️", title: "Tidewatch — Ch. 4", desc: "Synced 4 min ago · 2.1 MB" },
                  { ico: "💾", title: "Autosave slot",      desc: "Synced 4 min ago" },
                  { ico: "⏱️", title: "Continue · 02:14:33 in", desc: "Resume on any device" },
                ].map(r => (
                  <div key={r.title} className="flex items-center gap-2.5 py-2 border-b border-line last:border-none text-[13px]">
                    <div className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-[13px] shrink-0"
                      style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>{r.ico}</div>
                    <div>
                      <div className="font-semibold">{r.title}</div>
                      <div className="text-[11.5px] text-dim">{r.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Friends */}
              <div className="bg-panel border border-line rounded-[10px] p-4.5">
                <div className="flex items-center justify-between mb-3.5">
                  <span className="text-[12.5px] font-bold tracking-[.08em] uppercase text-muted">Friends who play</span>
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                    style={{ background: "rgba(255,255,255,.06)", color: "#8aa0b4" }}>3</span>
                </div>
                {friends.map(f => (
                  <div key={f.name} className="flex items-center gap-2.5 py-2">
                    <GradArt a={f.a} b={f.b} className="w-[30px] h-[30px] rounded-full shrink-0" />
                    <div>
                      <div className="font-semibold text-[13px]">{f.name}</div>
                      <div className="text-[11.5px] text-dim">{f.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 2-col: news + DLC */}
            <div className="grid gap-4 mt-4 items-start" style={{ gridTemplateColumns: "1fr 360px" }}>
              {/* News */}
              <div className="bg-panel border border-line rounded-[10px]">
                <div className="px-6 py-4 border-b border-line font-bold text-[15px]">Updates & news from the creator</div>
                <div className="px-6 pt-1.5 pb-4">
                  {newsPosts.map(n => (
                    <div key={n.title} className="flex gap-3.5 py-3.5 border-b border-line last:border-none">
                      <GradArt a={n.a} b={n.b} className="w-[120px] h-[68px] rounded-lg shrink-0" />
                      <div>
                        <p className="text-[11px] font-bold text-accent tracking-[.04em] uppercase">{n.tag}</p>
                        <h4 className="text-[14.5px] font-bold mt-0.5 mb-1">{n.title}</h4>
                        <p className="text-[12.5px] text-muted">{n.body}</p>
                        <p className="text-[11.5px] text-dim mt-1.5">{n.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* DLC */}
              <div className="bg-panel border border-line rounded-[10px]">
                <div className="px-6 py-4 border-b border-line font-bold text-[15px]">Add-ons & DLC</div>
                <div className="px-6 pt-2 pb-4">
                  {dlc.map(d => (
                    <div key={d.name} className="flex items-center gap-3 py-2.5 border-b border-line last:border-none">
                      <GradArt a={d.a} b={d.b} className="w-[54px] h-[34px] rounded-md shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[13px]">{d.name}</div>
                        <div className="text-[11.5px] text-dim">{d.desc}</div>
                      </div>
                      <div className="ml-auto shrink-0">
                        {d.owned ? (
                          <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                            style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>Installed</span>
                        ) : (
                          <button className="px-3.5 py-2 rounded-[9px] font-bold text-[13px] cursor-pointer border-none"
                            style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                            {d.price}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
