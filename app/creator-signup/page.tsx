"use client";
import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient } from "@/lib/supabase";

const engineOptions = [
  { label: "Babylon.js", dot: "#bb464b" },
  { label: "three.js", dot: "#cccccc" },
  { label: "PlayCanvas", dot: "#e5732b" },
  { label: "Phaser", dot: "#8e44ad" },
  { label: "Godot (web)", dot: "#478cbf" },
  { label: "Unity (WebGL)", dot: "#aaaaaa" },
  { label: "Bevy / WASM", dot: "#cea05a" },
  { label: "Other", dot: "" },
];

const brandProps = [
  { ico: "$", title: "Keep 88%", desc: "Flat split, Stripe payouts twice a month." },
  { ico: ">", title: "Any engine", desc: "Babylon, three.js, Godot, Unity WebGL..." },
  { ico: "*", title: "Weave Forge, free", desc: "In-browser world editor, forever free." },
  { ico: "o", title: "Multiplayer built-in", desc: "Drop-in WebRTC netcode & voice." },
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

export default function CreatorSignupPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [engines, setEngines] = useState<Set<string>>(new Set(["Babylon.js", "three.js"]));
  const [agreed, setAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "success" | "error">("idle");
  const [submitMessage, setSubmitMessage] = useState("");

  const signedIn = !!user?.id;
  const signInHint = useMemo(() => {
    if (!isLoaded) return "Loading sign-in state...";
    if (signedIn) return "";
    return "Sign in first so Woven can attach the application to your creator account.";
  }, [isLoaded, signedIn]);

  const toggleEngine = (label: string) =>
    setEngines((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState("idle");
    setSubmitMessage("");

    if (!signedIn || !user?.id) {
      setSubmitState("error");
      setSubmitMessage("Sign in first to submit a creator application.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const studio_name = String(form.get("studio_name") ?? "").trim();
    const handle = String(form.get("handle") ?? "").trim();
    if (!studio_name || !handle) {
      setSubmitState("error");
      setSubmitMessage("Studio name and public handle are required.");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setSubmitState("error");
      setSubmitMessage("Missing Supabase environment variables.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase
      .from("creator_profiles")
      .upsert(
        {
          clerk_user_id: user.id,
          studio_name,
          handle,
          status: "pending",
        },
        { onConflict: "clerk_user_id" }
      );
    setSubmitting(false);

    if (error) {
      setSubmitState("error");
      setSubmitMessage(error.message);
      return;
    }

    setSubmitState("success");
    setSubmitMessage("Application submitted. An admin can now approve it in the review console.");
    router.push("/dashboard");
  }

  return (
    <div className="grid min-h-screen" style={{ gridTemplateColumns: "minmax(420px, 46%) 1fr" }}>
      <div
        className="relative overflow-hidden flex flex-col justify-between p-12 text-[#eaf2fa]"
        style={{ background: "linear-gradient(150deg, #123a5e, #1d5a86 50%, #2a3a7a)" }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(58% 50% at 78% 16%, rgba(120,190,255,.5), transparent 60%), radial-gradient(50% 45% at 12% 86%, rgba(90,140,220,.45), transparent 60%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[.10] mix-blend-overlay"
          style={{ backgroundImage: "repeating-linear-gradient(135deg,#fff 0 2px,transparent 2px 12px)" }}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,12,17,.25), rgba(8,12,17,.55))" }} />

        <div className="relative z-10 flex items-center gap-2.5 font-extrabold text-[22px]">
          <LogoMark /> Woven
        </div>

        <div className="relative z-10">
          <p className="text-[12px] font-bold tracking-[.14em] uppercase text-[#9fd0f5] mb-3">Woven for Creators</p>
          <h1 className="text-[42px] font-extrabold tracking-[-0.03em] leading-[1.04]">
            Ship your <em className="not-italic text-[#8fd0ff]">worlds</em> to the browser.
          </h1>
          <p className="text-[16px] text-white/75 mt-3.5 max-w-[390px] leading-relaxed">
            Build in any web engine, publish a playable link, and reach players who actually finish games. Free to list - you keep 88%.
          </p>
          <div className="grid grid-cols-2 gap-4 mt-7 max-w-[430px]">
            {brandProps.map((p) => (
              <div key={p.title} className="flex gap-3 items-start">
                <div
                  className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[16px] shrink-0"
                  style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)" }}
                >
                  {p.ico}
                </div>
                <div>
                  <div className="font-bold text-[14px]">{p.title}</div>
                  <div className="text-[12px] text-white/70 mt-0.5 leading-snug">{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-[12px] text-white/50">Trusted by 4,200+ studios - $14M paid out to creators in 2025.</p>
      </div>

      <div className="flex items-center justify-center p-12" style={{ background: "#0b0f14" }}>
        <form className="w-full max-w-[440px]" onSubmit={handleSubmit}>
          <h2 className="text-[26px] font-extrabold tracking-[-0.02em]">Create your creator account</h2>
          <p className="text-muted text-[14px] mt-1.5">Step 1 of 3 - set up the account. Verification and your first upload come next.</p>

          <div className="grid grid-cols-2 gap-2.5 mt-5 mb-0">
            {[
              { glyph: "G", bg: "#fff", color: "#444", label: "Google" },
              { glyph: "⌥", bg: "#181a1f", color: "#fff", label: "GitHub" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                className="flex items-center justify-center gap-2 py-3 border border-line rounded-[9px] bg-panel2 font-bold text-[13px] cursor-pointer hover:brightness-110 transition-all"
              >
                <span
                  className="w-[18px] h-[18px] rounded-md flex items-center justify-center text-[11px] font-extrabold"
                  style={{ background: o.bg, color: o.color }}
                >
                  {o.glyph}
                </span>
                {o.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-dim text-[12px] my-4.5">
            <span className="flex-1 h-px bg-line" />or with email<span className="flex-1 h-px bg-line" />
          </div>

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

          <div className="flex flex-col gap-1.5 mb-4">
            <label className="text-[13px] font-semibold text-muted">Work email</label>
            <input name="email" type="email" className={inputCls} placeholder="studio@example.com" />
          </div>

          <div className="flex flex-col gap-1.5 mb-4">
            <label className="text-[13px] font-semibold text-muted">Password</label>
            <input name="password" type="password" className={inputCls} placeholder="At least 10 characters" />
          </div>

          <div className="flex flex-col gap-1.5 mb-4">
            <label className="text-[13px] font-semibold text-muted">What do you build with?</label>
            <p className="text-[12px] text-dim">Configures your upload presets and SDK - change anytime.</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {engineOptions.map((e) => {
                const on = engines.has(e.label);
                return (
                  <button
                    key={e.label}
                    type="button"
                    onClick={() => toggleEngine(e.label)}
                    className="inline-flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
                    style={{
                      background: on ? "rgba(86,166,232,.14)" : "#1b2836",
                      borderColor: on ? "#56a6e8" : "#26384a",
                      color: on ? "#cfe6fb" : "#e7eef4",
                    }}
                  >
                    {e.dot ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.dot }} /> : null}
                    {e.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAgreed((v) => !v)}
            className="flex gap-2.5 items-start text-[12.5px] text-muted leading-relaxed mb-4 cursor-pointer bg-transparent border-none text-left w-full"
          >
            <div
              className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center font-extrabold text-[12px] mt-0.5"
              style={{
                background: agreed ? "#56a6e8" : "transparent",
                border: `1.5px solid ${agreed ? "#56a6e8" : "#324a61"}`,
                color: agreed ? "#06121d" : "transparent",
              }}
            >
              ✓
            </div>
            <span>
              I agree to the <a className="text-accent font-semibold cursor-pointer">Creator Terms</a> and{" "}
              <a className="text-accent font-semibold cursor-pointer">Payout Agreement</a>, and confirm I have the rights to publish what I upload.
            </span>
          </button>

          <button
            type="submit"
            disabled={!agreed || submitting || !signedIn}
            className="flex items-center justify-center w-full py-4 rounded-[9px] font-bold text-[15px] no-underline disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}
          >
            {submitting ? "Submitting..." : signedIn ? "Create account and continue" : "Sign in to submit"}
          </button>

          {signInHint ? <div className="text-[12px] text-dim mt-3">{signInHint}</div> : null}
          {submitMessage ? (
            <div className={`text-[12px] mt-3 ${submitState === "error" ? "text-[#e88]" : "text-[#a6e06a]"}`}>
              {submitMessage}
            </div>
          ) : null}

          <div className="flex items-center justify-center gap-2 text-[12px] text-dim mt-3.5">
            Locked identity and tax verification happens later through Stripe Connect.
          </div>

          <div className="flex items-center justify-center gap-2 text-[12px] text-dim mt-3.5">
            Already a creator? <Link href="/dashboard" className="text-accent font-semibold">Go to your dashboard</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
