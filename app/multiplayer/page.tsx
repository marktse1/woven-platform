"use client";
import { useState } from "react";
import CreatorSubNav from "@/components/shell/CreatorSubNav";

const pillars = [
  { ico: "🛰️", title: "Signaling",       body: "Rooms, matchmaking & presence over secure WebSocket. We broker the SDP/ICE handshake so peers can find each other.", mono: "wss://net.woven.gg/room/:id"     },
  { ico: "🧭", title: "NAT traversal",   body: "Managed STUN + TURN across 14 regions. Direct peer-to-peer when possible, automatic relay fallback when firewalls get in the way.", mono: "STUN · TURN (DTLS) · auto" },
  { ico: "⚡", title: "Transport",       body: "Ordered & unordered WebRTC DataChannels for state at 30–60Hz, plus encrypted Opus voice. You pick reliability per channel.", mono: "DataChannel · Opus · DTLS-SRTP" },
];

const peers = [
  { name: "Maya",     color: "#3a7fc4", mode: "direct · P2P",  ping: 18 },
  { name: "kojiro",   color: "#5cb85c", mode: "direct · P2P",  ping: 24 },
  { name: "fenn",     color: "#c44b9a", mode: "direct · P2P",  ping: 31 },
  { name: "guest_91", color: "#e8a93a", mode: "via TURN relay", ping: 68 },
];

function pingColor(ms: number) { return ms < 40 ? "#7bc24a" : ms < 65 ? "#e8a93a" : "#e35c5c"; }

function SignalBars({ ping }: { ping: number }) {
  const bars = ping < 25 ? 5 : ping < 40 ? 4 : ping < 60 ? 3 : 2;
  const c = pingColor(ping);
  return (
    <span className="inline-flex gap-0.5 items-end h-3.5 ml-2 align-middle">
      {[0, 1, 2, 3, 4].map(i => (
        <span key={i} className="w-[3px] rounded-sm"
          style={{ height: `${4 + i * 2}px`, opacity: i < bars ? 1 : 0.2, background: c }} />
      ))}
    </span>
  );
}

