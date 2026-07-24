-- Photo gallery for Image-type studio_posts (0034) — a studio_posts row
-- keeps at most one photo via its own media_url column; this table lets an
-- Image post carry multiple. Mirrors game_screenshots (0030_game_media.sql)
-- both in shape and RLS.

create table public.studio_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.studio_posts(id) on delete cascade,
  media_url text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.studio_post_media enable row level security;

create policy studio_post_media_select on public.studio_post_media
  for select using (true);

create policy studio_post_media_write_own on public.studio_post_media
  for all to authenticated
  using (
    exists (
      select 1 from public.studio_posts sp
      join public.creator_profiles cp on cp.id = sp.creator_id
      where sp.id = studio_post_media.post_id
        and cp.clerk_user_id = (select auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1 from public.studio_posts sp
      join public.creator_profiles cp on cp.id = sp.creator_id
      where sp.id = studio_post_media.post_id
        and cp.clerk_user_id = (select auth.jwt()->>'sub')
    )
  );
