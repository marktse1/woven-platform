"use client";
import { useState } from "react";
import { useClerk, SignIn } from "@clerk/nextjs";
import Link from "next/link";

function LogoMark() {
  return (
    <div className="w-[30px] h-[30px] rounded-[7px] border border-white/30 shrink-0"
      style={{ background: "repeating-linear-gradient(45deg,rgba(255,255,255,.55) 0 3px,transparent 3px 7px), repeating-linear-gradient(-45deg,rgba(255,255,255,.3) 0 3px,transparent 3px 7px), rgba(255,255,255,.08)" }} />
  );
}

const props = [
  { ico: "☁️", title: "Cloud saves & cross-device", desc: "Pick up exactly where you left off, anywhere you sign in." },
  { ico: "🔑", title: "Play Token protection",       desc: "Games verify a signed token at launch — copied build files won't run." },
  { ico: "▶",  title: "Instant, in-browser",         desc: "Click and play in seconds. Nothing to download." },
];

type Mode = "signin" | "create";
type Step = 1 | 2;

const inputCls = "bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]";

export default function SignInPage() {
  const [mode, setMode]       = useState<Mode>("signin");
  const [step, setStep]       = useState<Step>(1);
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const { redirectToSignIn } = useClerk();

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    // Advance to Play Token step — real Clerk auth wired in next iteration
    setTimeout(() => { setLoading(false); setStep(2); }, 600);
  };

  const handleOAuth = (provider: string) => {
    redirectToSignIn({ redirectUrl: "/" });
  };

  return (
    <div className="grid min-h-screen" style={{ gridTemplateColumns: "minmax(420px, 46%) 1fr" }}>
      {/* Brand panel */}
      <div className="relative overflow-hidden flex flex-col justify-between p-12 text-[#eaf2fa]"
        style={{ background: "linear-gradient(150deg, #1c4a78, #2a2a6a 55%, #5a2a7a)" }}>
        <div className="absolute inset-0" style={{ background: "radial-gradient(60% 50% at 22% 18%, rgba(120,180,255,.5), transparent 60%), radial-gradient(50% 45% at 85% 80%, rgba(180,90,220,.4), transparent 60%)" }} />
        <div className="absolute inset-0 opacity-[.10] mix-blend-overlay" style={{ backgroundImage: "repeating-linear-gradient(135deg,#fff 0 2px,transparent 2px 12px)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,12,17,.25), rgba(8,12,17,.55))" }} />

        <div className="relative z-10 flex items-center gap-2.5 font-extrabold text-[22px]">
          <LogoMark /> Woven
        </div>

        <div className="relative z-10">
          <h1 className="text-[42px] font-extrabold tracking-[-0.03em] leading-[1.04]">
            Play anywhere.<br />Own it everywhere.
          </h1>
          <p className="text-[16px] text-white/75 mt-3.5 max-w-[380px] leading-relaxed">
            One account for every browser game on Woven. No installs, no launchers — your library, saves and friends follow you to any device.
          </p>
          <div className="flex flex-col gap-3.5 mt-7">
            {props.map(p => (
              <div key={p.title} className="flex gap-3 items-start">
                <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[16px] shrink-0"
                  style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)" }}>{p.ico}</div>
                <div>
                  <div className="font-bold text-[14px]">{p.title}</div>
                  <div className="text-[12.5px] text-white/70 mt-0.5">{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-[12px] text-white/50">
          © 2026 Woven · Your purchases are tied to your account, not a machine.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-12" style={{ background: "#0b0f14" }}>
        <div className="w-full max-w-[420px]">

          {/* Step indicator */}
          <div className="flex items-center gap-2.5 mb-7">
            {[{ n: "1", label: "Account" }, { n: "2", label: "Play Token" }].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2.5">
                {i > 0 && (
                  <div className="flex-1 h-0.5 w-[60px] transition-colors"
                    style={{ background: step === 2 ? "#7bc24a" : "#26384a" }} />
                )}
                <div className={`flex items-center gap-2 text-[12.5px] font-bold ${step === i + 1 ? "text-ink" : step > i + 1 ? "text-green" : "text-dim"}`}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[12px]"
                    style={{
                      background: step > i + 1 ? "#7bc24a" : step === i + 1 ? "#56a6e8" : "transparent",
                      border: `1.5px solid ${step > i + 1 ? "#7bc24a" : step === i + 1 ? "#56a6e8" : "#324a61"}`,
                      color: step > i + 1 ? "#0e1a06" : step === i + 1 ? "#06121d" : "#5d738a",
                    }}>
                    {step > i + 1 ? "✓" : s.n}
                  </span>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Step 1 — Auth */}
          {step === 1 && (
            <div>
              <h2 className="text-[25px] font-extrabold tracking-[-0.02em]">
                {mode === "signin" ? "Sign in to play" : "Create your gaming account"}
              </h2>
              <p className="text-muted text-[14px] mt-1.5">
                {mode === "signin" ? "Welcome back. Your library is waiting." : "Free, takes a few seconds — then claim your library."}
              </p>

              {/* Mode tabs */}
              <div className="flex gap-1 bg-panel border border-line rounded-[10px] p-1 mt-5 mb-5">
                {(["signin", "create"] as Mode[]).map(m => (
                  <button key={m} onClick={() => { setMode(m); setError(""); }}
                    className="flex-1 text-center py-2.5 rounded-[7px] text-[13px] font-bold cursor-pointer transition-colors border-none"
                    style={{ background: mode === m ? "#223345" : "transparent", color: mode === m ? "#e7eef4" : "#8aa0b4" }}>
                    {m === "signin" ? "Sign in" : "Create account"}
                  </button>
                ))}
              </div>

              {/* OAuth — use Clerk's component so Google/Apple/Discord actually work */}
              <SignIn
                appearance={{
                  elements: {
                    rootBox: "w-full",
                    card: "bg-transparent shadow-none border-none p-0",
                    header: "hidden",
                    footer: "hidden",
                    formContainer: "hidden",
                    dividerRow: "hidden",
                    socialButtons: "w-full",
                    socialButtonsBlockButton: "bg-[#f8fafc] border border-[#cbd5e1] text-[#0f172a] hover:bg-white rounded-[9px] font-bold text-[13.5px] w-full shadow-[0_1px_0_rgba(255,255,255,.5)_inset]",
                    socialButtonsBlockButtonText: "text-[#0f172a] font-bold",
                    socialButtonsBlockButtonArrow: "hidden",
                    socialButtonsProviderIcon: "brightness-0 saturate-0 opacity-80",
                    internal: "bg-transparent",
                    main: "w-full",
                  },
                  variables: {
                    colorBackground: "transparent",
                    colorText: "#e7eef4",
                    colorPrimary: "#56a6e8",
                    borderRadius: "9px",
                    fontFamily: "Inter, sans-serif",
                  },
                }}
              />

              <div className="flex items-center gap-3 text-dim text-[12px] my-4.5">
                <span className="flex-1 h-px bg-line" />or with email<span className="flex-1 h-px bg-line" />
              </div>

              {mode === "create" && (
                <div className="flex flex-col gap-1.5 mb-4">
                  <label className="text-[13px] font-semibold text-muted">Choose a handle</label>
                  <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@yourname" className={inputCls} />
                </div>
              )}
              <div className="flex flex-col gap-1.5 mb-4">
                <label className="text-[13px] font-semibold text-muted">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5 mb-1.5">
                <label className="flex justify-between text-[13px] font-semibold text-muted">
                  Password
                  {mode === "signin" && <a className="text-accent font-semibold cursor-pointer">Forgot?</a>}
                </label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className={inputCls} />
              </div>

              {error && <p className="text-bad text-[12.5px] mt-2">{error}</p>}

              <button onClick={handleSubmit} disabled={loading || !email || !password}
                className="w-full mt-4 py-4 rounded-[9px] font-bold text-[15px] cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                {loading ? "Please wait…" : mode === "signin" ? "Sign in →" : "Create account →"}
              </button>

              <p className="text-[11.5px] text-dim text-center mt-4 leading-relaxed">
                By continuing you agree to Woven&apos;s <a className="text-muted cursor-pointer">Terms</a> & <a className="text-muted cursor-pointer">Privacy Policy</a>.
              </p>
            </div>
          )}

          {/* Step 2 — Play Token */}
          {step === 2 && (
            <div>
              <h2 className="text-[25px] font-extrabold tracking-[-0.02em]">Authorize this device</h2>
              <p className="text-muted text-[14px] mt-1.5">Set up your Play Token so your games — and only yours — run here.</p>

              <div className="flex gap-3 p-3.5 rounded-[10px] my-4.5 text-[12.5px] text-[#bcdcf3] leading-relaxed"
                style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
                <span className="text-[17px] shrink-0">🔑</span>
                <div>Woven games request a short-lived, signed <strong>Play Token</strong> at launch. It proves the game is licensed to <strong>your account</strong> on an authorized device — so a copied or shared build won&apos;t run without it. Tokens refresh automatically and never leave your device.</div>
              </div>

              {/* Token card */}
              <div className="relative rounded-[13px] border border-line2 p-4.5 overflow-hidden"
                style={{ background: "linear-gradient(140deg, #16314a, #241a3e)", color: "#eaf2fa" }}>
                <div className="absolute inset-0 opacity-[.16]"
                  style={{ backgroundImage: "repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 11px)" }} />
                <div className="relative z-10">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] font-bold tracking-[.12em] uppercase text-white/60">Woven Play Token</span>
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#a6e06a] bg-[rgba(123,194,74,.16)] px-2.5 py-1 rounded-full">✓ Signed</span>
                  </div>
                  <div className="font-mono text-[15px] tracking-[.06em] mt-3.5 text-[#cfe6fb]">WVN·8F2A ···· ···· D41C</div>
                  <div className="flex gap-7 mt-3.5">
                    {[["Account", "@maya_b"], ["Device", "This browser"], ["Renews", "every 24h"]].map(([k, v]) => (
                      <div key={k}>
                        <div className="text-[10.5px] font-bold tracking-[.06em] uppercase text-white/55">{k}</div>
                        <div className="text-[13px] font-semibold mt-0.5">{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Authorized devices */}
              <div className="mt-4">
                <p className="text-[12.5px] font-bold tracking-[.08em] uppercase text-muted mb-1">Authorized devices · 1 of 5</p>
                {[
                  { ico: "💻", name: "This browser",  detail: "just now",      badge: true  },
                ].map(d => (
                  <div key={d.name} className="flex items-center gap-3 py-2.5 border-b border-line last:border-none">
                    <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[15px] bg-panel3 border border-line shrink-0">{d.ico}</div>
                    <div>
                      <div className="font-bold text-[13px]">{d.name}</div>
                      <div className="text-[11.5px] text-dim">{d.detail}</div>
                    </div>
                    {d.badge && <span className="ml-auto text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                      style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>This device</span>}
                  </div>
                ))}
              </div>

              {/* Security toggles */}
              {[
                { label: "Re-verify token on every launch", desc: "Strongest protection. Needs a connection to start a game.", on: true },
                { label: "Allow offline play for 72 hours", desc: "Cache a signed token so you can play without a connection.", on: false },
              ].map(t => (
                <div key={t.label} className="flex items-center gap-3 py-3 border-t border-line">
                  <div className="flex-1">
                    <div className="font-semibold text-[13px]">{t.label}</div>
                    <div className="text-[11.5px] text-dim mt-0.5">{t.desc}</div>
                  </div>
                  <div className="relative w-[42px] h-6 rounded-full border shrink-0 cursor-pointer"
                    style={{ background: t.on ? "rgba(86,166,232,.14)" : "#223345", borderColor: t.on ? "#56a6e8" : "#324a61" }}>
                    <span className="absolute top-[3px] w-[18px] h-[18px] rounded-full transition-[left] duration-150"
                      style={{ left: t.on ? "21px" : "3px", background: t.on ? "#56a6e8" : "#5d738a" }} />
                  </div>
                </div>
              ))}

              <Link href="/library"
                className="flex items-center justify-center w-full mt-4 py-4 rounded-[9px] font-bold text-[15px] no-underline"
                style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}>
                Finish & enter your library →
              </Link>
              <p className="text-center mt-3.5">
                <button onClick={() => setStep(1)} className="text-accent font-semibold text-[12.5px] bg-transparent border-none cursor-pointer">
                  ← Back to account
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
