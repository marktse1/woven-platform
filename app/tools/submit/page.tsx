"use client";
export const dynamic = "force-dynamic";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient } from "@/lib/supabase";

const CATEGORIES = ["modeling", "texturing", "audio", "utility", "other"];

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const inputCls =
  "w-full bg-[#0a0e13] border border-line rounded-lg px-3.5 py-2.5 text-ink text-[14px] outline-none focus:border-accent transition-colors";

export default function SubmitToolPage() {
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

  if (isLoaded && !user?.id) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center px-6">
        <div className="max-w-[480px] bg-panel border border-line rounded-[12px] p-6">
          <h1 className="text-[20px] font-extrabold mb-2">Submit a tool</h1>
          <p className="text-[13px] text-dim">Sign in to submit a tool for review.</p>
          <Link href="/sign-in" className="inline-block mt-4 px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}>Sign in</Link>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center px-6">
        <div className="max-w-[480px] bg-panel border border-line rounded-[12px] p-6 text-center">
          <div className="text-[34px] mb-2">✅</div>
          <h1 className="text-[20px] font-extrabold mb-2">Submitted for review</h1>
          <p className="text-[13px] text-dim">An admin will review <strong>{name}</strong>. Approved tools appear in Weave Forge automatically.</p>
          <Link href="/forge" className="inline-block mt-4 px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">Back to Forge</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="tool-min-h bg-[#070b11] text-ink">
      <div className="max-w-[720px] mx-auto px-6 pt-10 pb-16">
        <Link href="/forge" className="text-[12px] text-dim no-underline hover:text-ink">← Forge</Link>
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em] mt-2 mb-1">Submit a tool</h1>
        <p className="text-[14px] text-muted mb-6">Share a creator tool with the Woven community. An admin reviews every submission before it goes live.</p>

        {error && <div className="mb-4 p-3 rounded-[9px] text-[13px]" style={{ background: "rgba(227,92,92,.08)", border: "1px solid rgba(227,92,92,.4)", color: "#f0a6a6" }}>{error}</div>}

        <div className="bg-panel border border-line rounded-[12px] p-6 flex flex-col gap-4">
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
                <button key={k} onClick={() => setKind(k)} className="flex-1 py-2.5 rounded-lg border text-[13px] font-semibold capitalize" style={{ borderColor: kind === k ? "#56a6e8" : "#26384a", background: kind === k ? "rgba(86,166,232,.14)" : "#0d141c", color: kind === k ? "#cfe6fb" : "#8aa0b4" }}>
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

          <button onClick={submit} disabled={busy} className="mt-2 py-3.5 rounded-[10px] font-bold text-[14px] disabled:opacity-50" style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}>
            {busy ? "Submitting…" : "Submit for review"}
          </button>
        </div>
      </div>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-muted">{label}{hint && <span className="text-dim font-normal ml-1.5">· {hint}</span>}</label>
      {children}
    </div>
  );
}
