-- Studio content posts (news / image / video / promo) that creators publish
-- from /dashboard/studio/edit — shown on their public studio page and
-- aggregated into /community/feed. Public read, self-scoped write, same
-- pattern as creator_follows (0033).

create table public.studio_posts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creator_profiles(id) on delete cascade,
  type text not null check (type in ('news', 'image', 'video', 'promo')),
  title text,
  body text,
  media_url text,
  link_url text,
  created_at timestamptz not null default now()
);

alter table public.studio_posts enable row level security;

create policy studio_posts_select on public.studio_posts
  for select using (true);

create policy studio_posts_write_own on public.studio_posts
  for all to authenticated
  using (creator_id in (select id from public.creator_profiles where clerk_user_id = (select auth.jwt()->>'sub')))
  with check (creator_id in (select id from public.creator_profiles where clerk_user_id = (select auth.jwt()->>'sub')));

-- platform-media's 20MB limit (0030_game_media.sql) is fine for images but
-- too small for post videos; raise it, mirroring 0006's precedent for
-- creator-assets. Still subject to the project-wide Supabase plan cap
-- (see 0003/0006's comments on that).
update storage.buckets
set file_size_limit = 209715200 -- 200 MB
where id = 'platform-media';
