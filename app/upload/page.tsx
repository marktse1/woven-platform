"use client";
import { useState, useEffect } from "react";
import CreatorSubNav from "@/components/shell/CreatorSubNav";

const STEPS = [
  { title: "Build & engine", sub: "Files uploaded"  },
  { title: "Store page",     sub: "Art, copy, tags"  },
  { title: "Pricing",        sub: "Price & Pass"     },
  { title: "Multiplayer",    sub: "RTC & netcode"    },
  { title: "Review & submit",sub: "Final checks"     },
];

const files = [
  { ico: "📄", name: "index.html",                size: "2 KB",     pct: 100 },
  { ico: "🧩", name: "playcanvas-stable.min.js",  size: "1.4 MB",   pct: 100 },
  { ico: "🎮", name: "config.json",               size: "8 KB",     pct: 100 },
  { ico: "🗺️", name: "scenes/hollow-tide.json",   size: "640 KB",   pct: 100 },
  { ico: "🖼️", name: "assets/atlas_01.png",       size: "3.1 MB",   pct: 100 },
  { ico: "🖼️", name: "assets/atlas_02.png",       size: "3.4 MB",   pct:  72 },
  { ico: "🔊", name: "audio/ambient_tide.ogg",    size: "2.2 MB",   pct:  40 },
  { ico: "🧱", name: "assets/terrain.bin",        size: "5.8 MB",   pct: 100 },
  { ico: "✨", name: "assets/weather_fx.json",    size: "120 KB",   pct: 100 },
];

const engineOptions = [
  { label: "PlayCanvas",   dot: "#e5732b", selected: true  },
  { label: "Babylon.js",   dot: "#bb464b", selected: false },
  { label: "three.js",     dot: "#ffffff", selected: false },
  { label: "Phaser",       dot: "#8e44ad", selected: false },
  { label: "Godot web",    dot: "#478cbf", selected: false },
  { label: "Unity WebGL",  dot: "#cccccc", selected: false },
  { label: "Custom",       dot: "#7bc24a", selected: false },
];

const tags = ["Exploration", "Atmospheric", "Singleplayer", "Hand-painted", "Cozy", "Underwater", "Story-rich"];
const shotPalettes: [string, string][] = [["#3a7fc4","#7d4bd0"], ["#2aa6c4","#15527a"], ["#5cb85c","#1e7a4a"]];

