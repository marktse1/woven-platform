"use client";
import CreatorSubNav from "@/components/shell/CreatorSubNav";
import Link from "next/link";

const UPCOMING = [
  {
    icon: "🫧",
    title: "Sculpted Meshes",
    desc: "Game-ready low-poly models with baked maps, created with Mesh Sculptor.",
  },
  {
    icon: "🌈",
    title: "Shader Graphs",
    desc: "Ready-to-drop GLSL shaders for Three.js, Babylon.js, and PlayCanvas, made in Shaderade.",
  },
  {
    icon: "🎨",
    title: "Texture Packs",
    desc: "Albedo, normal, and roughness maps painted in Mesh Painter.",
  },
  {
    icon: "🔻",
    title: "Optimised 3D Assets",
    desc: "Decimated and UV-baked GLBs from Mesh Loom, drop-in ready for any web engine.",
  },
];

export default function MarketplacePage() {
  return (
    <>
      <CreatorSubNav />
      <main className="tool-min-h bg-[#070b11] text-ink">
        <div className="max-w-[860px] mx-auto px-8 pt-14 pb-20">

          {/* Hero */}
          <p className="text-[11px] font-bold tracking-[.14em] uppercase text-accent mb-3">Asset Marketplace</p>
          <h1 className="text-[36px] font-extrabold tracking-[-0.02em] mb-3 leading-tight">
            Buy and sell game-ready assets<br />made in Woven tools.
          </h1>
          <p className="text-[15px] text-muted mb-10 max-w-xl leading-relaxed">
            Creators set their own prices. Buyers get drop-in GLBs, shader graphs, and texture packs
            that work with any web game engine. Launching soon.
          </p>

          {/* Coming soon badge */}
          <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-[10px] border border-[#26384a] bg-[#111820] mb-12">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[13px] font-semibold text-amber-300">In development — we&apos;ll notify you when it opens.</span>
          </div>

          {/* Asset categories */}
          <h2 className="text-[18px] font-bold mb-5">What will be sold here</h2>
          <div className="grid grid-cols-2 gap-4 mb-14">
            {UPCOMING.map((c) => (
              <div key={c.title} className="rounded-[12px] border border-[#26384a] bg-[#111820] p-5">
                <span className="text-2xl mb-3 block">{c.icon}</span>
                <p className="font-bold text-[14px] mb-1">{c.title}</p>
                <p className="text-[12.5px] text-muted leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="rounded-[14px] border border-[#26384a] bg-[#111820] p-7 flex items-center justify-between gap-6">
            <div>
              <p className="font-bold text-[15px] mb-1">Ready to start creating assets?</p>
              <p className="text-[13px] text-muted">Use Mesh Sculptor and Shaderade to build your first assets now.</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link href="/tools/mesh-sculptor" className="px-4 py-2.5 rounded-[9px] bg-[#c47be8] text-white text-[13px] font-bold no-underline">
                Mesh Sculptor
              </Link>
              <Link href="/tools/shaderade" className="px-4 py-2.5 rounded-[9px] bg-[#e8875a] text-[#0e0b08] text-[13px] font-bold no-underline">
                Shaderade
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
