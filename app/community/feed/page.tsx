"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import CommunitySubNav from "@/components/shell/CommunitySubNav";
import { getFeedPosts, getComments, addComment, type FeedPostRow, type StudioPostCommentRow } from "@/lib/studioPosts";
import { StudioPostBody } from "@/components/StudioPostBody";
import { useMyStudio } from "@/lib/useMyStudio";
import { getCreatorProfilesByIds } from "@/lib/games";

const PAGE_SIZE = 10;

type GradPair = [string, string];
const pal: GradPair[] = [
  ["#3a7fc4", "#7d4bd0"], ["#2aa6c4", "#15527a"], ["#5cb85c", "#1e7a4a"],
  ["#e8794b", "#b8431a"], ["#4b7fd0", "#2a3f7a"], ["#c44b9a", "#6a2a7a"],
];

function GradAvatar({ pair, className = "" }: { pair: GradPair; className?: string }) {
  return (
    <div className={`relative overflow-hidden shrink-0 ${className}`}
      style={{ background: `linear-gradient(140deg, ${pair[0]}, ${pair[1]})` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 26% 16%, rgba(255,255,255,.26), transparent 60%)" }} />
    </div>
  );
}

function relativeTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

const postTypeLabel: Record<FeedPostRow["type"], string> = {
  news: "News", image: "Image", video: "Video", promo: "Promo",
};

// Renders one comment plus its replies, recursing on a parent_id -> children
// map built once per PostComments render — arbitrary nesting depth without
// a recursive query (see 0035_studio_post_comments.sql's header comment).
function CommentNode({
  comment, childrenMap, onReply, studioById,
}: {
  comment: StudioPostCommentRow;
  childrenMap: Map<string | null, StudioPostCommentRow[]>;
  onReply: (parentId: string, body: string) => Promise<void>;
  studioById: Record<string, { studio_name: string | null; handle: string | null }>;
}) {
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const kids = childrenMap.get(comment.id) ?? [];
  const studio = comment.posted_as_studio_id ? studioById[comment.posted_as_studio_id] : null;
  const identityPair = pal[comment.author.length % pal.length];

  async function submitReply() {
    if (!replyBody.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onReply(comment.id, replyBody.trim());
      setReplyBody("");
      setReplying(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pl-3 border-l border-line">
      <div className="py-2">
        <div className="flex items-center gap-2 text-[12px]">
          <GradAvatar pair={identityPair} className="w-[18px] h-[18px] rounded-full" />
          {studio?.handle ? (
            <Link href={`/studio/${studio.handle}`} className="font-semibold text-muted no-underline hover:text-accent">@{comment.author}</Link>
          ) : (
            <span className="font-semibold text-muted">@{comment.author}</span>
          )}
          <span className="text-dim">{relativeTime(comment.created_at)}</span>
        </div>
        <p className="text-[13px] mt-0.5 whitespace-pre-wrap">{comment.body}</p>
        <button onClick={() => setReplying((r) => !r)}
          className="text-[11.5px] text-accent font-semibold cursor-pointer bg-transparent border-none mt-1 p-0">
          Reply
        </button>
        {replying && (
          <div className="mt-2 flex gap-2">
            <input value={replyBody} onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Write a reply…"
              className="flex-1 bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-accent" />
            <button onClick={submitReply} disabled={submitting || !replyBody.trim()}
              className="px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer bg-panel2 border border-line text-ink disabled:opacity-50">
              {submitting ? "…" : "Reply"}
            </button>
          </div>
        )}
      </div>
      {kids.map((k) => <CommentNode key={k.id} comment={k} childrenMap={childrenMap} onReply={onReply} studioById={studioById} />)}
    </div>
  );
}

function PostComments({ postId, authorName, userId }: { postId: string; authorName: string; userId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<StudioPostCommentRow[]>([]);
  const [studioById, setStudioById] = useState<Record<string, { studio_name: string | null; handle: string | null }>>({});
  const [newBody, setNewBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postAsStudio, setPostAsStudio] = useState(false);
  const myStudio = useMyStudio();

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) {
      const rows = await getComments(postId);
      setComments(rows);
      setLoaded(true);
      const studioIds = Array.from(new Set(rows.map((r) => r.posted_as_studio_id).filter((id): id is string => !!id)));
      if (studioIds.length > 0) setStudioById(await getCreatorProfilesByIds(studioIds));
    }
  }

  function effectiveAuthor() {
    return postAsStudio && myStudio ? (myStudio.studio_name ?? myStudio.handle ?? authorName) : authorName;
  }

  async function reply(parentId: string, body: string) {
    if (!userId) return;
    const asStudio = postAsStudio && !!myStudio;
    const row = await addComment(userId, effectiveAuthor(), postId, body, parentId, asStudio ? myStudio!.id : null);
    setComments((prev) => [...prev, row]);
  }

  async function postTopLevel() {
    if (!userId || !newBody.trim() || posting) return;
    setPosting(true);
    try {
      const asStudio = postAsStudio && !!myStudio;
      const row = await addComment(userId, effectiveAuthor(), postId, newBody.trim(), null, asStudio ? myStudio!.id : null);
      setComments((prev) => [...prev, row]);
      setNewBody("");
    } finally {
      setPosting(false);
    }
  }

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, StudioPostCommentRow[]>();
    for (const c of comments) {
      const key = c.parent_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [comments]);

  const topLevel = childrenMap.get(null) ?? [];

  return (
    <div className="mt-3 pt-3 border-t border-line">
      <button onClick={toggle} className="text-[12.5px] font-semibold text-muted cursor-pointer bg-transparent border-none p-0">
        {expanded ? "Hide comments" : loaded ? `💬 ${comments.length} comment${comments.length === 1 ? "" : "s"}` : "💬 Comments"}
      </button>
      {expanded && (
        <div className="mt-2.5 flex flex-col gap-1">
          {loaded && topLevel.length === 0 && (
            <p className="text-[12.5px] text-dim">No comments yet.</p>
          )}
          {topLevel.map((c) => <CommentNode key={c.id} comment={c} childrenMap={childrenMap} onReply={reply} studioById={studioById} />)}
          {userId ? (
            <div className="mt-2 flex flex-col gap-1.5">
              {myStudio && (
                <div className="flex gap-1 p-1 rounded-lg border border-line w-max" style={{ background: "#16202c" }}>
                  {[false, true].map((asStudio) => (
                    <button key={String(asStudio)} type="button" onClick={() => setPostAsStudio(asStudio)}
                      className="px-3 py-1 rounded-md text-[11.5px] font-bold cursor-pointer transition-colors"
                      style={{ background: postAsStudio === asStudio ? "#223345" : "transparent", color: postAsStudio === asStudio ? "#e7eef4" : "#8aa0b4" }}>
                      {asStudio ? (myStudio.studio_name ?? myStudio.handle) : authorName}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
              <input value={newBody} onChange={(e) => setNewBody(e.target.value)}
                placeholder="Write a comment…"
                className="flex-1 bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-accent" />
              <button onClick={postTopLevel} disabled={posting || !newBody.trim()}
                className="px-3.5 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer border-none disabled:opacity-50"
                style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                Post
              </button>
              </div>
            </div>
          ) : (
            <Link href="/sign-in" className="text-[12.5px] text-accent mt-2 inline-block">Sign in to comment</Link>
          )}
        </div>
      )}
    </div>
  );
}

function FeedPostCard({ post, userId, authorName }: { post: FeedPostRow; userId?: string; authorName: string }) {
  const studioName = post.creator_profiles?.studio_name ?? post.creator_profiles?.handle ?? "Studio";
  const handle = post.creator_profiles?.handle;
  const pair = pal[studioName.length % pal.length];

  return (
    <div className="bg-panel border border-line rounded-[10px] p-4.5">
      <div className="flex items-center gap-2.5 mb-3">
        <GradAvatar pair={pair} className="w-[38px] h-[38px] rounded-full" />
        <div className="flex-1 min-w-0">
          {handle ? (
            <Link href={`/studio/${handle}`} className="font-bold text-[14px] no-underline text-inherit hover:text-accent">{studioName}</Link>
          ) : (
            <span className="font-bold text-[14px]">{studioName}</span>
          )}
          <div className="text-[11.5px] text-dim">{relativeTime(post.created_at)}</div>
        </div>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md tracking-[.02em] bg-[rgba(86,166,232,.14)] text-[#8fc6f0] shrink-0">
          {postTypeLabel[post.type]}
        </span>
      </div>

      <StudioPostBody post={post} />

      <PostComments postId={post.id} authorName={authorName} userId={userId} />
    </div>
  );
}

export default function CommunityFeedPage() {
  const { user } = useUser();
  const authorName = user?.username ?? user?.firstName ?? "anon";

  const [posts, setPosts] = useState<FeedPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    let active = true;
    getFeedPosts(PAGE_SIZE, 0)
      .then((rows) => {
        if (!active) return;
        setPosts(rows);
        setHasMore(rows.length === PAGE_SIZE);
        setLoading(false);
      })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const rows = await getFeedPosts(PAGE_SIZE, posts.length);
      setPosts((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <CommunitySubNav />
      <div className="max-w-[680px] mx-auto px-4 sm:px-6 pt-6 pb-16">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Feed</h1>
        <p className="text-muted text-[15px] mt-2 mb-5 max-w-[560px]">
          News, screenshots, videos and promos from studios across Woven.
        </p>

        {loading && <div className="text-center text-muted text-[14px] py-10">Loading…</div>}
        {!loading && posts.length === 0 && (
          <div className="rounded-lg border border-line bg-panel py-10 flex items-center justify-center text-dim text-[13px]">
            No posts yet.
          </div>
        )}

        <div className="flex flex-col gap-4">
          {posts.map((p) => <FeedPostCard key={p.id} post={p} userId={user?.id} authorName={authorName} />)}
        </div>

        {hasMore && posts.length > 0 && (
          <div className="flex justify-center mt-5">
            <button onClick={loadMore} disabled={loadingMore}
              className="px-5 py-2.5 rounded-[9px] font-bold text-[14px] cursor-pointer bg-panel2 border border-line text-ink disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
