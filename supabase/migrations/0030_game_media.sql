-- Formally captures games' RLS policies, found live but undocumented in any
-- migration (same untracked-dashboard-change pattern found repeatedly this
-- session) — re-asserted idempotently with this session's newer
-- (select auth.jwt()->>'sub') idiom instead of the older
-- current_setting('request.jwt.claims', true)::json->>'sub' one, for
-- consistency with 0018/0020/0029. Same semantics, no functional change.

drop policy if exists creator_insert_own_games on public.games;
create policy creator_insert_own_games on public.games
  for insert to authenticated
  with check (creator_id in (select id from public.creator_profiles where clerk_user_id = (select auth.jwt()->>'sub')));

drop policy if exists creator_read_own_games on public.games;
create policy creator_read_own_games on public.games
  for select to authenticated
  using (creator_id in (select id from public.creator_profiles where clerk_user_id = (select auth.jwt()->>'sub')));

drop policy if exists creator_update_own_games on public.games;
create policy creator_update_own_games on public.games
  for update to authenticated
  using (creator_id in (select id from public.creator_profiles where clerk_user_id = (select auth.jwt()->>'sub')))
  with check (creator_id in (select id from public.creator_profiles where clerk_user_id = (select auth.jwt()->>'sub')));

drop policy if exists public_read_live_games on public.games;
create policy public_read_live_games on public.games
  for select
  using (status = 'live');

-- video_url is new. thumbnail_url/banner_url already exist live (same
-- untracked-drift pattern) — these two are a documentation no-op.
alter table public.games add column if not exists video_url text;
alter table public.games add column if not exists thumbnail_url text;
alter table public.games add column if not exists banner_url text;

alter table public.creator_profiles add column if not exists banner_url text;

create table if not exists public.game_screenshots (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.game_screenshots enable row level security;

drop policy if exists game_screenshots_select on public.game_screenshots;
create policy game_screenshots_select on public.game_screenshots
  for select using (true);

drop policy if exists game_screenshots_write_own on public.game_screenshots;
create policy game_screenshots_write_own on public.game_screenshots
  for all to authenticated
  using (
    exists (
      select 1 from public.games g
      join public.creator_profiles cp on cp.id = g.creator_id
      where g.id = game_screenshots.game_id
        and cp.clerk_user_id = (select auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1 from public.games g
      join public.creator_profiles cp on cp.id = g.creator_id
      where g.id = game_screenshots.game_id
        and cp.clerk_user_id = (select auth.jwt()->>'sub')
    )
  );

-- Shared public bucket for game/studio media (capsule art, banners,
-- screenshots) — separate from game-builds (versioned playable build
-- artifacts with dist/source-scoped RLS) and creator-assets (private-by-
-- default tool assets). All writes go through service-role API routes.
--
-- A "public" bucket flag alone does not bypass storage.objects' RLS for
-- the anon role — confirmed earlier this session with game-builds, which
-- needed both the public flag AND an explicit select policy before its
-- public URLs actually served anything. Everything in this bucket is
-- meant to be unconditionally public (unlike game-builds' dist/, which
-- needed per-build gating), so the policy here is a flat `using (true)`
-- scoped to just this bucket, not a dynamic per-row check.
insert into storage.buckets (id, name, public, file_size_limit)
values ('platform-media', 'platform-media', true, 20971520)
on conflict (id) do nothing;

drop policy if exists platform_media_public_read on storage.objects;
create policy platform_media_public_read on storage.objects
  for select
  using (bucket_id = 'platform-media');
