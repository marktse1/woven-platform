-- Nested comments on studio_posts (0034), shown on /community/feed.
-- Self-referencing parent_id gives arbitrary-depth nesting; the client
-- assembles the tree from a flat, created_at-ordered list rather than
-- needing a recursive query. author is stored denormalized at write time
-- (the caller's Clerk username/firstName) — same convention threads.author
-- already uses, since this repo has no users table to join against.

create table public.studio_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.studio_posts(id) on delete cascade,
  parent_id uuid references public.studio_post_comments(id) on delete cascade,
  clerk_user_id text not null,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.studio_post_comments enable row level security;

create policy studio_post_comments_select on public.studio_post_comments
  for select using (true);

create policy studio_post_comments_insert_own on public.studio_post_comments
  for insert to authenticated
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create policy studio_post_comments_delete_own on public.studio_post_comments
  for delete to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));
