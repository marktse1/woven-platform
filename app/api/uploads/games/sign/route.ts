import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Mints a Supabase Storage signed upload URL for a creator's game build zip.
// The zip itself is uploaded directly from the browser to Storage (bypasses
// the 4.5MB Vercel Function body cap), landing in a short-lived _incoming/
// prefix. app/api/uploads/games/process then picks it up from there.

const BUCKET = "game-builds";
const MAX_BYTES = 500 * 1024 * 1024; // matches the bucket's file_size_limit (0013)

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { fileName, fileSizeBytes } = body as { fileName: string; fileSizeBytes: number };

  if (!fileName || typeof fileSizeBytes !== "number" || fileSizeBytes <= 0) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!fileName.toLowerCase().endsWith(".zip")) {
    return Response.json({ error: "Only .zip archives are accepted" }, { status: 400 });
  }
  if (fileSizeBytes > MAX_BYTES) {
    return Response.json({ error: `File exceeds the ${MAX_BYTES / 1024 / 1024}MB limit` }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }

  const path = `_incoming/${userId}/${crypto.randomUUID()}.zip`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  }

  return Response.json({ path, token: data.token, signedUrl: data.signedUrl });
}
