import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// game_moderation_actions has RLS enabled with zero policies on purpose
// (0014_games_rating_and_moderation.sql: "not something the browser should
// ever read or write directly") — this route is the only way a creator can
// see why their own game was rejected, ownership-checked server-side the
// same way every other app/api/creator/* route is.
export async function GET(_req: Request, { params }: { params: Promise<{ gameId: string }> }) {
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

  const { data: action } = await admin
    .from("game_moderation_actions")
    .select("action, reason, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ action: string; reason: string; created_at: string }>();
  if (!action) return Response.json({ error: "No moderation action found for this game" }, { status: 404 });

  return Response.json({ action });
}
