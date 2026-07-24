import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Mints a Supabase Storage signed upload URL for a game's trailer video —
// same shape as app/api/uploads/studio-posts/sign/route.ts. Video is too
// large for app/api/games/[gameId]/media's in-memory multipart upload
// (Vercel's 4.5MB function body cap, see lib/uploads.ts), so this goes
// through a signed URL instead, same bucket/path family
// (games/{gameId}/...) that route already uses for thumbnail/banner/
// screenshot.

const BUCKET = "platform-media";
const MAX_BYTES = 200 * 1024 * 1024; // matches platform-media's limit (0034_studio_posts.sql)
const EXT_TO_MIME: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const { gameId, fileName, fileSizeBytes } = body as { gameId?: string; fileName?: string; fileSizeBytes?: number };
  if (!gameId || !fileName || typeof fileSizeBytes !== "number" || fileSizeBytes <= 0) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: profile } = await admin
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return Response.json({ error: "No creator profile" }, { status: 403 });

  const { data: game } = await admin.from("games").select("creator_id").eq("id", gameId).maybeSingle<{ creator_id: string }>();
  if (!game || game.creator_id !== profile.id) {
    return Response.json({ error: "Game not found or access denied" }, { status: 404 });
  }

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!EXT_TO_MIME[ext]) return Response.json({ error: `Unsupported video format: .${ext}` }, { status: 400 });
  if (fileSizeBytes > MAX_BYTES) return Response.json({ error: `File exceeds the ${MAX_BYTES / 1024 / 1024}MB limit` }, { status: 400 });

  const path = `games/${gameId}/trailer-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  }

  return Response.json({ path, token: data.token, signedUrl: data.signedUrl });
}
