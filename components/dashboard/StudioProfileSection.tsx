"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { getMyCreatorProfile, type CreatorProfileRow } from "@/lib/games";
import { getPostsByCreator, uploadStudioPostMedia, type StudioPostRow, type StudioPostType, type UploadProgress } from "@/lib/studioPosts";
import BannerPositionPicker from "@/components/BannerPositionPicker";

// The "Studio Profile" tab of /dashboard — was its own page
// (/dashboard/studio/edit, which now just redirects here) until Dashboard
// and Studio Profile were merged into one tabbed console (they'd always
// shared the same subnav, auth pattern, and visual language, and Studio
// Profile's only "back" link already pointed at Dashboard, so the two read
// as one console's tabs, not separate products).

const postTypeOptions: { value: StudioPostType; label: string }[] = [
  { value: "news", label: "News" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "promo", label: "Promotional" },
];

function relativeTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function NewPostModal({ onClose, onPost }: { onClose: () => void; onPost: (p: StudioPostRow) => void }) {
  const [type, setType] = useState<StudioPostType>("news");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [videoMode, setVideoMode] = useState<"link" | "upload">("link");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, saving]);

  const videoNeedsUpload = type === "video" && videoMode === "upload";
  const canSubmit =
    type === "image" ? files.length > 0
    : type === "video" ? (videoNeedsUpload ? files.length > 0 : linkUrl.trim().length > 0)
    : (title.trim() || body.trim() || (type === "promo" && linkUrl.trim()));

  async function handleSubmit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError("");
    try {
      let media_path: string | undefined;
      let media_paths: string[] | undefined;
      if (type === "image" && files.length > 0) {
        media_paths = [];
        for (const f of files) {
          setProgress({ loaded: 0, total: f.size, pct: 0 });
          const { storagePath } = await uploadStudioPostMedia(f, setProgress);
          media_paths.push(storagePath);
        }
      } else if (videoNeedsUpload && files[0]) {
        setProgress({ loaded: 0, total: files[0].size, pct: 0 });
        const { storagePath } = await uploadStudioPostMedia(files[0], setProgress);
        media_path = storagePath;
      }
      const link_url = type === "promo" || (type === "video" && videoMode === "link") ? linkUrl : "";
      const res = await fetch("/api/creator/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title, body, link_url, media_path, media_paths }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error ?? "Could not publish post.");
      onPost(resBody.post as StudioPostRow);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish post.");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  const inputCls = "bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="bg-panel border border-line rounded-[14px] w-full max-w-[560px] shadow-[0_24px_60px_rgba(0,0,0,.7)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">New post</h2>
          <button onClick={() => !saving && onClose()} className="text-dim hover:text-ink text-[20px] leading-none cursor-pointer bg-transparent border-none">×</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {error && <div className="p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>{error}</div>}

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-muted">Type</label>
            <select value={type} onChange={(e) => { setType(e.target.value as StudioPostType); setFiles([]); setLinkUrl(""); setVideoMode("link"); }} className={inputCls + " cursor-pointer"}>
              {postTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-muted">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Optional" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-muted">{type === "news" ? "Body" : "Caption"}</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className={inputCls + " resize-none"} placeholder="Optional — links you paste here get an automatic preview card" />
          </div>

          {type === "promo" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-muted">Link URL</label>
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className={inputCls} placeholder="https://…" />
            </div>
          )}

          {type === "image" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-muted">Photos</label>
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="text-[13px] text-dim"
              />
              {files.length > 1 && <p className="text-[12px] text-dim">{files.length} photos selected</p>}
              {progress && (
                <div className="h-1.5 rounded-full bg-panel2 overflow-hidden mt-1">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress.pct * 100)}%` }} />
                </div>
              )}
            </div>
          )}

          {type === "video" && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-1 p-1 rounded-lg border border-line w-max" style={{ background: "#16202c" }}>
                {(["link", "upload"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setVideoMode(m)}
                    className="px-3.5 py-1.5 rounded-md text-[12.5px] font-bold cursor-pointer transition-colors"
                    style={{ background: videoMode === m ? "#223345" : "transparent", color: videoMode === m ? "#e7eef4" : "#8aa0b4" }}>
                    {m === "link" ? "Link" : "Upload file"}
                  </button>
                ))}
              </div>
              {videoMode === "link" ? (
                <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className={inputCls} placeholder="YouTube, Vimeo, or Rumble embed URL" />
              ) : (
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => setFiles(e.target.files?.[0] ? [e.target.files[0]] : [])}
                  className="text-[13px] text-dim"
                />
              )}
              {progress && (
                <div className="h-1.5 rounded-full bg-panel2 overflow-hidden mt-1">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress.pct * 100)}%` }} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-line">
          <button onClick={() => !saving && onClose()} className="px-5 py-2.5 rounded-[9px] font-bold text-[14px] cursor-pointer bg-panel2 border border-line text-ink">Cancel</button>
          <button onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="px-5 py-2.5 rounded-[9px] font-bold text-[14px] cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
            {saving ? (progress ? "Uploading…" : "Publishing…") : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudioProfileSection() {
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

  const [posts, setPosts] = useState<StudioPostRow[]>([]);
  const [showPostModal, setShowPostModal] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

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
        getPostsByCreator(p.id).then((rows) => { if (active) setPosts(rows); }).catch(() => {});
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

  async function handleDeletePost(id: string) {
    setDeletingPostId(id);
    try {
      const res = await fetch(`/api/creator/posts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not delete post.");
      }
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete post.");
    } finally {
      setDeletingPostId(null);
    }
  }

  if (!isLoaded || loading) {
    return <div className="text-[13px] text-dim py-10 text-center">Loading…</div>;
  }

  if (notFound || !profile) {
    return (
      <div className="max-w-[480px] mx-auto bg-panel border border-line rounded-[10px] p-6 text-center">
        <p className="text-[16px] font-bold mb-2">No creator profile</p>
        <p className="text-[13px] text-dim">{error || "Apply as a creator first."}</p>
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
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
            Handle <span className="text-dim font-normal">(wovengames.app/studio/{profile.handle} — can&apos;t be changed)</span>
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

      <div className="bg-panel border border-line rounded-[10px] p-6 mt-5">
        <div className="flex items-center justify-between mb-3.5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted">Posts</p>
          <button onClick={() => setShowPostModal(true)}
            className="px-3.5 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer border-none"
            style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
            ＋ New post
          </button>
        </div>
        <p className="text-[12.5px] text-dim mb-4">
          News, images, video and promos posted here show on your studio page and in the Community feed.
        </p>
        {posts.length === 0 ? (
          <div className="rounded-lg border border-line bg-[#0a0e13] py-8 flex items-center justify-center text-dim text-[13px]">
            No posts yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {posts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md tracking-[.02em] bg-[rgba(86,166,232,.14)] text-[#8fc6f0] shrink-0">
                  {postTypeOptions.find((o) => o.value === p.type)?.label}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold truncate">{p.title || p.body || "(untitled)"}</div>
                  <div className="text-[11.5px] text-dim">{relativeTime(p.created_at)}</div>
                </div>
                <button onClick={() => handleDeletePost(p.id)} disabled={deletingPostId === p.id}
                  className="text-[12px] text-dim hover:text-[#e35c5c] cursor-pointer bg-transparent border-none disabled:opacity-50 shrink-0">
                  {deletingPostId === p.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPostModal && (
        <NewPostModal
          onClose={() => setShowPostModal(false)}
          onPost={(p) => setPosts((prev) => [p, ...prev])}
        />
      )}
    </div>
  );
}
