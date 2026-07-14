"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient, getSupabaseEnvStatus } from "@/lib/supabase";

type StaffRole = "auditor" | "reviewer" | "senior_reviewer" | "admin";

type Submission = {
  id: string;
  clerk_user_id: string;
  game_id: string | null;
  build_id: string | null;
  title: string | null;
  engine: string | null;
  status: "draft" | "validating" | "pending_review" | "approved" | "rejected" | "changes_requested";
  validation_result: { engine?: string; entryFile?: string; fileCount?: number; totalBytes?: number; warnings?: string[]; error?: string } | null;
  review_notes: string | null;
  created_at: string;
};

type LiveGame = {
  id: string;
  title: string;
  status: string;
  engine: string | null;
  price_cents: number;
  created_at: string;
};

type Filter = "pending" | "approved" | "rejected" | "all";
type Tab = "submissions" | "live";

function badge(status: Submission["status"]) {
  switch (status) {
    case "approved": return "bg-[rgba(123,194,74,.16)] text-[#a6e06a]";
    case "rejected": return "bg-[rgba(227,92,92,.16)] text-[#e88]";
    case "changes_requested": return "bg-[rgba(232,169,58,.16)] text-[#f0c66a]";
    default: return "bg-[rgba(232,169,58,.16)] text-[#f0c66a]";
  }
}

