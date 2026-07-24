import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { extractFirstUrl, fetchLinkPreview } from "@/lib/linkPreview";

const BUCKET = "platform-media";
const POST_TYPES = ["news", "image", "video", "promo"] as const;
type PostType = (typeof POST_TYPES)[number];
const POST_FIELDS = "id, creator_id, type, title, body, media_url, link_url, link_preview, created_at, studio_post_media(media_url, position)";

// Creator's own studio_posts — GET for the edit-profile Posts list, POST to
// publish a new one. Split into its own route (rather than going through
// the anon client directly, as lib/studioPosts.ts's reads do) because
// creating a post needs to turn the uploaded storage path into a public
// media_url server-side, same as app/api/creator/profile/banner does for
// the banner image.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: profile } = await admin
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return Response.json({ error: "No creator profile" }, { status: 404 });

  const { data, error } = await admin
    .from("studio_posts")
    .select(POST_FIELDS)
    .eq("creator_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ posts: data ?? [] });
}

function mediaUrlFor(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: profile } = await admin
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return Response.json({ error: "No creator profile" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { type, title, body: postBody, link_url, media_path, media_paths } = body as {
    type?: PostType;
    title?: string;
    body?: string;
    link_url?: string;
    media_path?: string;
    media_paths?: string[];
  };

  if (!type || !POST_TYPES.includes(type)) {
    return Response.json({ error: "Invalid post type" }, { status: 400 });
  }

  const trimmedLinkUrl = typeof link_url === "string" ? link_url.trim() : "";

  if (type === "image" && (!Array.isArray(media_paths) || media_paths.length === 0)) {
    return Response.json({ error: "An image post requires at least one photo" }, { status: 400 });
  }
  if (type === "video" && !media_path && !trimmedLinkUrl) {
    return Response.json({ error: "A video post requires either a link or an uploaded file" }, { status: 400 });
  }

  // media_path(s) are signed-upload paths minted for this creator by
  // /api/uploads/studio-posts/sign — confirm they're actually theirs rather
  // than trusting an arbitrary client-supplied path.
  const ownPrefix = `studios/${profile.id}/posts/`;
  if (media_path && !media_path.startsWith(ownPrefix)) {
    return Response.json({ error: "Invalid media path" }, { status: 400 });
  }
  if (media_paths && media_paths.some((p) => typeof p !== "string" || !p.startsWith(ownPrefix))) {
    return Response.json({ error: "Invalid media path" }, { status: 400 });
  }

  const media_url = media_path ? mediaUrlFor(media_path) : null;

  const trimmedBody = typeof postBody === "string" ? postBody.trim() || null : null;
  let link_preview = null;
  const bodyUrl = extractFirstUrl(trimmedBody);
  if (bodyUrl) {
    link_preview = await fetchLinkPreview(bodyUrl).catch(() => null);
  }

  const { data: post, error } = await admin
    .from("studio_posts")
    .insert({
      creator_id: profile.id,
      type,
      title: typeof title === "string" ? title.trim() || null : null,
      body: trimmedBody,
      link_url: trimmedLinkUrl || null,
      media_url,
      link_preview,
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (type === "image" && media_paths) {
    const rows = media_paths.map((path, position) => ({ post_id: post.id, media_url: mediaUrlFor(path), position }));
    const { error: mediaErr } = await admin.from("studio_post_media").insert(rows);
    if (mediaErr) return Response.json({ error: mediaErr.message }, { status: 500 });
  }

  const { data: full, error: fetchErr } = await admin.from("studio_posts").select(POST_FIELDS).eq("id", post.id).single();
  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 });

  return Response.json({ post: full });
}
