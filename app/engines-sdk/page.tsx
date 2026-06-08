import CreatorSubNav from "@/components/shell/CreatorSubNav";

const engines = [
  { abbr: "BJS", name: "Babylon.js",   desc: "3D · WebGPU ready",       color: "#bb464b", badge: "Official SDK",   cmd: "woven init → publish"  },
  { abbr: "3JS", name: "three.js",     desc: "3D · most popular",        color: "#222831", badge: "Official SDK",   cmd: "npx woven deploy"      },
  { abbr: "PC",  name: "PlayCanvas",   desc: "3D · editor + engine",     color: "#e5732b", badge: "Official SDK",   cmd: "one-click export"      },
  { abbr: "PH",  name: "Phaser",       desc: "2D · arcade & casual",     color: "#8e44ad", badge: "Verified",       cmd: "woven deploy ./dist"   },
  { abbr: "PX",  name: "PixiJS",       desc: "2D · WebGL renderer",      color: "#e91e63", badge: "Verified",       cmd: "generic loader"        },
  { abbr: "GD",  name: "Godot",        desc: "web (HTML5) export",       color: "#478cbf", badge: "Verified",       cmd: "upload .zip"           },
  { abbr: "U",   name: "Unity",        desc: "WebGL build",              color: "#444b54", badge: "Verified",       cmd: "upload Build/ folder"  },
  { abbr: "C3",  name: "Construct",    desc: "no-code 2D",               color: "#00a8e8", badge: "Verified",       cmd: "export → upload"       },
  { abbr: "BV",  name: "Bevy / Rust",  desc: "WASM + WebGL",             color: "#cea05a", badge: "Community",      cmd: "wasm-bindgen"          },
  { abbr: "DF",  name: "Defold",       desc: "2D · HTML5 bundle",        color: "#011f42", badge: "Community",      cmd: "upload bundle"         },
  { abbr: "CC",  name: "Cocos",        desc: "2D/3D web",                color: "#2bb150", badge: "Community",      cmd: "web-mobile build"      },
  { abbr: "{}",  name: "Custom WASM",  desc: "Emscripten / any",         color: "#7bc24a", badge: "Generic loader", cmd: "index.html entry"      },
];

const badgeStyle: Record<string, React.CSSProperties> = {
  "Official SDK":   { background: "rgba(123,194,74,.16)",  color: "#a6e06a"  },
  "Verified":       { background: "rgba(86,166,232,.14)",  color: "#8fc6f0"  },
  "Community":      { background: "rgba(255,255,255,.06)", color: "#8aa0b4"  },
  "Generic loader": { background: "rgba(232,169,58,.16)",  color: "#f0c66a"  },
};

const sdkFeatures = [
  { ico: "👤", title: "Auth & profiles",    body: "Sign-in, avatars & friends with zero backend."           },
  { ico: "💳", title: "Payments & DLC",     body: "Sell unlocks & entitlements via Stripe, in-game."        },
  { ico: "☁️", title: "Cloud saves",        body: "Per-player key/value & blob storage, synced."            },
  { ico: "🌐", title: "Multiplayer / RTC",  body: "WebRTC rooms, relay & spatial voice."                    },
  { ico: "🏆", title: "Leaderboards",       body: "Scores, achievements & daily challenges."                },
  { ico: "📊", title: "Analytics",          body: "Sessions, funnels & retention, privacy-first."           },
];

const codeLines = [
  { t: "c", v: "<!-- one script, any engine -->" },
  { t: "k", v: "<script", after: { t: "n", v: ` src=` }, s: `"https://sdk.woven.gg/v1.js"`, close: { t: "k", v: `></script>` } },
  { t: "blank" },
  { t: "k", v: "const", after2: " woven = ", f: "Woven", dot: ".", f2: "init", p: `('app_hollowtide')` },
];

