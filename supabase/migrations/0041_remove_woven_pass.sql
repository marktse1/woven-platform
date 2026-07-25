-- Removes the Woven Pass subscription tier entirely. pass_included never
-- actually gated anything (lib/games.ts's own addFreeGameToLibrary doc
-- comment said as much — no real subscription check ever existed), and
-- pass_subscriptions was never a tracked migration to begin with (created
-- directly in Supabase, same untracked-drift pattern flagged repeatedly
-- this session) — dropping both outright.

alter table public.games drop column if exists pass_included;
drop table if exists public.pass_subscriptions;

-- Nothing ever actually wrote source='pass' — tighten the constraint to
-- match real usage.
alter table public.user_library drop constraint if exists user_library_source_check;
alter table public.user_library add constraint user_library_source_check
  check (source in ('purchase', 'grant'));
