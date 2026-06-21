"use client";
export const dynamic = "force-dynamic";
import { useEffect, useMemo, useState } from "react";
import CreatorSubNav from "@/components/shell/CreatorSubNav";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient } from "@/lib/supabase";

type Project = {
  id: string; name: string; type: string; a: string; b: string;
  status: string; statusClass: string; version: string;
  plays: string; revenue: string; rating: string;
};

const PAL: [string, string][] = [
  ["#2a6aa0", "#7d4bd0"], ["#3a3a6a", "#7d4bd0"], ["#3a6a8a", "#2a9a8a"],
  ["#e0823a", "#c43a6a"], ["#1f9d8a", "#2c5fb0"], ["#b8923a", "#7a4a2a"],
];

function statusToClass(status: string): string {
  if (status === "live")              return "badge-green";
  if (status === "in_review")         return "badge-info";
  if (status === "rejected")          return "badge-warn";
  return "badge-dim";
}

function statusLabel(status: string): string {
  if (status === "live")      return "Live";
  if (status === "in_review") return "In review";
  if (status === "rejected")  return "Changes requested";
  return "Draft";
}

const filters = ["All", "Live", "In review", "Drafts"];

function GradArt({ a, b, className = "" }: { a: string; b: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: `linear-gradient(140deg, ${a}, ${b})` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 26% 16%, rgba(255,255,255,.26), transparent 60%)" }} />
      <div className="absolute inset-0 opacity-[.10] mix-blend-overlay" style={{ backgroundImage: "repeating-linear-gradient(135deg,#fff 0 2px,transparent 2px 9px)" }} />
    </div>
  );
}