function inputCls(width = "w-full") {
  return `bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] ${width} outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-3">{children}</p>;
}

function Setting({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-line last:border-none">
      <div>
        <div className="text-[13.5px] font-semibold">{label}</div>
        {sub && <div className="text-[12px] text-dim">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button onClick={() => setOn(v => !v)}
      className="relative w-[42px] h-6 rounded-full border shrink-0 cursor-pointer transition-colors"
      style={{ background: on ? "#56a6e8" : "#223345", borderColor: on ? "#56a6e8" : "#324a61" }}>
      <span className="absolute top-[3px] w-[18px] h-[18px] rounded-full transition-[left] duration-150"
        style={{ left: on ? "21px" : "3px", background: on ? "#06121d" : "#cfd8e0" }} />
    </button>
  );
}

function Seg({ options, defaultIndex = 0 }: { options: string[]; defaultIndex?: number }) {
  const [active, setActive] = useState(defaultIndex);
  return (
    <div className="flex border border-line rounded-lg overflow-hidden">
      {options.map((o, i) => (
        <button key={o} onClick={() => setActive(i)}
          className="px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer transition-colors"
          style={{ background: i === active ? "#56a6e8" : "transparent", color: i === active ? "#06121d" : "#8aa0b4" }}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Step1() {
  const [barW, setBarW] = useState(0);
  const [engine, setEngine] = useState("PlayCanvas");

  useEffect(() => { requestAnimationFrame(() => setBarW(100)); }, []);

  return (
    <div>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <div className="flex items-center gap-4.5 p-6 rounded-xl border"
          style={{ border: "1.5px solid rgba(123,194,74,.4)", background: "rgba(123,194,74,.06)" }}>
          <div className="w-[52px] h-[52px] rounded-xl flex items-center justify-center text-[24px] shrink-0 text-[#a6e06a]"
            style={{ background: "rgba(123,194,74,.16)", border: "1px solid rgba(123,194,74,.4)" }}>✓</div>
          <div className="flex-1">
            <div className="font-bold">hollow-tide-build-v0.3.zip
              <span className="ml-1.5 text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>uploaded</span>
            </div>
            <div className="text-[12.5px] text-dim mt-0.5">42.4 MB · 41 files · uploaded just now</div>
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#223345" }}>
              <div className="h-full rounded-full transition-[width] duration-[1200ms] ease-out"
                style={{ width: `${barW}%`, background: "linear-gradient(90deg, #56a6e8, #7bd0ff)" }} />
            </div>
          </div>
          <button className="px-3.5 py-2 rounded-[9px] font-bold text-[14px] cursor-pointer bg-transparent border border-line text-ink">Replace build</button>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-dim mt-3">
          🔒 Or push from your terminal: <span className="font-mono text-muted">npx woven deploy ./dist</span> · also supports drag-drop & GitHub.
        </div>
      </div>

      <div className="grid gap-5.5 mt-5.5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
        {/* Files */}
        <div className="bg-panel border border-line rounded-[10px] p-6">
          <SectionLabel>Files</SectionLabel>
          <div className="flex flex-col">
            {files.map(f => (
              <div key={f.name} className="flex items-center gap-3 py-2.5 border-b border-line text-[13px] last:border-none">
                <span className="w-6 text-center text-dim">{f.ico}</span>
                <span className="flex-1 font-mono text-[12.5px]">{f.name}</span>
                <span className="text-dim text-[12px] w-16 text-right">{f.size}</span>
                {f.pct >= 100 ? (
                  <span className="text-green">✓</span>
                ) : (
                  <div className="w-[90px] h-[5px] rounded bg-panel3 overflow-hidden">
                    <div className="h-full bg-accent rounded" style={{ width: `${f.pct}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right col */}
        <div className="flex flex-col gap-5">
          {/* Engine detected */}
          <div className="bg-panel border border-line rounded-[10px] p-6">
            <SectionLabel>Engine detected</SectionLabel>
            <div className="flex items-center gap-3.5 p-4 rounded-[10px]"
              style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
              <div className="w-11 h-11 rounded-[10px] flex items-center justify-center font-extrabold text-white text-[13px] shrink-0"
                style={{ background: "#e5732b" }}>PC</div>
              <div className="flex-1">
                <div className="font-bold text-[15px]">PlayCanvas</div>
                <div className="text-[12px] text-dim">from <span className="font-mono">playcanvas-stable.min.js</span> · 98% match</div>
              </div>
              <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                style={{ background: "rgba(86,166,232,.14)", color: "#8fc6f0" }}>auto</span>
            </div>
            <p className="text-[12.5px] text-muted mt-3 mb-1.5">Wrong? Pick your engine:</p>
            <div className="flex flex-wrap gap-2">
              {engineOptions.map(e => {
                const on = engine === e.label;
                return (
                  <button key={e.label} onClick={() => setEngine(e.label)}
                    className="inline-flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
                    style={{ background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.dot }} />
                    {e.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Runtime */}
          <div className="bg-panel border border-line rounded-[10px] p-6">
            <SectionLabel>Runtime</SectionLabel>
            <Setting label="Entry file" sub="HTML loaded in the player iframe">
              <select className="bg-[#0a0e13] border border-line rounded-lg px-3 py-1.5 text-ink text-[13px] w-[140px] outline-none font-[inherit] cursor-pointer">
                <option>index.html</option><option>game.html</option>
              </select>
            </Setting>
            <Setting label="Graphics API"><Seg options={["WebGL2", "Auto", "WebGPU"]} defaultIndex={1} /></Setting>
            <Setting label="Aspect"><Seg options={["16:9", "Fit", "Free"]} defaultIndex={0} /></Setting>
            <Setting label="Mobile / touch support"><Toggle defaultOn /></Setting>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step2() {
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set(tags.slice(0, 4)));
  return (
    <div className="grid gap-5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <div className="flex flex-col gap-1.5 mb-4"><label className="text-[13px] font-semibold text-muted">Title</label><input className={inputCls()} defaultValue="Hollow Tide" /></div>
        <div className="flex flex-col gap-1.5 mb-4"><label className="text-[13px] font-semibold text-muted">Tagline</label><input className={inputCls()} defaultValue="A sunken city that rebuilds itself with every tide." /></div>
        <div className="flex flex-col gap-1.5 mb-4"><label className="text-[13px] font-semibold text-muted">Description</label><textarea rows={5} className={`${inputCls()} resize-none`} defaultValue="Drift through a hand-painted underwater city in this quiet exploration game about memory and currents…" /></div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-muted">Genre & tags</label>
          <div className="flex flex-wrap gap-2">
            {tags.map(t => {
              const on = activeTags.has(t);
              return (
                <button key={t} onClick={() => setActiveTags(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; })}
                  className="inline-flex items-center text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
                  style={{ background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" }}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <div className="bg-panel border border-line rounded-[10px] p-6">
          <SectionLabel>Capsule art</SectionLabel>
          <div className="h-[150px] rounded-lg border border-dashed border-line2 flex items-center justify-center text-dim text-[12px] cursor-pointer relative overflow-hidden">
            <span className="font-mono text-[12px] text-white/85 bg-black/35 px-2.5 py-1.5 rounded-[7px]">capsule · 3:4 · drop image</span>
          </div>
          <p className="text-[12px] text-dim mt-2">Shown on the store grid & library. 600×900 PNG.</p>
        </div>
        <div className="bg-panel border border-line rounded-[10px] p-6">
          <SectionLabel>Screenshots</SectionLabel>
          <div className="grid grid-cols-4 gap-3">
            {shotPalettes.map(([a, b], i) => (
              <div key={i} className="h-24 rounded-lg overflow-hidden" style={{ background: `linear-gradient(140deg, ${a}, ${b})`, border: "1px solid #26384a" }} />
            ))}
            <div className="h-24 rounded-lg border border-dashed border-line2 flex items-center justify-center text-dim text-[12px] cursor-pointer">+ add</div>
          </div>
        </div>
        <div className="bg-panel border border-line rounded-[10px] p-6">
          <SectionLabel>Gameplay trailer</SectionLabel>
          <div className="h-[110px] rounded-lg border border-dashed border-line2 flex items-center justify-center text-dim text-[12px] cursor-pointer mb-3">
            <span className="font-mono text-[12px] text-white/85 bg-black/35 px-2.5 py-1.5 rounded-[7px]">drop video file · mp4 / webm</span>
          </div>
          <p className="text-[11.5px] text-dim mb-2">Or paste a YouTube / Vimeo URL:</p>
          <input className={inputCls()} placeholder="https://youtube.com/watch?v=…" />
          <p className="text-[11.5px] text-dim mt-2">Shown at the top of your store page. 16:9, max 3 min.</p>
        </div>
      </div>
    </div>
  );
}

function Step3() {
  return (
    <div className="grid gap-5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>How is it sold?</SectionLabel>
        <Setting label="One-time purchase" sub="Players buy once, own forever"><Toggle defaultOn /></Setting>
        <div className="my-4">
          <label className="text-[13px] font-semibold text-muted block mb-1.5">Base price (USD)</label>
          <input className={inputCls("w-[160px]")} defaultValue="$15.99" />
          <p className="text-[12px] text-dim mt-1.5">Woven keeps 12%. You earn <strong className="text-green">$14.07</strong> per sale.</p>
        </div>
        <div className="h-px bg-line my-4" />
        <Setting label="Include in Woven Pass" sub="Subscribers play free; you're paid per hour played"><Toggle defaultOn /></Setting>
        <Setting label="Regional pricing" sub="Auto-adjust for 40+ regions (recommended)"><Toggle defaultOn /></Setting>
      </div>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>Estimated payout</SectionLabel>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Per sale (88%)</span><span className="font-semibold text-green">$14.07</span></div>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Pass · per hour played</span><span className="font-semibold">~$0.04</span></div>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Payout method</span><span className="font-semibold">Stripe · ••4421</span></div>
        <div className="h-px bg-line my-4" />
        <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3]"
          style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
          Set up regional & launch-discount pricing later from the dashboard.
        </div>
      </div>
    </div>
  );
}

function Step4() {
  return (
    <div className="grid gap-5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <Setting label="Enable multiplayer (Weave Net)" sub="Drop-in WebRTC netcode, rooms & relay"><Toggle defaultOn /></Setting>
        <Setting label="Voice chat" sub="Spatial WebRTC audio in rooms"><Toggle defaultOn /></Setting>
        <div className="my-4">
          <label className="text-[13px] font-semibold text-muted block mb-1.5">Max players per room</label>
          <input className={inputCls("w-[120px]")} defaultValue="8" />
        </div>
        <div className="h-px bg-line my-4" />
        <Setting label="Topology"><Seg options={["P2P mesh", "Relay (SFU)", "Authoritative"]} /></Setting>
        <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3] mt-3.5"
          style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
          See the <a className="text-accent cursor-pointer ml-0.5 mr-0.5">Multiplayer</a> tab for the SDK, signaling & TURN setup.
        </div>
      </div>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>Connection preview</SectionLabel>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Signaling</span>
          <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
            style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>Weave Net · auto</span>
        </div>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">STUN / TURN</span><span className="font-semibold">Hosted · 14 regions</span></div>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Est. p2p latency</span><span className="font-semibold">18–40 ms</span></div>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Fallback</span><span className="font-semibold">TURN relay</span></div>
      </div>
    </div>
  );
}

const checklist = [
  { ok: true,  text: "Build uploaded & sandbox-scanned (41 files, 42.4 MB)" },
  { ok: true,  text: "Engine detected — PlayCanvas, entry index.html" },
  { ok: true,  text: "Store page: title, description, tags" },
  { ok: false, text: "Capsule art & 1 of 4 screenshots still placeholder" },
  { ok: true,  text: "Pricing & Stripe payout configured" },
  { ok: true,  text: "Multiplayer: Weave Net, 8 players, voice on" },
  { ok: true,  text: "Content rating questionnaire complete" },
];

function Step5() {
  return (
    <div className="grid gap-5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>Pre-submission checklist</SectionLabel>
        <div>
          {checklist.map((c, i) => (
            <div key={i} className="flex items-center gap-2.5 py-2.5 border-b border-line last:border-none text-[14px]">
              <div className="w-5 h-5 rounded-md flex items-center justify-center text-[12px] shrink-0"
                style={{
                  background: c.ok ? "rgba(123,194,74,.16)" : "rgba(232,169,58,.16)",
                  color: c.ok ? "#a6e06a" : "#f0c66a",
                }}>{c.ok ? "✓" : "!"}</div>
              {c.text}
            </div>
          ))}
        </div>
      </div>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>Review & timeline</SectionLabel>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Visibility on approval</span><span className="font-semibold">Public</span></div>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Est. review time</span><span className="font-semibold">~2 business days</span></div>
        <div className="h-px bg-line my-4" />
        <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3]"
          style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
          A reviewer plays your build, checks it loads & runs, and verifies the store page. You'll get notified at each stage.
        </div>
        <button className="w-full mt-4 py-4 rounded-[9px] font-bold text-[15px] cursor-pointer border-none"
          style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
          Submit for review
        </button>
        <div className="flex justify-center text-[12px] text-dim mt-2.5">
          You can keep editing the draft until a reviewer picks it up.
        </div>
      </div>
    </div>
  );
}

const PANE_COMPONENTS = [Step1, Step2, Step3, Step4, Step5];

export default function UploadPage() {
  const [current, setCurrent] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  const goTo = (i: number) => { setCurrent(i); window.scrollTo({ top: 0 }); };
  const next = () => { setCompleted(prev => new Set([...prev, current])); goTo(Math.min(current + 1, 4)); };
  const back = () => goTo(Math.max(current - 1, 0));

  const Pane = PANE_COMPONENTS[current];

  return (
    <>
      <CreatorSubNav />
      <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-[12px] font-bold tracking-[.14em] uppercase text-accent">New submission</p>
            <h1 className="text-[30px] font-extrabold tracking-[-0.02em] mt-1.5">Upload &ldquo;Hollow Tide&rdquo;</h1>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-1.5 rounded-full uppercase tracking-[.04em]"
            style={{ background: "rgba(255,255,255,.06)", color: "#8aa0b4" }}>Draft · autosaved 12s ago</span>
        </div>

        <div className="grid gap-7 items-start" style={{ gridTemplateColumns: "230px 1fr" }}>
          {/* Stepper */}
          <div className="sticky top-4 flex flex-col gap-1">
            {STEPS.map((s, i) => {
              const isDone = completed.has(i);
              const isOn = i === current;
              return (
                <button key={i} onClick={() => goTo(i)}
                  className="flex gap-3 p-3 rounded-[10px] cursor-pointer text-left transition-colors hover:bg-panel2 w-full"
                  style={{ background: isOn ? "#1b2836" : "transparent", border: isOn ? "1px solid #26384a" : "1px solid transparent" }}>
                  <div className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 transition-colors"
                    style={{
                      background: isDone ? "#7bc24a" : isOn ? "#56a6e8" : "transparent",
                      border: `1.5px solid ${isDone ? "#7bc24a" : isOn ? "#56a6e8" : "#324a61"}`,
                      color: isDone ? "#0e1a06" : isOn ? "#06121d" : "#8aa0b4",
                    }}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <div>
                    <div className="text-[13.5px] font-bold whitespace-nowrap" style={{ color: isOn ? "#e7eef4" : "#8aa0b4" }}>{s.title}</div>
                    <div className="text-[11.5px] text-dim mt-0.5">{s.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Pane */}
          <div>
            <Pane />
            <div className="flex items-center gap-3 mt-6 pt-5 border-t border-line">
              <div className="flex items-center gap-1.5 text-[12px] text-dim">🔒 Builds are sandboxed & scanned. Players run your game in an isolated iframe.</div>
              <div className="flex-1" />
              {current > 0 && (
                <button onClick={back} className="px-5 py-3 rounded-[9px] font-bold text-[14px] cursor-pointer bg-panel2 border border-line text-ink">← Back</button>
              )}
              {current < 4 && (
                <button onClick={next}
                  className="px-5 py-3 rounded-[9px] font-bold text-[14px] cursor-pointer border-none"
                  style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                  {current === 0 ? "Continue → Store page" : current === 1 ? "Continue → Pricing" : current === 2 ? "Continue → Multiplayer" : "Continue → Review"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
