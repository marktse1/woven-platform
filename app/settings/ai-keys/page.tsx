"use client";

import { useEffect, useState } from "react";

type Provider = "anthropic" | "openai" | "google";
type KeyRow = { provider: Provider; key_hint: string; model: string | null; updated_at: string };

const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI", google: "Google (Gemini)" };
const PROVIDER_DEFAULT_MODEL: Record<Provider, string> = { anthropic: "claude-sonnet-5", openai: "gpt-4o", google: "gemini-2.0-flash" };

export default function AiKeysSettingsPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/settings/ai-keys");
    const body = await res.json();
    if (res.ok) setKeys(body.keys ?? []);
    else setError(body.error ?? "Could not load keys");
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/ai-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, model: model || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save key");
      setApiKey("");
      setModel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save key");
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Provider) {
    await fetch("/api/settings/ai-keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: p }) });
    await load();
  }

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink px-6 lg:px-12 py-10">
      <div className="max-w-[720px] mx-auto">
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">AI editor keys</h1>
        <p className="text-[13.5px] text-dim mt-2 mb-6">
          The in-browser AI code editor uses Claude by default, billed to Woven. Add your own API key from any provider below to use your
          own account instead — your key is encrypted and only ever used for your own edit sessions.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-[9px] text-[13px]" style={{ background: "rgba(227,92,92,.08)", border: "1px solid rgba(227,92,92,.4)", color: "#f0a6a6" }}>
            {error}
          </div>
        )}

        <div className="bg-panel border border-line rounded-[12px] p-5 mb-6">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Your keys</p>
          {loading ? (
            <div className="text-[13px] text-dim">Loading…</div>
          ) : keys.length === 0 ? (
            <div className="text-[13px] text-dim">No keys configured — sessions will use Woven&apos;s shared Claude key.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {keys.map((k) => (
                <div key={k.provider} className="flex items-center gap-3 p-3 rounded-[9px] border border-line bg-[#0a0e13]">
                  <div className="flex-1">
                    <div className="font-semibold text-[13.5px]">{PROVIDER_LABEL[k.provider]}</div>
                    <div className="text-[12px] text-dim font-mono">key {k.key_hint} · model: {k.model || PROVIDER_DEFAULT_MODEL[k.provider]}</div>
                  </div>
                  <button onClick={() => remove(k.provider)} className="text-[12px] text-dim hover:text-[#e88]">Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-panel border border-line rounded-[12px] p-5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Add or update a key</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[12.5px] font-semibold text-muted block mb-1.5">Provider</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className="w-full bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-[13.5px]">
                {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                  <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-muted block mb-1.5">API key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" className="w-full bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-[13.5px] font-mono outline-none" />
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-muted block mb-1.5">Model (optional)</label>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={PROVIDER_DEFAULT_MODEL[provider]} className="w-full bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-[13.5px] font-mono outline-none" />
            </div>
            <button onClick={save} disabled={saving || !apiKey.trim()} className="mt-1 py-2.5 rounded-[9px] font-bold text-[14px] disabled:opacity-50" style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}>
              {saving ? "Saving…" : "Save key"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
