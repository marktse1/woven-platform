import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { runBuildPipeline } from "@/lib/sandbox/run-build-pipeline";

// Storage-mediated (per lib/uploads.ts): the browser already uploaded the
// zip directly to Supabase Storage via a signed URL. This route only
// receives a small JSON body referencing that object, runs the Vercel
// Sandbox extraction/validation pipeline against it, and streams NDJSON
// progress back — same shape as app/api/tools/retopology/bake/route.ts.
//
// Ownership: real Clerk auth() (not a client-supplied userId) since this
// gates publishing of arbitrary uploaded code, not just processing a GLB.
export const maxDuration = 600; // Sandbox npm install + build can run long on larger projects

const BUCKET = "game-builds";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { gameId, title, engine, storagePath } = body as {
    gameId?: string;
    title: string;
    engine?: string;
    storagePath: string;
  };

  if (!title || !storagePath) {
    return Response.json({ error: "title and storagePath are required" }, { status: 400 });
  }
  if (!storagePath.startsWith(`_incoming/${userId}/`)) {
    return Response.json({ error: "storagePath does not belong to this upload session" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }

  const { data: profile, error: profileErr } = await admin
    .from("creator_profiles")
    .select("id, status")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string; status: string }>();
  if (profileErr || !profile || profile.status !== "approved") {
    return Response.json({ error: "An approved creator profile is required to upload a game" }, { status: 403 });
  }

  let targetGameId = gameId ?? null;
  if (targetGameId) {
    const { data: existing } = await admin
      .from("games")
      .select("creator_id")
      .eq("id", targetGameId)
      .maybeSingle<{ creator_id: string }>();
    if (!existing || existing.creator_id !== profile.id) {
      return Response.json({ error: "Game not found or access denied" }, { status: 404 });
    }
  } else {
    const { data: created, error: createErr } = await admin
      .from("games")
      .insert({ creator_id: profile.id, title, engine: engine ?? null, status: "draft" })
      .select("id")
      .single<{ id: string }>();
    if (createErr || !created) {
      return Response.json({ error: createErr?.message ?? "Could not create game" }, { status: 500 });
    }
    targetGameId = created.id;
  }

  const version = Date.now().toString(36);
  const storagePrefix = `${targetGameId}/${version}`;

  const { data: build, error: buildErr } = await admin
    .from("game_builds")
    .insert({
      game_id: targetGameId,
      version,
      status: "processing",
      source_kind: "static",
      storage_prefix: storagePrefix,
      uploaded_by: userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (buildErr || !build) {
    return Response.json({ error: buildErr?.message ?? "Could not create build record" }, { status: 500 });
  }

  const { data: submission, error: subErr } = await admin
    .from("game_submissions")
    .insert({
      clerk_user_id: userId,
      game_id: targetGameId,
      build_id: build.id,
      title,
      engine: engine ?? null,
      status: "validating",
    })
    .select("id")
    .single<{ id: string }>();
  if (subErr || !submission) {
    return Response.json({ error: subErr?.message ?? "Could not create submission record" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ stage: "starting", progress: 0.01, gameId: targetGameId, buildId: build.id });

      try {
        const result = await runBuildPipeline({
          admin,
          bucket: BUCKET,
          zipStoragePath: storagePath,
          storagePrefix,
          mode: "upload",
          onProgress: (stage, progress) => send({ stage, progress }),
        });

        if (!result.ok) {
          await admin.from("game_builds").update({ status: "failed", error: result.error }).eq("id", build.id);
          await admin
            .from("game_submissions")
            .update({
              status: "draft",
              validation_result: { ok: false, error: result.error, warnings: result.warnings },
              updated_at: new Date().toISOString(),
            })
            .eq("id", submission.id);
          send({ error: result.error, warnings: result.warnings, done: true });
          return;
        }

        await admin
          .from("game_builds")
          .update({
            status: "ready",
            entry_file: result.entryFile,
            engine: engine ?? result.engine,
            source_kind: result.sourceKind,
            build_command: result.buildCommand,
            build_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePrefix}/dist`,
            file_count: result.fileCount,
            total_bytes: result.totalBytes,
            pushed_at: new Date().toISOString(),
          })
          .eq("id", build.id);

        await admin
          .from("game_submissions")
          .update({
            status: "pending_review",
            validation_result: { ...result },
            updated_at: new Date().toISOString(),
          })
          .eq("id", submission.id);

        send({
          done: true,
          progress: 1,
          gameId: targetGameId,
          buildId: build.id,
          submissionId: submission.id,
          engine: result.engine,
          entryFile: result.entryFile,
          warnings: result.warnings,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[uploads/games/process] error:", msg, e);
        await admin.from("game_builds").update({ status: "failed", error: msg }).eq("id", build.id);
        send({ error: msg, done: true });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" },
  });
}
