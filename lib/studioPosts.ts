"use client";

// Browser-side helpers for studio content posts (news/image/video/promo)
// and their comments. Mirrors lib/uploads.ts's signed-upload-URL pattern
// for media (bypasses Vercel's 4.5MB function body cap, needed for video)
// and lib/games.ts's anon-client read pattern for everything else. Creating
// and deleting posts themselves goes through app/api/creator/posts (a
// service-role route, same as lib/games.ts's profile edit flow) rather than
// a helper here, since that route also computes media_url server-side.

import { getSupabaseClient } from "@/lib/supabase";

export type StudioPostType = "news" | "image" | "video" | "promo";

export type StudioPostMediaRow = { media_url: string; position: number };

export type LinkPreview = { url: string; title: string | null; description: string | null; image: string | null };

export type StudioPostRow = {
  id: string;
  creator_id: string;
  type: StudioPostType;
  title: string | null;
  body: string | null;
  media_url: string | null;
  link_url: string | null;
  link_preview: LinkPreview | null;
  created_at: string;
  studio_post_media?: StudioPostMediaRow[];
};

export type FeedPostRow = StudioPostRow & {
  creator_profiles: { studio_name: string | null; handle: string | null } | null;
};

export type StudioPostCommentRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  clerk_user_id: string;
  author: string;
  body: string;
  created_at: string;
  posted_as_studio_id: string | null;
};

export type UploadProgress = { loaded: number; total: number; pct: number };

function client() {
  const c = getSupabaseClient();
  if (!c) throw new Error("Supabase is not configured (missing env vars).");
  return c;
}

async function signUpload(fileName: string, fileSizeBytes: number): Promise<{ path: string; signedUrl: string }> {
  const res = await fetch("/api/uploads/studio-posts/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, fileSizeBytes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to get an upload URL (${res.status})`);
  }
  return res.json();
}

function putWithProgress(url: string, file: File, onProgress?: (p: UploadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress({ loaded: e.loaded, total: e.total, pct: e.total > 0 ? e.loaded / e.total : 0 });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.send(file);
  });
}

/** Uploads post media (image or video) directly to Storage via a signed URL, returning the storage path for the create-post call. */
export async function uploadStudioPostMedia(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ storagePath: string }> {
  const { path, signedUrl } = await signUpload(file.name, file.size);
  await putWithProgress(signedUrl, file, onProgress);
  return { storagePath: path };
}

const POST_FIELDS = "id, creator_id, type, title, body, media_url, link_url, link_preview, created_at, studio_post_media(media_url, position)";

/** A studio's own posts, newest first — used both by the edit-profile Posts list and the public studio page. */
export async function getPostsByCreator(creatorId: string): Promise<StudioPostRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("studio_posts")
    .select(POST_FIELDS)
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as StudioPostRow[];
}

/** Every studio's posts across the platform, newest first — paginated feed for /community/feed. */
export async function getFeedPosts(limit: number, offset: number): Promise<FeedPostRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("studio_posts")
    .select(`${POST_FIELDS}, creator_profiles(studio_name, handle)`)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as unknown as FeedPostRow[];
}

/** A post's comments, oldest first — the client assembles the parent_id tree itself rather than a recursive query. */
export async function getComments(postId: string): Promise<StudioPostCommentRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("studio_post_comments")
    .select("id, post_id, parent_id, clerk_user_id, author, body, created_at, posted_as_studio_id")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addComment(
  userId: string,
  author: string,
  postId: string,
  body: string,
  parentId: string | null = null,
  postedAsStudioId: string | null = null,
): Promise<StudioPostCommentRow> {
  const supabase = client();
  const { data, error } = await supabase
    .from("studio_post_comments")
    .insert({ post_id: postId, parent_id: parentId, clerk_user_id: userId, author, body: body.trim(), posted_as_studio_id: postedAsStudioId })
    .select("id, post_id, parent_id, clerk_user_id, author, body, created_at, posted_as_studio_id")
    .single();
  if (error) throw error;
  return data;
}
