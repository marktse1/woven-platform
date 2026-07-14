import { requireStaff } from "@/lib/staff";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Mirrors app/api/uploads/games/sign, but for Forge tool builds
// (platform_tool_builds) — staff-only, since publishing a new engine build
// isn't a creator action.

const BUCKET = "game-builds"; // shared bucket; tool builds use the same {id}/{version}/dist convention as games (see 0015's policy comment)
const MAX_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff) return Response.json({ error: "Unauthorized" }, { status: 401 });

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
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const path = `_incoming/${staff.clerkUserId}/${crypto.randomUUID()}.zip`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });

  return Response.json({ path, token: data.token, signedUrl: data.signedUrl });
}
