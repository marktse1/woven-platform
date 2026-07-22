-- Sweeping pg_policies directly (not just migration files) while verifying
-- the creator_profiles fix turned up another untracked dashboard policy:
-- user_library had a pre-existing "anon_read_user_library" (select using
-- true) sitting alongside the correctly-scoped policies added in
-- 0023_user_library_rls.sql — meaning anyone with the anon key could still
-- read every user's entire library (which games they own) despite that
-- earlier fix, since PERMISSIVE policies are additive/OR'd together.

drop policy if exists "anon_read_user_library" on public.user_library;

-- Only user_library_select_own and user_library_insert_own (from 0023)
-- should remain.
