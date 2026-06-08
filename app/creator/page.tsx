"use client";
import { useState } from "react";
import CreatorSubNav from "@/components/shell/CreatorSubNav";

const engines = [
  { label: "Babylon.js",    dot: "#bb464b", on: true  },
  { label: "three.js",      dot: "#ffffff", on: true  },
  { label: "PlayCanvas",    dot: "#e5732b", on: true  },
  { label: "Phaser",        dot: "#8e44ad", on: false },
  { label: "PixiJS",        dot: "#e91e63", on: false },
  { label: "Godot (web)",   dot: "#478cbf", on: false },
  { label: "Unity (WebGL)", dot: "#cccccc", on: false },
  { label: "Construct",     dot: "#00a8e8", on: false },
  { label: "Bevy / WASM",   dot: "#cea05a", on: false },
  { label: "Custom WASM",   dot: "#7bc24a", on: false },
];

const benefits = [
  { ico: "💸", title: "Keep 88%",             body: "Flat split, no tiers. Payouts via Stripe in 30+ currencies, twice a month." },
  { ico: "🛠️", title: "Weave Forge, free",    body: "Our in-browser world editor — terrain, skyboxes, weather — free forever." },
  { ico: "🎮", title: "Any engine",            body: "Babylon, three.js, PlayCanvas, Phaser, Godot & Unity WebGL — if it runs in a browser, it runs on Woven." },
  { ico: "🌐", title: "Multiplayer built-in",  body: "Drop-in WebRTC netcode & voice. Rooms, matchmaking and relay handled for you." },
];

const timeline = [
  { n: "1", done: true,  title: "Apply",                   desc: "Submit this form — takes ~3 minutes." },
  { n: "2", done: false, title: "Verify identity & tax",   desc: "Stripe Connect onboarding so we can pay you." },
  { n: "3", done: false, title: "Review",                  desc: "A human checks your account — usually ~2 business days." },
  { n: "✓", done: false, title: "Upload & ship",           desc: "Unlock uploads, the dashboard, and your first playable link." },
];

export default function BecomeCreatorPage() {
  const [selectedEngines, setSelectedEngines] = useState<Set<string>>(new Set(["Babylon.js", "three.js", "PlayCanvas"]));

  const toggleEngine = (label: string) =>
    setSelectedEngines(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  return (
    <>
      <CreatorSubNav />
      <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
        {/* Hero */}
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
              <button className="px-6 py-3.5 rounded-[9px] font-bold text-[15px] cursor-pointer border-none"
                style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                Apply for a creator account
              </button>
              <button className="px-6 py-3.5 rounded-[9px] font-bold text-[15px] cursor-pointer bg-panel2 border border-line text-ink">
                Read the docs
              </button>
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
          <div className="relative h-[300px] rounded-[14px] border border-line overflow-hidden"
            style={{ background: "linear-gradient(140deg, #2a6aa0, #7d4bd0)" }}>
            <div className="absolute inset-0 opacity-[.12] mix-blend-overlay"
              style={{ backgroundImage: "repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 10px)" }} />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[12px] text-white/85 bg-black/35 px-2.5 py-1.5 rounded-[7px] whitespace-nowrap">
              creator hero · drop art here
            </span>
          </div>
        </section>

        {/* Benefits */}
        <section className="grid grid-cols-4 gap-4 mb-11">
          {benefits.map(b => (
            <div key={b.title} className="bg-panel border border-line rounded-[10px] p-5">
              <div className="w-[38px] h-[38px] rounded-[9px] flex items-center justify-center text-[18px] mb-3"
                style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>{b.ico}</div>
              <h3 className="text-[16px] font-bold">{b.title}</h3>
              <p className="text-[13px] text-muted mt-1.5">{b.body}</p>
            </div>
          ))}
        </section>

        {/* Apply section */}
        <div className="text-[21px] font-bold tracking-[-0.01em] mb-1">Apply for a creator account</div>
        <p className="text-muted text-[15px] mb-5.5">Tell us about you and what you build. Approval unlocks uploads, payouts, and the developer dashboard.</p>

        <div className="grid gap-7 items-start" style={{ gridTemplateColumns: "1fr 360px" }}>
          {/* Form */}
          <div className="bg-panel border border-line rounded-[10px] p-6">
            <div className="grid grid-cols-2 gap-3.5 mb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-muted">Studio / creator name</label>
                <input className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]" placeholder="Lantern Few" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-muted">Public handle</label>
                <input className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]" placeholder="@lanternfew" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3.5 mb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-muted">Country / region</label>
                <select className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent transition-all font-[inherit] cursor-pointer">
                  {["United States", "United Kingdom", "Canada", "Germany", "Brazil", "Japan"].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-muted">Team size</label>
                <select className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent transition-all font-[inherit] cursor-pointer">
                  {["Just me", "2–5", "6–20", "20+"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-[13px] font-semibold text-muted">About your studio</label>
              <textarea rows={3} placeholder="What kind of games do you make? What are you working on now?"
                className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit] resize-none" />
            </div>
            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-[13px] font-semibold text-muted">Portfolio / links</label>
              <input placeholder="itch.io, YouTube, a build link, your site…"
                className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]" />
            </div>
            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-[13px] font-semibold text-muted">Which engines do you build with?</label>
              <p className="text-[12px] text-dim">Select all that apply — this configures your upload presets & SDK.</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {engines.map(e => {
                  const on = selectedEngines.has(e.label);
                  return (
                    <button key={e.label} onClick={() => toggleEngine(e.label)}
                      className="inline-flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-full border cursor-pointer select-none transition-all"
                      style={{
                        background: on ? "rgba(86,166,232,.14)" : "#1b2836",
                        borderColor: on ? "#56a6e8" : "#26384a",
                        color: on ? "#cfe6fb" : "#e7eef4",
                      }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.dot }} />
                      {e.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-dim mb-4 cursor-pointer">
              <input type="checkbox" />
              <span>I agree to the <a className="text-accent cursor-pointer">Creator Terms</a> and <a className="text-accent cursor-pointer">Payout Agreement</a>.</span>
            </label>
            <button className="w-full py-4 rounded-[9px] font-bold text-[15px] cursor-pointer border-none"
              style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
              Submit application
            </button>
            <div className="flex justify-center items-center gap-1.5 text-[12px] text-dim mt-3">
              🔒 Identity & tax verification handled securely by <strong style={{ color: "#9aa8ff" }}>stripe</strong> after approval.
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-panel border border-line rounded-[10px] p-6">
            <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-4.5">What happens next</p>
            <div className="flex flex-col">
              {timeline.map((step, i) => (
                <div key={step.n} className="flex gap-3.5">
                  <div className="flex flex-col items-center">
                    <div className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                      style={{
                        background: step.done ? "#56a6e8" : "#1b2836",
                        border: `1.5px solid ${step.done ? "#56a6e8" : "#324a61"}`,
                        color: step.done ? "#06121d" : "#8aa0b4",
                      }}>{step.n}</div>
                    {i < timeline.length - 1 && <div className="w-0.5 flex-1 bg-line mt-1 mb-0 min-h-[22px]" />}
                  </div>
                  <div className="pb-5">
                    <div className="font-bold text-[14px]">{step.title}</div>
                    <div className="text-[12.5px] text-dim mt-0.5">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3] mt-2"
              style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
              No game ready yet? You can still apply and start prototyping in Weave Forge today.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
