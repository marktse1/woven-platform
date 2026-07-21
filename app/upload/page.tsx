"use client";
import { useState } from "react";
import CreatorSubNav from "@/components/shell/CreatorSubNav";
import { uploadGameBuildZip, streamNdjson } from "@/lib/uploads";

const STEPS = [
  { title: "Build & engine", sub: "Upload your zip"  },
  { title: "Store page",     sub: "Art, copy, tags"  },
  { title: "Pricing",        sub: "Price & Pass"     },
  { title: "Multiplayer",    sub: "RTC & netcode"    },
  { title: "Review & submit",sub: "Final checks"     },
];

const ENGINE_OPTIONS = [
  { label: "Three.js",     value: "three.js",     dot: "#ffffff" },
  { label: "PlayCanvas",   value: "playcanvas",   dot: "#e5732b" },
  { label: "Babylon.js",   value: "babylon",      dot: "#bb464b" },
  { label: "Phaser",       value: "phaser",       dot: "#8e44ad" },
  { label: "Godot (web)",  value: "godot-web",    dot: "#478cbf" },
  { label: "Unity WebGL",  value: "unity-webgl",  dot: "#cccccc" },
  { label: "Custom HTML5", value: "custom-html5", dot: "#7bc24a" },
];

const STAGE_LABEL: Record<string, string> = {
  starting: "Starting…",
  downloading: "Downloading archive…",
  validating: "Validating archive contents…",
  extracting: "Extracting…",
  "detecting-engine": "Detecting engine…",
  uploading: "Uploading build files…",
  finalizing: "Finalizing…",
};

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

function ControlledToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="relative w-[42px] h-6 rounded-full border shrink-0 cursor-pointer transition-colors"
      style={{ background: on ? "#56a6e8" : "#223345", borderColor: on ? "#56a6e8" : "#324a61" }}>
      <span className="absolute top-[3px] w-[18px] h-[18px] rounded-full transition-[left] duration-150"
        style={{ left: on ? "21px" : "3px", background: on ? "#06121d" : "#cfd8e0" }} />
    </button>
  );
}

