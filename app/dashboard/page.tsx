"use client";
export const dynamic = "force-dynamic";
import { FormEvent, useEffect, useMemo, useState } from "react";
import CreatorSubNav from "@/components/shell/CreatorSubNav";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient } from "@/lib/supabase";
import RatingBadge from "@/components/RatingBadge";
import type { CreatorProfileRow } from "@/lib/games";

type Project = {
  id: string; name: string; type: string; a: string; b: string;
  status: string; statusClass: string; version: string;
  plays: string; revenue: string; rating: number | null;
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

const engineOptions = [
  { label: "Babylon.js", dot: "#bb464b" },
  { label: "three.js", dot: "#ffffff" },
  { label: "PlayCanvas", dot: "#e5732b" },
  { label: "Phaser", dot: "#8e44ad" },
  { label: "PixiJS", dot: "#e91e63" },
  { label: "Godot (web)", dot: "#478cbf" },
  { label: "Unity (WebGL)", dot: "#cccccc" },
  { label: "Construct", dot: "#00a8e8" },
  { label: "Bevy / WASM", dot: "#cea05a" },
  { label: "Custom WASM", dot: "#7bc24a" },
];

const inputCls =
  "bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]";

function GradArt({ a, b, className = "" }: { a: string; b: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: `linear-gradient(140deg, ${a}, ${b})` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 26% 16%, rgba(255,255,255,.26), transparent 60%)" }} />
      <div className="absolute inset-0 opacity-[.10] mix-blend-overlay" style={{ backgroundImage: "repeating-linear-gradient(135deg,#fff 0 2px,transparent 2px 9px)" }} />
    </div>
  );
}

type StripeConnectStatus = "loading" | "not_started" | "pending" | "active";
type CreatorStatus = "loading" | "none" | "pending" | "approved" | "rejected";

/** Prefilled reapply form for a rejected applicant — same fields/endpoint
 * as app/creator/page.tsx's first-time form (POST /api/creator/apply,
 * which upserts on clerk_user_id and resets status to pending/approved).
 * Kept local to this page rather than shared: the surrounding card/copy
 * differs enough (rejection reason, "resubmit" framing) that extracting
 * a shared component would mostly just be prop plumbing. */
