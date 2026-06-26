"use client";

// Browser-side helpers for the per-creator asset library and retopo jobs.
// Uses the anon Supabase client and scopes everything by the Clerk user id,
// matching the existing creator_profiles access pattern.

import { getSupabaseClient } from "@/lib/supabase";

export type Visibility = "private" | "shared" | "public";

export type AssetRow = {
  id: string;
  clerk_user_id: string;
  name: string;
  kind: string;
  format: string;
  visibility: Visibility;
  shared_with: string[];
  storage_path: string;
  thumbnail_url: string | null;
  file_bytes: number;
  poly_count: number | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export type JobRow = {
  id: string;
  clerk_user_id: string;
  source_asset_id: string | null;
  output_asset_id: string | null;
  pipeline_step_id: string | null;
  op: string;
  status: "queued" | "processing" | "done" | "failed";
  classification: string;
  target_polys: number | null;
  mode: string;
  adaptive: boolean;
  bake_maps: string[];
  stats: Record<string, unknown>;
  error: string | null;
  created_at: string;
};

const BUCKET = "creator-assets";

function client() {
  const c = getSupabaseClient();
  if (!c) throw new Error("Supabase is not configured (missing env vars).");
  return c;
}

/** Upload a GLB blob to the private bucket and record it in the library. */
export async function uploadAsset(params: {
  userId: string;
  name: string;
  bytes: Uint8Array | ArrayBuffer | Blob;
  polyCount?: number;
  visibility?: Visibility;
  meta?: Record<string, unknown>;
}): Promise<AssetRow> {
  const supabase = client();
  const id = crypto.randomUUID();
  const safeName = params.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${params.userId}/${id}-${safeName}`;

  const blob =
    params.bytes instanceof Blob
      ? params.bytes
      : new Blob([params.bytes as BlobPart], { type: "model/gltf-binary" });

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "model/gltf-binary", upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from("creator_assets")
    .insert({
      id,
      clerk_user_id: params.userId,
      name: params.name,
      kind: "model",
      format: "glb",
      visibility: params.visibility ?? "private",
      storage_path: path,
      file_bytes: blob.size,
      poly_count: params.polyCount ?? null,
      meta: params.meta ?? {},
    })
    .select()
    .single<AssetRow>();
  if (error) throw error;
  return data;
}

/** Assets the user owns plus assets shared with them or made public. */
export async function listVisibleAssets(userId: string): Promise<AssetRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("creator_assets")
    .select("*")
    .or(
      `clerk_user_id.eq.${userId},visibility.eq.public,shared_with.cs.{${userId}}`,
    )
    .order("created_at", { ascending: false })
    .returns<AssetRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function setAssetVisibility(
  id: string,
  visibility: Visibility,
  sharedWith: string[] = [],
): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from("creator_assets")
    .update({ visibility, shared_with: sharedWith, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteAsset(asset: AssetRow): Promise<void> {
  const supabase = client();
  await supabase.storage.from(BUCKET).remove([asset.storage_path]);
  const { error } = await supabase.from("creator_assets").delete().eq("id", asset.id);
  if (error) throw error;
}

export async function deletePipelineStep(stepId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.from("pipeline_steps").delete().eq("id", stepId);
  if (error) throw error;
}

export async function getAsset(id: string): Promise<AssetRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("creator_assets")
    .select("*")
    .eq("id", id)
    .maybeSingle<AssetRow>();
  if (error) throw error;
  return data;
}

/** Signed URL for loading a private asset into the viewer. */
export async function signedAssetUrl(path: string, expires = 3600): Promise<string> {
  const supabase = client();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expires);
  if (error) throw error;
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Tier-2 retopology jobs
// ---------------------------------------------------------------------------
export async function createRetopoJob(params: {
  userId: string;
  sourceAssetId: string | null;
  classification: string;
  targetPolys: number;
  mode: "decimate" | "retopo";
  adaptive: boolean;
  bakeMaps: string[];
}): Promise<JobRow> {
  const supabase = client();
  const { data, error } = await supabase
    .from("retopo_jobs")
    .insert({
      clerk_user_id: params.userId,
      source_asset_id: params.sourceAssetId,
      classification: params.classification,
      target_polys: params.targetPolys,
      mode: params.mode,
      adaptive: params.adaptive,
      bake_maps: params.bakeMaps,
    })
    .select()
    .single<JobRow>();
  if (error) throw error;
  return data;
}

export async function listJobs(userId: string): Promise<JobRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("retopo_jobs")
    .select("*")
    .eq("clerk_user_id", userId)
    .order("created_at", { ascending: false })
    .returns<JobRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getJobForStep(stepId: string): Promise<JobRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("retopo_jobs")
    .select("*")
    .eq("pipeline_step_id", stepId)
    .maybeSingle<JobRow>();
  if (error) throw error;
  return data;
}

export async function getJob(jobId: string): Promise<JobRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("retopo_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle<JobRow>();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Pipeline Studio — order-agnostic multi-step pipeline (decimate, retopo,
// segment, adaptive density, finalize) on top of a single source asset.
// pipeline_sessions is a "what's current" pointer; pipeline_steps is the
// append-only history that makes step order and re-runs free to represent.
// ---------------------------------------------------------------------------
export type PipelineSessionRow = {
  id: string;
  clerk_user_id: string;
  source_asset_id: string;
  classification: string;
  current_asset_id: string | null;
  current_step_id: string | null;
  status: "open" | "finalized" | "archived";
  created_at: string;
  updated_at: string;
};

export type PipelineStepOp = "decimate" | "retopo" | "segment" | "adaptive_density" | "finalize";
export type PipelineStepTier = "tier1" | "tier2";
export type PipelineStepStatus = "queued" | "processing" | "done" | "failed";

export type PipelineStepRow = {
  id: string;
  session_id: string;
  clerk_user_id: string;
  seq: number;
  op: PipelineStepOp;
  tier: PipelineStepTier;
  status: PipelineStepStatus;
  input_asset_id: string;
  output_asset_id: string | null;
  params: Record<string, unknown>;
  stats: Record<string, unknown>;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/** Look up a session for a source asset without creating one. */
export async function findSessionByAsset(sourceAssetId: string): Promise<PipelineSessionRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("pipeline_sessions")
    .select("*")
    .eq("source_asset_id", sourceAssetId)
    .maybeSingle<PipelineSessionRow>();
  if (error) throw error;
  return data;
}

/** Get the existing pipeline session for a source asset, or open a new one. */
export async function openOrGetSession(
  userId: string,
  sourceAssetId: string,
  classification: string,
): Promise<PipelineSessionRow> {
  const supabase = client();

  const existing = await findSessionByAsset(sourceAssetId);
  if (existing) return existing;

  const { data: created, error: insErr } = await supabase
    .from("pipeline_sessions")
    .insert({
      clerk_user_id: userId,
      source_asset_id: sourceAssetId,
      classification,
      current_asset_id: sourceAssetId,
    })
    .select()
    .single<PipelineSessionRow>();
  if (insErr) throw insErr;
  return created;
}

export async function getSession(sessionId: string): Promise<PipelineSessionRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("pipeline_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle<PipelineSessionRow>();
  if (error) throw error;
  return data;
}

export async function listSteps(sessionId: string): Promise<PipelineStepRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("pipeline_steps")
    .select("*")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true })
    .returns<PipelineStepRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Apply a Tier-1 (client-computed) step: uploads the result GLB as a new
 * library asset, appends a `done` step row, and advances the session's
 * current-asset pointer. Synchronous — no worker involved.
 */
export async function appendTier1Step(params: {
  sessionId: string;
  userId: string;
  op: "decimate" | "segment" | "adaptive_density";
  inputAssetId: string;
  /** True for steps that don't change the mesh bytes (e.g. segmentation is metadata-only) — skips re-upload. */
  reuseInputAsOutput?: boolean;
  outputName?: string;
  outputBytes?: Uint8Array | ArrayBuffer;
  outputPolyCount?: number;
  params?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  visibility?: Visibility;
}): Promise<PipelineStepRow> {
  const supabase = client();

  let outputAssetId = params.inputAssetId;
  if (!params.reuseInputAsOutput) {
    if (!params.outputBytes || !params.outputName) {
      throw new Error("outputBytes/outputName are required unless reuseInputAsOutput is set.");
    }
    const outputAsset = await uploadAsset({
      userId: params.userId,
      name: params.outputName,
      bytes: params.outputBytes,
      polyCount: params.outputPolyCount,
      visibility: params.visibility ?? "private",
      meta: { pipelineOp: params.op, ...(params.stats ?? {}) },
    });
    outputAssetId = outputAsset.id;
  }

  const steps = await listSteps(params.sessionId);
  const seq = steps.length + 1;

  const { data: step, error: stepErr } = await supabase
    .from("pipeline_steps")
    .insert({
      session_id: params.sessionId,
      clerk_user_id: params.userId,
      seq,
      op: params.op,
      tier: "tier1",
      status: "done",
      input_asset_id: params.inputAssetId,
      output_asset_id: outputAssetId,
      params: params.params ?? {},
      stats: params.stats ?? {},
      finished_at: new Date().toISOString(),
    })
    .select()
    .single<PipelineStepRow>();
  if (stepErr) throw stepErr;

  const { error: sessErr } = await supabase
    .from("pipeline_sessions")
    .update({
      current_asset_id: outputAssetId,
      current_step_id: step.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.sessionId);
  if (sessErr) throw sessErr;

  return step;
}

/**
 * Queue a Tier-2 (Forge worker) step: appends a `queued` step row and a
 * linked `retopo_jobs` row the existing worker route already knows how to
 * claim/report against (app/api/tools/retopology/jobs/route.ts is unchanged).
 */
export async function queueTier2Step(params: {
  sessionId: string;
  userId: string;
  op: PipelineStepOp;
  inputAssetId: string;
  classification: string;
  targetPolys?: number;
  mode?: "decimate" | "retopo";
  adaptive?: boolean;
  bakeMaps?: string[];
  params?: Record<string, unknown>;
}): Promise<{ step: PipelineStepRow; job: JobRow }> {
  const supabase = client();

  const steps = await listSteps(params.sessionId);
  const seq = steps.length + 1;

  const { data: step, error: stepErr } = await supabase
    .from("pipeline_steps")
    .insert({
      session_id: params.sessionId,
      clerk_user_id: params.userId,
      seq,
      op: params.op,
      tier: "tier2",
      status: "queued",
      input_asset_id: params.inputAssetId,
      params: params.params ?? {},
    })
    .select()
    .single<PipelineStepRow>();
  if (stepErr) throw stepErr;

  const { data: job, error: jobErr } = await supabase
    .from("retopo_jobs")
    .insert({
      clerk_user_id: params.userId,
      source_asset_id: params.inputAssetId,
      pipeline_step_id: step.id,
      op: params.op,
      classification: params.classification,
      target_polys: params.targetPolys ?? null,
      mode: params.mode ?? "retopo",
      adaptive: params.adaptive ?? true,
      bake_maps: params.bakeMaps ?? ["normal", "ao"],
    })
    .select()
    .single<JobRow>();
  if (jobErr) throw jobErr;

  return { step, job };
}

/**
 * Sync a finished/failed Tier-2 job back onto its pipeline_steps row and,
 * on success, advance the session's current-asset pointer. Call this from
 * the existing job-polling effect once a watched job leaves queued/processing.
 */
export async function syncStepFromJob(step: PipelineStepRow, job: JobRow): Promise<PipelineStepRow> {
  if (job.status !== "done" && job.status !== "failed") return step;
  const supabase = client();

  const { data, error } = await supabase
    .from("pipeline_steps")
    .update({
      status: job.status,
      output_asset_id: job.output_asset_id,
      stats: job.stats,
      error: job.error,
      finished_at: new Date().toISOString(),
    })
    .eq("id", step.id)
    .select()
    .single<PipelineStepRow>();
  if (error) throw error;

  if (job.status === "done" && job.output_asset_id) {
    const { error: sessErr } = await supabase
      .from("pipeline_sessions")
      .update({
        current_asset_id: job.output_asset_id,
        current_step_id: step.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", step.session_id);
    if (sessErr) throw sessErr;
  }

  return data;
}
