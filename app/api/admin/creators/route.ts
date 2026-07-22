import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff } from "@/lib/staff";

// Server-mediated replacement for app/admin/page.tsx's previous direct
// supabase.from("creator_profiles").select(...) call, unscoped across every
// applicant — that table has no RLS select policy wide enough to allow
// that from the browser anymore (0026_creator_profiles_rls.sql only
// allows a caller to see their own row or an approved creator's row), so
// staff now need a real server-side gate to see the full pending/rejected
// applicant list.
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data, error } = await admin
    .from("creator_profiles")
    .select("id, clerk_user_id, status, studio_name, handle, rejection_note")
    .order("id", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ profiles: data ?? [] });
}
