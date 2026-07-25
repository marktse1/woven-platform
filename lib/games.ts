"use client";

// Browser-side helpers for the public game store/library — mirrors
// lib/assets.ts's conventions (anon Supabase client, scoped by Clerk user
// id in the query, matching this repo's established permissive-RLS pattern).

import { getSupabaseClient } from "@/lib/supabase";

export type UploadProgress = { loaded: number; total: number; pct: number };

async function signTrailerUpload(gameId: string, fileName: string, fileSizeBytes: number): Promise<{ path: string; signedUrl: string }> {
  const res = await fetch("/api/uploads/games/trailer/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, fileName, fileSizeBytes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to get an upload URL (${res.status})`);
  }
  return res.json();
}

function putTrailerWithProgress(url: string, file: File, onProgress?: (p: UploadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress({ loaded: e.loaded, total: e.total, pct: e.total > 0 ? e.loaded / e.total : 0 });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.send(file);
  });
}

/** Uploads a game trailer video directly to Storage via a signed URL, then saves it as the game's video_url. Returns the new public URL. */
export async function uploadGameTrailer(
  gameId: string,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ url: string }> {
  const { path, signedUrl } = await signTrailerUpload(gameId, file.name, file.size);
  await putTrailerWithProgress(signedUrl, file, onProgress);
  const res = await fetch(`/api/games/${gameId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_path: path }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Could not save the uploaded trailer.");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return { url: `${base}/storage/v1/object/public/platform-media/${path}` };
}

export type GameRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  price_cents: number;
  original_price_cents: number | null;
  tags: string[];
  status: string;
  creator_id: string | null;
  created_at: string;
  rating: number | null;
  plays: number;
  thumbnail_url: string | null;
  banner_url: string | null;
  banner_pos_x: number;
  banner_pos_y: number;
  video_url: string | null;
  creator_profiles: { studio_name: string | null; handle: string | null } | null;
};

/** "Free" or "$X.XX" — the one shared price formatter for every storefront
 * surface (store landing, /browse, studio pages, game detail), replacing
 * three near-identical local copies that each had their own now-removed
 * Woven Pass branch. Callers render the struck-through original +
 * discount badge themselves (via discountPercent below) when a game is on
 * sale — that's markup, not string formatting, so it stays out of this
 * data-layer file. */
export function formatPrice(priceCents: number): string {
  if (priceCents === 0) return "Free";
  return `$${(priceCents / 100).toFixed(2)}`;
}

/** Null unless a game is genuinely on sale (original_price_cents set and
 * actually higher than the current price — same condition the DB's
 * games_original_price_check constraint enforces). */
export function discountPercent(priceCents: number, originalPriceCents: number | null): number | null {
  if (!originalPriceCents || originalPriceCents <= priceCents) return null;
  return Math.round((1 - priceCents / originalPriceCents) * 100);
}

export type GameScreenshotRow = {
  id: string;
  storage_path: string;
  position: number;
};

export type GameReviewRow = {
  id: string;
  game_id: string;
  clerk_user_id: string;
  rating: number;
  body: string | null;
  created_at: string;
  updated_at: string;
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
  banner_url: string | null;
  banner_pos_x: number;
  banner_pos_y: number;
  created_at: string;
  status?: "pending" | "approved" | "rejected";
  rejection_note?: string | null;
};

/** Converts the 1-5 star average (games.rating, trigger-maintained from
 * game_reviews) into a Metacritic-style 0-100 score. null when there are
 * no reviews yet — a game with zero reviews shows no score, not a 0. */
export function scoreOutOf100(rating: number | null): number | null {
  if (rating == null) return null;
  return Math.round((rating / 5) * 100);
}

export function scoreColor(score: number): string {
  if (score >= 75) return "#5cb85c";
  if (score >= 50) return "#f0c66a";
  return "#e35c5c";
}

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
    .select("id, slug, title, short_description, price_cents, original_price_cents, tags, status, creator_id, created_at, rating, plays, thumbnail_url, banner_url, banner_pos_x, banner_pos_y, video_url, creator_profiles(studio_name, handle)")
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle<GameRow>();
  if (error) throw error;
  return data;
}

/** A game's screenshot gallery, in creator-set order. game_screenshots has
 * RLS `for select using (true)` — a plain public read. Returns full public
 * URLs (constructed from the stored path) rather than making callers know
 * the platform-media bucket name. */
export async function getScreenshots(gameId: string): Promise<string[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("game_screenshots")
    .select("id, storage_path, position")
    .eq("game_id", gameId)
    .order("position", { ascending: true });
  if (error) throw error;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (data ?? []).map((s: GameScreenshotRow) => `${base}/storage/v1/object/public/platform-media/${s.storage_path}`);
}

/** A game by id, regardless of status — for a creator editing their own
 * (possibly not-yet-live) game. RLS (creator_read_own_games /
 * public_read_live_games, 0030_game_media.sql) scopes this to either the
 * caller's own game or any live one; a non-owner trying to open another
 * creator's draft simply gets null back. */
export async function getGameById(gameId: string): Promise<GameRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("games")
    .select("id, slug, title, short_description, price_cents, original_price_cents, tags, status, creator_id, created_at, rating, plays, thumbnail_url, banner_url, banner_pos_x, banner_pos_y, video_url, creator_profiles(studio_name, handle)")
    .eq("id", gameId)
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
    .select("id, studio_name, handle, about, country, team_size, links, engines, banner_url, banner_pos_x, banner_pos_y, created_at")
    .eq("handle", handle)
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** The caller's own creator_profiles row, any status — for self-editing
 * (contrast with getCreatorByHandle, which requires status='approved' and
 * is for the public studio page, not self-management). */
export async function getMyCreatorProfile(userId: string): Promise<CreatorProfileRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("creator_profiles")
    .select("id, studio_name, handle, about, country, team_size, links, engines, banner_url, banner_pos_x, banner_pos_y, created_at, status, rejection_note")
    .eq("clerk_user_id", userId)
    .maybeSingle<CreatorProfileRow>();
  if (error) throw error;
  return data;
}

export type StoreSort = "trending" | "top_sellers" | "newest" | "price_asc" | "price_desc";

/** Live, publicly-visible games across the whole store, filterable/sortable
 * — backs both the store landing's rails and /browse's real list. Mirrors
 * lib/assets.ts's listMarketplaceAssets: build the query conditionally,
 * single error/data ?? [] handling. "trending"/"top_sellers" are proxies —
 * plays is the only real popularity signal this schema has, there's no
 * sales-ranking pipeline. */
export async function listStoreGames(opts: {
  tag?: string;
  onSale?: boolean;
  sort?: StoreSort;
} = {}): Promise<GameRow[]> {
  const supabase = client();
  let q = supabase
    .from("games")
    .select("id, slug, title, short_description, price_cents, original_price_cents, tags, status, creator_id, created_at, rating, plays, thumbnail_url, banner_url, banner_pos_x, banner_pos_y, video_url, creator_profiles(studio_name, handle)")
    .eq("status", "live");

  if (opts.tag) q = q.contains("tags", [opts.tag]);
  if (opts.onSale) q = q.not("original_price_cents", "is", null);

  if (opts.sort === "top_sellers") q = q.order("plays", { ascending: false });
  else if (opts.sort === "price_asc") q = q.order("price_cents", { ascending: true });
  else if (opts.sort === "price_desc") q = q.order("price_cents", { ascending: false });
  else q = q.order("created_at", { ascending: false }).order("plays", { ascending: false }); // newest/trending

  const { data, error } = await q.returns<GameRow[]>();
  if (error) throw error;
  return data ?? [];
}

/** A studio's live, publicly-visible games — for the studio profile page. */
export async function getGamesByCreator(creatorId: string): Promise<GameRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("games")
    .select("id, slug, title, short_description, price_cents, original_price_cents, tags, status, creator_id, created_at, rating, plays")
    .eq("creator_id", creatorId)
    .eq("status", "live")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as GameRow[];
}

/** Studio names/handles for a batch of creator_profiles ids — used to render a real studio identity (avatar, link) wherever posted_as_studio_id shows up (threads, studio_post_comments), instead of just a bare uuid. */
export async function getCreatorProfilesByIds(ids: string[]): Promise<Record<string, { studio_name: string | null; handle: string | null }>> {
  if (ids.length === 0) return {};
  const supabase = client();
  const { data, error } = await supabase
    .from("creator_profiles")
    .select("id, studio_name, handle")
    .in("id", ids)
    .returns<{ id: string; studio_name: string | null; handle: string | null }[]>();
  if (error) throw error;
  const map: Record<string, { studio_name: string | null; handle: string | null }> = {};
  for (const row of data ?? []) map[row.id] = { studio_name: row.studio_name, handle: row.handle };
  return map;
}

export async function isFollowingCreator(userId: string, creatorId: string): Promise<boolean> {
  const supabase = client();
  const { data, error } = await supabase
    .from("creator_follows")
    .select("id")
    .eq("clerk_user_id", userId)
    .eq("creator_id", creatorId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function getFollowerCount(creatorId: string): Promise<number> {
  const supabase = client();
  const { count, error } = await supabase
    .from("creator_follows")
    .select("*", { count: "exact", head: true })
    .eq("creator_id", creatorId);
  if (error) throw error;
  return count ?? 0;
}

export async function followCreator(userId: string, creatorId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from("creator_follows")
    .insert({ clerk_user_id: userId, creator_id: creatorId });
  if (error) throw error;
}

export async function unfollowCreator(userId: string, creatorId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from("creator_follows")
    .delete()
    .eq("clerk_user_id", userId)
    .eq("creator_id", creatorId);
  if (error) throw error;
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

/** Adds a $0 game directly to the user's library — priced games instead go
 * through the real Stripe checkout flow (app/checkout/page.tsx), which
 * writes to user_library via the payment_intent.succeeded webhook. */
export async function addFreeGameToLibrary(userId: string, gameId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from("user_library")
    .insert({ clerk_user_id: userId, game_id: gameId, source: "grant" });
  if (error) throw error;
}

/** Whether this user has actually launched this game at least once — the
 * real gate for reviews (0029_game_reviews.sql), not just ownership. */
export async function hasPlayedGame(userId: string, gameId: string): Promise<boolean> {
  const supabase = client();
  const { data, error } = await supabase
    .from("user_library")
    .select("first_played_at")
    .eq("clerk_user_id", userId)
    .eq("game_id", gameId)
    .maybeSingle<{ first_played_at: string | null }>();
  if (error) throw error;
  return !!data?.first_played_at;
}

/** Marks a game as played, once — safe to call every time Play is pressed
 * (the `is null` guard means only the first call ever actually writes). */
export async function markGamePlayed(userId: string, gameId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from("user_library")
    .update({ first_played_at: new Date().toISOString() })
    .eq("clerk_user_id", userId)
    .eq("game_id", gameId)
    .is("first_played_at", null);
  if (error) throw error;
}

/** Every review for a game, newest first. game_reviews has RLS
 * `for select using (true)` — a plain public read. */
export async function getReviews(gameId: string): Promise<GameReviewRow[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from("game_reviews")
    .select("id, game_id, clerk_user_id, rating, body, created_at, updated_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getMyReview(userId: string, gameId: string): Promise<GameReviewRow | null> {
  const supabase = client();
  const { data, error } = await supabase
    .from("game_reviews")
    .select("id, game_id, clerk_user_id, rating, body, created_at, updated_at")
    .eq("game_id", gameId)
    .eq("clerk_user_id", userId)
    .maybeSingle<GameReviewRow>();
  if (error) throw error;
  return data;
}

/** Writes or edits the caller's own review. RLS enforces the "owned and
 * played" rule (0029_game_reviews.sql) — this call fails outright if
 * first_played_at isn't set yet, not just hidden by the UI. */
export async function upsertReview(userId: string, gameId: string, rating: number, body: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from("game_reviews")
    .upsert(
      { game_id: gameId, clerk_user_id: userId, rating, body: body.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: "game_id,clerk_user_id" },
    );
  if (error) throw error;
}
