import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff, canApprove } from "@/lib/staff";

// Flips a platform_tool_builds row to is_current, unpublishing whatever was
// previously current for that tool. Staff-only.
export async function POST(_req: Request, { params }: { params: Promise<{ toolId: string; buildId: string }> }) {
  const staff = await requireStaff();
  if (!staff || !canApprove(staff.role)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { toolId, buildId } = await params;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: build } = await admin
    .from("platform_tool_builds")
    .select("id, tool_id, status")
    .eq("id", buildId)
    .eq("tool_id", toolId)
    .maybeSingle<{ id: string; tool_id: string; status: string }>();
  if (!build) return Response.json({ error: "Build not found" }, { status: 404 });
  if (build.status !== "ready") return Response.json({ error: "Build is not ready to publish" }, { status: 400 });

  await admin.from("platform_tool_builds").update({ is_current: false }).eq("tool_id", toolId).eq("is_current", true);
  await admin.from("platform_tool_builds").update({ is_current: true, pushed_at: new Date().toISOString() }).eq("id", buildId);

  return Response.json({ ok: true });
}
