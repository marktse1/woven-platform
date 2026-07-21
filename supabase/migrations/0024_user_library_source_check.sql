-- user_library.source has a check constraint ("user_library_source_check")
-- that was added directly in the Supabase dashboard at some point — not
-- previously captured in any migration (same untracked-dashboard-change
-- pattern as the RLS gap fixed in 0023). It only allowed the values used by
-- the Stripe purchase webhook, so addFreeGameToLibrary's source: 'grant'
-- (lib/games.ts) was rejected with "violates check constraint
-- user_library_source_check" — this is what broke "Get" on free/Pass games
-- even after 0023 fixed the RLS gap.
--
-- The column's own inline comment in 0000_backfill_existing_tables.sql
-- already documents the intended domain as purchase | pass | grant; this
-- migration makes the actual constraint match that intent.

alter table public.user_library drop constraint if exists user_library_source_check;

alter table public.user_library add constraint user_library_source_check
  check (source in ('purchase', 'pass', 'grant'));
