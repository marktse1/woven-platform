import VideoEmbed from "@/components/VideoEmbed";
import type { StudioPostRow } from "@/lib/studioPosts";

// Shared post-body rendering (title/caption, media, promo CTA, link
// preview) used by both the public studio page's PostCard and the
// community feed's FeedPostCard — the two differ only in their header
// chrome (studio avatar+name vs. a type badge), not in how a post's
// content renders.
export function StudioPostBody({ post }: { post: StudioPostRow }) {
  const gallery = post.studio_post_media && post.studio_post_media.length > 0
    ? [...post.studio_post_media].sort((a, b) => a.position - b.position)
    : post.media_url && post.type === "image"
      ? [{ media_url: post.media_url, position: 0 }]
      : [];

  let hostname = "";
  try { hostname = post.link_preview ? new URL(post.link_preview.url).hostname : ""; } catch { hostname = ""; }

  return (
    <>
      {post.title && <div className="text-[15px] font-bold mb-1">{post.title}</div>}
      {post.body && <p className="text-[13.5px] text-dim whitespace-pre-wrap mb-2.5">{post.body}</p>}

      {post.type === "image" && gallery.length === 1 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={gallery[0].media_url} alt={post.title ?? ""} className="w-full rounded-lg" />
      )}
      {post.type === "image" && gallery.length > 1 && (
        <div className={`grid gap-1.5 ${gallery.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
          {gallery.map((g, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={g.media_url} alt="" className="w-full aspect-square object-cover rounded-lg" />
          ))}
        </div>
      )}

      {post.type === "video" && (post.link_url || post.media_url) && (
        <VideoEmbed url={post.link_url ?? post.media_url} className="h-[240px] sm:h-[320px]" />
      )}

      {post.type === "promo" && post.link_url && (
        <a href={post.link_url} target="_blank" rel="noreferrer"
          className="inline-block mt-1 px-3.5 py-2 rounded-lg text-[12.5px] font-bold no-underline"
          style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
          Learn more →
        </a>
      )}

      {post.link_preview && (
        <a href={post.link_preview.url} target="_blank" rel="noreferrer"
          className="flex gap-3 mt-2 rounded-lg border border-line bg-[#0a0e13] overflow-hidden no-underline text-inherit hover:border-line2 transition-colors">
          {post.link_preview.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.link_preview.image} alt="" className="w-[96px] h-[96px] object-cover shrink-0" />
          )}
          <div className="py-2.5 pr-3 min-w-0 flex flex-col justify-center">
            {hostname && <div className="text-[10.5px] uppercase tracking-[.06em] text-dim mb-0.5">{hostname}</div>}
            {post.link_preview.title && <div className="text-[13px] font-bold truncate">{post.link_preview.title}</div>}
            {post.link_preview.description && <div className="text-[12px] text-dim line-clamp-2 mt-0.5">{post.link_preview.description}</div>}
          </div>
        </a>
      )}
    </>
  );
}
