"use client";
export const dynamic = "force-dynamic";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import CreatorSubNav from "@/components/shell/CreatorSubNav";
import { getSupabaseClient, getSupabaseEnvStatus } from "@/lib/supabase";
import { getAutoApproveCreators } from "@/lib/platformSettings";

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

const benefits = [
  { ico: "💸", title: "Keep 88%", body: "Flat split, no tiers. Payouts via Stripe in 30+ currencies, twice a month." },
  { ico: "🛠️", title: "Weave Forge, free", body: "Our in-browser world editor - terrain, skyboxes, weather - free forever." },
  { ico: "🎮", title: "Any engine", body: "Babylon, three.js, PlayCanvas, Phaser, Godot & Unity WebGL - if it runs in a browser, it runs on Woven." },
  { ico: "🌐", title: "Multiplayer built-in", body: "Drop-in WebRTC netcode & voice. Rooms, matchmaking and relay handled for you." },
];

const timeline = [
  { n: "1", done: true, title: "Apply", desc: "Submit this form - takes about 3 minutes." },
  { n: "2", done: false, title: "Verify identity & tax", desc: "Stripe Connect onboarding so we can pay you." },
  { n: "3", done: false, title: "Review", desc: "A human checks your account - usually about 2 business days." },
  { n: "✓", done: false, title: "Upload & ship", desc: "Unlock uploads, the dashboard, and your first playable link." },
];

function LogoMark() {
  return (
    <div
      className="w-[30px] h-[30px] rounded-[7px] border border-white/30 shrink-0"
      style={{
        background:
          "repeating-linear-gradient(45deg,rgba(255,255,255,.55) 0 3px,transparent 3px 7px), repeating-linear-gradient(-45deg,rgba(255,255,255,.3) 0 3px,transparent 3px 7px), rgba(255,255,255,.08)",
      }}
    />
  );
}

const inputCls =
  "bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]";

