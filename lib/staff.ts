import { auth, currentUser } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Server-side staff/admin check, backed by the staff_roles table (0012).
// Replaces the client-side BOOTSTRAP_ADMIN_EMAIL string comparisons in
// app/admin/page.tsx and app/admin/tools/page.tsx, which enforce nothing —
// they only "work" today because RLS on the tables they touch is wide open
// (see 0001's header note). Every new admin-only route in this codebase
// should call requireStaff() and bail on null, rather than trusting a
// client-supplied role/email.
//
// The BOOTSTRAP_ADMIN_EMAIL fallback below is intentional and permanent: it
// guarantees the current admin can never be locked out by a staff_roles seed
// row not matching their exact clerk_user_id (that id wasn't known at
// migration-authoring time — see 0012's header comment).

export type StaffRole = "auditor" | "reviewer" | "senior_reviewer" | "admin";

const BOOTSTRAP_ADMIN_EMAIL = "starfox.and.mark@gmail.com";

export type StaffMember = { clerkUserId: string; email: string; role: StaffRole };

/** Returns the current request's staff membership, or null if not staff. */
export async function getStaffMember(): Promise<StaffMember | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "";

  if (email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) {
    return { clerkUserId: userId, email, role: "admin" };
  }

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data } = await admin
    .from("staff_roles")
    .select("clerk_user_id, email, role")
    .or(`clerk_user_id.eq.${userId},email.ilike.${email}`)
    .maybeSingle<{ clerk_user_id: string | null; email: string; role: StaffRole }>();

  if (!data) return null;
  return { clerkUserId: userId, email: data.email, role: data.role };
}

/** Convenience for routes that just need to gate on "is any staff role". */
export async function requireStaff(): Promise<StaffMember | null> {
  return getStaffMember();
}

export function canApprove(role: StaffRole): boolean {
  return role === "senior_reviewer" || role === "admin";
}
