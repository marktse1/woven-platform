import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Mints a Supabase Storage signed upload URL for studio post media (image
// or video). Same shape as app/api/uploads/games/sign/route.ts — the file
// is uploaded directly from the browser to Storage, bypassing Vercel's
// 4.5MB Function body cap, which matters here since video can run large.

const BUCKET = "platform-media";
const MAX_BYTES_BY_KIND: Record<"image" | "video", number> = {
  image: 20 * 1024 * 1024, // matches the bucket's pre-existing 20MB limit (0030)
  video: 200 * 1024 * 1024, // matches the bucket's raised limit (0034)
};
const KIND_BY_EXT: Record<string, "image" | "video"> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
  mp4: "video", webm: "video", mov: "video",
};

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }

  const { data: profile } = await admin
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return Response.json({ error: "No creator profile" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { fileName, fileSizeBytes } = body as { fileName?: string; fileSizeBytes?: number };

  if (!fileName || typeof fileSizeBytes !== "number" || fileSizeBytes <= 0) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const kind = KIND_BY_EXT[ext];
  if (!kind) {
    return Response.json({ error: `Unsupported media format: .${ext}` }, { status: 400 });
  }
  const maxBytes = MAX_BYTES_BY_KIND[kind];
  if (fileSizeBytes > maxBytes) {
    return Response.json({ error: `File exceeds the ${maxBytes / 1024 / 1024}MB limit` }, { status: 400 });
  }

  const path = `studios/${profile.id}/posts/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  }

  return Response.json({ path, token: data.token, signedUrl: data.signedUrl });
}
