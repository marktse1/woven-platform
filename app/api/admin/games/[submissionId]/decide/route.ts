import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff, canApprove } from "@/lib/staff";

// Server-mediated staff decision on a game_submissions row — replaces the
// client-direct supabase.from(...).update() anti-pattern app/admin/tools/page.tsx
// uses today (see 0001's header note: RLS is wide open, so that pattern has
// no real server-side authorization). On approval, this is also what
// actually makes the linked game_builds row is_current and the game live.
export async function POST(req: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const staff = await requireStaff();
  if (!staff) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { submissionId } = await params;
  const body = await req.json();
  const { decision, reviewNotes } = body as {
    decision: "approved" | "rejected" | "changes_requested";
    reviewNotes?: string;
  };
  if (!["approved", "rejected", "changes_requested"].includes(decision)) {
    return Response.json({ error: "Invalid decision" }, { status: 400 });
  }
  if ((decision === "approved" || decision === "rejected") && !canApprove(staff.role)) {
    return Response.json({ error: "Your role cannot approve or reject submissions" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: submission, error: subErr } = await admin
    .from("game_submissions")
    .select("id, game_id, build_id")
    .eq("id", submissionId)
    .maybeSingle<{ id: string; game_id: string; build_id: string }>();
  if (subErr || !submission) return Response.json({ error: "Submission not found" }, { status: 404 });

  await admin
    .from("game_submissions")
    .update({ status: decision, review_notes: reviewNotes ?? null, reviewed_by: staff.clerkUserId, updated_at: new Date().toISOString() })
    .eq("id", submissionId);

  if (decision === "approved") {
    // Unpublish any previously-current build for this game, then promote this one.
    await admin.from("game_builds").update({ is_current: false }).eq("game_id", submission.game_id).eq("is_current", true);
    await admin.from("game_builds").update({ is_current: true }).eq("id", submission.build_id);
    await admin.from("games").update({ status: "live" }).eq("id", submission.game_id);
    await admin.from("game_moderation_actions").insert({
      game_id: submission.game_id,
      action: "approved",
      reason: reviewNotes || "Approved via admin review",
      actor_clerk_user_id: staff.clerkUserId,
    });
  } else if (decision === "rejected") {
    await admin.from("games").update({ status: "rejected" }).eq("id", submission.game_id);
    await admin.from("game_moderation_actions").insert({
      game_id: submission.game_id,
      action: "rejected",
      reason: reviewNotes || "Rejected via admin review",
      actor_clerk_user_id: staff.clerkUserId,
    });
  }

  return Response.json({ ok: true, status: decision });
}
