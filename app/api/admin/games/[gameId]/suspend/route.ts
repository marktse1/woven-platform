import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff, canApprove } from "@/lib/staff";

// Takes an already-LIVE game down — separate from the pre-publish review
// flow (decide/route.ts), since a game can pass review, go live, and only
// later get reported or found to violate policy (no ad-based-freemium /
// predatory-monetization games, ToS violations, etc.). Requires a reason,
// logged to game_moderation_actions for an audit trail.
export async function POST(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const staff = await requireStaff();
  if (!staff || !canApprove(staff.role)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { gameId } = await params;
  const body = await req.json().catch(() => ({}));
  const { reason } = body as { reason?: string };
  if (!reason || !reason.trim()) {
    return Response.json({ error: "A reason is required to suspend a live game" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: game } = await admin.from("games").select("id, status").eq("id", gameId).maybeSingle<{ id: string; status: string }>();
  if (!game) return Response.json({ error: "Game not found" }, { status: 404 });

  await admin.from("games").update({ status: "suspended" }).eq("id", gameId);
  await admin.from("game_moderation_actions").insert({
    game_id: gameId,
    action: "suspended",
    reason: reason.trim(),
    actor_clerk_user_id: staff.clerkUserId,
  });

  return Response.json({ ok: true, status: "suspended" });
}
