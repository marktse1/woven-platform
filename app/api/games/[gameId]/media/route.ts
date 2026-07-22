import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "platform-media";
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

async function requireOwnedGame(admin: ReturnType<typeof getSupabaseAdmin>, userId: string, gameId: string) {
  const { data: profile } = await admin!
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return { error: "No creator profile", status: 403 } as const;

  const { data: game } = await admin!.from("games").select("creator_id").eq("id", gameId).maybeSingle<{ creator_id: string }>();
  if (!game || game.creator_id !== profile.id) return { error: "Game not found or access denied", status: 404 } as const;

  return { ok: true } as const;
}

// POST — uploads capsule art (kind=thumbnail), a hero banner (kind=banner),
// or a new screenshot (kind=screenshot) for a game the caller owns.
// Multipart form: fields `kind`, file field `file`.
export async function POST(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { gameId } = await params;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const owned = await requireOwnedGame(admin, userId, gameId);
  if ("error" in owned) return Response.json({ error: owned.error }, { status: owned.status });

  const form = await req.formData();
  const kind = form.get("kind") as string | null;
  const file = form.get("file") as File | null;
  if (!kind || !file || !["thumbnail", "banner", "screenshot"].includes(kind)) {
    return Response.json({ error: "kind (thumbnail|banner|screenshot) and file are required" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) return Response.json({ error: `Unsupported image format: .${ext}` }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `games/${gameId}/${kind}-${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  if (kind === "thumbnail" || kind === "banner") {
    const column = kind === "thumbnail" ? "thumbnail_url" : "banner_url";
    const { error } = await admin.from("games").update({ [column]: publicUrl }).eq("id", gameId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, url: publicUrl });
  }

  const { data: maxPos } = await admin
    .from("game_screenshots")
    .select("position")
    .eq("game_id", gameId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();
  const { data: row, error } = await admin
    .from("game_screenshots")
    .insert({ game_id: gameId, storage_path: path, position: (maxPos?.position ?? -1) + 1 })
    .select("id")
    .single<{ id: string }>();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, url: publicUrl, id: row.id });
}

// DELETE — removes a screenshot (?screenshotId=...) the caller owns.
export async function DELETE(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { gameId } = await params;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const owned = await requireOwnedGame(admin, userId, gameId);
  if ("error" in owned) return Response.json({ error: owned.error }, { status: owned.status });

  const url = new URL(req.url);
  const screenshotId = url.searchParams.get("screenshotId");
  if (!screenshotId) return Response.json({ error: "screenshotId required" }, { status: 400 });

  const { data: shot } = await admin
    .from("game_screenshots")
    .select("storage_path")
    .eq("id", screenshotId)
    .eq("game_id", gameId)
    .maybeSingle<{ storage_path: string }>();
  if (!shot) return Response.json({ error: "Screenshot not found" }, { status: 404 });

  await admin.storage.from(BUCKET).remove([shot.storage_path]);
  const { error } = await admin.from("game_screenshots").delete().eq("id", screenshotId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
