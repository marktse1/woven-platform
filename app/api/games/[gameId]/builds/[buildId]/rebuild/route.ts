import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { runBuildPipeline } from "@/lib/sandbox/run-build-pipeline";

// Re-invokes the same Sandbox pipeline used for fresh uploads (Part A3/4),
// but against the edited source/ tree instead of a new zip. Output always
// lands as a NEW, non-current game_builds row — never overwrites the live
// build — so it flows through the normal review/publish path (Part 7) even
// though the edit came from the AI editor.
export const maxDuration = 300;

const BUCKET = "game-builds";

export async function POST(req: Request, { params }: { params: Promise<{ gameId: string; buildId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { gameId, buildId } = await params;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: profile } = await admin
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return Response.json({ error: "No creator profile" }, { status: 403 });

  const { data: game } = await admin.from("games").select("creator_id").eq("id", gameId).maybeSingle<{ creator_id: string }>();
  if (!game || game.creator_id !== profile.id) {
    return Response.json({ error: "Game not found or access denied" }, { status: 404 });
  }

  const { data: sourceBuild } = await admin
    .from("game_builds")
    .select("id, storage_prefix, source_kind, build_command, engine")
    .eq("id", buildId)
    .eq("game_id", gameId)
    .maybeSingle<{ id: string; storage_prefix: string; source_kind: string; build_command: string | null; engine: string | null }>();
  if (!sourceBuild) return Response.json({ error: "Build not found" }, { status: 404 });
  if (sourceBuild.source_kind !== "buildable") {
    return Response.json({ error: "This build has no source tree to rebuild from" }, { status: 400 });
  }

  const version = Date.now().toString(36);
  const storagePrefix = `${gameId}/${version}`;

  const { data: newBuild, error: buildErr } = await admin
    .from("game_builds")
    .insert({
      game_id: gameId,
      version,
      status: "processing",
      source_kind: "buildable",
      storage_prefix: storagePrefix,
      uploaded_by: userId,
      engine: sourceBuild.engine,
      is_current: false,
    })
    .select("id")
    .single<{ id: string }>();
  if (buildErr || !newBuild) return Response.json({ error: buildErr?.message ?? "Could not create build record" }, { status: 500 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ stage: "starting", progress: 0.01, buildId: newBuild.id });

      try {
        const result = await runBuildPipeline({
          admin,
          bucket: BUCKET,
          zipStoragePath: "", // unused in rebuild mode
          storagePrefix,
          mode: "rebuild",
          sourceStoragePrefix: `${sourceBuild.storage_prefix}/source`,
          buildCommand: sourceBuild.build_command ?? undefined,
          onProgress: (stage, progress) => send({ stage, progress }),
        });

        if (!result.ok) {
          await admin.from("game_builds").update({ status: "failed", error: result.error }).eq("id", newBuild.id);
          send({ error: result.error, warnings: result.warnings, done: true });
          return;
        }

        await admin
          .from("game_builds")
          .update({
            status: "ready",
            entry_file: result.entryFile,
            engine: sourceBuild.engine ?? result.engine,
            build_command: result.buildCommand,
            build_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePrefix}/dist`,
            file_count: result.fileCount,
            total_bytes: result.totalBytes,
          })
          .eq("id", newBuild.id);

        // New build needs its own review before it can go live — create a
        // fresh submission the same way a first-time upload does.
        await admin.from("game_submissions").insert({
          clerk_user_id: userId,
          game_id: gameId,
          build_id: newBuild.id,
          title: null,
          engine: sourceBuild.engine,
          status: "pending_review",
          validation_result: { ...result },
        });

        send({ done: true, progress: 1, buildId: newBuild.id, entryFile: result.entryFile, warnings: result.warnings });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[builds/rebuild] error:", msg, e);
        await admin.from("game_builds").update({ status: "failed", error: msg }).eq("id", newBuild.id);
        send({ error: msg, done: true });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" } });
}
