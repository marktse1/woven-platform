"use client";

// Browser-side helpers for World Builder levels — same shape as
// lib/assets.ts (anon Supabase client, scoped by Clerk user id, matching
// the pattern every creator tool already uses). Phase D only: this gives a
// level somewhere real to live. The editor itself isn't wired to call these
// yet (Phase E) — main.ts still uses its own local/cached fallback path.

import { getSupabaseClient } from "@/lib/supabase";

export type LevelVisibility = "private" | "shared" | "public" | "sellable";

export type WorldLevelRow = {
  id: string;
  clerk_user_id: string;
  name: string;
  district: string;
  chunk_size: number;
  visibility: LevelVisibility;
  shared_with: string[];
  price_cents: number;
  groups: unknown[];
  terrain: Record<string, unknown>;
  sky_gradient: Record<string, unknown>;
  lighting: Record<string, unknown>;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
};

export type WorldLevelChunkRow = {
  id: string;
  level_id: string;
  clerk_user_id: string;
  chunk_x: number;
  chunk_z: number;
  // PlacedObjectData[] — each object's `asset` field is a creator_assets.id,
  // not a raw URL (Phase E resolves that id to a signedAssetUrl() at load).
  objects: unknown[];
  terrain: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LevelWithChunks = {
  level: WorldLevelRow;
  chunks: WorldLevelChunkRow[];
};

function client() {
  const c = getSupabaseClient();
  if (!c) throw new Error("Supabase is not configured (missing env vars).");
  return c;
}

/** Levels the user owns, in any visibility state — a "my levels" list. */
export async function listMyLevels(userId: string): Promise<WorldLevelRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("world_levels")
    .select("*")
    .eq("clerk_user_id", userId)
    .order("updated_at", { ascending: false })
    .returns<WorldLevelRow[]>();
  if (error) throw error;
  return data ?? [];
}

/** Levels the user owns plus ones shared with them or made public/sellable. */
export async function listVisibleLevels(userId: string): Promise<WorldLevelRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("world_levels")
    .select("*")
    .or(
      `clerk_user_id.eq.${userId},visibility.eq.public,visibility.eq.sellable,shared_with.cs.{${userId}}`,
    )
    .order("updated_at", { ascending: false })
    .returns<WorldLevelRow[]>();
  if (error) throw error;
  return data ?? [];
}

/** Fetches a level and every one of its terrain chunks. */
export async function loadLevel(levelId: string): Promise<LevelWithChunks> {
  const supabase = client();
  const { data: level, error: levelErr } = await supabase
    .from("world_levels")
    .select("*")
    .eq("id", levelId)
    .single<WorldLevelRow>();
  if (levelErr) throw levelErr;

  const { data: chunks, error: chunksErr } = await supabase
    .from("world_level_chunks")
    .select("*")
    .eq("level_id", levelId)
    .returns<WorldLevelChunkRow[]>();
  if (chunksErr) throw chunksErr;

  return { level, chunks: chunks ?? [] };
}

/**
 * Creates a new level (pass no `id`) or overwrites an existing one's
 * manifest + chunks (pass the owning level's `id`). Chunks are fully
 * replaced, not merged — matches the editor's own save-the-whole-layout
 * behavior (saveRemoteLayout in the standalone app).
 */
export async function saveLevel(params: {
  id?: string;
  userId: string;
  name: string;
  district: string;
  chunkSize?: number;
  groups?: unknown[];
  terrain?: Record<string, unknown>;
  skyGradient?: Record<string, unknown>;
  lighting?: Record<string, unknown>;
  chunks: Array<{
    chunkX: number;
    chunkZ: number;
    objects: unknown[];
    terrain: Record<string, unknown>;
  }>;
}): Promise<WorldLevelRow> {
  const supabase = client();

  const levelPayload = {
    clerk_user_id: params.userId,
    name: params.name,
    district: params.district,
    chunk_size: params.chunkSize ?? 64,
    groups: params.groups ?? [],
    terrain: params.terrain ?? {},
    sky_gradient: params.skyGradient ?? {},
    lighting: params.lighting ?? {},
    updated_at: new Date().toISOString(),
  };

  const { data: level, error: levelErr } = params.id
    ? await supabase.from("world_levels").update(levelPayload).eq("id", params.id).select().single<WorldLevelRow>()
    : await supabase.from("world_levels").insert(levelPayload).select().single<WorldLevelRow>();
  if (levelErr) throw levelErr;

  // Full replace: clear existing chunks for this level, then insert the
  // current set. Simple and correct for "save the whole layout"; if partial
  // chunk-level saves are ever needed, upsert-by-(level_id,chunk_x,chunk_z)
  // instead of delete+insert.
  const { error: deleteErr } = await supabase.from("world_level_chunks").delete().eq("level_id", level.id);
  if (deleteErr) throw deleteErr;

  if (params.chunks.length > 0) {
    const chunkRows = params.chunks.map((c) => ({
      level_id: level.id,
      clerk_user_id: params.userId,
      chunk_x: c.chunkX,
      chunk_z: c.chunkZ,
      objects: c.objects,
      terrain: c.terrain,
    }));
    const { error: insertErr } = await supabase.from("world_level_chunks").insert(chunkRows);
    if (insertErr) throw insertErr;
  }

  return level;
}

export async function setLevelVisibility(
  id: string,
  visibility: LevelVisibility,
  opts: { sharedWith?: string[]; priceCents?: number } = {},
): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from("world_levels")
    .update({
      visibility,
      shared_with: opts.sharedWith ?? [],
      price_cents: opts.priceCents ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Deletes a level and all its chunks (chunks cascade via the FK). */
export async function deleteLevel(id: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.from("world_levels").delete().eq("id", id);
  if (error) throw error;
}
