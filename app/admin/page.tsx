"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient, getSupabaseEnvStatus } from "@/lib/supabase";
import { getAutoApproveCreators, setAutoApproveCreators } from "@/lib/platformSettings";

type CreatorProfile = {
  id: string;
  clerk_user_id?: string | null;
  status: "pending" | "approved" | "rejected";
  studio_name?: string | null;
  handle?: string | null;
  [key: string]: unknown;
};

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "auditor" | "reviewer" | "senior_reviewer" | "admin";
  status: "active" | "disabled";
  bootstrap?: boolean;
  color: string;
};

const BOOTSTRAP_ADMIN_EMAIL = "starfox.and.mark@gmail.com";
const REVIEW_STORAGE_KEY = "woven_creator_review_v1";
const TEAM_STORAGE_KEY = "woven_creator_team_v1";

const ROLE_LABEL: Record<TeamMember["role"], string> = {
  auditor: "Auditor",
  reviewer: "T&S Reviewer",
  senior_reviewer: "Senior Reviewer",
  admin: "T&S Admin",
};

const DEFAULT_TEAM: TeamMember[] = [
  { id: "u_mark", name: "Mark (Starfox)", email: BOOTSTRAP_ADMIN_EMAIL, role: "admin", status: "active", bootstrap: true, color: "#e8a93a" },
  { id: "u_reina", name: "Reina T.", email: "reina.t@woven.gg", role: "senior_reviewer", status: "active", color: "#56a6e8" },
  { id: "u_devon", name: "Devon K.", email: "devon.k@woven.gg", role: "reviewer", status: "active", color: "#7bc24a" },
  { id: "u_priya", name: "Priya N.", email: "priya.n@woven.gg", role: "auditor", status: "active", color: "#c089e0" },
];