function ReapplyForm({ profile, onSubmitted }: { profile: CreatorProfileRow | null; onSubmitted: () => void }) {
  const [engines, setEngines] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    if (profile?.engines) setEngines(new Set(profile.engines));
  }, [profile]);

  const toggleEngine = (label: string) =>
    setEngines((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("idle");
    setMessage("");

    const form = new FormData(event.currentTarget);
    const studio_name = String(form.get("studio_name") ?? "").trim();
    const handle = String(form.get("handle") ?? "").trim();
    const country = String(form.get("country") ?? "").trim();
    const team_size = String(form.get("team_size") ?? "").trim();
    const about = String(form.get("about") ?? "").trim();
    const links = String(form.get("links") ?? "").trim();

    if (!studio_name || !handle || !about) {
      setState("error");
      setMessage("Studio name, public handle, and studio description are required.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/creator/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studio_name, handle, country, team_size, about, links, engines: Array.from(engines) }),
    });
    const resBody = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setState("error");
      setMessage(resBody.error ?? "Could not resubmit your application.");
      return;
    }

    setState("success");
    setMessage(resBody.autoApprove ? "Approved automatically — reloading…" : "Resubmitted — a staff reviewer will take another look.");
    onSubmitted();
  }

  return (
    <form className="bg-panel border border-line rounded-[10px] p-6" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3.5 mb-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-muted">Studio / creator name</label>
          <input name="studio_name" defaultValue={profile?.studio_name ?? ""} className={inputCls} placeholder="Lantern Few" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-muted">Public handle</label>
          <input name="handle" defaultValue={profile?.handle ?? ""} className={inputCls} placeholder="@lanternfew" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5 mb-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-muted">Country / region</label>
          <select name="country" defaultValue={profile?.country ?? "United States"} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent transition-all font-[inherit] cursor-pointer">
            {["United States", "United Kingdom", "Canada", "Germany", "Brazil", "Japan"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-muted">Team size</label>
          <select name="team_size" defaultValue={profile?.team_size ?? "Just me"} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent transition-all font-[inherit] cursor-pointer">
            {["Just me", "2-5", "6-20", "20+"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-4">
        <label className="text-[13px] font-semibold text-muted">About your studio</label>
        <textarea
          name="about"
          rows={3}
          defaultValue={profile?.about ?? ""}
          placeholder="What kind of games do you make? What are you working on now?"
          className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit] resize-none"
        />
      </div>

      <div className="flex flex-col gap-1.5 mb-4">
        <label className="text-[13px] font-semibold text-muted">Portfolio / links</label>
        <input
          name="links"
          defaultValue={profile?.links ?? ""}
          placeholder="itch.io, YouTube, a build link, your site..."
          className={inputCls}
        />
      </div>

      <div className="flex flex-col gap-1.5 mb-4">
        <label className="text-[13px] font-semibold text-muted">Which engines do you build with?</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {engineOptions.map((engine) => {
            const on = engines.has(engine.label);
            return (
              <button
                key={engine.label}
                type="button"
                onClick={() => toggleEngine(engine.label)}
                className="inline-flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-full border cursor-pointer select-none transition-all"
                style={{
                  background: on ? "rgba(86,166,232,.14)" : "#1b2836",
                  borderColor: on ? "#56a6e8" : "#26384a",
                  color: on ? "#cfe6fb" : "#e7eef4",
                }}
              >
                {engine.dot ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: engine.dot }} /> : null}
                {engine.label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3.5 rounded-[9px] font-bold text-[15px] cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}
      >
        {submitting ? "Resubmitting…" : "Resubmit application"}
      </button>

      {message ? (
        <div className={`text-[12px] mt-3 ${state === "error" ? "text-[#e88]" : "text-[#a6e06a]"}`}>{message}</div>
      ) : null}
    </form>
  );
}

export default function DashboardPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState("All");
  const [creatorStatus, setCreatorStatus] = useState<CreatorStatus>("loading");
  const [profile, setProfile] = useState<CreatorProfileRow | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stripeStatus, setStripeStatus] = useState<StripeConnectStatus>("loading");
  const [stripePendingCents, setStripePendingCents] = useState(0);
  const [stripeConnecting, setStripeConnecting] = useState(false);

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

      const { data: row } = await supabase
        .from("creator_profiles")
        .select("id, studio_name, handle, about, country, team_size, links, engines, banner_url, created_at, status, rejection_note")
        .eq("clerk_user_id", user.id)
        .maybeSingle<CreatorProfileRow & { id: string }>();

      if (!active) return;
      setCreatorStatus(row?.status ?? "none");
      setProfile(row ?? null);

      if (row?.id && row.status === "approved") {
        const { data: games } = await supabase
          .from("games")
          .select("id, title, engine, status, plays, rating, created_at")
          .eq("creator_id", row.id)
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
          rating: g.rating,
        }));
        setProjects(mapped);
      }
    }

    load();
    return () => { active = false; };
  }, [isLoaded, user?.id]);

  // Anyone who hasn't applied at all has nothing to see here.
  useEffect(() => {
    if (creatorStatus === "none") router.replace("/creator");
  }, [creatorStatus, router]);

  // Load Stripe Connect status
  useEffect(() => {
    if (!isLoaded || !user?.id || creatorStatus !== "approved") return;
    fetch("/api/stripe/connect/status")
      .then(r => r.json())
      .then((data: { status: string; pending_cents?: number }) => {
        setStripeStatus(data.status as StripeConnectStatus);
        setStripePendingCents(data.pending_cents ?? 0);
      })
      .catch(() => setStripeStatus("not_started"));
  }, [isLoaded, user?.id, creatorStatus]);

  // On return from Stripe onboarding, trigger pending payout then refresh status
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    if (connect === "success" || connect === "refresh") {
      if (connect === "success") {
        fetch("/api/stripe/connect/payout-pending", { method: "POST" }).catch(() => null);
      }
      fetch("/api/stripe/connect/status")
        .then(r => r.json())
        .then((data: { status: string; pending_cents?: number }) => {
          setStripeStatus(data.status as StripeConnectStatus);
          setStripePendingCents(data.pending_cents ?? 0);
        })
        .catch(() => null);
      // Clean URL without reload
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  async function handleConnectStripe() {
    setStripeConnecting(true);
    try {
      const res = await fetch("/api/stripe/connect/onboard", { method: "POST" });
      const data = await res.json() as { url?: string };
      if (data.url) window.location.href = data.url;
    } finally {
      setStripeConnecting(false);
    }
  }

  const filtered = projects.filter(p => {
    if (activeFilter === "All")       return true;
    if (activeFilter === "Live")      return p.status === "Live";
    if (activeFilter === "In review") return p.status === "In review";
    if (activeFilter === "Drafts")    return p.status === "Draft" || p.status === "Changes requested";
    return true;
  });

  if (creatorStatus === "loading" || creatorStatus === "none") {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center">
        <div className="text-[13px] text-dim">{creatorStatus === "none" ? "Redirecting…" : "Loading…"}</div>
      </main>
    );
  }

  if (creatorStatus === "pending") {
    return (
      <>
        <CreatorSubNav />
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 pt-10 pb-16">
          <div className="flex items-center gap-3.5 mb-6">
            <GradArt a="#2a6aa0" b="#7d4bd0" className="w-[52px] h-[52px] rounded-[13px] shrink-0" />
            <div>
              <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">Developer Dashboard</h1>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[.04em]" style={{ background: "rgba(232,169,58,.16)", color: "#f0c66a" }}>
                Application pending review
              </span>
            </div>
          </div>
          <div className="bg-panel border border-line rounded-[10px] p-6">
            <p className="text-[15px] font-bold mb-2">
              {profile?.studio_name ?? "Your"} application is under review
            </p>
            <p className="text-[13.5px] text-dim leading-relaxed">
              A staff reviewer typically responds in about 2 business days. Once approved, this page unlocks your
              full project dashboard, uploads, and Weave Forge.
            </p>
          </div>
        </div>
      </>
    );
  }

  if (creatorStatus === "rejected") {
    return (
      <>
        <CreatorSubNav />
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 pt-10 pb-16">
          <div className="flex items-center gap-3.5 mb-6">
            <GradArt a="#2a6aa0" b="#7d4bd0" className="w-[52px] h-[52px] rounded-[13px] shrink-0" />
            <div>
              <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">Developer Dashboard</h1>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[.04em]" style={{ background: "rgba(227,92,92,.16)", color: "#e88" }}>
                Application rejected
              </span>
            </div>
          </div>

          {profile?.rejection_note ? (
            <div className="mb-5 p-4 rounded-[10px] border border-[rgba(232,136,136,.35)] bg-[rgba(232,136,136,.06)]">
              <div className="text-[11px] font-bold uppercase tracking-[.1em] text-[#e88] mb-1.5">Why it was rejected</div>
              <div className="text-[13.5px] text-[#f0d4d4] whitespace-pre-wrap">{profile.rejection_note}</div>
            </div>
          ) : null}

          <p className="text-[13.5px] text-dim mb-4">Update your details below and resubmit for another review.</p>
          <ReapplyForm profile={profile} onSubmitted={() => window.location.reload()} />
        </div>
      </>
    );
  }

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
                  style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>Verified creator</span>
                · 80% revenue share · payouts via <strong style={{ color: "#9aa8ff" }}>stripe</strong>
              </div>
            </div>
          </div>
          <div className="flex gap-2.5">
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
                <div className="hidden lg:block">
                  <RatingBadge rating={p.rating} />
                  {p.rating == null && <span className="font-bold text-[14px] text-dim">—</span>}
                </div>
                <div className="text-right">
                  <Link href={`/dashboard/games/${p.id}/edit`} onClick={e => e.stopPropagation()}
                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg no-underline"
                    style={{ background: "rgba(86,166,232,.14)", color: "#8fc6f0", border: "1px solid #2c6aa0" }}>
                    Edit
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar */}
          <aside className="sticky top-4 flex flex-col gap-4">
            {/* Payout / Stripe Connect */}
            {stripeStatus === "active" ? (
              <div className="bg-panel border border-line rounded-[10px] p-5">
                <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-2">Payouts</p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-[#7bc24a]" />
                  <span className="text-[13px] font-semibold text-[#a6e06a]">Stripe connected</span>
                </div>
                {stripePendingCents > 0 && (
                  <div className="text-[12.5px] text-amber-300 mb-3">
                    ${(stripePendingCents / 100).toFixed(2)} in pending earnings transferred to your account.
                  </div>
                )}
                <a
                  href="https://connect.stripe.com/express_login"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12.5px] text-accent font-semibold no-underline hover:underline"
                >
                  Open Stripe dashboard →
                </a>
              </div>
            ) : stripeStatus === "pending" ? (
              <div className="bg-panel border border-line rounded-[10px] p-5">
                <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-2">Stripe onboarding</p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[13px] font-semibold text-amber-300">In progress</span>
                </div>
                <div className="text-[12.5px] text-dim mb-3">Complete your Stripe onboarding to start receiving payouts.</div>
                <button
                  onClick={handleConnectStripe}
                  disabled={stripeConnecting}
                  className="text-[12.5px] text-accent font-semibold cursor-pointer disabled:opacity-50"
                >
                  {stripeConnecting ? "Loading…" : "Resume onboarding →"}
                </button>
              </div>
            ) : (
              <div className="bg-panel border border-line rounded-[10px] p-5">
                <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-2">Payouts</p>
                {stripePendingCents > 0 ? (
                  <>
                    <div className="text-[28px] font-extrabold tracking-[-0.02em] text-amber-300">
                      ${(stripePendingCents / 100).toFixed(2)}
                    </div>
                    <div className="text-[12.5px] text-amber-300/80 mt-0.5 mb-3">pending earnings waiting for you</div>
                  </>
                ) : (
                  <>
                    <div className="text-[32px] font-extrabold tracking-[-0.02em] text-dim">—</div>
                    <div className="text-[12.5px] text-dim mt-0.5 mb-3">Connect Stripe to receive payouts</div>
                  </>
                )}
                <div className="mt-3.5 pt-3.5 border-t border-line">
                  <button
                    onClick={handleConnectStripe}
                    disabled={stripeConnecting}
                    className="w-full py-2 rounded-[9px] text-[13px] font-bold text-white disabled:opacity-50 cursor-pointer transition-opacity"
                    style={{ background: "linear-gradient(180deg, #635bff, #4b44d6)" }}
                  >
                    {stripeConnecting ? "Loading…" : stripePendingCents > 0 ? "Connect Stripe to claim earnings" : "Connect Stripe"}
                  </button>
                </div>
              </div>
            )}

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
