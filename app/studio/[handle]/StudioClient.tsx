"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  getCreatorByHandle, getGamesByCreator,
  isFollowingCreator, getFollowerCount, followCreator, unfollowCreator,
  type CreatorProfileRow, type GameRow,
} from "@/lib/games";
import { getPostsByCreator, type StudioPostRow } from "@/lib/studioPosts";
import { StudioPostBody } from "@/components/StudioPostBody";

type GradPair = [string, string];
const pal: GradPair[] = [
  ["#3a7fc4", "#7d4bd0"], ["#2aa6c4", "#15527a"], ["#5cb85c", "#1e7a4a"],
  ["#e8794b", "#b8431a"], ["#4b7fd0", "#2a3f7a"], ["#c44b9a", "#6a2a7a"],
];

function GradArt({ pair, className = "", style, children }: { pair: GradPair; className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  return (
    <div className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(140deg, ${pair[0]}, ${pair[1]})`, ...style }}>
      {!style?.backgroundImage && (
        <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 25% 14%, rgba(255,255,255,.30), transparent 60%)" }} />
      )}
      <div className="absolute inset-0 opacity-[.12] mix-blend-overlay"
        style={{ backgroundImage: "repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 9px)" }} />
      {children}
    </div>
  );
}

function formatPrice(priceCents: number, passIncluded: boolean): string {
  if (passIncluded) return "◆ Pass";
  if (priceCents === 0) return "Free";
  return `$${(priceCents / 100).toFixed(2)}`;
}

function relativeTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function FollowButton({ creatorId }: { creatorId: string }) {
  const { user, isLoaded } = useUser();
  const [following, setFollowing] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const c = await getFollowerCount(creatorId);
        if (active) setCount(c);
      } catch { /* best-effort */ }
      if (user?.id) {
        try {
          const f = await isFollowingCreator(user.id, creatorId);
          if (active) setFollowing(f);
        } catch { /* best-effort */ }
      }
    }
    if (isLoaded) load();
    return () => { active = false; };
  }, [creatorId, user?.id, isLoaded]);

  async function toggle() {
    if (!user?.id || busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next);
    setCount((c) => (c == null ? c : c + (next ? 1 : -1)));
    try {
      if (next) await followCreator(user.id, creatorId);
      else await unfollowCreator(user.id, creatorId);
    } catch {
      setFollowing(!next);
      setCount((c) => (c == null ? c : c - (next ? 1 : -1)));
    } finally {
      setBusy(false);
    }
  }

  if (isLoaded && !user) {
    return (
      <Link href="/sign-in"
        className="px-4 py-2 rounded-[9px] font-bold text-[13px] no-underline border shrink-0"
        style={{ borderColor: "#2c6aa0", color: "#cfe6fb", background: "rgba(86,166,232,.12)" }}>
        ＋ Follow
      </Link>
    );
  }

  return (
    <button onClick={toggle} disabled={busy || !isLoaded}
      className="px-4 py-2 rounded-[9px] font-bold text-[13px] cursor-pointer border disabled:opacity-60 shrink-0"
      style={following
        ? { borderColor: "#26384a", background: "#1b2836", color: "#e7eef4" }
        : { borderColor: "transparent", background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
      {following ? "✓ Following" : "＋ Follow"}
      {count != null && <span className="ml-1.5 font-normal opacity-80">· {count.toLocaleString()}</span>}
    </button>
  );
}

const postTypeLabel: Record<StudioPostRow["type"], string> = {
  news: "News", image: "Image", video: "Video", promo: "Promo",
};

function PostCard({ post }: { post: StudioPostRow }) {
  return (
    <div className="bg-panel border border-line rounded-[10px] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md tracking-[.02em] bg-[rgba(86,166,232,.14)] text-[#8fc6f0]">
          {postTypeLabel[post.type]}
        </span>
        <span className="text-[11px] text-dim">{relativeTime(post.created_at)}</span>
      </div>
      <StudioPostBody post={post} />
    </div>
  );
}

type Phase = "loading" | "not-found" | "ready";

export default function StudioClient({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = usePromise(params);

  const [phase, setPhase] = useState<Phase>("loading");
  const [creator, setCreator] = useState<CreatorProfileRow | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [posts, setPosts] = useState<StudioPostRow[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const c = await getCreatorByHandle(decodeURIComponent(handle));
        if (!active) return;
        if (!c) { setPhase("not-found"); return; }
        setCreator(c);
        const [g, p] = await Promise.all([getGamesByCreator(c.id), getPostsByCreator(c.id)]);
        if (!active) return;
        setGames(g);
        setPosts(p);
        setPhase("ready");
      } catch {
        if (!active) return;
        setPhase("not-found");
      }
    }
    load();
    return () => { active = false; };
  }, [handle]);

  if (phase === "loading") {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center">
        <div className="text-[13px] text-dim">Loading…</div>
      </main>
    );
  }

  if (phase === "not-found" || !creator) {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center px-6">
        <div className="max-w-[480px] w-full bg-panel border border-line rounded-[10px] p-6 text-center">
          <p className="text-[16px] font-bold mb-2">Studio not found</p>
          <p className="text-[13px] text-dim mb-4">This creator profile isn&apos;t available.</p>
          <Link href="/" className="px-4 py-2 rounded-[8px] bg-panel2 border border-line text-[13px] font-semibold no-underline">
            Back to Store
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="tool-min-h bg-[#070b11] text-ink">
      <div className="max-w-[960px] mx-auto px-6 pt-8 pb-16">
        <GradArt
          pair={pal[(creator.studio_name ?? creator.handle ?? "").length % pal.length]}
          className="rounded-[14px] border border-line h-[180px] sm:h-[220px]"
          style={creator.banner_url ? { backgroundImage: `url(${creator.banner_url})`, backgroundSize: "cover", backgroundPosition: `${creator.banner_pos_x}% ${creator.banner_pos_y}%` } : undefined}
        >
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(5,8,11,.92))" }} />
          <div className="absolute left-6 right-6 bottom-5 z-10 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-[24px] sm:text-[32px] font-extrabold tracking-[-0.02em]">{creator.studio_name ?? creator.handle}</h1>
              <p className="text-[13px] text-[#c2d2e0] mt-1">
                {[creator.country, creator.team_size ? `${creator.team_size} people` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <FollowButton creatorId={creator.id} />
          </div>
        </GradArt>

        {creator.about && (
          <p className="text-[14px] text-dim mt-5 max-w-[640px] whitespace-pre-wrap">{creator.about}</p>
        )}

        {creator.links && (
          <p className="text-[13px] text-accent mt-3">{creator.links}</p>
        )}

        <div className="mt-8">
          <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">
            Games by {creator.studio_name ?? creator.handle}
          </p>
          {games.length === 0 ? (
            <div className="rounded-lg border border-line bg-panel py-10 flex items-center justify-center text-dim text-[13px]">
              No live games yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {games.map((game, i) => (
                <Link key={game.id} href={`/game/${game.slug}`}
                  className="block bg-panel border border-line rounded-lg overflow-hidden cursor-pointer transition-[transform,box-shadow] hover:-translate-y-[3px] hover:shadow-[0_12px_30px_rgba(0,0,0,.5)] no-underline text-inherit">
                  <GradArt pair={pal[(i + 1) % pal.length]} className="h-[130px]" />
                  <div className="px-3 pt-2.5 pb-3">
                    <div className="text-[14px] font-semibold truncate">{game.title}</div>
                    <div className="text-[11px] text-dim mt-1 mb-2.5">{game.tags.slice(0, 2).join(" · ")}</div>
                    <div className="flex items-center justify-end gap-2">
                      {game.pass_included ? (
                        <span className="text-accent font-bold text-[12px]">◆ Free on Pass</span>
                      ) : (
                        <span className="font-bold text-[13px]">{formatPrice(game.price_cents, game.pass_included)}</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8">
          <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">
            Studio updates
          </p>
          {posts.length === 0 ? (
            <div className="rounded-lg border border-line bg-panel py-10 flex items-center justify-center text-dim text-[13px]">
              No updates yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {posts.map((p) => <PostCard key={p.id} post={p} />)}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
