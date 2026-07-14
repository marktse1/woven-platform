import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff, canApprove } from "@/lib/staff";

// Server-mediated replacement for app/admin/tools/page.tsx's previous
// direct supabase.from("tool_submissions").update(...) call — that had no
// real server-side authorization (see 0001's header note on wide-open RLS).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { status, reviewNotes } = body as {
    status: "approved" | "rejected" | "changes_requested";
    reviewNotes?: string;
  };
  if (!["approved", "rejected", "changes_requested"].includes(status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }
  if ((status === "approved" || status === "rejected") && !canApprove(staff.role)) {
    return Response.json({ error: "Your role cannot approve or reject submissions" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { error } = await admin
    .from("tool_submissions")
    .update({ status, review_notes: reviewNotes ?? null, reviewed_by: staff.email, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, status });
}
