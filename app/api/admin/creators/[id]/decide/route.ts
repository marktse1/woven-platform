import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff, canApprove } from "@/lib/staff";

// Server-mediated replacement for app/admin/page.tsx's previous direct
// supabase.from("creator_profiles").update({ status }) call — that had no
// real server-side authorization (see 0026_creator_profiles_rls.sql's
// header note on the table's prior wide-open state).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!canApprove(staff.role)) {
    return Response.json({ error: "Your role cannot approve or reject creator applications" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { status } = body as { status: "approved" | "rejected" | "pending" };
  if (!["approved", "rejected", "pending"].includes(status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { error } = await admin.from("creator_profiles").update({ status }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, status });
}