export default function DashboardPage() {
  const { user, isLoaded } = useUser();
  const [activeFilter, setActiveFilter] = useState("All");
  const [creatorStatus, setCreatorStatus] = useState<"loading" | "none" | "pending" | "approved" | "rejected">("loading");
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!isLoaded) return;
      if (!user?.id) {
        if (active) setCreatorStatus("none");
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        if (active) setCreatorStatus("none");
        return;
      }

      const { data: profile } = await supabase
        .from("creator_profiles")
        .select("id, status")
        .eq("clerk_user_id", user.id)
        .maybeSingle<{ id: string; status: "pending" | "approved" | "rejected" }>();

      if (!active) return;
      setCreatorStatus(profile?.status ?? "none");

      if (profile?.id) {
        const { data: games } = await supabase
          .from("games")
          .select("id, title, engine, status, plays, rating, created_at")
          .eq("creator_id", profile.id)
          .order("created_at", { ascending: false });

        if (!active) return;
        const mapped: Project[] = (games ?? []).map((g, i) => ({
          id: g.id,
          name: g.title,
          type: g.engine ? `${g.engine} · WebGL` : "WebGL",
          a: PAL[i % PAL.length][0],
          b: PAL[i % PAL.length][1],
          status: statusLabel(g.status),
          statusClass: statusToClass(g.status),
          version: "—",
          plays: g.plays > 0 ? String(g.plays) : "—",
          revenue: "—",
          rating: g.rating != null ? String(g.rating) : "—",
        }));
        setProjects(mapped);
      }
    }

    load();
    return () => { active = false; };
  }, [isLoaded, user?.id]);

  const creatorBadge = useMemo(() => {
    if (creatorStatus === "approved") return { label: "Verified creator", color: "#a6e06a", bg: "rgba(123,194,74,.16)" };
    if (creatorStatus === "pending") return { label: "Creator application pending", color: "#f0c66a", bg: "rgba(232,169,58,.16)" };
    if (creatorStatus === "rejected") return { label: "Creator application rejected", color: "#e88", bg: "rgba(227,92,92,.16)" };
    return { label: "Apply to become a creator", color: "#8fc6f0", bg: "rgba(86,166,232,.14)" };
  }, [creatorStatus]);

  const filtered = projects.filter(p => {
    if (activeFilter === "All")       return true;
    if (activeFilter === "Live")      return p.status === "Live";
    if (activeFilter === "In review") return p.status === "In review";
    if (activeFilter === "Drafts")    return p.status === "Draft" || p.status === "Changes requested";
    return true;
  });

  return (
    <>
      <CreatorSubNav />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-16">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6 mb-5">
          <div className="flex items-center gap-3.5">
            <GradArt a="#2a6aa0" b="#7d4bd0" className="w-[52px] h-[52px] rounded-[13px] shrink-0" />
            <div>
              <h1 className="text-[27px] font-extrabold tracking-[-0.02em]">Developer Dashboard</h1>
              <div className="flex items-center gap-2 text-[13.5px] text-muted mt-0.5">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[.04em]"
                  style={{ background: creatorBadge.bg, color: creatorBadge.color }}>{creatorBadge.label}</span>
                · 88% revenue share · payouts via <strong style={{ color: "#9aa8ff" }}>stripe</strong>
              </div>
            </div>
          </div>
          <div className="flex gap-2.5">
            <Link href="/admin" className="px-5 py-2.5 rounded-[9px] font-bold text-[14px] bg-panel2 border border-line text-ink no-underline">Review applications</Link>
            <Link
              href="/forge"
              className={[
                "px-5 py-2.5 rounded-[9px] font-bold text-[14px] border text-ink no-underline",
                creatorStatus === "approved" ? "bg-panel2 border-line" : "bg-panel2 border-line opacity-60 pointer-events-none",
              ].join(" ")}
            >
              Open Weave Forge
            </Link>
            <Link href="/upload" className="px-5 py-2.5 rounded-[9px] font-bold text-[14px] no-underline"
              style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>＋ New game</Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Revenue · 30 days", value: "—",  delta: "Connect Stripe to see revenue" },
            { label: "Players · 30 days", value: "—",  delta: `${projects.filter(p => p.status === "Live").length} game${projects.filter(p => p.status === "Live").length === 1 ? "" : "s"} live` },
            { label: "Published games",   value: String(projects.filter(p => p.status === "Live").length), delta: `${projects.filter(p => p.status !== "Live").length} in progress or review` },
            { label: "Next payout",       value: "—",  delta: "Connect Stripe to see payouts" },
          ].map(s => (
            <div key={s.label} className="bg-panel border border-line rounded-[10px] px-5 py-4.5">
              <p className="text-[12px] font-bold tracking-[.08em] uppercase text-muted">{s.label}</p>
              <p className="text-[30px] font-extrabold tracking-[-0.02em] mt-2">{s.value}</p>
              <p className="text-[12.5px] text-dim mt-1">{s.delta}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 items-start grid-cols-1 lg:grid-cols-[1fr_340px]">
          {/* Projects table */}
          <div className="bg-panel border border-line rounded-[10px]">
            <div className="flex items-center px-6 py-4 border-b border-line font-bold text-[15px]">
              Your projects
              <span className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[.04em]"
                style={{ background: "rgba(255,255,255,.06)", color: "#8aa0b4" }}>{filtered.length}</span>
              <div className="flex gap-2 ml-auto">
                {filters.map(f => {
                  const on = activeFilter === f;
                  return (
                    <button key={f} onClick={() => setActiveFilter(f)}
                      className="text-[12.5px] px-3 py-1.5 rounded-full border cursor-pointer transition-all"
                      style={{ background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" }}>
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Table head */}
            <div className="grid px-4.5 py-3 text-[11px] font-bold tracking-[.08em] uppercase text-dim border-b border-line grid-cols-[1fr_auto_auto] lg:grid-cols-[1fr_132px_88px_98px_70px_40px]">
              <div>Game</div><div>Status</div><div className="hidden lg:block">Plays</div><div className="hidden lg:block">Revenue</div><div className="hidden lg:block">Rating</div><div />
            </div>

            {/* Rows */}
            {filtered.map(p => (
              <div key={p.name}
                className="grid items-center px-4.5 py-3.5 border-b border-line last:border-none cursor-pointer hover:bg-white/[.025] transition-colors gap-3 grid-cols-[1fr_auto_auto] lg:grid-cols-[1fr_132px_88px_98px_70px_40px]">
                <div className="flex items-center gap-3 min-w-0">
                  <GradArt a={p.a} b={p.b} className="w-[62px] h-10 rounded-[7px] shrink-0" />
                  <div className="min-w-0">
                    <div className="font-bold text-[14.5px] truncate">{p.name}</div>
                    <div className="text-[11.5px] text-dim mt-0.5">{p.type} · {p.version}</div>
                  </div>
                </div>
                <div>
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em] ${
                    p.statusClass === "badge-green" ? "bg-[rgba(123,194,74,.16)] text-[#a6e06a]" :
                    p.statusClass === "badge-info"  ? "bg-[rgba(86,166,232,.14)] text-[#8fc6f0]" :
                    p.statusClass === "badge-warn"  ? "bg-[rgba(232,169,58,.16)] text-[#f0c66a]" :
                    "bg-[rgba(255,255,255,.06)] text-[#8aa0b4]"}`}>
                    {p.status}
                  </span>
                </div>
                <div className={`hidden lg:block font-bold text-[14px] ${p.plays === "—" ? "text-dim" : ""}`}>{p.plays}</div>
                <div className={`hidden lg:block font-bold text-[14px] ${p.revenue === "—" ? "text-dim" : ""}`}>{p.revenue}</div>
                <div className={`hidden lg:block ${p.rating === "—" ? "font-bold text-[14px] text-dim" : "font-bold text-[14px] text-[#f0c66a]"}`}>
                  {p.rating === "—" ? "—" : `★ ${p.rating}`}
                </div>
                <div className="text-right">
                  {p.status === "Live" ? (
                    <Link href="/upload" onClick={e => e.stopPropagation()}
                      className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg no-underline"
                      style={{ background: "rgba(86,166,232,.14)", color: "#8fc6f0", border: "1px solid #2c6aa0" }}>
                      Patch
                    </Link>
                  ) : (
                    <span className="text-dim font-bold">›</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar */}
          <aside className="sticky top-4 flex flex-col gap-4">
            {/* Payout */}
            <div className="bg-panel border border-line rounded-[10px] p-5">
              <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-2">Next payout</p>
              <div className="text-[32px] font-extrabold tracking-[-0.02em] text-dim">—</div>
              <div className="text-[12.5px] text-dim mt-0.5">Connect Stripe to see payouts</div>
              <div className="flex items-center gap-2 text-[12.5px] text-muted mt-3.5 pt-3.5 border-t border-line">
                <strong style={{ color: "#9aa8ff" }}>stripe</strong> not connected
                <a className="text-accent font-semibold ml-auto cursor-pointer">Connect</a>
              </div>
            </div>

            {/* Apply card */}
            <div className="border border-line rounded-[10px] p-5"
              style={{ background: "linear-gradient(155deg, #1b2836, #16202c)" }}>
              <div className="font-extrabold text-[16px] tracking-[-0.01em]">New here? Apply to publish</div>
              <p className="text-[12.5px] text-muted mt-1.5 mb-3.5 leading-relaxed">Bringing another studio or your first game to Woven? Get a creator account — free to list, 88% to you.</p>
              <Link href="/creator"
                className="flex items-center justify-center w-full py-2.5 rounded-[9px] font-bold text-[14px] no-underline mb-2.5"
                style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
              Apply to be a creator
              </Link>
              <Link href="/upload"
                className="flex items-center justify-center w-full py-2.5 rounded-[9px] font-bold text-[14px] no-underline bg-transparent border border-line text-ink">
                Upload a game build
              </Link>
            </div>

            {/* Activity feed */}
            <div className="bg-panel border border-line rounded-[10px]">
              <div className="px-6 py-4 border-b border-line font-bold text-[15px]">Recent activity</div>
              <div className="px-6 py-4 text-dim text-[13px]">No activity yet.</div>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
