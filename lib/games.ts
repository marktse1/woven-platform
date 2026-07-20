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
};

export type GameBuildRow = {
  id: string;
  build_url: string;
  entry_file: string;
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
    .select("id, slug, title, short_description, price_cents, pass_included, tags, status")
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
    .select("id, build_url, entry_file")
    .eq("game_id", gameId)
    .eq("is_current", true)
    .eq("status", "ready")
    .maybeSingle<GameBuildRow>();
  if (error) throw error;
  return data;
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
