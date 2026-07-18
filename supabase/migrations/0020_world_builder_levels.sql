-- World Builder levels (Phase D of the world-builder tool integration).
-- Mirrors the shape the editor already produces (see
-- ~/threejs-world-builder/packages/woven-world-schema): a level manifest
-- (name/district/groups/district-level terrain settings) plus one row per
-- terrain chunk (heightmap + placed objects), rather than one big document —
-- matches how every major engine keeps a level's terrain/placement data
-- chunked for streaming, and matches this repo's own chunked game-builds
-- pattern.
--
-- Deliberately NOT wired into the editor yet (that's Phase E) — this
-- migration only creates somewhere real for a level to live.
--
-- RLS follows the exact pattern proven in 0018_creator_assets_rls.sql /
-- 0019_creator_assets_sellable.sql: owner read/write via auth.jwt()->>'sub'
-- (Clerk ids are strings, not uuids — auth.uid() doesn't apply here),
-- public/sellable rows listable with no `to` restriction so a marketplace
-- listing is browsable before sign-in, same reasoning as the live games
-- store. clerk_user_id is denormalized onto the chunks table (not just
-- joined through the parent level) to match how retopo_jobs/pipeline_steps
-- already denormalize ownership onto child rows in this codebase, rather
-- than requiring a join for every RLS check.

create table if not exists public.world_levels (
  id            uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  name          text not null,
  district      text not null,
  chunk_size    integer not null default 64,
  visibility    text not null default 'private',        -- private | shared | public | sellable
  shared_with   text[] not null default '{}',
  price_cents   integer not null default 0,
  groups        jsonb not null default '[]'::jsonb,       -- scene-graph folders/hierarchy
  terrain       jsonb not null default '{}'::jsonb,        -- district-level TerrainDistrictSettings (seed, waterLevel, shoreline, splines, shaders)
  thumbnail_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists world_levels_owner_idx on public.world_levels (clerk_user_id);
create index if not exists world_levels_visibility_idx on public.world_levels (visibility);

alter table public.world_levels enable row level security;

create policy world_levels_select_public on public.world_levels
  for select
  using (visibility in ('public', 'sellable'));

create policy world_levels_select_own on public.world_levels
  for select to authenticated
  using (
    clerk_user_id = (select auth.jwt()->>'sub')
    or (select auth.jwt()->>'sub') = any(shared_with)
  );

create policy world_levels_insert on public.world_levels
  for insert to authenticated
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create policy world_levels_update on public.world_levels
  for update to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'))
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create policy world_levels_delete on public.world_levels
  for delete to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

-- ---------------------------------------------------------------------------
-- Per-chunk terrain heightmap + placed objects. Placed objects reference
-- creator_assets.id (see PlacedObjectData in schema — asset was a bare URL
-- string in the standalone editor; that's fixed here since a bare path
-- means nothing against Woven's private, per-user storage).
-- ---------------------------------------------------------------------------

create table if not exists public.world_level_chunks (
  id            uuid primary key default gen_random_uuid(),
  level_id      uuid not null references public.world_levels(id) on delete cascade,
  clerk_user_id text not null,
  chunk_x       integer not null,
  chunk_z       integer not null,
  objects       jsonb not null default '[]'::jsonb,  -- PlacedObjectData[], asset = creator_assets.id
  terrain       jsonb not null default '{}'::jsonb,  -- TerrainChunkData: heights[], waterMask, paintMask
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (level_id, chunk_x, chunk_z)
);

create index if not exists world_level_chunks_level_idx on public.world_level_chunks (level_id);
create index if not exists world_level_chunks_owner_idx on public.world_level_chunks (clerk_user_id);

alter table public.world_level_chunks enable row level security;

-- A chunk is publicly listable exactly when its parent level is (public or
-- sellable) — checked via the parent, not duplicated visibility state.
create policy world_level_chunks_select_public on public.world_level_chunks
  for select
  using (
    exists (
      select 1 from public.world_levels l
      where l.id = world_level_chunks.level_id and l.visibility in ('public', 'sellable')
    )
  );

create policy world_level_chunks_select_own on public.world_level_chunks
  for select to authenticated
  using (
    clerk_user_id = (select auth.jwt()->>'sub')
    or exists (
      select 1 from public.world_levels l
      where l.id = world_level_chunks.level_id and (select auth.jwt()->>'sub') = any(l.shared_with)
    )
  );

create policy world_level_chunks_insert on public.world_level_chunks
  for insert to authenticated
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create policy world_level_chunks_update on public.world_level_chunks
  for update to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'))
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create policy world_level_chunks_delete on public.world_level_chunks
  for delete to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));
