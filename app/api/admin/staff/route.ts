import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff } from "@/lib/staff";

// Read-only staff roster for the admin console's "Team & roles" panel.
// staff_roles (0012) has no client-side RLS policy at all, so this route —
// gated by requireStaff() — is the only way the browser can see it.
// Editing roles isn't wired up yet (that needs its own write-gated route,
// left for a follow-up); this just replaces the old localStorage-backed
// fake roster with the real table.
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data, error } = await admin
    .from("staff_roles")
    .select("id, clerk_user_id, email, role, created_at")
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ staff: data ?? [] });
}
