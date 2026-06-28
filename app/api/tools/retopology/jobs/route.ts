import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Worker-facing endpoint for the Tier-2 retopology pipeline.
//
// The browser creates queued retopo_jobs rows directly (anon client). The
// Blender/Modal worker authenticates with a shared secret and uses this route
// to (a) claim the next queued job and (b) report results. Until the worker is
// deployed, jobs simply sit in `queued` and the UI shows them as pending.

function authorized(request: Request): boolean {
  const secret = process.env.RETOPO_WORKER_SECRET;
  if (!secret) return false;
  return request.headers.get("x-worker-secret") === secret;
}

// GET: claim the oldest queued job (worker pulls work).
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "Worker storage not configured" }, { status: 503 });
  }

  const { data: job, error } = await admin
    .from("retopo_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!job) return Response.json({ job: null });

  await admin
    .from("retopo_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", job.id);

  // Provide a short-lived signed URL so the worker can download the input GLB
  // without needing direct Supabase credentials.
  let inputSignedUrl: string | null = null;
  if (job.source_asset_id) {
    const { data: assetRow } = await admin
      .from("creator_assets")
      .select("storage_path")
      .eq("id", job.source_asset_id)
      .maybeSingle();
    if (assetRow?.storage_path) {
      const { data: urlData } = await admin.storage
        .from("creator-assets")
        .createSignedUrl(assetRow.storage_path, 3600);
      inputSignedUrl = urlData?.signedUrl ?? null;
    }
  }

  return Response.json({ job: { ...job, input_signed_url: inputSignedUrl } });
}

// PATCH: worker reports completion or failure for a job.
export async function PATCH(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "Worker storage not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    jobId: string;
    status: "done" | "failed";
    outputAssetId?: string;
    stats?: Record<string, unknown>;
    error?: string;
  };

  if (!body.jobId || !body.status) {
    return Response.json({ error: "jobId and status required" }, { status: 400 });
  }

  const { error } = await admin
    .from("retopo_jobs")
    .update({
      status: body.status,
      output_asset_id: body.outputAssetId ?? null,
      stats: body.stats ?? {},
      error: body.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", body.jobId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
