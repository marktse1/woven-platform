"use client";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";

export type StaffRole = "auditor" | "reviewer" | "senior_reviewer" | "admin";

/** Client-side read of the caller's real staff role, backed by
 * /api/staff/me (lib/staff.ts's getStaffMember() — checked server-side
 * against the staff_roles table / bootstrap admin email, never trusted
 * from the client). Used to decide whether to show staff-only nav
 * entries; the actual admin routes re-check requireStaff() themselves
 * regardless of what this hook returns. */
export function useStaffRole(): { role: StaffRole | null; loading: boolean } {
  const { isLoaded } = useUser();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    fetch("/api/staff/me")
      .then((r) => r.json())
      .then((body: { staff: { role: StaffRole } | null }) => setRole(body.staff?.role ?? null))
      .catch(() => setRole(null))
      .finally(() => setLoading(false));
  }, [isLoaded]);

  return { role, loading };
}
