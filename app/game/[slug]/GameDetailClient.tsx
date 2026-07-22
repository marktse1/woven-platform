"use client";

import { useEffect, useState, use as usePromise } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import {
  getGameBySlug, getCurrentBuild, getBuildHistory, isInLibrary, addFreeGameToLibrary,
  hasPlayedGame, markGamePlayed, getReviews, getMyReview, upsertReview,
  type GameRow, type GameBuildRow, type GameBuildHistoryRow, type GameReviewRow,
} from "@/lib/games";

type GradPair = [string, string];
const pal: GradPair[] = [
  ["#3a7fc4", "#7d4bd0"], ["#2aa6c4", "#15527a"], ["#5cb85c", "#1e7a4a"],
  ["#e8794b", "#b8431a"], ["#4b7fd0", "#2a3f7a"], ["#c44b9a", "#6a2a7a"],
];

function GradArt({ pair, className = "", children }: { pair: GradPair; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(140deg, ${pair[0]}, ${pair[1]})` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 25% 14%, rgba(255,255,255,.30), transparent 60%)" }} />
      <div className="absolute inset-0 opacity-[.12] mix-blend-overlay"
        style={{ backgroundImage: "repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 9px)" }} />
      {children}
    </div>
  );
}

function formatPrice(priceCents: number, passIncluded: boolean): string {
  if (passIncluded) return "◆ Included with Pass";
  if (priceCents === 0) return "Free";
  return `$${(priceCents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

type Phase = "loading" | "not-found" | "ready" | "playing";

export default function GameDetailClient({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = usePromise(params);
  const { user, isLoaded } = useUser();

  const [phase, setPhase] = useState<Phase>("loading");
  const [game, setGame] = useState<GameRow | null>(null);
  const [build, setBuild] = useState<GameBuildRow | null>(null);
  const [history, setHistory] = useState<GameBuildHistoryRow[]>([]);
  const [owned, setOwned] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [reviews, setReviews] = useState<GameReviewRow[]>([]);
  const [myReview, setMyReview] = useState<GameReviewRow | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const g = await getGameBySlug(slug);
        if (!active) return;
        if (!g) { setPhase("not-found"); return; }
        setGame(g);
        const b = await getCurrentBuild(g.id);
        if (!active) return;
        setBuild(b);
        getBuildHistory(g.id).then((h) => { if (active) setHistory(h); });
        getReviews(g.id).then((r) => { if (active) setReviews(r); });
        if (user?.id) {
          const inLib = await isInLibrary(user.id, g.id);
          if (!active) return;
          setOwned(inLib);
          if (inLib) {
            hasPlayedGame(user.id, g.id).then((p) => { if (active) setHasPlayed(p); });
            getMyReview(user.id, g.id).then((r) => {
              if (!active || !r) return;
              setMyReview(r);
              setReviewRating(r.rating);
              setReviewBody(r.body ?? "");
            });
          }
        }
        setPhase("ready");
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load game.");
        setPhase("not-found");
      }
    }
    if (isLoaded) load();
    return () => { active = false; };
  }, [slug, isLoaded, user?.id]);

  async function handlePlay() {
    setPhase("playing");
    if (user?.id && game) {
      try {
        await markGamePlayed(user.id, game.id);
        setHasPlayed(true);
      } catch {
        // Non-fatal — worst case the review gate stays locked until the next play.
      }
    }
  }

  async function handleSubmitReview() {
    if (!user?.id || !game) return;
    setReviewSubmitting(true);
    setReviewError("");
    try {
      await upsertReview(user.id, game.id, reviewRating, reviewBody);
      const [freshReviews, freshGame] = await Promise.all([getReviews(game.id), getGameBySlug(slug)]);
      setReviews(freshReviews);
      if (freshGame) setGame(freshGame);
      setMyReview(freshReviews.find((r) => r.clerk_user_id === user.id) ?? null);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "Could not save your review.");
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleGet() {
    if (!user?.id || !game) return;
    setAdding(true);
    setError("");
    try {
      await addFreeGameToLibrary(user.id, game.id);
      setOwned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add to library.");
    } finally {
      setAdding(false);
    }
  }

  if (phase === "loading" || !isLoaded) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center">
        <div className="text-[13px] text-dim">Loading…</div>
      </main>
    );
  }

  if (phase === "not-found" || !game) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center px-6">
        <div className="max-w-[480px] w-full bg-panel border border-line rounded-[10px] p-6 text-center">
          <p className="text-[16px] font-bold mb-2">Game not found</p>
          <p className="text-[13px] text-dim mb-4">{error || "This game isn't available."}</p>
          <Link href="/" className="px-4 py-2 rounded-[8px] bg-panel2 border border-line text-[13px] font-semibold no-underline">
            Back to Store
          </Link>
        </div>
      </main>
    );
  }

  if (phase === "playing" && build) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex flex-col">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-line bg-panel/80 shrink-0">
          <button
            onClick={() => setPhase("ready")}
            className="px-3 py-1.5 rounded-[7px] border border-line bg-panel2 text-[12px] font-semibold cursor-pointer"
          >
            ← Back
          </button>
          <div className="text-[13px] font-bold">{game.title}</div>
        </div>
        <div className="flex-1">
          <iframe
            key={build.id}
            src={`/api/games/play/${build.id}/${build.entry_file}`}
            className="w-full h-full border-0"
            style={{ height: "calc(100vh - 121px)" }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            allow="fullscreen; clipboard-read; clipboard-write; gamepad"
            referrerPolicy="no-referrer"
            title={game.title}
          />
        </div>
      </main>
    );
  }

  const isFree = game.price_cents === 0 || game.pass_included;

  return (
    <main className="tool-min-h bg-[#070b11] text-ink">
      <div className="max-w-[960px] mx-auto px-6 pt-8 pb-16">
        <GradArt pair={pal[game.title.length % pal.length]} className="rounded-[14px] border border-line h-[280px] sm:h-[360px]">
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(5,8,11,.92))" }} />
          <div className="absolute left-6 right-6 bottom-5 z-10">
            <h1 className="text-[26px] sm:text-[36px] font-extrabold tracking-[-0.02em]">{game.title}</h1>
            <p className="text-[13px] text-[#c2d2e0] mt-1">
              {game.creator_profiles?.handle ? (
                <>by <Link href={`/studio/${game.creator_profiles.handle}`} className="text-accent no-underline hover:underline">{game.creator_profiles.studio_name ?? game.creator_profiles.handle}</Link></>
              ) : game.creator_profiles?.studio_name ? (
                <>by {game.creator_profiles.studio_name}</>
              ) : null}
              {game.creator_profiles?.studio_name || game.creator_profiles?.handle ? " · " : null}
              Released {formatDate(game.created_at)}
            </p>
            {game.short_description && (
              <p className="text-[#c2d2e0] text-sm mt-1.5 max-w-[520px]">{game.short_description}</p>
            )}
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {game.tags.map((tag) => (
                <span key={tag} className="text-xs bg-white/10 px-2.5 py-1 rounded-md">{tag}</span>
              ))}
            </div>
          </div>
        </GradArt>

        <div className="flex items-center gap-3 mt-5">
          {!build ? (
            <span className="px-4 py-3 rounded-[9px] bg-panel2 border border-line text-[13px] text-dim">
              This game&apos;s build isn&apos;t ready to play yet.
            </span>
          ) : owned ? (
            <button
              onClick={handlePlay}
              className="flex items-center gap-2 px-8 py-3.5 rounded-[9px] font-bold text-[16px] cursor-pointer border-none"
              style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}
            >
              <span className="text-[13px]">▶</span> Play in browser
            </button>
          ) : isFree ? (
            <button
              onClick={handleGet}
              disabled={adding || !user?.id}
              className="px-8 py-3.5 rounded-[9px] font-bold text-[16px] cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}
            >
              {!user?.id ? "Sign in to get this game" : adding ? "Adding…" : `Get · ${formatPrice(game.price_cents, game.pass_included)}`}
            </button>
          ) : (
            <span className="px-4 py-3 rounded-[9px] bg-panel2 border border-line text-[13px] text-dim">
              {formatPrice(game.price_cents, game.pass_included)} · purchases aren&apos;t available yet
            </span>
          )}
        </div>

        {error && <p className="text-[12px] text-red-400 mt-2">{error}</p>}

        <div className="mt-8 bg-panel border border-line rounded-[10px]">
          <div className="px-6 py-4 border-b border-line font-bold text-[15px]">Version history</div>
          {history.length === 0 ? (
            <div className="px-6 py-4 text-dim text-[13px]">No release notes yet.</div>
          ) : (
            <div>
              {history.map((h) => (
                <div key={h.id} className="px-6 py-4 border-b border-line last:border-none">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="text-[13px] font-semibold">{formatDate(h.created_at)}</span>
                    {h.is_current && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[.04em]" style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-dim whitespace-pre-wrap">{h.changelog || "No release notes for this version."}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 bg-panel border border-line rounded-[10px]">
          <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
            <span className="font-bold text-[15px]">Reviews</span>
            {game.rating != null && (
              <span className="text-[13px] text-dim">★ {game.rating.toFixed(1)} · {reviews.length} review{reviews.length === 1 ? "" : "s"}</span>
            )}
          </div>

          {owned && hasPlayed ? (
            <div className="px-6 py-4 border-b border-line">
              <div className="flex items-center gap-1.5 mb-2.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setReviewRating(n)}
                    className="text-[20px] cursor-pointer bg-transparent border-none p-0"
                    style={{ color: n <= reviewRating ? "#f0c66a" : "#3a4552" }}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                placeholder="What did you think? (optional)"
                className="w-full bg-[#0a0e13] border border-line rounded-lg px-3 py-2.5 text-[13px] text-ink outline-none focus:border-accent min-h-[80px] resize-y"
              />
              <div className="flex items-center gap-3 mt-2.5">
                <button
                  onClick={handleSubmitReview}
                  disabled={reviewSubmitting}
                  className="px-4 py-2 rounded-[8px] font-bold text-[13px] cursor-pointer border-none disabled:opacity-50"
                  style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}
                >
                  {reviewSubmitting ? "Saving…" : myReview ? "Update review" : "Submit review"}
                </button>
                {reviewError && <span className="text-[12px] text-red-400">{reviewError}</span>}
              </div>
            </div>
          ) : owned ? (
            <div className="px-6 py-4 border-b border-line text-dim text-[13px]">Play the game to leave a review.</div>
          ) : null}

          {reviews.length === 0 ? (
            <div className="px-6 py-4 text-dim text-[13px]">No reviews yet.</div>
          ) : (
            <div>
              {reviews.map((r) => (
                <div key={r.id} className="px-6 py-4 border-b border-line last:border-none">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span style={{ color: "#f0c66a" }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                    <span className="text-[12px] text-dim">{formatDate(r.created_at)}</span>
                  </div>
                  {r.body && <p className="text-[13px] text-dim whitespace-pre-wrap">{r.body}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
