import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// The actual "edit my game" metadata endpoint — title/description/price/
// tags/video, saved immediately, no build/zip involved (contrast with
// app/api/games/[gameId]/submit, which is submission-flow-specific and has
// a real bug where an empty string can't clear an existing value, since it
// checks truthiness rather than presence — not fixing that route here, just
// not repeating its bug in this one).
export async function PATCH(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { gameId } = await params;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

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

  const body = await req.json().catch(() => ({}));
  const { title, short_description, price_cents, pass_included, tags, video_url } = body as {
    title?: string;
    short_description?: string;
    price_cents?: number;
    pass_included?: boolean;
    tags?: string[];
    video_url?: string;
  };

  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title.trim();
  if (short_description !== undefined) patch.short_description = short_description.trim() || null;
  if (price_cents !== undefined) patch.price_cents = Math.max(0, Math.round(price_cents));
  if (pass_included !== undefined) patch.pass_included = pass_included;
  if (tags !== undefined) patch.tags = tags;
  if (video_url !== undefined) patch.video_url = video_url.trim() || null;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const { error } = await admin.from("games").update(patch).eq("id", gameId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