function Setting({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-line last:border-none">
      <div>
        <div className="text-[13.5px] font-semibold">{label}</div>
        {sub && <div className="text-[11.5px] text-dim">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Seg({ options, defaultIndex = 0 }: { options: string[]; defaultIndex?: number }) {
  const [active, setActive] = useState(defaultIndex);
  return (
    <div className="flex border border-line rounded-lg overflow-hidden">
      {options.map((o, i) => (
        <button key={o} onClick={() => setActive(i)}
          className="px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors"
          style={{ background: i === active ? "#56a6e8" : "transparent", color: i === active ? "#06121d" : "#8aa0b4" }}>
          {o}
        </button>
      ))}
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

const avgPing = Math.round(peers.reduce((a, p) => a + p.ping, 0) / peers.length);

export default function MultiplayerPage() {
  return (
    <>
      <CreatorSubNav />
      <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
        <p className="text-[12px] font-bold tracking-[.14em] uppercase text-accent mb-1.5">Weave Net · Real-time</p>
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Real-time multiplayer, no backend.</h1>
        <p className="text-muted text-[15px] mt-2.5 mb-5 max-w-[620px]">
          Woven ships a managed <strong className="text-ink">WebRTC</strong> stack: rooms & matchmaking over a signaling server, hosted STUN/TURN for NAT traversal, and low-latency DataChannels for game state — plus spatial voice. Add it in a few lines, any engine.
        </p>

        {/* Pillars */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {pillars.map(p => (
            <div key={p.title} className="bg-panel border border-line rounded-[10px] p-6">
              <div className="w-[38px] h-[38px] rounded-[9px] flex items-center justify-center text-[18px] mb-3"
                style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>{p.ico}</div>
              <h3 className="text-[16px] font-bold">{p.title}</h3>
              <p className="text-[13px] text-muted mt-1.5">{p.body}</p>
              <span className="font-mono text-[12px] text-dim mt-2 block">{p.mono}</span>
            </div>
          ))}
        </div>

        {/* Architecture diagram */}
        <h2 className="text-[21px] font-bold tracking-[-0.01em] mb-3.5">How a session connects</h2>
        <div className="relative h-[430px] rounded-xl border border-line overflow-hidden"
          style={{ background: "radial-gradient(700px 300px at 50% -10%, rgba(86,166,232,.10), transparent 60%), #16202c" }}>
          <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
            <defs>
              <linearGradient id="acc" x1="0" x2="1">
                <stop offset="0" stopColor="#56a6e8" />
                <stop offset="1" stopColor="#7bd0ff" />
              </linearGradient>
            </defs>
            {/* Direct P2P */}
            <path d="M 268 214 L 1124 214" fill="none" stroke="url(#acc)" strokeWidth="3" strokeLinecap="round" />
            {/* Signaling dashed */}
            <path d="M 160 168 C 200 110, 520 96, 560 96" fill="none" stroke="#324a61" strokeWidth="2" strokeDasharray="2 7" />
            <path d="M 1212 168 C 1180 110, 856 96, 856 96" fill="none" stroke="#324a61" strokeWidth="2" strokeDasharray="2 7" />
            {/* STUN dotted */}
            <path d="M 150 264 C 300 330, 460 350, 540 356" fill="none" stroke="#324a61" strokeWidth="1.6" strokeDasharray="1 6" opacity="0.8" />
            <path d="M 1212 264 C 900 340, 700 350, 640 356" fill="none" stroke="#324a61" strokeWidth="1.6" strokeDasharray="1 6" opacity="0.8" />
            {/* TURN fallback */}
            <path d="M 268 230 C 520 300, 700 330, 800 340" fill="none" stroke="#5d738a" strokeWidth="1.6" strokeDasharray="1 7" opacity="0.7" />
            <path d="M 1124 230 C 980 300, 880 330, 880 340" fill="none" stroke="#5d738a" strokeWidth="1.6" strokeDasharray="1 7" opacity="0.7" />
          </svg>

          {/* Labels */}
          <div className="absolute font-semibold text-[11.5px] text-[#bcdcf3] bg-[rgba(7,11,16,.85)] border border-accent2 px-3 py-1 rounded-full whitespace-nowrap"
            style={{ left: "50%", top: "214px", transform: "translate(-50%, -50%)" }}>
            WebRTC DataChannel · 60Hz state · 18 ms
          </div>
          <div className="absolute font-semibold text-[11.5px] text-dim bg-[rgba(7,11,16,.7)] border border-line px-2.5 py-1 rounded-full whitespace-nowrap"
            style={{ left: "360px", top: "120px", transform: "translate(-50%, -50%)" }}>1 · ICE / SDP</div>
          <div className="absolute font-semibold text-[11.5px] text-dim bg-[rgba(7,11,16,.7)] border border-line px-2.5 py-1 rounded-full whitespace-nowrap"
            style={{ left: "1010px", top: "120px", transform: "translate(-50%, -50%)" }}>1 · ICE / SDP</div>

          {/* Player A */}
          <div className="absolute border border-line2 bg-panel2 p-3 rounded-[10px] w-[220px]" style={{ left: "48px", top: "168px" }}>
            <div className="text-[16px] mb-1 text-accent">🎮</div>
            <div className="font-bold text-[13.5px]">Player A · browser</div>
            <div className="text-[11.5px] text-dim mt-0.5">your game + Weave SDK</div>
          </div>
          {/* Player B */}
          <div className="absolute border border-line2 bg-panel2 p-3 rounded-[10px] w-[220px]" style={{ left: "1124px", top: "168px" }}>
            <div className="text-[16px] mb-1 text-accent">🎮</div>
            <div className="font-bold text-[13.5px]">Player B · browser</div>
            <div className="text-[11.5px] text-dim mt-0.5">your game + Weave SDK</div>
          </div>
          {/* Signaling */}
          <div className="absolute border text-center p-3 rounded-[10px] w-[296px]"
            style={{ left: "560px", top: "26px", background: "rgba(86,166,232,.10)", borderColor: "#2c6aa0" }}>
            <div className="font-bold text-[13.5px]">Weave Net · Signaling (WSS)</div>
            <div className="text-[11.5px] text-dim mt-0.5">rooms · matchmaking · SDP/ICE exchange</div>
          </div>
          {/* STUN */}
          <div className="absolute border border-accent2 p-3 rounded-[10px] w-[170px]"
            style={{ left: "470px", top: "340px", background: "rgba(86,166,232,.10)" }}>
            <div className="font-bold text-[13.5px]">STUN</div>
            <div className="text-[11.5px] text-dim mt-0.5">discover public address</div>
          </div>
          {/* TURN */}
          <div className="absolute border border-accent2 p-3 rounded-[10px] w-[210px] opacity-85"
            style={{ left: "716px", top: "340px", background: "rgba(86,166,232,.10)" }}>
            <div className="font-bold text-[13.5px]">TURN relay</div>
            <div className="text-[11.5px] text-dim mt-0.5">fallback when P2P blocked</div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-5 text-[12px] text-dim mt-2.5 mb-6">
          <span><span className="inline-block w-5 h-[3px] bg-accent rounded align-middle mr-1.5" /> Direct P2P data & voice</span>
          <span><span className="inline-block w-5 border-t-2 border-dashed border-line2 align-middle mr-1.5" /> Signaling handshake</span>
          <span><span className="inline-block w-5 border-t-2 border-dotted border-dim align-middle mr-1.5" /> Relay fallback</span>
        </div>

        {/* Split: code + config */}
        <div className="grid gap-6 items-start" style={{ gridTemplateColumns: "1fr 400px" }}>
          <div>
            <h2 className="text-[21px] font-bold tracking-[-0.01em] mb-3.5">Add it in ~10 lines</h2>
            <pre className="bg-[#070b10] border border-line rounded-[10px] p-4 font-mono text-[12.5px] leading-[1.7] overflow-x-auto"
              style={{ color: "#c5d6e6" }}>
              <code>
                <span style={{ color: "#5d738a" }}>{"// works with Babylon, three.js, PlayCanvas, Phaser…"}</span>{"\n"}
                <span style={{ color: "#7bc2ff" }}>{"import"}</span>{" { Weave } "}<span style={{ color: "#7bc2ff" }}>{"from"}</span>{" "}<span style={{ color: "#9ad48a" }}>{"'@woven/net'"}</span>{"\n\n"}
                <span style={{ color: "#5d738a" }}>{"// join a room — signaling, STUN/TURN & encryption handled"}</span>{"\n"}
                <span style={{ color: "#7bc2ff" }}>{"const"}</span>{" room = "}<span style={{ color: "#7bc2ff" }}>{"await"}</span>{" "}<span style={{ color: "#e8c06a" }}>{"Weave"}</span>.<span style={{ color: "#e8c06a" }}>{"join"}</span>(<span style={{ color: "#9ad48a" }}>{"'hollow-tide'"}</span>, {"{ max: "}<span style={{ color: "#c089e0" }}>8</span>{", voice: "}<span style={{ color: "#c089e0" }}>{"true"}</span>{" })"}{"\n\n"}
                {"room."}<span style={{ color: "#e8c06a" }}>{"on"}</span>(<span style={{ color: "#9ad48a" }}>{"'peer'"}</span>{", (peer) => console."}<span style={{ color: "#e8c06a" }}>{"log"}</span>(<span style={{ color: "#9ad48a" }}>"'+ '"</span>{", peer.id, peer.ping))"}{"\n\n"}
                <span style={{ color: "#5d738a" }}>{"// 60Hz state over an unreliable DataChannel"}</span>{"\n"}
                <span style={{ color: "#7bc2ff" }}>{"const"}</span>{" net = room."}<span style={{ color: "#e8c06a" }}>{"channel"}</span>(<span style={{ color: "#9ad48a" }}>{"'state'"}</span>{", { ordered: "}<span style={{ color: "#c089e0" }}>{"false"}</span>{" })"}{"\n"}
                {"net."}<span style={{ color: "#e8c06a" }}>{"onMessage"}</span>{"(s => world."}<span style={{ color: "#e8c06a" }}>{"apply"}</span>{"(s))"}{"\n"}
                <span style={{ color: "#e8c06a" }}>{"setInterval"}</span>{"(() => net."}<span style={{ color: "#e8c06a" }}>{"send"}</span>{"(player."}<span style={{ color: "#e8c06a" }}>{"snapshot"}</span>{"()), "}<span style={{ color: "#c089e0" }}>1000</span>{"/"}<span style={{ color: "#c089e0" }}>60</span>{")"}{"\n\n"}
                <span style={{ color: "#5d738a" }}>{"// spatial voice, also WebRTC"}</span>{"\n"}
                {"room.voice."}<span style={{ color: "#e8c06a" }}>{"enable"}</span>{"({ spatial: "}<span style={{ color: "#c089e0" }}>{"true"}</span>{" })"}
              </code>
            </pre>
            <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3] mt-3.5"
              style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
              Prefer an authoritative server? Flip topology to <strong>Relay (SFU)</strong> or <strong>Authoritative</strong> and run logic on a Woven edge worker — same SDK.
            </div>
          </div>

          {/* Config + Monitor */}
          <div className="flex flex-col gap-5">
            {/* Room config */}
            <div className="bg-panel border border-line rounded-[10px] p-6">
              <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-2">Room config</p>
              <Setting label="Topology"><Seg options={["P2P mesh", "SFU", "Auth"]} /></Setting>
              <Setting label="Region">
                <select className="bg-[#0a0e13] border border-line rounded-lg px-3 py-1.5 text-ink text-[13px] w-[150px] outline-none font-[inherit] cursor-pointer">
                  <option>Auto (nearest)</option><option>us-east</option><option>eu-west</option><option>ap-southeast</option>
                </select>
              </Setting>
              <Setting label="Tick rate"><Seg options={["20Hz", "30Hz", "60Hz"]} defaultIndex={2} /></Setting>
              <Setting label="Spatial voice"><Toggle defaultOn /></Setting>
              <Setting label="Encryption" sub="DTLS-SRTP, always on">
                <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                  style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>enforced</span>
              </Setting>
            </div>

            {/* Room monitor */}
            <div className="bg-panel border border-line rounded-[10px] p-6">
              <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-1.5 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green animate-pulse-green" />
                Room monitor · <span className="text-ink normal-case tracking-normal">hollow-tide#4f2a</span>
              </p>
              <div>
                {peers.map(p => (
                  <div key={p.name} className="flex items-center gap-3 py-3 border-b border-line last:border-none">
                    <div className="w-[34px] h-[34px] rounded-[9px] shrink-0"
                      style={{ background: `linear-gradient(140deg, ${p.color}, #1b2836)` }} />
                    <div>
                      <div className="font-semibold text-[13.5px]">{p.name}</div>
                      <div className="text-[11.5px] text-dim">{p.mode}</div>
                    </div>
                    <div className="ml-auto text-right">
                      <strong className="text-[14px] font-bold" style={{ color: pingColor(p.ping) }}>
                        {p.ping}<span className="text-[10px]">ms</span>
                      </strong>
                      <SignalBars ping={p.ping} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[14px] mt-1.5 pt-1.5">
                <span className="text-muted">Avg. latency</span>
                <span className="font-semibold">{avgPing} ms</span>
              </div>
              <div className="flex justify-between text-[14px] py-1">
                <span className="text-muted">P2P direct</span>
                <span className="font-semibold text-green">3 / 4 peers</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