export default function EnginesSDKPage() {
  return (
    <>
      <CreatorSubNav />
      <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
        <p className="text-[12px] font-bold tracking-[.14em] uppercase text-accent mb-1.5">Bring your own engine</p>
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">If it runs in a browser, it ships on Woven.</h1>
        <p className="text-muted text-[15px] mt-2.5 mb-4 max-w-[620px]">
          Upload a build from any web-capable engine. The Woven SDK is optional but unlocks accounts, payments, cloud saves, multiplayer and leaderboards — one lightweight script, framework-agnostic.
        </p>

        {/* Engine grid */}
        <div className="grid grid-cols-4 gap-4 my-4.5">
          {engines.map(e => (
            <div key={e.name}
              className="bg-panel border border-line rounded-[10px] p-4.5 flex flex-col gap-2.5 transition-[transform,border-color] hover:-translate-y-[3px] hover:border-line2 cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="w-[42px] h-[42px] rounded-[11px] flex items-center justify-center font-extrabold text-[14px] text-white shrink-0"
                  style={{ background: e.color }}>{e.abbr}</div>
                <div>
                  <div className="font-bold text-[15.5px]">{e.name}</div>
                  <div className="text-[12.5px] text-muted">{e.desc}</div>
                </div>
              </div>
              <span className="self-start text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                style={badgeStyle[e.badge]}>{e.badge}</span>
              <div className="font-mono text-[11.5px] text-dim mt-auto">{e.cmd}</div>
            </div>
          ))}
        </div>

        <p className="text-[12px] text-dim mb-8">
          Don&apos;t see yours? Any <strong className="text-ink">WebGL/WebGPU + WASM</strong> build works via the generic loader.{" "}
          <a className="text-accent cursor-pointer">Tell us your engine →</a>
        </p>

        {/* SDK section */}
        <h2 className="text-[21px] font-bold tracking-[-0.01em] mb-1.5">The Woven SDK</h2>
        <p className="text-muted text-[15px] mb-4.5">Drop in one script. Call what you need.</p>

        <div className="grid gap-7 items-start" style={{ gridTemplateColumns: "1fr 420px" }}>
          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-3.5">
            {sdkFeatures.map(f => (
              <div key={f.title} className="flex gap-3 p-3.5 border border-line rounded-[10px] bg-panel2">
                <div className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-[16px] shrink-0"
                  style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>{f.ico}</div>
                <div>
                  <h4 className="text-[14px] font-bold">{f.title}</h4>
                  <p className="text-[12px] text-muted mt-0.5">{f.body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Code block */}
          <div>
            <pre className="bg-[#070b10] border border-line rounded-[10px] p-4 font-mono text-[12.5px] leading-[1.7] overflow-x-auto"
              style={{ color: "#c5d6e6" }}>
              <code>
                <span style={{ color: "#5d738a" }}>{`<!-- one script, any engine -->`}</span>{"\n"}
                <span style={{ color: "#7bc2ff" }}>{`<script`}</span>{" "}src=<span style={{ color: "#9ad48a" }}>{`"https://sdk.woven.gg/v1.js"`}</span><span style={{ color: "#7bc2ff" }}>{`></script>`}</span>{"\n\n"}
                <span style={{ color: "#7bc2ff" }}>{"const"}</span>{" woven = "}<span style={{ color: "#7bc2ff" }}>{"await"}</span>{" "}<span style={{ color: "#e8c06a" }}>{"Woven"}</span>.<span style={{ color: "#e8c06a" }}>{"init"}</span>(<span style={{ color: "#9ad48a" }}>{`'app_hollowtide'`}</span>){"\n\n"}
                <span style={{ color: "#5d738a" }}>{"// who's playing"}</span>{"\n"}
                <span style={{ color: "#7bc2ff" }}>{"const"}</span>{" me = "}<span style={{ color: "#7bc2ff" }}>{"await"}</span>{" woven."}<span style={{ color: "#e8c06a" }}>{"user"}</span>(){"\n\n"}
                <span style={{ color: "#5d738a" }}>{"// cloud save"}</span>{"\n"}
                <span style={{ color: "#7bc2ff" }}>{"await"}</span>{" woven.saves."}<span style={{ color: "#e8c06a" }}>{"set"}</span>(<span style={{ color: "#9ad48a" }}>{`'slot1'`}</span>, world.<span style={{ color: "#e8c06a" }}>{"serialize"}</span>()){"\n\n"}
                <span style={{ color: "#5d738a" }}>{"// sell an unlock (Stripe)"}</span>{"\n"}
                <span style={{ color: "#7bc2ff" }}>{"await"}</span>{" woven."}<span style={{ color: "#e8c06a" }}>{"purchase"}</span>(<span style={{ color: "#9ad48a" }}>{`'chapter2'`}</span>){"\n\n"}
                <span style={{ color: "#5d738a" }}>{"// realtime room"}</span>{"\n"}
                <span style={{ color: "#7bc2ff" }}>{"const"}</span>{" room = "}<span style={{ color: "#7bc2ff" }}>{"await"}</span>{" woven.net."}<span style={{ color: "#e8c06a" }}>{"join"}</span>(<span style={{ color: "#9ad48a" }}>{`'lobby'`}</span>)
              </code>
            </pre>
            <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3] mt-3.5"
              style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
              Engine plugins for Babylon, three.js & PlayCanvas wrap this with typed helpers. Everything also works framework-free.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
