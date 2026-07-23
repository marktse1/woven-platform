"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { getGameById, getScreenshots, type GameRow } from "@/lib/games";
import VideoEmbed from "@/components/VideoEmbed";
import BannerPositionPicker from "@/components/BannerPositionPicker";

const TAG_OPTIONS = ["Exploration", "Atmospheric", "Singleplayer", "Hand-painted", "Cozy", "Underwater", "Story-rich", "Roguelike", "Multiplayer"];

function pillCls(on: boolean) {
  return "inline-flex items-center text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all";
}
function pillStyle(on: boolean) {
  return { background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" };
}

export default function EditGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = usePromise(params);
  const { user, isLoaded } = useUser();

  const [game, setGame] = useState<GameRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [isFree, setIsFree] = useState(true);
  const [priceInput, setPriceInput] = useState("9.99");
  const [passIncluded, setPassIncluded] = useState(false);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [videoUrl, setVideoUrl] = useState("");

  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const g = await getGameById(gameId);
        if (!active) return;
        if (!g) { setNotFound(true); setLoading(false); return; }
        setGame(g);
        setTitle(g.title);
        setShortDescription(g.short_description ?? "");
        setIsFree(g.price_cents === 0);
        setPriceInput(g.price_cents ? (g.price_cents / 100).toFixed(2) : "9.99");
        setPassIncluded(g.pass_included);
        setTags(new Set(g.tags ?? []));
        setVideoUrl(g.video_url ?? "");
        const shots = await getScreenshots(g.id);
        if (active) setScreenshots(shots);
        setLoading(false);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load game.");
        setNotFound(true);
        setLoading(false);
      }
    }
    if (isLoaded) load();
    return () => { active = false; };
  }, [gameId, isLoaded]);

  function toggleTag(t: string) {
    setTags((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          short_description: shortDescription,
          price_cents: isFree ? 0 : Math.round((Number(priceInput) || 0) * 100),
          pass_included: passIncluded,
          tags: Array.from(tags),
          video_url: videoUrl,
        }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error ?? "Could not save changes.");
      setMessage("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleImageUpload(kind: "thumbnail" | "banner" | "screenshot", file: File) {
    setUploadingKind(kind);
    setError("");
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await fetch(`/api/games/${gameId}/media`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");
      if (kind === "thumbnail") setGame((g) => (g ? { ...g, thumbnail_url: body.url } : g));
      else if (kind === "banner") setGame((g) => (g ? { ...g, banner_url: body.url, banner_pos_x: 50, banner_pos_y: 50 } : g));
      else setScreenshots((prev) => [...prev, body.url]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploadingKind(null);
    }
  }

  async function handleBannerPosition(x: number, y: number) {
    setGame((g) => (g ? { ...g, banner_pos_x: x, banner_pos_y: y } : g));
    try {
      await fetch(`/api/games/${gameId}`, {
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

  if (notFound || !game) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center px-6">
        <div className="max-w-[480px] w-full bg-panel border border-line rounded-[10px] p-6 text-center">
          <p className="text-[16px] font-bold mb-2">Game not found</p>
          <p className="text-[13px] text-dim mb-4">{error || "This game isn't available, or you don't own it."}</p>
          <Link href="/dashboard" className="px-4 py-2 rounded-[8px] bg-panel2 border border-line text-[13px] font-semibold no-underline">
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="tool-min-h bg-[#070b11] text-ink">
      <div className="max-w-[860px] mx-auto px-6 pt-8 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard" className="text-[13px] text-dim hover:text-ink no-underline">← Dashboard</Link>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Edit {game.title}</h1>
        </div>

        {error && <div className="mb-4 p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>{error}</div>}
        {message && <div className="mb-4 p-3 rounded-[9px] border text-[13px] text-green" style={{ borderColor: "rgba(123,194,74,.4)", background: "rgba(123,194,74,.08)" }}>{message}</div>}

        <div className="bg-panel border border-line rounded-[10px] p-6 mb-5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Store details</p>
          <div className="flex flex-col gap-1.5 mb-4">
            <label className="text-[13px] font-semibold text-muted">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] outline-none focus:border-accent" />
          </div>
          <div className="flex flex-col gap-1.5 mb-4">
            <label className="text-[13px] font-semibold text-muted">Tagline / short description</label>
            <input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} className="bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] outline-none focus:border-accent" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-[13px] font-semibold text-muted">Free to play</label>
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
            {!isFree && (
              <input value={priceInput} onChange={(e) => setPriceInput(e.target.value.replace(/[^0-9.]/g, ""))} className="w-[100px] bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-ink text-[13px] outline-none" placeholder="9.99" />
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[13px] font-semibold text-muted">Include in Woven Pass</label>
            <input type="checkbox" checked={passIncluded} onChange={(e) => setPassIncluded(e.target.checked)} />
          </div>
        </div>

        <div className="bg-panel border border-line rounded-[10px] p-6 mb-5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Tags</p>
          <div className="flex flex-wrap gap-2">
            {TAG_OPTIONS.map((t) => (
              <button key={t} onClick={() => toggleTag(t)} className={pillCls(tags.has(t))} style={pillStyle(tags.has(t))}>{t}</button>
            ))}
          </div>
        </div>

        <div className="bg-panel border border-line rounded-[10px] p-6 mb-5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Gameplay video</p>
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="YouTube, Vimeo, or Rumble embed URL"
            className="w-full bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] outline-none focus:border-accent mb-3"
          />
          {videoUrl && <VideoEmbed url={videoUrl} className="h-[220px]" />}
        </div>

        <div className="bg-panel border border-line rounded-[10px] p-6 mb-5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Images</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-[12px] text-dim block mb-1.5">Capsule art (store grid)</label>
              <ImageTile url={game.thumbnail_url} uploading={uploadingKind === "thumbnail"} onFile={(f) => handleImageUpload("thumbnail", f)} />
            </div>
            <div>
              <label className="text-[12px] text-dim block mb-1.5">Banner (game page hero)</label>
              {game.banner_url ? (
                <>
                  <BannerPositionPicker
                    imageUrl={game.banner_url}
                    x={game.banner_pos_x}
                    y={game.banner_pos_y}
                    onCommit={handleBannerPosition}
                  />
                  <label className="text-[11.5px] text-accent hover:underline cursor-pointer inline-block ml-3">
                    {uploadingKind === "banner" ? "Uploading…" : "Replace image"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload("banner", f); }}
                    />
                  </label>
                </>
              ) : (
                <ImageTile url={null} uploading={uploadingKind === "banner"} onFile={(f) => handleImageUpload("banner", f)} />
              )}
            </div>
          </div>
          <label className="text-[12px] text-dim block mb-1.5">Screenshots</label>
          <div className="grid grid-cols-4 gap-3">
            {screenshots.map((url) => (
              <div key={url} className="h-24 rounded-lg overflow-hidden border border-line" style={{ backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
            ))}
            <ImageTile url={null} uploading={uploadingKind === "screenshot"} onFile={(f) => handleImageUpload("screenshot", f)} compact />
          </div>
        </div>

        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 rounded-[9px] font-bold text-[14px] cursor-pointer border-none disabled:opacity-50"
            style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>

        <div className="bg-panel border border-line rounded-[10px] p-6">
          <p className="font-bold text-[14px] mb-1">Ship a new version</p>
          <p className="text-[12.5px] text-dim mb-3">Uploading new code or assets? That goes through the build pipeline so it's reviewed before going live.</p>
          <Link href={`/upload?gameId=${gameId}`} className="px-4 py-2 rounded-[8px] bg-panel2 border border-line text-[13px] font-semibold no-underline inline-block">
            Upload a new build →
          </Link>
        </div>
      </div>
    </main>
  );
}

function ImageTile({ url, uploading, onFile, compact = false }: { url: string | null; uploading: boolean; onFile: (f: File) => void; compact?: boolean }) {
  const inputId = `img-${Math.random().toString(36).slice(2)}`;
  return (
    <div
      className={`rounded-lg border border-dashed border-line2 flex items-center justify-center text-dim text-[12px] cursor-pointer relative overflow-hidden ${compact ? "h-24" : "h-[150px]"}`}
      style={url ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center", borderStyle: "solid" } : undefined}
      onClick={() => document.getElementById(inputId)?.click()}
    >
      {!url && <span>{uploading ? "Uploading…" : "+ upload"}</span>}
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </div>
  );
}
