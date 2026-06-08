"use client";
import StoreSubNav from "@/components/shell/StoreSubNav";

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

const railGames = [
  { name: "Skybound Drifters", genre: "Co-op Roguelike",    price: "$9.99",  free: false, active: true  },
  { name: "Paper Kingdoms",    genre: "Cozy Strategy",      price: "◆ Pass", free: true,  active: false },
  { name: "Static Bloom",      genre: "Atmospheric Puzzle", price: "$4.99",  free: false, active: false },
  { name: "Foxfire",           genre: "Pixel Action",       price: "$12.99", free: false, active: false },
  { name: "Mossgrove",         genre: "Relaxing Sim",       price: "◆ Pass", free: true,  active: false },
  { name: "Neon Garden",       genre: "Rhythm Arcade",      price: "$7.99",  free: false, active: false },
];

const specials = [
  { name: "Cogwork City", genre: "Sandbox Builder",   disc: "−40%", orig: "$14.99", price: "$8.99",  free: false },
  { name: "Driftwood",    genre: "Adventure",          disc: "−25%", orig: "$14.99", price: "$11.24", free: false },
  { name: "Lumen",        genre: "Puzzle Platformer",  disc: "",     orig: "",       price: "",       free: true  },
  { name: "Tangle",       genre: "Co-op Party",        disc: "−50%", orig: "$9.99",  price: "$4.99",  free: false },
  { name: "Saltmarsh",    genre: "Survival Craft",     disc: "−30%", orig: "$19.99", price: "$13.99", free: false },
];

const categories = ["Cozy", "Roguelike", "Made in Weave Forge", "Multiplayer", "Atmospheric", "Free on Pass"];

export default function StorePage() {
  return (
    <>
      <StoreSubNav />
      <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
        {/* Featured */}
        <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">Featured & Recommended</p>
        <section className="grid gap-4" style={{ gridTemplateColumns: "1fr 320px" }}>
          <GradArt pair={pal[0]} className="rounded-lg border border-line min-h-[440px]">
            <span className="absolute left-3.5 top-3 font-mono text-[11px] text-white bg-black/40 px-2 py-1 rounded-md z-10">
              banner art · 16:9
            </span>
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(5,8,11,.92))" }} />
            <div className="absolute left-6 right-6 bottom-5 flex items-end justify-between gap-5 z-10">
              <div>
                <h2 className="text-[34px] font-extrabold tracking-[-0.02em]">Hollow Tide</h2>
                <p className="text-[#c2d2e0] text-sm mt-1.5 max-w-[420px]">
                  Drift through a sunken city that rebuilds itself with every tide. A hand-painted exploration game about memory and currents.
                </p>
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {["Exploration", "Atmospheric", "Browser-native", "Controller"].map(tag => (
                    <span key={tag} className="text-xs bg-white/10 px-2.5 py-1 rounded-md">{tag}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center shrink-0 rounded-lg overflow-hidden">
                <div className="flex flex-col items-center leading-none px-3 py-3" style={{ background: "#2c6aa0", color: "#cfeaff" }}>
                  <span className="text-[10px] font-semibold opacity-85 mb-0.5">−25%</span>
                  <span className="text-lg font-extrabold">SALE</span>
                </div>
                <div className="flex flex-col justify-center px-3 py-2" style={{ background: "rgba(0,0,0,.45)" }}>
                  <span className="text-[11px] text-dim line-through">$15.99</span>
                  <span className="text-[17px] font-bold">$11.99</span>
                </div>
                <button className="self-stretch px-5 font-extrabold text-[14px] cursor-pointer border-none"
                  style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}>
                  Add to cart
                </button>
              </div>
            </div>
          </GradArt>

          <div className="flex flex-col gap-2">
            {railGames.map((g, i) => (
              <div key={g.name}
                className={`flex gap-2.5 p-2 rounded-[7px] cursor-pointer items-center border transition-colors ${g.active ? "bg-panel2 border-line" : "bg-panel border-transparent hover:bg-panel2 hover:border-line"}`}>
                <GradArt pair={pal[(i + 1) % pal.length]} className="w-[88px] h-12 rounded-md shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{g.name}</div>
                  <div className="text-[11px] text-dim mt-0.5">{g.genre}</div>
                </div>
                <div className={`text-[13px] font-bold ${g.free ? "text-accent text-[11px]" : ""}`}>{g.price}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Special Offers */}
        <section className="mt-10">
          <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">Special Offers</p>
          <div className="grid grid-cols-5 gap-3.5">
            {specials.map((s, i) => (
              <div key={s.name}
                className="bg-panel border border-line rounded-lg overflow-hidden cursor-pointer transition-[transform,box-shadow] hover:-translate-y-[3px] hover:shadow-[0_12px_30px_rgba(0,0,0,.5)]">
                <GradArt pair={pal[(i + 2) % pal.length]} className="h-[130px]" />
                <div className="px-3 pt-2.5 pb-3">
                  <div className="text-[14px] font-semibold truncate">{s.name}</div>
                  <div className="text-[11px] text-dim mt-1 mb-2.5">{s.genre}</div>
                  <div className="flex items-center justify-end gap-2">
                    {s.free ? (
                      <span className="text-accent font-bold text-[12px]">◆ Free on Pass</span>
                    ) : (
                      <>
                        <span className="text-[12px] font-extrabold px-1.5 py-0.5 rounded"
                          style={{ background: "#2c6aa0", color: "#cfeaff" }}>{s.disc}</span>
                        <span className="text-[13px] font-bold">
                          <span className="block text-right text-[10px] text-dim line-through">{s.orig}</span>
                          {s.price}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Categories */}
        <section className="mt-10">
          <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">Browse by Category</p>
          <div className="grid grid-cols-6 gap-3">
            {categories.map((cat, i) => (
              <div key={cat} className="relative h-[84px] rounded-lg overflow-hidden flex items-end p-3 font-bold text-[14px] cursor-pointer border border-line">
                <GradArt pair={pal[(i + 3) % pal.length]} className="absolute inset-0 opacity-85" />
                <span className="relative z-10">{cat}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Woven Pass Banner */}
        <section className="mt-10 border border-accent2 rounded-[10px] px-6 py-5 flex items-center gap-4"
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
