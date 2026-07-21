"use client";

// Browser-side helpers for the public game store/library — mirrors
// lib/assets.ts's conventions (anon Supabase client, scoped by Clerk user
// id in the query, matching this repo's established permissive-RLS pattern).

import { getSupabaseClient } from "@/lib/supabase";

export type GameRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  price_cents: number;
  pass_included: boolean;
  tags: string[];
  status: string;
  creator_id: string | null;
  created_at: string;
  creator_profiles: { studio_name: string | null; handle: string | null } | null;
};

export type GameBuildRow = {
  id: string;
  build_url: string;
  entry_file: string;
  changelog: string | null;
  created_at: string;
};

export type GameBuildHistoryRow = {
  id: string;
  version: string;
  changelog: string | null;
  is_current: boolean;
  created_at: string;
};

export type CreatorProfileRow = {
  id: string;
  studio_name: string | null;
  handle: string | null;
  about: string | null;
  country: string | null;
  team_size: string | null;
  links: string | null;
  engines: string[] | null;
  created_at: string;
};

function client() {
  const c = getSupabaseClient();
  if (!c) throw new Error("Supabase is not configured (missing env vars).");
  return c;
}

/** A single live, publicly-visible game by its store slug. */
export async function getGameBySlug(slug: string): Promise<GameRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("games")
    .select("id, slug, title, short_description, price_cents, pass_included, tags, status, creator_id, created_at, creator_profiles(studio_name, handle)")
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle<GameRow>();
  if (error) throw error;
  return data;
}

/** The build actually servable right now (public-read once ready, per
 * 0015_game_builds_bucket_policy.sql) — null if nothing's ready yet. */
export async function getCurrentBuild(gameId: string): Promise<GameBuildRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("game_builds")
    .select("id, build_url, entry_file, changelog, created_at")
    .eq("game_id", gameId)
    .eq("is_current", true)
    .eq("status", "ready")
    .maybeSingle<GameBuildRow>();
  if (error) throw error;
  return data;
}

/** Every ready build for a game, newest first — a Steam-style "version
 * history" of change notes. game_builds has RLS `for select using (true)`,
 * so this is a plain public read, same as getCurrentBuild. */
export async function getBuildHistory(gameId: string): Promise<GameBuildHistoryRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("game_builds")
    .select("id, version, changelog, is_current, created_at")
    .eq("game_id", gameId)
    .eq("status", "ready")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** A public studio profile by its creator_profiles.handle. Not using
 * .maybeSingle() even though handle is now unique-indexed
 * (0025_creator_profiles_handle_unique.sql only enforces it going forward
 * for non-null handles) — defensive against any pre-existing duplicates. */
export async function getCreatorByHandle(handle: string): Promise<CreatorProfileRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("creator_profiles")
    .select("id, studio_name, handle, about, country, team_size, links, engines, created_at")
    .eq("handle", handle)
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** A studio's live, publicly-visible games — for the studio profile page. */
export async function getGamesByCreator(creatorId: string): Promise<GameRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("games")
    .select("id, slug, title, short_description, price_cents, pass_included, tags, status, creator_id, created_at")
    .eq("creator_id", creatorId)
    .eq("status", "live")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as GameRow[];
}

export async function isInLibrary(userId: string, gameId: string): Promise<boolean> {
  const supabase = client();
  const { data, error } = await supabase
    .from("user_library")
    .select("id")
    .eq("clerk_user_id", userId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Adds a free or Pass-included game to the user's library — no real
 * Pass-subscription check exists to verify against, so both cases are
 * treated as directly grantable (confirmed scope: this repo has no
 * checkout flow yet for priced games, so those aren't handled here). */
export async function addFreeGameToLibrary(userId: string, gameId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from("user_library")
    .insert({ clerk_user_id: userId, game_id: gameId, source: "grant" });
  if (error) throw error;
}
