import { getStaffMember } from "@/lib/staff";

// Lets admin client pages know the caller's real staff role without
// re-implementing the BOOTSTRAP_ADMIN_EMAIL / staff_roles lookup client-side.
// This is a display/gating convenience only — every actual mutation route
// re-checks requireStaff()/canApprove() itself server-side.
export async function GET() {
  const staff = await getStaffMember();
  return Response.json({ staff });
}