function bytes(n?: number) {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function AdminGamesPage() {
  const { isLoaded } = useUser();
  const [tab, setTab] = useState<Tab>("submissions");
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [staffChecked, setStaffChecked] = useState(false);
  const isStaff = staffRole !== null;
  const canDecide = staffRole === "admin" || staffRole === "senior_reviewer";

  const [rows, setRows] = useState<Submission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [suspendReason, setSuspendReason] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isLoaded) return;
    fetch("/api/staff/me")
      .then((r) => r.json())
      .then((body: { staff: { role: StaffRole } | null }) => setStaffRole(body.staff?.role ?? null))
      .catch(() => setStaffRole(null))
      .finally(() => setStaffChecked(true));
  }, [isLoaded]);

  async function loadSubmissions() {
    setLoading(true);
    const supabase = getSupabaseClient();
    if (!supabase) {
      const env = getSupabaseEnvStatus();
      setError(env.missing.length ? `Missing Supabase env vars: ${env.missing.join(", ")}.` : "Supabase not configured.");
      setLoading(false);
      return;
    }
    const { data, error: e } = await supabase.from("game_submissions").select("*").order("created_at", { ascending: false });
    if (e) setError(e.message);
    else setRows((data as Submission[]) ?? []);
    setLoading(false);
  }

  async function loadLiveGames() {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase
      .from("games")
      .select("id, title, status, engine, price_cents, created_at")
      .in("status", ["live", "suspended"])
      .order("created_at", { ascending: false });
    setLiveGames((data as LiveGame[]) ?? []);
  }

  useEffect(() => {
    if (!staffChecked) return;
    if (!isStaff) { setLoading(false); return; }
    loadSubmissions();
    loadLiveGames();
  }, [staffChecked, isStaff]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "pending") return rows.filter((r) => r.status === "pending_review" || r.status === "validating" || r.status === "draft");
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);
  const selected = rows.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  async function decide(status: "approved" | "rejected" | "changes_requested") {
    if (!selected) return;
    const res = await fetch(`/api/admin/games/submissions/${selected.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: status, reviewNotes: notes || selected.review_notes }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error ?? "Could not save this decision."); return; }
    setNotes("");
    setRows((prev) => prev.map((r) => (r.id === selected.id ? { ...r, status, review_notes: notes || r.review_notes } : r)));
    loadLiveGames();
  }

  async function suspend(gameId: string) {
    const reason = suspendReason[gameId]?.trim();
    if (!reason) { setError("A reason is required to suspend a game."); return; }
    const res = await fetch(`/api/admin/games/${gameId}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error ?? "Could not suspend this game."); return; }
    setLiveGames((prev) => prev.map((g) => (g.id === gameId ? { ...g, status: "suspended" } : g)));
  }

  async function reinstate(gameId: string) {
    const res = await fetch(`/api/admin/games/${gameId}/reinstate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: suspendReason[gameId]?.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error ?? "Could not reinstate this game."); return; }
    setLiveGames((prev) => prev.map((g) => (g.id === gameId ? { ...g, status: "live" } : g)));
  }

  if (staffChecked && !isStaff) {
    return (
      <main className="min-h-screen px-12 py-10">
        <div className="max-w-[640px] bg-panel border border-line rounded-[14px] p-7">
          <h1 className="text-[24px] font-extrabold">Game review</h1>
          <p className="text-[14px] text-dim mt-2">Access denied. Sign in with a staff account to review game submissions.</p>
          <Link href="/admin" className="inline-block mt-4 px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">Creator review console</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 lg:px-12 py-8">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">Game submissions</h1>
        <div className="flex-1" />
        <Link href="/admin/tools" className="px-3 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">Tool submissions</Link>
        <Link href="/admin" className="px-3 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">Creator review</Link>
      </div>

      {error && <div className="mb-4 p-3 rounded-[9px] text-[13px]" style={{ background: "rgba(227,92,92,.08)", border: "1px solid rgba(227,92,92,.4)", color: "#f0a6a6" }}>{error}</div>}

      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab("submissions")} className="px-3 py-1.5 rounded-full border text-[12px] font-semibold" style={{ background: tab === "submissions" ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: tab === "submissions" ? "#56a6e8" : "#26384a", color: tab === "submissions" ? "#cfe6fb" : "#e7eef4" }}>New submissions</button>
        <button onClick={() => setTab("live")} className="px-3 py-1.5 rounded-full border text-[12px] font-semibold" style={{ background: tab === "live" ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: tab === "live" ? "#56a6e8" : "#26384a", color: tab === "live" ? "#cfe6fb" : "#e7eef4" }}>Live games (moderation)</button>
      </div>

      {tab === "submissions" ? (
        <>
          <div className="flex gap-2 mb-5">
            {(["pending", "approved", "rejected", "all"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className="px-3 py-1.5 rounded-full border text-[12px] font-semibold capitalize" style={{ background: filter === f ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: filter === f ? "#56a6e8" : "#26384a", color: filter === f ? "#cfe6fb" : "#e7eef4" }}>{f}</button>
            ))}
          </div>

          <div className="grid gap-6 items-start" style={{ gridTemplateColumns: "360px 1fr" }}>
            <div className="bg-panel border border-line rounded-[10px] overflow-hidden max-h-[72vh] overflow-y-auto">
              {loading ? (
                <div className="p-6 text-dim">Loading…</div>
              ) : filtered.length ? (
                filtered.map((r) => (
                  <button key={r.id} onClick={() => setSelectedId(r.id)} className="w-full text-left px-5 py-4 border-b border-line last:border-none hover:bg-white/[.025]" style={{ background: r.id === selected?.id ? "rgba(86,166,232,.08)" : undefined }}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[14px] truncate">{r.title || "Untitled game"}</div>
                        <div className="text-[12px] text-dim truncate">{r.engine ?? "engine unknown"}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${badge(r.status)}`}>{r.status.replace("_", " ")}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-6 text-dim">No submissions in this view.</div>
              )}
            </div>

            <div className="bg-panel border border-line rounded-[10px]">
              {!selected ? (
                <div className="p-8 text-dim">Select a submission.</div>
              ) : (
                <>
                  <div className="p-6 border-b border-line">
                    <div className="flex items-center gap-3">
                      <div>
                        <h2 className="text-[20px] font-extrabold">{selected.title || "Untitled game"}</h2>
                        <div className="text-[12.5px] text-dim">{selected.engine ?? "engine unknown"}</div>
                      </div>
                      <span className={`ml-auto text-[11px] font-bold px-2 py-1 rounded-full uppercase ${badge(selected.status)}`}>{selected.status.replace("_", " ")}</span>
                    </div>
                  </div>

                  <div className="p-6 border-b border-line grid grid-cols-2 gap-3 text-[13px]">
                    <Info label="Submitter">{selected.clerk_user_id}</Info>
                    <Info label="Detected engine">{selected.validation_result?.engine ?? "—"}</Info>
                    <Info label="Entry file">{selected.validation_result?.entryFile ?? "—"}</Info>
                    <Info label="Files / size">{selected.validation_result?.fileCount ?? "—"} files · {bytes(selected.validation_result?.totalBytes)}</Info>
                    {selected.validation_result?.warnings?.length ? (
                      <div className="col-span-2 bg-[#1a1508] border border-[rgba(232,169,58,.4)] rounded-[9px] p-3 text-[12.5px] text-[#f0c66a]">
                        {selected.validation_result.warnings.join(" · ")}
                      </div>
                    ) : null}
                    {selected.validation_result?.error ? (
                      <div className="col-span-2 bg-[rgba(227,92,92,.08)] border border-[rgba(227,92,92,.4)] rounded-[9px] p-3 text-[12.5px] text-[#f0a6a6]">
                        {selected.validation_result.error}
                      </div>
                    ) : null}
                  </div>

                  <div className="p-6">
                    <div className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Decision</div>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Review notes (sent with the decision)…" className="w-full min-h-[90px] bg-[#0a0e13] border border-line rounded-[10px] px-3.5 py-3 text-[13px] outline-none mb-3" />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => decide("approved")} disabled={!canDecide} className="px-4 py-2 rounded-[8px] font-bold text-[13px] disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: "linear-gradient(180deg,#8bc34a,#5c8a1e)", color: "#0e1a06" }} title={canDecide ? "" : "Your role cannot approve or reject"}>Approve & publish</button>
                      <button onClick={() => decide("changes_requested")} className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold">Request changes</button>
                      <button onClick={() => decide("rejected")} disabled={!canDecide} className="px-4 py-2 rounded-[8px] border text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed" style={{ borderColor: "rgba(232,136,136,.45)", color: "#e88" }} title={canDecide ? "" : "Your role cannot approve or reject"}>Reject</button>
                    </div>
                    {selected.review_notes && <p className="text-[12.5px] text-dim mt-3">Last note: {selected.review_notes}</p>}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="bg-panel border border-line rounded-[10px] overflow-hidden">
          {liveGames.length === 0 ? (
            <div className="p-6 text-dim">No live or suspended games yet.</div>
          ) : (
            liveGames.map((g) => (
              <div key={g.id} className="p-5 border-b border-line last:border-none flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-[14px]">{g.title}</div>
                  <div className="text-[12px] text-dim">{g.engine ?? "engine unknown"} · {g.price_cents === 0 ? "Free" : `$${(g.price_cents / 100).toFixed(2)}`}</div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${g.status === "live" ? "bg-[rgba(123,194,74,.16)] text-[#a6e06a]" : "bg-[rgba(227,92,92,.16)] text-[#e88]"}`}>{g.status}</span>
                <input
                  value={suspendReason[g.id] ?? ""}
                  onChange={(e) => setSuspendReason((prev) => ({ ...prev, [g.id]: e.target.value }))}
                  placeholder={g.status === "live" ? "Reason for suspension…" : "Reason for reinstating…"}
                  className="bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-[12.5px] w-[260px]"
                />
                {g.status === "live" ? (
                  <button onClick={() => suspend(g.id)} disabled={!canDecide} className="px-3 py-2 rounded-[8px] border text-[12.5px] font-semibold disabled:opacity-50" style={{ borderColor: "rgba(232,136,136,.45)", color: "#e88" }}>Suspend</button>
                ) : (
                  <button onClick={() => reinstate(g.id)} disabled={!canDecide} className="px-3 py-2 rounded-[8px] border border-line bg-panel2 text-[12.5px] font-semibold disabled:opacity-50">Reinstate</button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0a0e13] border border-line rounded-[9px] p-3">
      <div className="text-[11px] text-dim uppercase">{label}</div>
      <div className="font-semibold mt-1 break-all">{children}</div>
    </div>
  );
}
