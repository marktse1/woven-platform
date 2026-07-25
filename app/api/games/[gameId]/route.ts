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
  const { title, short_description, price_cents, original_price_cents, tags, video_url, video_path, banner_pos_x, banner_pos_y } = body as {
    title?: string;
    short_description?: string;
    price_cents?: number;
    original_price_cents?: number | null;
    tags?: string[];
    video_url?: string;
    video_path?: string;
    banner_pos_x?: number;
    banner_pos_y?: number;
  };

  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title.trim();
  if (short_description !== undefined) patch.short_description = short_description.trim() || null;
  if (price_cents !== undefined) patch.price_cents = Math.max(0, Math.round(price_cents));
  if (original_price_cents !== undefined) patch.original_price_cents = original_price_cents == null ? null : Math.max(0, Math.round(original_price_cents));
  if (tags !== undefined) patch.tags = tags;
  if (video_url !== undefined) patch.video_url = video_url.trim() || null;
  if (banner_pos_x !== undefined) patch.banner_pos_x = Math.max(0, Math.min(100, banner_pos_x));
  if (banner_pos_y !== undefined) patch.banner_pos_y = Math.max(0, Math.min(100, banner_pos_y));

  // video_path is a signed-upload path minted for this game by
  // /api/uploads/games/trailer/sign — confirm it's actually this game's
  // before trusting it, and let it win over any video_url in the same
  // request (whichever the creator's last action was — upload or paste).
  if (video_path !== undefined) {
    if (!video_path.startsWith(`games/${gameId}/`)) {
      return Response.json({ error: "Invalid media path" }, { status: 400 });
    }
    patch.video_url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/platform-media/${video_path}`;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const { error } = await admin.from("games").update(patch).eq("id", gameId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}

// Creator-initiated delete — only while the game hasn't been published or
// is sitting rejected (RLS's creator_delete_own_games, 0036, enforces the
// same condition independently; this check exists to give a friendly error
// message rather than relying on RLS to silently no-op the delete).
export async function DELETE(_req: Request, { params }: { params: Promise<{ gameId: string }> }) {
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

  const { data: game } = await admin.from("games").select("creator_id, status").eq("id", gameId).maybeSingle<{ creator_id: string; status: string }>();
  if (!game || game.creator_id !== profile.id) {
    return Response.json({ error: "Game not found or access denied" }, { status: 404 });
  }
  if (game.status !== "draft" && game.status !== "rejected") {
    return Response.json({ error: "Only draft or rejected games can be deleted" }, { status: 400 });
  }

  const { error } = await admin.from("games").delete().eq("id", gameId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
