import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff, canApprove } from "@/lib/staff";

export async function POST(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const staff = await requireStaff();
  if (!staff || !canApprove(staff.role)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { gameId } = await params;
  const body = await req.json().catch(() => ({}));
  const { reason } = body as { reason?: string };

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: game } = await admin.from("games").select("id, status").eq("id", gameId).maybeSingle<{ id: string; status: string }>();
  if (!game) return Response.json({ error: "Game not found" }, { status: 404 });
  if (game.status !== "suspended") {
    return Response.json({ error: "Game is not currently suspended" }, { status: 400 });
  }

  await admin.from("games").update({ status: "live" }).eq("id", gameId);
  await admin.from("game_moderation_actions").insert({
    game_id: gameId,
    action: "reinstated",
    reason: reason?.trim() || "Reinstated via admin console",
    actor_clerk_user_id: staff.clerkUserId,
  });

  return Response.json({ ok: true, status: "live" });
}
