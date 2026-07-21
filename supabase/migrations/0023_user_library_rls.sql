-- user_library has row-level security enabled (turned on directly in the
-- Supabase dashboard at some point — not previously captured in any
-- migration) but had zero policies defined for it. With RLS on and no
-- matching policy, Postgres denies everything by default, so no one could
-- read or write their own library rows through the browser client at all —
-- only the Stripe purchase webhook ever worked, since it uses the
-- service-role key and bypasses RLS entirely. This is what silently broke
-- "Get" on free/Pass-included games (lib/games.ts addFreeGameToLibrary)
-- and would have broken the Library page's own read too.
--
-- Mirrors the Clerk-JWT ownership pattern already established in
-- 0018_creator_assets_rls.sql — auth.jwt()->>'sub' is the Clerk user id,
-- not auth.uid() (Clerk ids are strings, not uuids).

alter table public.user_library enable row level security;

drop policy if exists user_library_select_own on public.user_library;
create policy user_library_select_own on public.user_library
  for select to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

drop policy if exists user_library_insert_own on public.user_library;
create policy user_library_insert_own on public.user_library
  for insert to authenticated
  with check (clerk_user_id = (select auth.jwt()->>'sub'));
