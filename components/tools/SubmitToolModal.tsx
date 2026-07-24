"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient } from "@/lib/supabase";

const CATEGORIES = ["modeling", "texturing", "audio", "utility", "other"];

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const inputCls =
  "w-full bg-[#0a0e13] border border-line rounded-lg px-3.5 py-2.5 text-ink text-[14px] outline-none focus:border-accent transition-colors";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-muted">{label}{hint && <span className="text-dim font-normal ml-1.5">· {hint}</span>}</label>
      {children}
    </div>
  );
}

export default function SubmitToolModal({ onClose }: { onClose: () => void }) {
  const { user, isLoaded } = useUser();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("utility");
  const [kind, setKind] = useState<"hosted" | "native">("hosted");
  const [buildUrl, setBuildUrl] = useState("");
  const [entryFile, setEntryFile] = useState("index.html");
  const [icon, setIcon] = useState("🧩");
  const [engine, setEngine] = useState("");

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const effectiveSlug = slug || slugify(name);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, busy]);

  async function submit() {
    setError("");
    if (!user?.id) { setError("Sign in to submit a tool."); return; }
    if (!name.trim() || !effectiveSlug) { setError("Name is required."); return; }
    if (kind === "hosted" && !buildUrl.trim()) { setError("Hosted tools need a build URL."); return; }

    const supabase = getSupabaseClient();
    if (!supabase) { setError("Supabase is not configured."); return; }

    setBusy(true);
    const { error: insErr } = await supabase.from("tool_submissions").insert({
      clerk_user_id: user.id,
      name: name.trim(),
      slug: effectiveSlug,
      summary: summary.trim() || null,
      description: description.trim() || null,
      category,
      kind,
      build_url: kind === "hosted" ? buildUrl.trim() : null,
      entry_file: kind === "hosted" ? entryFile.trim() || "index.html" : null,
      icon: icon || "🧩",
      engine: engine.trim() || null,
      status: "pending",
    });
    setBusy(false);
    if (insErr) { setError(insErr.message); return; }
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="bg-panel border border-line rounded-[14px] w-full max-w-[720px] max-h-[85vh] overflow-y-auto shadow-[0_24px_60px_rgba(0,0,0,.7)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line sticky top-0 bg-panel">
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">Submit a tool</h2>
          <button onClick={() => !busy && onClose()} className="text-dim hover:text-ink text-[20px] leading-none cursor-pointer bg-transparent border-none">×</button>
        </div>

        {!isLoaded ? (
          <div className="px-6 py-10 text-center text-dim text-[13px]">Loading…</div>
        ) : !user?.id ? (
          <div className="px-6 py-10 text-center">
            <p className="text-[13px] text-dim mb-4">Sign in to submit a tool for review.</p>
            <Link href="/sign-in" className="inline-block px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}>Sign in</Link>
          </div>
        ) : done ? (
          <div className="px-6 py-10 text-center">
            <div className="text-[34px] mb-2">✅</div>
            <p className="text-[16px] font-bold mb-2">Submitted for review</p>
            <p className="text-[13px] text-dim mb-4">An admin will review <strong>{name}</strong>. Approved tools appear in Weave Forge automatically.</p>
            <button onClick={onClose} className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold cursor-pointer">Done</button>
          </div>
        ) : (
          <div className="px-6 py-5">
            <p className="text-[13px] text-muted mb-4">Share a creator tool with the Woven community. An admin reviews every submission before it goes live.</p>

            {error && <div className="mb-4 p-3 rounded-[9px] text-[13px]" style={{ background: "rgba(227,92,92,.08)", border: "1px solid rgba(227,92,92,.4)", color: "#f0a6a6" }}>{error}</div>}

            <div className="flex flex-col gap-4">
              <Field label="Tool name">
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="UV Unwrapper Pro" />
              </Field>
              <Field label="Slug" hint={`URL id · ${effectiveSlug || "auto"}`}>
                <input className={inputCls} value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder={slugify(name) || "uv-unwrapper-pro"} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Icon (emoji)"><input className={inputCls} value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} /></Field>
                <Field label="Category">
                  <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="One-line summary"><input className={inputCls} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Fast automatic UV unwrapping for game assets." /></Field>
              <Field label="Description"><textarea rows={4} className={`${inputCls} resize-none`} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>

              <Field label="Tool type">
                <div className="flex gap-2">
                  {(["hosted", "native"] as const).map((k) => (
                    <button key={k} onClick={() => setKind(k)} className="flex-1 py-2.5 rounded-lg border text-[13px] font-semibold capitalize cursor-pointer" style={{ borderColor: kind === k ? "#56a6e8" : "#26384a", background: kind === k ? "rgba(86,166,232,.14)" : "#0d141c", color: kind === k ? "#cfe6fb" : "#8aa0b4" }}>
                      {k === "hosted" ? "Hosted web build (iframe)" : "Native (in-repo) proposal"}
                    </button>
                  ))}
                </div>
              </Field>

              {kind === "hosted" ? (
                <>
                  <Field label="Build URL" hint="HTTPS URL where your tool is hosted"><input className={inputCls} value={buildUrl} onChange={(e) => setBuildUrl(e.target.value)} placeholder="https://my-tool.example.com/" /></Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Entry file"><input className={inputCls} value={entryFile} onChange={(e) => setEntryFile(e.target.value)} /></Field>
                    <Field label="Engine (optional)"><input className={inputCls} value={engine} onChange={(e) => setEngine(e.target.value)} placeholder="three.js" /></Field>
                  </div>
                </>
              ) : (
                <p className="text-[12.5px] text-dim p-3 rounded-[9px]" style={{ background: "rgba(86,166,232,.08)", border: "1px solid #2c6aa0" }}>
                  Native tools are reviewed as a proposal — the team will reach out to integrate the module into the repo registry.
                </p>
              )}

              <button onClick={submit} disabled={busy} className="mt-2 py-3.5 rounded-[10px] font-bold text-[14px] cursor-pointer disabled:opacity-50" style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}>
                {busy ? "Submitting…" : "Submit for review"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
