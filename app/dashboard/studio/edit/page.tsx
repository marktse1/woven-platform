"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { getMyCreatorProfile, type CreatorProfileRow } from "@/lib/games";
import BannerPositionPicker from "@/components/BannerPositionPicker";

export default function EditStudioPage() {
  const { user, isLoaded } = useUser();

  const [profile, setProfile] = useState<CreatorProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [studioName, setStudioName] = useState("");
  const [about, setAbout] = useState("");
  const [country, setCountry] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [links, setLinks] = useState("");

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user?.id) { setLoading(false); return; }
      try {
        const p = await getMyCreatorProfile(user.id);
        if (!active) return;
        if (!p) { setNotFound(true); setLoading(false); return; }
        setProfile(p);
        setStudioName(p.studio_name ?? "");
        setAbout(p.about ?? "");
        setCountry(p.country ?? "");
        setTeamSize(p.team_size ?? "");
        setLinks(p.links ?? "");
        setLoading(false);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load your studio profile.");
        setNotFound(true);
        setLoading(false);
      }
    }
    if (isLoaded) load();
    return () => { active = false; };
  }, [isLoaded, user?.id]);

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/creator/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio_name: studioName, about, country, team_size: teamSize, links }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save changes.");
      setMessage("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleBannerUpload(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/creator/profile/banner", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");
      setProfile((p) => (p ? { ...p, banner_url: body.url, banner_pos_x: 50, banner_pos_y: 50 } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleBannerPosition(x: number, y: number) {
    setProfile((p) => (p ? { ...p, banner_pos_x: x, banner_pos_y: y } : p));
    try {
      await fetch("/api/creator/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banner_pos_x: x, banner_pos_y: y }),
      });
    } catch {
      // best-effort — the picker already reflects the chosen position locally
    }
  }

  if (!isLoaded || loading) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center">
        <div className="text-[13px] text-dim">Loading…</div>
      </main>
    );
  }

  if (notFound || !profile) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center px-6">
        <div className="max-w-[480px] w-full bg-panel border border-line rounded-[10px] p-6 text-center">
          <p className="text-[16px] font-bold mb-2">No creator profile</p>
          <p className="text-[13px] text-dim mb-4">{error || "Apply as a creator first."}</p>
          <Link href="/creator" className="px-4 py-2 rounded-[8px] bg-panel2 border border-line text-[13px] font-semibold no-underline">
            Apply
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="tool-min-h bg-[#070b11] text-ink">
      <div className="max-w-[720px] mx-auto px-6 pt-8 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard" className="text-[13px] text-dim hover:text-ink no-underline">← Dashboard</Link>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Edit Studio Profile</h1>
        </div>

        {error && <div className="mb-4 p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>{error}</div>}
        {message && <div className="mb-4 p-3 rounded-[9px] border text-[13px] text-green" style={{ borderColor: "rgba(123,194,74,.4)", background: "rgba(123,194,74,.08)" }}>{message}</div>}

        <div className="bg-panel border border-line rounded-[10px] p-6 mb-5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Banner</p>
          {profile.banner_url ? (
            <>
              <BannerPositionPicker
                imageUrl={profile.banner_url}
                x={profile.banner_pos_x}
                y={profile.banner_pos_y}
                heightClassName="h-[160px]"
                onCommit={handleBannerPosition}
              />
              <label className="text-[11.5px] text-accent hover:underline cursor-pointer inline-block ml-3">
                {uploading ? "Uploading…" : "Replace image"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBannerUpload(f); }}
                />
              </label>
            </>
          ) : (
            <div
              className="h-[160px] rounded-lg border border-dashed border-line2 flex items-center justify-center text-dim text-[12px] cursor-pointer overflow-hidden"
              onClick={() => document.getElementById("studio-banner-input")?.click()}
            >
              <span>{uploading ? "Uploading…" : "+ upload banner"}</span>
              <input
                id="studio-banner-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBannerUpload(f); }}
              />
            </div>
          )}
        </div>

        <div className="bg-panel border border-line rounded-[10px] p-6 mb-5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Details</p>
          <div className="flex flex-col gap-1.5 mb-4">
            <label className="text-[13px] font-semibold text-muted">Studio name</label>
            <input value={studioName} onChange={(e) => setStudioName(e.target.value)} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] outline-none focus:border-accent" />
          </div>
          <div className="flex flex-col gap-1.5 mb-4">
            <label className="text-[13px] font-semibold text-muted">
              Handle <span className="text-dim font-normal">(wovengames.app/studio/{profile.handle} — can't be changed)</span>
            </label>
            <input value={profile.handle ?? ""} disabled className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-dim text-[14px] outline-none opacity-60" />
          </div>
          <div className="flex flex-col gap-1.5 mb-4">
            <label className="text-[13px] font-semibold text-muted">About</label>
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] outline-none focus:border-accent min-h-[100px] resize-y" />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-muted">Country</label>
              <input value={country} onChange={(e) => setCountry(e.target.value)} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] outline-none focus:border-accent" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-muted">Team size</label>
              <input value={teamSize} onChange={(e) => setTeamSize(e.target.value)} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] outline-none focus:border-accent" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-muted">Links</label>
            <input value={links} onChange={(e) => setLinks(e.target.value)} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] outline-none focus:border-accent" />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 rounded-[9px] font-bold text-[14px] cursor-pointer border-none disabled:opacity-50"
          style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </main>
  );
}
