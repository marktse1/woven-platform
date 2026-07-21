import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { mimeFor } from "@/lib/sandbox/run-build-pipeline";

// Public streaming proxy for a live game's dist/ files. Supabase Storage's
// public-bucket serving forces any HTML-detected object to Content-Type:
// text/plain regardless of what's set at upload time (an anti-XSS measure
// for public buckets) — so an iframe pointed straight at the storage URL
// shows the entry file's raw source instead of running it. Streaming
// through here instead lets us set the real Content-Type ourselves, the
// same trick app/api/admin/games/preview already uses for reviewers.
//
// Gated to status='ready' AND is_current=true — the same condition that
// already makes these objects publicly readable via
// 0015_game_builds_bucket_policy.sql — so this route can't expose a build
// any wider than the storage bucket itself already does.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ buildId: string; path: string[] }> },
) {
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
    .eq("status", "ready")
    .eq("is_current", true)
    .maybeSingle<{ storage_prefix: string }>();
  if (!build) return new Response("Not found", { status: 404 });

  const { data: blob, error } = await admin.storage
    .from("game-builds")
    .download(`${build.storage_prefix}/dist/${relPath}`);
  if (error || !blob) return new Response("Not found", { status: 404 });

  return new Response(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": mimeFor(relPath),
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
