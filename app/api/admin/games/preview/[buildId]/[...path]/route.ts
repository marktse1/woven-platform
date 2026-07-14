import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/staff";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { mimeFor } from "@/lib/sandbox/run-build-pipeline";

// Staff-gated streaming proxy for game_builds dist/ files that aren't yet
// publicly readable (0015_game_builds_bucket_policy.sql only grants public
// read once status='ready' AND is_current=true). Lets a reviewer play a
// pending submission's build before deciding on it.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ buildId: string; path: string[] }> },
) {
  const staff = await requireStaff();
  if (!staff) return new Response("Forbidden", { status: 403 });

  const { buildId, path } = await params;
  if (path.some((seg) => seg === ".." || seg === "")) {
    return new Response("Bad path", { status: 400 });
  }
  const relPath = path.join("/");

  const admin = getSupabaseAdmin();
  if (!admin) return new Response("Supabase not configured", { status: 500 });

  const { data: build } = await admin
    .from("game_builds")
    .select("storage_prefix")
    .eq("id", buildId)
    .maybeSingle<{ storage_prefix: string }>();
  if (!build) return new Response("Not found", { status: 404 });

  const { data: blob, error } = await admin.storage
    .from("game-builds")
    .download(`${build.storage_prefix}/dist/${relPath}`);
  if (error || !blob) return new Response("Not found", { status: 404 });

  return new Response(await blob.arrayBuffer(), {
    headers: { "Content-Type": mimeFor(relPath), "Cache-Control": "no-store" },
  });
}