export default function BecomeCreatorPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [engines, setEngines] = useState<Set<string>>(new Set(["Babylon.js", "three.js", "PlayCanvas"]));
  const [agreed, setAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "success" | "error">("idle");

  const signedIn = !!user?.id;
  const hint = useMemo(() => {
    if (!isLoaded) return "Loading sign-in state...";
    if (signedIn) return "";
    return "Sign in first. Creator access is attached to your existing Woven account.";
  }, [isLoaded, signedIn]);

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

    if (!signedIn || !user?.id) {
      setState("error");
      setMessage("Sign in first to submit a creator application.");
      return;
    }

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

    const supabase = getSupabaseClient();
    if (!supabase) {
      const env = getSupabaseEnvStatus();
      setState("error");
      setMessage(
        env.missing.length
          ? `Missing Supabase env vars: ${env.missing.join(", ")}.`
          : "Supabase client could not initialize. Check the Woven Vercel env vars."
      );
      return;
    }

    setSubmitting(true);
    const autoApprove = await getAutoApproveCreators();
    const { error } = await supabase
      .from("creator_profiles")
      .upsert(
        {
          clerk_user_id: user.id,
          studio_name,
          handle,
          status: autoApprove ? "approved" : "pending",
          country,
          team_size,
          about,
          links,
          engines: Array.from(engines),
        },
        { onConflict: "clerk_user_id" }
      );
    setSubmitting(false);

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }

    setState("success");
    setMessage(
      autoApprove
        ? "Application approved automatically — creator access is unlocked."
        : "Application saved. A staff reviewer can now approve creator status."
    );
    router.push("/dashboard");
  }

  return (
    <>
      <CreatorSubNav />
      <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
        <section className="grid gap-10 items-center mb-12" style={{ gridTemplateColumns: "1.1fr .9fr" }}>
          <div>
            <p className="text-[12px] font-bold tracking-[.14em] uppercase text-accent mb-3">Woven for Creators</p>
            <h1 className="text-[50px] font-extrabold tracking-[-0.03em] leading-[1.02]">
              Bring your <em className="not-italic text-accent">worlds</em><br />to Woven.
            </h1>
            <p className="text-muted text-[17px] mt-4 mb-6 max-w-[480px]">
              Build in your engine, ship to the browser, and reach players who actually finish games. Free tools, fair revenue, instant playable links.
            </p>
            <div className="flex gap-3">
              <a href="#apply" className="px-6 py-3.5 rounded-[9px] font-bold text-[15px] cursor-pointer border-none no-underline" style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                Apply for creator status
              </a>
              <Link href="/forge" className="px-6 py-3.5 rounded-[9px] font-bold text-[15px] cursor-pointer bg-panel2 border border-line text-ink no-underline">
                Open Weave Forge
              </Link>
            </div>
            <div className="flex gap-8 mt-2">
              {[["88%", "Revenue to you"], ["$0", "To list & to use Weave Forge"], ["~2 days", "Avg. review time"]].map(([n, l]) => (
                <div key={l}>
                  <div className="text-[28px] font-extrabold tracking-[-0.02em]">{n}</div>
                  <div className="text-[12.5px] text-dim mt-0.5">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative h-[300px] rounded-[14px] overflow-hidden">
            <Image src="/creator_hero.png" alt="" fill className="object-contain" priority />
          </div>
        </section>

        <section className="grid grid-cols-4 gap-4 mb-11">
          {benefits.map((b) => (
            <div key={b.title} className="bg-panel border border-line rounded-[10px] p-5">
              <div className="w-[38px] h-[38px] rounded-[9px] flex items-center justify-center text-[18px] mb-3"
                style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>{b.ico}</div>
              <h3 className="text-[16px] font-bold">{b.title}</h3>
              <p className="text-[13px] text-muted mt-1.5">{b.body}</p>
            </div>
          ))}
        </section>

        <div id="apply" className="text-[21px] font-bold tracking-[-0.01em] mb-1">Apply for creator status</div>
        <p className="text-muted text-[15px] mb-5.5">Creator access is a status on your existing Woven account. It is free to use.</p>

        <div className="grid gap-7 items-start" style={{ gridTemplateColumns: "1fr 360px" }}>
          <form className="bg-panel border border-line rounded-[10px] p-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-3.5 mb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-muted">Studio / creator name</label>
                <input name="studio_name" className={inputCls} placeholder="Lantern Few" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-muted">Public handle</label>
                <input name="handle" className={inputCls} placeholder="@lanternfew" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3.5 mb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-muted">Country / region</label>
                <select name="country" className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent transition-all font-[inherit] cursor-pointer">
                  {["United States", "United Kingdom", "Canada", "Germany", "Brazil", "Japan"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-muted">Team size</label>
                <select name="team_size" className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent transition-all font-[inherit] cursor-pointer">
                  {["Just me", "2-5", "6-20", "20+"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-[13px] font-semibold text-muted">About your studio</label>
              <textarea
                name="about"
                rows={3}
                placeholder="What kind of games do you make? What are you working on now?"
                className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit] resize-none"
              />
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-[13px] font-semibold text-muted">Portfolio / links</label>
              <input
                name="links"
                placeholder="itch.io, YouTube, a build link, your site..."
                className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]"
              />
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-[13px] font-semibold text-muted">Which engines do you build with?</label>
              <p className="text-[12px] text-dim">Select all that apply — this configures your upload presets.</p>
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

            <label className="flex items-center gap-2 text-[12px] text-dim mb-4 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={() => setAgreed((v) => !v)} />
              <span>
                I agree to the <a className="text-accent cursor-pointer">Creator Terms</a> and{" "}
                <a className="text-accent cursor-pointer">Payout Agreement</a>.
              </span>
            </label>

            <button
              type="submit"
              disabled={!agreed || submitting || !signedIn}
              className="w-full py-4 rounded-[9px] font-bold text-[15px] cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}
            >
              {submitting ? "Saving..." : signedIn ? "Save creator status" : "Sign in to submit"}
            </button>

            {hint ? <div className="text-[12px] text-dim mt-3">{hint}</div> : null}
            {message ? (
              <div className={`text-[12px] mt-3 ${state === "error" ? "text-[#e88]" : "text-[#a6e06a]"}`}>{message}</div>
            ) : null}

            <div className="flex justify-center items-center gap-1.5 text-[12px] text-dim mt-3">
              🔒 Identity and tax verification happen later through Stripe Connect.
            </div>
          </form>

          <div className="bg-panel border border-line rounded-[10px] p-6">
            <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-4.5">What happens next</p>
            <div className="flex flex-col">
              {timeline.map((step, i) => (
                <div key={step.n} className="flex gap-3.5">
                  <div className="flex flex-col items-center">
                    <div
                      className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                      style={{
                        background: step.done ? "#56a6e8" : "#1b2836",
                        border: `1.5px solid ${step.done ? "#56a6e8" : "#324a61"}`,
                        color: step.done ? "#06121d" : "#8aa0b4",
                      }}
                    >
                      {step.n}
                    </div>
                    {i < timeline.length - 1 && <div className="w-0.5 flex-1 bg-line mt-1 mb-0 min-h-[22px]" />}
                  </div>
                  <div className="pb-5">
                    <div className="font-bold text-[14px]">{step.title}</div>
                    <div className="text-[12.5px] text-dim mt-0.5">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div
              className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3] mt-2"
              style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}
            >
              No game ready yet? You can still apply and start prototyping in Weave Forge today.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