function initials(name: string) {
  return name
    .split(/[\s()]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function statusStyle(status: CreatorProfile["status"]) {
  switch (status) {
    case "approved":
      return "bg-[rgba(123,194,74,.16)] text-[#a6e06a]";
    case "rejected":
      return "bg-[rgba(227,92,92,.16)] text-[#e88]";
    default:
      return "bg-[rgba(232,169,58,.16)] text-[#f0c66a]";
  }
}

function reviewCopy(status: CreatorProfile["status"]) {
  if (status === "approved") return "Creator access is unlocked.";
  if (status === "rejected") return "Rejected. The applicant can submit again later.";
  return "Pending review. This application has not been decided yet.";
}

export default function AdminReviewPage() {
  const { user, isLoaded } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState<CreatorProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [note, setNote] = useState("");
  const [notesById, setNotesById] = useState<Record<string, Array<{ text: string; at: string }>>>({});
  const [activityById, setActivityById] = useState<Record<string, Array<{ text: string; at: string }>>>({});
  const [previewRole, setPreviewRole] = useState<TeamMember["role"]>("admin");
  const [team, setTeam] = useState<TeamMember[]>(DEFAULT_TEAM);
  const [teamOpen, setTeamOpen] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [autoApproveBusy, setAutoApproveBusy] = useState(false);

  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "";
  const isBootstrapAdmin = currentEmail.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;

  useEffect(() => {
    try {
      const rawNotes = localStorage.getItem(REVIEW_STORAGE_KEY);
      if (rawNotes) {
        const parsed = JSON.parse(rawNotes) as typeof notesById;
        setNotesById(parsed || {});
      }
      const rawTeam = localStorage.getItem(TEAM_STORAGE_KEY);
      if (rawTeam) {
        const parsed = JSON.parse(rawTeam) as TeamMember[];
        if (Array.isArray(parsed) && parsed.length) setTeam(parsed);
      }
    } catch {
      // ignore local storage issues
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(notesById));
    } catch {
      // ignore
    }
  }, [notesById]);

  useEffect(() => {
    try {
      localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(team));
    } catch {
      // ignore
    }
  }, [team]);

  useEffect(() => {
    let active = true;

    async function loadProfiles() {
      setLoading(true);
      setError("");

      if (!isLoaded) return;
      if (!user?.id) {
        if (active) {
          setError("Sign in to open the staff console.");
          setLoading(false);
        }
        return;
      }

      if (!isBootstrapAdmin) {
        if (active) {
          setError("Access denied. Use the bootstrap admin account to review creator applications.");
          setLoading(false);
        }
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        if (active) {
          const env = getSupabaseEnvStatus();
          setError(
            env.missing.length
              ? `Missing Supabase env vars: ${env.missing.join(", ")}.`
              : "Supabase client could not initialize. Check the Woven Vercel env vars."
          );
          setLoading(false);
        }
        return;
      }

      const { data, error: loadError } = await supabase
        .from("creator_profiles")
        .select("id, clerk_user_id, status, studio_name, handle")
        .order("id", { ascending: false });

      if (!active) return;

      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as CreatorProfile[];
      setProfiles(rows);
      if (!selectedId && rows.length) setSelectedId(rows[0].id);
      setLoading(false);
    }

    loadProfiles().catch((loadError: unknown) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load creator applications.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
   }, [isBootstrapAdmin, isLoaded, user?.id]);

  useEffect(() => {
    if (!isBootstrapAdmin) return;
    let active = true;
    getAutoApproveCreators()
      .then((value) => {
        if (active) setAutoApprove(value);
      })
      .catch(() => {
        // Leave the toggle at its default (off) if this fails to load.
      });
    return () => {
      active = false;
    };
  }, [isBootstrapAdmin]);

  async function toggleAutoApprove() {
    const next = !autoApprove;
    setAutoApproveBusy(true);
    try {
      await setAutoApproveCreators(next);
      setAutoApprove(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the auto-approve setting.");
    } finally {
      setAutoApproveBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((row) => {
      const matchesFilter = filter === "all" ? true : row.status === filter;
      const haystack = `${row.studio_name ?? ""} ${row.handle ?? ""} ${row.clerk_user_id ?? ""}`.toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [filter, profiles, search]);

  useEffect(() => {
    if (!filtered.length) return;
    if (!selectedId || !filtered.some((row) => row.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = profiles.find((row) => row.id === selectedId) ?? null;
  const currentRole = isBootstrapAdmin ? previewRole : "auditor";
  const canApprove = currentRole === "senior_reviewer" || currentRole === "admin";
  const canRequestChanges = currentRole !== "auditor";
  const canAddNote = currentRole !== "auditor";
  const canReopen = currentRole === "senior_reviewer" || currentRole === "admin";
  const counts = {
    pending: profiles.filter((row) => row.status === "pending").length,
    approved: profiles.filter((row) => row.status === "approved").length,
    rejected: profiles.filter((row) => row.status === "rejected").length,
  };

  async function updateStatus(nextStatus: CreatorProfile["status"], reason: string) {
    if (!selected) return;
    const supabase = getSupabaseClient();
    if (!supabase) {
      const env = getSupabaseEnvStatus();
      setError(
        env.missing.length
          ? `Missing Supabase env vars: ${env.missing.join(", ")}.`
          : "Supabase client could not initialize. Check the Woven Vercel env vars."
      );
      return;
    }

    const { error: updateError } = await supabase
      .from("creator_profiles")
      .update({ status: nextStatus })
      .eq("id", selected.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setProfiles((prev) => prev.map((row) => (row.id === selected.id ? { ...row, status: nextStatus } : row)));
    setActivityById((prev) => ({
      ...prev,
      [selected.id]: [{ text: reason, at: new Date().toLocaleString() }, ...(prev[selected.id] ?? [])],
    }));
  }

  function addNote() {
    if (!selected || !note.trim()) return;
    setNotesById((prev) => ({
      ...prev,
      [selected.id]: [{ text: note.trim(), at: new Date().toLocaleString() }, ...(prev[selected.id] ?? [])],
    }));
    setActivityById((prev) => ({
      ...prev,
      [selected.id]: [{ text: "Added an internal note", at: new Date().toLocaleString() }, ...(prev[selected.id] ?? [])],
    }));
    setNote("");
  }

  function activeAdminsCount(nextTeam = team) {
    return nextTeam.filter((member) => member.role === "admin" && member.status === "active").length;
  }

  function updateTeamMember(id: string, patch: Partial<TeamMember>) {
    setTeam((prev) => {
      const next = prev.map((member) => (member.id === id ? { ...member, ...patch } : member));
      const target = next.find((member) => member.id === id);
      if (!target) return prev;
      if (target.bootstrap && (patch.role && patch.role !== "admin")) return prev;
      if (target.bootstrap && patch.status === "disabled") return prev;
      if (target.role === "admin" && patch.role && patch.role !== "admin" && activeAdminsCount(next) < 1) return prev;
      if (target.role === "admin" && patch.status === "disabled" && activeAdminsCount(next) < 1) return prev;
      return next;
    });
  }

  if (!isLoaded) {
    return (
      <main className="min-h-screen px-12 py-10">
        <div className="bg-panel border border-line rounded-[10px] p-6 text-dim">Loading staff console...</div>
      </main>
    );
  }

  if (!user?.id || error) {
    return (
      <main className="min-h-screen px-12 py-10">
        <div className="max-w-[780px] bg-panel border border-line rounded-[14px] p-7">
          <div className="text-[12px] font-bold tracking-[.12em] uppercase text-muted">Weave Forge</div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em] mt-2">Creator review console</h1>
          <p className="text-[14px] text-dim mt-2">{error || "Sign in to review creator applications."}</p>
          <div className="flex gap-2 mt-5">
            <Link href="/dashboard" className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
              Back to dashboard
            </Link>
            <Link href="/creator-signup" className="px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
              Open creator signup
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-12 py-8">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-[30px] h-[30px] rounded-[7px] border border-accent2 shrink-0"
          style={{ background: "repeating-linear-gradient(45deg, #56a6e8 0 3px, transparent 3px 7px), repeating-linear-gradient(-45deg, #2c6aa0 0 3px, transparent 3px 7px), #0b0f14" }} />
        <div>
          <div className="text-[12px] font-bold tracking-[.12em] uppercase text-muted">Weave Forge</div>
          <div className="text-[13px] text-dim">Creator review console and staff tooling</div>
        </div>
        <div className="flex-1" />
        <div className="text-[12px] text-dim">Signed in as {currentEmail}</div>
        <div className="px-3 py-1.5 rounded-full text-[12px] font-bold" style={{ background: "rgba(86,166,232,.14)", color: "#cfe6fb" }}>
          {ROLE_LABEL.admin}
        </div>
        <Link href="/dashboard" className="px-3 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
          Dashboard
        </Link>
      </div>

      <div className="flex items-end justify-between gap-6 mb-5">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em]">Creator applications</h1>
          <p className="text-[14px] text-dim mt-1">Approving a creator profile unlocks the dashboard and Forge for that account.</p>
        </div>
        <div className="flex gap-2 items-center">
          {(["pending", "approved", "rejected", "all"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className="px-3 py-1.5 rounded-full border text-[12px] font-semibold capitalize"
              style={{
                background: filter === item ? "rgba(86,166,232,.14)" : "#1b2836",
                borderColor: filter === item ? "#56a6e8" : "#26384a",
                color: filter === item ? "#cfe6fb" : "#e7eef4",
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {isBootstrapAdmin ? (
        <div
          className="flex items-center gap-4 p-4 rounded-[10px] border mb-6"
          style={{
            borderColor: autoApprove ? "rgba(232,169,58,.5)" : "#26384a",
            background: autoApprove ? "rgba(232,169,58,.08)" : "transparent",
          }}
        >
          <div className="flex-1">
            <div className="font-bold text-[14px]">Auto-approve creator applications</div>
            <div className="text-[12.5px] text-dim mt-0.5">
              {autoApprove
                ? "On — every new application is approved instantly, skipping this review queue entirely."
                : "Off — new applications land here as Pending until a reviewer decides."}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleAutoApprove}
            disabled={autoApproveBusy}
            className="relative w-[42px] h-6 rounded-full border shrink-0 transition-colors disabled:opacity-50"
            style={{
              background: autoApprove ? "rgba(232,169,58,.25)" : "#223345",
              borderColor: autoApprove ? "#e8a93a" : "#324a61",
            }}
          >
            <span
              className="absolute top-[3px] w-[18px] h-[18px] rounded-full transition-[left]"
              style={{ left: autoApprove ? "21px" : "3px", background: autoApprove ? "#e8a93a" : "#5d738a" }}
            />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-panel border border-line rounded-[10px] p-4">
          <div className="text-[11px] font-bold tracking-[.08em] uppercase text-muted">Pending</div>
          <div className="text-[30px] font-extrabold mt-2">{counts.pending}</div>
        </div>
        <div className="bg-panel border border-line rounded-[10px] p-4">
          <div className="text-[11px] font-bold tracking-[.08em] uppercase text-muted">Approved</div>
          <div className="text-[30px] font-extrabold mt-2 text-[#a6e06a]">{counts.approved}</div>
        </div>
        <div className="bg-panel border border-line rounded-[10px] p-4">
          <div className="text-[11px] font-bold tracking-[.08em] uppercase text-muted">Rejected</div>
          <div className="text-[30px] font-extrabold mt-2 text-[#e88]">{counts.rejected}</div>
        </div>
        <div className="bg-panel border border-line rounded-[10px] p-4">
          <div className="text-[11px] font-bold tracking-[.08em] uppercase text-muted">Role preview</div>
          <select
            value={previewRole}
            onChange={(e) => setPreviewRole(e.target.value as TeamMember["role"])}
            className="mt-2 w-full bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-ink text-[14px]"
          >
            <option value="auditor">Auditor</option>
            <option value="reviewer">T&S Reviewer</option>
            <option value="senior_reviewer">Senior Reviewer</option>
            <option value="admin">T&S Admin</option>
          </select>
        </div>
      </div>

      <div className="grid gap-6 items-start" style={{ gridTemplateColumns: "360px 1fr" }}>
        <div className="bg-panel border border-line rounded-[10px] overflow-hidden">
          <div className="px-5 py-4 border-b border-line">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search studio, handle or email"
              className="w-full bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-ink text-[13px] outline-none"
            />
          </div>
          <div className="max-h-[68vh] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-dim">Loading applications...</div>
            ) : filtered.length ? (
              filtered.map((row) => {
                const selected = row.id === selectedId;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={[
                      "w-full text-left px-5 py-4 border-b border-line last:border-b-0 hover:bg-white/[.025]",
                      selected ? "bg-[rgba(86,166,232,.08)]" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center font-extrabold text-[#06121d]" style={{ background: "#56a6e8" }}>
                        {initials(row.studio_name || row.handle || "App")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[14px] truncate">{row.studio_name || "Untitled studio"}</div>
                        <div className="text-[12px] text-dim truncate">{row.handle || "no handle"} · {row.clerk_user_id || "unlinked"}</div>
                      </div>
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-full uppercase ${statusStyle(row.status)}`}>{row.status}</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-6 text-dim">No applications in this view.</div>
            )}
          </div>
        </div>

        <div className="bg-panel border border-line rounded-[10px] overflow-hidden">
          {!selected ? (
            <div className="p-8 text-dim">Select an application to review.</div>
          ) : (
            <>
              <div className="p-6 border-b border-line">
                <div className="flex items-start gap-4">
                  <div className="w-[58px] h-[58px] rounded-[14px] flex items-center justify-center font-extrabold text-[#06121d]" style={{ background: "#56a6e8" }}>
                    {initials(selected.studio_name || selected.handle || "App")}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[22px] font-extrabold tracking-[-0.02em]">{selected.studio_name || "Untitled studio"}</h2>
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-full uppercase ${statusStyle(selected.status)}`}>{selected.status}</span>
                    </div>
                    <div className="text-[13px] text-dim mt-1">{selected.handle || "no handle"} · {selected.clerk_user_id || "unlinked"}</div>
                    <div className="text-[12px] text-muted mt-2">Profile id: {selected.id}</div>
                  </div>
                </div>
                <div className="mt-4 p-4 rounded-[10px] border border-line bg-[#0a0e13] text-[13px] text-dim">
                  {reviewCopy(selected.status)}
                </div>
              </div>

              <div className="p-6 border-b border-line">
                <div className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Decision</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => updateStatus("approved", "Approved by staff console")}
                    disabled={!canApprove}
                    className="px-4 py-2 rounded-[8px] font-bold text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}
                    title={canApprove ? "" : "Preview role cannot approve from this view"}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!canRequestChanges) return;
                      updateStatus("pending", "Requested changes from applicant");
                    }}
                    disabled={!canRequestChanges}
                    className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    onClick={() => updateStatus("rejected", "Rejected by staff console")}
                    disabled={!canApprove}
                    className="px-4 py-2 rounded-[8px] border border-[rgba(232,136,136,.45)] bg-transparent text-[#e88] text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    title={canApprove ? "" : "Preview role cannot reject from this view"}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => updateStatus("pending", "Reopened for another review pass")}
                    disabled={!canReopen}
                    className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Reopen
                  </button>
                </div>
              </div>

              <div className="grid gap-6 p-6" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <div className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Application details</div>
                  <div className="grid grid-cols-2 gap-3 text-[13px]">
                    <div className="bg-[#0a0e13] border border-line rounded-[9px] p-3">
                      <div className="text-[11px] text-dim uppercase">Studio</div>
                      <div className="font-semibold mt-1">{selected.studio_name || "Untitled studio"}</div>
                    </div>
                    <div className="bg-[#0a0e13] border border-line rounded-[9px] p-3">
                      <div className="text-[11px] text-dim uppercase">Handle</div>
                      <div className="font-semibold mt-1">{selected.handle || "No handle"}</div>
                    </div>
                    <div className="bg-[#0a0e13] border border-line rounded-[9px] p-3">
                      <div className="text-[11px] text-dim uppercase">Clerk user</div>
                      <div className="font-semibold mt-1 break-all">{selected.clerk_user_id || "Not linked yet"}</div>
                    </div>
                    <div className="bg-[#0a0e13] border border-line rounded-[9px] p-3">
                      <div className="text-[11px] text-dim uppercase">Status</div>
                      <div className="font-semibold mt-1">{selected.status}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Notes and activity</div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={canAddNote ? "Add an internal note..." : "Read only"}
                    disabled={!canAddNote}
                    className="w-full min-h-[108px] bg-[#0a0e13] border border-line rounded-[10px] px-3.5 py-3 text-ink text-[13px] outline-none disabled:opacity-60"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      type="button"
                      onClick={addNote}
                      disabled={!canAddNote || !note.trim()}
                      className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Add note
                    </button>
                  </div>
                  <div className="mt-4 space-y-2 max-h-[220px] overflow-y-auto">
                    {(notesById[selected.id] || []).map((entry, index) => (
                      <div key={`${entry.at}-${index}`} className="bg-[#0a0e13] border border-line rounded-[9px] p-3 text-[13px]">
                        <div className="text-dim text-[11px]">{entry.at}</div>
                        <div className="mt-1">{entry.text}</div>
                      </div>
                    ))}
                    {(activityById[selected.id] || []).map((entry, index) => (
                      <div key={`${entry.at}-${index}-activity`} className="bg-[rgba(86,166,232,.08)] border border-line rounded-[9px] p-3 text-[13px]">
                        <div className="text-dim text-[11px]">{entry.at}</div>
                        <div className="mt-1">{entry.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {isBootstrapAdmin ? (
        <>
          <button
            type="button"
            onClick={() => setTeamOpen(true)}
            className="fixed right-6 bottom-6 px-4 py-3 rounded-full bg-panel border border-line text-[13px] font-bold shadow-lg"
          >
            Team & roles
          </button>

          {teamOpen ? (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 flex items-center justify-center p-6" onClick={() => setTeamOpen(false)}>
              <div className="w-full max-w-[760px] bg-panel border border-line rounded-[16px] overflow-hidden" onClick={(event) => event.stopPropagation()}>
                <div className="px-6 py-5 border-b border-line flex items-start gap-3">
                  <div>
                    <div className="text-[18px] font-extrabold tracking-[-0.02em]">Team & roles</div>
                    <div className="text-[13px] text-dim mt-1">Preview team access and basic role assignments.</div>
                  </div>
                  <div className="flex-1" />
                  <button type="button" onClick={() => setTeamOpen(false)} className="px-3 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold">
                    Close
                  </button>
                </div>
                <div className="p-4 max-h-[60vh] overflow-y-auto">
                  {team.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 py-3 border-b border-line last:border-none">
                      <div className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center text-[#06121d] font-extrabold" style={{ background: member.color }}>
                        {initials(member.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-bold text-[14px]">{member.name}</div>
                          {member.bootstrap ? (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[rgba(232,169,58,.15)] text-[#f0c66a]">Bootstrap admin</span>
                          ) : null}
                        </div>
                        <div className="text-[12px] text-dim">{member.email}</div>
                      </div>
                      <select
                        value={member.role}
                        onChange={(event) => updateTeamMember(member.id, { role: event.target.value as TeamMember["role"] })}
                        disabled={member.bootstrap}
                        className="bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-ink text-[12px] disabled:opacity-50"
                      >
                        {(Object.keys(ROLE_LABEL) as TeamMember["role"][]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => updateTeamMember(member.id, { status: member.status === "active" ? "disabled" : "active" })}
                        disabled={member.bootstrap}
                        className="px-3 py-2 rounded-[8px] border border-line bg-panel2 text-[12px] font-semibold disabled:opacity-50"
                      >
                        {member.status === "active" ? "Active" : "Disabled"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
