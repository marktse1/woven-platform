import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "platform-media";
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

// Studio profile banner upload — same shape as games' media route, writing
// into the shared platform-media bucket's studios/ prefix instead of games/.
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

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return Response.json({ error: "file is required" }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) return Response.json({ error: `Unsupported image format: .${ext}` }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `studios/${profile.id}/banner-${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  const { error } = await admin.from("creator_profiles").update({ banner_url: publicUrl }).eq("id", profile.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, url: publicUrl });
}
