"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { isFollowingCreator, getFollowerCount, followCreator, unfollowCreator } from "@/lib/games";

// Shared across the studio page and the community page's "Creators to
// follow" widget — was previously defined only inside StudioClient.tsx.
export default function FollowButton({ creatorId }: { creatorId: string }) {
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
