-- Player -> studio follow relationships, backing the Follow button on
-- /studio/[handle]. Same shape as user_library/game_reviews: public read,
-- self-scoped write, enforced in RLS (not just the client) — see
-- 0029_game_reviews.sql's header comment for why that distinction matters.

create table public.creator_follows (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creator_profiles(id) on delete cascade,
  clerk_user_id text not null,
  created_at timestamptz not null default now(),
  unique (creator_id, clerk_user_id)
);

alter table public.creator_follows enable row level security;

create policy creator_follows_select on public.creator_follows
  for select using (true);

create policy creator_follows_insert_own on public.creator_follows
  for insert to authenticated
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create policy creator_follows_delete_own on public.creator_follows
  for delete to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));
