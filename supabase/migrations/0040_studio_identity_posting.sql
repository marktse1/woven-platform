-- threads (Discussion board) has no migration history at all — untracked,
-- created directly in Supabase at some point, confirmed live via direct
-- query to have no clerk_user_id and no verified ownership (columns were
-- exactly: id, title, excerpt, author, hub, category, tags, votes, replies,
-- pinned, created_at). Retrofitting real ownership is required before
-- "post as studio" can mean anything verifiable here, not just another
-- trusted string — same class of gap this session already fixed for
-- user_library (0023) and creator_profiles (0026).

alter table public.threads add column if not exists clerk_user_id text;
alter table public.threads add column if not exists posted_as_studio_id uuid references public.creator_profiles(id);

alter table public.threads enable row level security;

drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads for select using (true);

drop policy if exists threads_insert_own on public.threads;
create policy threads_insert_own on public.threads
  for insert to authenticated
  with check (
    clerk_user_id = (select auth.jwt()->>'sub')
    and (
      posted_as_studio_id is null
      or exists (
        select 1 from public.creator_profiles cp
        where cp.id = posted_as_studio_id
          and cp.clerk_user_id = (select auth.jwt()->>'sub')
          and cp.status = 'approved'
      )
    )
  );

-- Existing rows get clerk_user_id = null — fine, since `author` stays the
-- display fallback for old rows and nothing reads clerk_user_id as
-- required. This migration only adds ownership; it doesn't touch anything
-- that already exists.

-- studio_post_comments (0035) already has real clerk_user_id + RLS — this
-- just adds the same verifiable studio-identity claim to it.
alter table public.studio_post_comments add column if not exists posted_as_studio_id uuid references public.creator_profiles(id);

drop policy if exists studio_post_comments_insert_own on public.studio_post_comments;
create policy studio_post_comments_insert_own on public.studio_post_comments
  for insert to authenticated
  with check (
    clerk_user_id = (select auth.jwt()->>'sub')
    and (
      posted_as_studio_id is null
      or exists (
        select 1 from public.creator_profiles cp
        where cp.id = posted_as_studio_id
          and cp.clerk_user_id = (select auth.jwt()->>'sub')
          and cp.status = 'approved'
      )
    )
  );