function bytesLabel(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function humanizeFileName(name: string) {
  return name.replace(/\.zip$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type UploadPhase = "idle" | "uploading" | "processing" | "ready" | "failed";

type SharedState = {
  file: File | null;
  uploadPhase: UploadPhase;
  uploadPct: number;
  stage: string;
  stageProgress: number;
  gameId: string | null;
  buildId: string | null;
  detectedEngine: string | null;
  entryFile: string | null;
  engineOverride: string | null;
  warnings: string[];
  errorMsg: string | null;
  title: string;
  shortDescription: string;
  isFree: boolean;
  priceInput: string;
  passIncluded: boolean;
  changelog: string;
  submitStatus: "idle" | "submitting" | "submitted" | "error";
  submitError: string;
  onFile: (file: File) => void;
  setEngineOverride: (v: string) => void;
  setTitle: (v: string) => void;
  setShortDescription: (v: string) => void;
  setIsFree: (v: boolean) => void;
  setPriceInput: (v: string) => void;
  setPassIncluded: (v: boolean) => void;
  setChangelog: (v: string) => void;
  onSubmit: () => void;
};

function Step1({ s }: { s: SharedState }) {
  const [dragOver, setDragOver] = useState(false);

  if (!s.file) {
    return (
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) s.onFile(f);
          }}
          className="flex flex-col items-center justify-center gap-3 p-14 rounded-xl border-2 border-dashed cursor-pointer text-center"
          style={{ borderColor: dragOver ? "#56a6e8" : "#26384a", background: dragOver ? "rgba(86,166,232,.06)" : "transparent" }}
          onClick={() => document.getElementById("zip-input")?.click()}
        >
          <div className="text-[32px]">📦</div>
          <div className="font-bold text-[15px]">Drop a zipped web build here</div>
          <div className="text-[12.5px] text-dim">index.html + assets, up to 500MB · Three.js, PlayCanvas, Babylon, Phaser, Godot Web, Unity WebGL, or custom HTML5</div>
          <input
            id="zip-input"
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) s.onFile(f); }}
          />
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-dim mt-3">
          🔒 Builds are sandboxed &amp; scanned before anything is published.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <div className="flex items-center gap-4.5 p-6 rounded-xl border"
          style={{
            border: `1.5px solid ${s.uploadPhase === "failed" ? "rgba(227,92,92,.4)" : s.uploadPhase === "ready" ? "rgba(123,194,74,.4)" : "rgba(86,166,232,.4)"}`,
            background: s.uploadPhase === "failed" ? "rgba(227,92,92,.06)" : s.uploadPhase === "ready" ? "rgba(123,194,74,.06)" : "rgba(86,166,232,.06)",
          }}>
          <div className="w-[52px] h-[52px] rounded-xl flex items-center justify-center text-[24px] shrink-0"
            style={{
              background: s.uploadPhase === "failed" ? "rgba(227,92,92,.16)" : s.uploadPhase === "ready" ? "rgba(123,194,74,.16)" : "rgba(86,166,232,.16)",
              border: `1px solid ${s.uploadPhase === "failed" ? "rgba(227,92,92,.4)" : s.uploadPhase === "ready" ? "rgba(123,194,74,.4)" : "#2c6aa0"}`,
              color: s.uploadPhase === "failed" ? "#e88" : s.uploadPhase === "ready" ? "#a6e06a" : "#8fc6f0",
            }}>
            {s.uploadPhase === "ready" ? "✓" : s.uploadPhase === "failed" ? "!" : "…"}
          </div>
          <div className="flex-1">
            <div className="font-bold">{s.file.name}
              <span className="ml-1.5 text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-[.04em]"
                style={{
                  background: s.uploadPhase === "failed" ? "rgba(227,92,92,.16)" : s.uploadPhase === "ready" ? "rgba(123,194,74,.16)" : "rgba(86,166,232,.16)",
                  color: s.uploadPhase === "failed" ? "#e88" : s.uploadPhase === "ready" ? "#a6e06a" : "#8fc6f0",
                }}>
                {s.uploadPhase === "ready" ? "ready" : s.uploadPhase === "failed" ? "failed" : s.uploadPhase}
              </span>
            </div>
            <div className="text-[12.5px] text-dim mt-0.5">
              {bytesLabel(s.file.size)}
              {s.uploadPhase === "uploading" && ` · uploading ${Math.round(s.uploadPct * 100)}%`}
              {s.uploadPhase === "processing" && ` · ${STAGE_LABEL[s.stage] ?? s.stage}`}
              {s.uploadPhase === "ready" && ` · ${s.detectedEngine ?? "engine unknown"}`}
            </div>
            {(s.uploadPhase === "uploading" || s.uploadPhase === "processing") && (
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#223345" }}>
                <div className="h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{
                    width: `${Math.round((s.uploadPhase === "uploading" ? s.uploadPct : s.stageProgress) * 100)}%`,
                    background: "linear-gradient(90deg, #56a6e8, #7bd0ff)",
                  }} />
              </div>
            )}
          </div>
          <button
            onClick={() => document.getElementById("zip-input-2")?.click()}
            className="px-3.5 py-2 rounded-[9px] font-bold text-[14px] cursor-pointer bg-transparent border border-line text-ink"
          >
            Replace build
          </button>
          <input id="zip-input-2" type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) s.onFile(f); }} />
        </div>

        {s.errorMsg && (
          <div className="mt-3 p-3 rounded-[9px] text-[13px]" style={{ background: "rgba(227,92,92,.08)", border: "1px solid rgba(227,92,92,.4)", color: "#f0a6a6" }}>
            {s.errorMsg}
          </div>
        )}
        {s.warnings.length > 0 && (
          <div className="mt-3 p-3 rounded-[9px] text-[13px]" style={{ background: "rgba(232,169,58,.08)", border: "1px solid rgba(232,169,58,.4)", color: "#f0c66a" }}>
            {s.warnings.join(" · ")}
          </div>
        )}
      </div>

      {s.uploadPhase === "ready" && (
        <div className="grid gap-5.5 mt-5.5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
          <div className="bg-panel border border-line rounded-[10px] p-6">
            <SectionLabel>Build summary</SectionLabel>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div className="bg-[#0a0e13] border border-line rounded-[9px] p-3">
                <div className="text-[11px] text-dim uppercase">Entry file</div>
                <div className="font-semibold mt-1 font-mono">{s.entryFile ?? "—"}</div>
              </div>
              <div className="bg-[#0a0e13] border border-line rounded-[9px] p-3">
                <div className="text-[11px] text-dim uppercase">Size</div>
                <div className="font-semibold mt-1">{bytesLabel(s.file.size)}</div>
              </div>
            </div>
          </div>

          <div className="bg-panel border border-line rounded-[10px] p-6">
            <SectionLabel>Engine detected</SectionLabel>
            <div className="flex items-center gap-3.5 p-4 rounded-[10px]"
              style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
              <div className="flex-1">
                <div className="font-bold text-[15px]">{s.engineOverride ?? s.detectedEngine ?? "Unknown"}</div>
                <div className="text-[12px] text-dim">auto-detected from the archive contents</div>
              </div>
            </div>
            <p className="text-[12.5px] text-muted mt-3 mb-1.5">Wrong? Pick your engine:</p>
            <div className="flex flex-wrap gap-2">
              {ENGINE_OPTIONS.map(e => {
                const on = (s.engineOverride ?? s.detectedEngine) === e.value;
                return (
                  <button key={e.value} onClick={() => s.setEngineOverride(e.value)}
                    className="inline-flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
                    style={{ background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.dot }} />
                    {e.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Step2({ s }: { s: SharedState }) {
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set(tags.slice(0, 4)));
  return (
    <div className="grid gap-5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <div className="flex flex-col gap-1.5 mb-4"><label className="text-[13px] font-semibold text-muted">Title</label><input className={inputCls()} value={s.title} onChange={(e) => s.setTitle(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5 mb-4"><label className="text-[13px] font-semibold text-muted">Tagline</label><input className={inputCls()} value={s.shortDescription} onChange={(e) => s.setShortDescription(e.target.value)} placeholder="A one-line hook for your store page" /></div>
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
          <p className="text-[11.5px] text-dim mt-2">Tags aren&apos;t stored yet — coming in a later update.</p>
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <div className="bg-panel border border-line rounded-[10px] p-6">
          <SectionLabel>Capsule art</SectionLabel>
          <div className="h-[150px] rounded-lg border border-dashed border-line2 flex items-center justify-center text-dim text-[12px] cursor-pointer relative overflow-hidden">
            <span className="font-mono text-[12px] text-white/85 bg-black/35 px-2.5 py-1.5 rounded-[7px]">capsule · 3:4 · not wired up yet</span>
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
      </div>
    </div>
  );
}

function Step3({ s }: { s: SharedState }) {
  const dollars = (Number(s.priceInput) || 0);
  const cents = Math.round(dollars * 100);
  const creatorCut = cents ? (cents * 0.88 / 100).toFixed(2) : "0.00";
  return (
    <div className="grid gap-5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>How is it sold?</SectionLabel>
        <Setting label="Free to play" sub="No charge to play or download">
          <ControlledToggle on={s.isFree} onToggle={() => s.setIsFree(!s.isFree)} />
        </Setting>
        {!s.isFree && (
          <div className="my-4">
            <label className="text-[13px] font-semibold text-muted block mb-1.5">Base price (USD)</label>
            <input className={inputCls("w-[160px]")} value={s.priceInput} onChange={(e) => s.setPriceInput(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="15.99" />
            <p className="text-[12px] text-dim mt-1.5">Woven keeps 12%. You earn <strong className="text-green">${creatorCut}</strong> per sale.</p>
          </div>
        )}
        <div className="h-px bg-line my-4" />
        <Setting label="Include in Woven Pass" sub="Subscribers play free; you're paid per hour played">
          <ControlledToggle on={s.passIncluded} onToggle={() => s.setPassIncluded(!s.passIncluded)} />
        </Setting>
        <Setting label="Regional pricing" sub="Auto-adjust for 40+ regions — coming soon"><Toggle defaultOn={false} /></Setting>
      </div>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>Estimated payout</SectionLabel>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Per sale (88%)</span><span className="font-semibold text-green">{s.isFree ? "—" : `$${creatorCut}`}</span></div>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Pass · per hour played</span><span className="font-semibold">{s.passIncluded ? "~$0.04" : "—"}</span></div>
        <div className="h-px bg-line my-4" />
        <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3]"
          style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
          Connect a Stripe payout account from your dashboard before your first sale.
        </div>
      </div>
    </div>
  );
}

function Step4() {
  return (
    <div className="grid gap-5 items-start" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <Setting label="Enable multiplayer (Weave Net)" sub="Drop-in WebRTC netcode, rooms & relay — coming soon"><Toggle /></Setting>
        <Setting label="Voice chat" sub="Spatial WebRTC audio in rooms — coming soon"><Toggle /></Setting>
        <div className="h-px bg-line my-4" />
        <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3] mt-3.5"
          style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
          Multiplayer netcode isn&apos;t available yet — this section is a preview of what&apos;s planned.
        </div>
      </div>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>Status</SectionLabel>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Weave Net</span><span className="font-semibold text-dim">Not yet available</span></div>
      </div>
    </div>
  );
}

function Step5({ s }: { s: SharedState }) {
  const checklist = [
    { ok: s.uploadPhase === "ready", text: s.uploadPhase === "ready" ? `Build uploaded & sandbox-scanned (${s.entryFile ?? "?"})` : "Build not uploaded yet" },
    { ok: !!(s.engineOverride ?? s.detectedEngine), text: `Engine — ${s.engineOverride ?? s.detectedEngine ?? "not detected"}` },
    { ok: s.title.trim().length > 0, text: s.title.trim() ? `Title set: "${s.title}"` : "Title is required" },
    { ok: s.isFree || Number(s.priceInput) > 0, text: s.isFree ? "Free to play" : Number(s.priceInput) > 0 ? `Priced at $${s.priceInput}` : "Set a price or mark as free" },
  ];
  const canSubmit = s.uploadPhase === "ready" && s.title.trim().length > 0 && !!s.gameId;

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
        <div className="mt-5">
          <label className="text-[13px] font-semibold text-muted block mb-1.5">What&apos;s new</label>
          <textarea
            className={`${inputCls()} min-h-[90px] resize-y`}
            value={s.changelog}
            onChange={(e) => s.setChangelog(e.target.value)}
            placeholder="Release notes players will see on the store page (optional for a first release, but recommended for updates)"
          />
        </div>
      </div>
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <SectionLabel>Review & timeline</SectionLabel>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Visibility on approval</span><span className="font-semibold">Public</span></div>
        <div className="h-px bg-line my-4" />
        <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3]"
          style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
          A reviewer plays your build, checks it loads & runs, and verifies the store page. You&apos;ll be notified once it&apos;s decided.
        </div>
        <button
          onClick={s.onSubmit}
          disabled={!canSubmit || s.submitStatus === "submitting" || s.submitStatus === "submitted"}
          className="w-full mt-4 py-4 rounded-[9px] font-bold text-[15px] cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
          {s.submitStatus === "submitting" ? "Submitting…" : s.submitStatus === "submitted" ? "Submitted ✓" : "Submit for review"}
        </button>
        {s.submitStatus === "error" && <p className="text-[12.5px] mt-2" style={{ color: "#e88" }}>{s.submitError}</p>}
        {s.submitStatus === "submitted" && <p className="text-[12.5px] mt-2 text-green">Submitted — check your dashboard for review status.</p>}
      </div>
    </div>
  );
}

export default function UploadPage() {
  const [current, setCurrent] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  const [file, setFile] = useState<File | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [stage, setStage] = useState("");
  const [stageProgress, setStageProgress] = useState(0);
  const [gameId, setGameId] = useState<string | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [detectedEngine, setDetectedEngine] = useState<string | null>(null);
  const [entryFile, setEntryFile] = useState<string | null>(null);
  const [engineOverride, setEngineOverride] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [isFree, setIsFree] = useState(true);
  const [priceInput, setPriceInput] = useState("9.99");
  const [passIncluded, setPassIncluded] = useState(false);
  const [changelog, setChangelog] = useState("");

  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [submitError, setSubmitError] = useState("");

  async function onFile(f: File) {
    setFile(f);
    setErrorMsg(null);
    setWarnings([]);
    setUploadPhase("uploading");
    setUploadPct(0);
    try {
      const { storagePath } = await uploadGameBuildZip(f, (p) => setUploadPct(p.pct));
      setUploadPhase("processing");
      setStage("starting");
      setStageProgress(0.01);
      const initialTitle = title || humanizeFileName(f.name);
      let sawError = false;
      await streamNdjson("/api/uploads/games/process", { gameId: gameId ?? undefined, title: initialTitle, storagePath }, (evt) => {
        if (typeof evt.stage === "string") { setStage(evt.stage); setStageProgress(typeof evt.progress === "number" ? evt.progress : 0); }
        if (typeof evt.gameId === "string") setGameId(evt.gameId);
        if (typeof evt.buildId === "string") setBuildId(evt.buildId);
        if (Array.isArray(evt.warnings)) setWarnings(evt.warnings as string[]);
        if (typeof evt.error === "string") { sawError = true; setErrorMsg(evt.error); }
        if (evt.done) {
          if (!sawError) {
            setUploadPhase("ready");
            if (typeof evt.engine === "string") setDetectedEngine(evt.engine);
            if (typeof evt.entryFile === "string") setEntryFile(evt.entryFile);
            if (!title) setTitle(initialTitle);
          } else {
            setUploadPhase("failed");
          }
        }
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed.");
      setUploadPhase("failed");
    }
  }

  async function onSubmit() {
    if (!gameId) return;
    setSubmitStatus("submitting");
    setSubmitError("");
    try {
      const res = await fetch(`/api/games/${gameId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          shortDescription,
          priceCents: isFree ? 0 : Math.round((Number(priceInput) || 0) * 100),
          passIncluded,
          engine: engineOverride ?? undefined,
          changelog: changelog.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not submit for review.");
      setSubmitStatus("submitted");
    } catch (e) {
      setSubmitStatus("error");
      setSubmitError(e instanceof Error ? e.message : "Could not submit for review.");
    }
  }

  const shared: SharedState = {
    file, uploadPhase, uploadPct, stage, stageProgress, gameId, buildId,
    detectedEngine, entryFile, engineOverride, warnings, errorMsg,
    title, shortDescription, isFree, priceInput, passIncluded, changelog,
    submitStatus, submitError,
    onFile, setEngineOverride, setTitle, setShortDescription, setIsFree, setPriceInput, setPassIncluded, setChangelog, onSubmit,
  };

  const goTo = (i: number) => { setCurrent(i); window.scrollTo({ top: 0 }); };
  const next = () => { setCompleted(prev => new Set([...prev, current])); goTo(Math.min(current + 1, 4)); };
  const back = () => goTo(Math.max(current - 1, 0));

  const panes = [<Step1 key="1" s={shared} />, <Step2 key="2" s={shared} />, <Step3 key="3" s={shared} />, <Step4 key="4" />, <Step5 key="5" s={shared} />];

  return (
    <>
      <CreatorSubNav />
      <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-[12px] font-bold tracking-[.14em] uppercase text-accent">New submission</p>
            <h1 className="text-[30px] font-extrabold tracking-[-0.02em] mt-1.5">{title ? `Upload "${title}"` : "Upload a game"}</h1>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-1.5 rounded-full uppercase tracking-[.04em]"
            style={{ background: "rgba(255,255,255,.06)", color: "#8aa0b4" }}>
            {submitStatus === "submitted" ? "Submitted" : "Draft"}
          </span>
        </div>

        <div className="grid gap-7 items-start" style={{ gridTemplateColumns: "230px 1fr" }}>
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

          <div>
            {panes[current]}
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
