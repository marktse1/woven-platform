import { requireStaff } from "@/lib/staff";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { runBuildPipeline } from "@/lib/sandbox/run-build-pipeline";

// Mirrors app/api/uploads/games/process, staff-only, targeting
// platform_tools/platform_tool_builds instead of games/game_builds. Lands
// as a new, non-current build — publishing (is_current) is a separate
// staff action (app/api/admin/tools/[toolId]/builds/[buildId]/publish).
export const maxDuration = 300;

const BUCKET = "game-builds";

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { toolSlug, storagePath } = body as { toolSlug: string; storagePath: string };
  if (!toolSlug || !storagePath) {
    return Response.json({ error: "toolSlug and storagePath are required" }, { status: 400 });
  }
  if (!storagePath.startsWith(`_incoming/${staff.clerkUserId}/`)) {
    return Response.json({ error: "storagePath does not belong to this upload session" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: tool, error: toolErr } = await admin
    .from("platform_tools")
    .select("id")
    .eq("slug", toolSlug)
    .maybeSingle<{ id: string }>();
  if (toolErr || !tool) return Response.json({ error: "Tool not found" }, { status: 404 });

  const version = Date.now().toString(36);
  const storagePrefix = `${tool.id}/${version}`;

  const { data: build, error: buildErr } = await admin
    .from("platform_tool_builds")
    .insert({ tool_id: tool.id, version, status: "processing", source_kind: "static", storage_prefix: storagePrefix, uploaded_by: staff.clerkUserId, is_current: false })
    .select("id")
    .single<{ id: string }>();
  if (buildErr || !build) return Response.json({ error: buildErr?.message ?? "Could not create build record" }, { status: 500 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ stage: "starting", progress: 0.01, buildId: build.id });

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
          await admin.from("platform_tool_builds").update({ status: "failed", error: result.error }).eq("id", build.id);
          send({ error: result.error, warnings: result.warnings, done: true });
          return;
        }

        await admin
          .from("platform_tool_builds")
          .update({
            status: "ready",
            entry_file: result.entryFile,
            engine: result.engine,
            source_kind: result.sourceKind,
            build_command: result.buildCommand,
            build_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePrefix}/dist`,
            file_count: result.fileCount,
            total_bytes: result.totalBytes,
          })
          .eq("id", build.id);

        send({ done: true, progress: 1, buildId: build.id, engine: result.engine, entryFile: result.entryFile, warnings: result.warnings });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[uploads/tools/process] error:", msg, e);
        await admin.from("platform_tool_builds").update({ status: "failed", error: msg }).eq("id", build.id);
        send({ error: msg, done: true });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" } });
}
