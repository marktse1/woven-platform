-- 0026 added a correctly-scoped select policy, but creator_profiles had
-- five other policies already present in the live database that were
-- never captured in any migration (set directly in the Supabase dashboard
-- at some point — the exact same untracked-dashboard-change pattern as the
-- user_library RLS gap fixed earlier). Postgres RLS policies are additive
-- (PERMISSIVE, OR'd together), so 0026's restrictive-looking select policy
-- did nothing to stop these — in particular "anon can update creator
-- profile status" (qual: true, with_check: true) let ANY anon-key caller
-- update ANY row's status, confirmed live via a direct PATCH test after
-- 0026 shipped.
--
-- Discovered by querying pg_policies directly (via the Management API),
-- since these were invisible to a migration-file-only audit.

drop policy if exists "anon can insert creator profiles" on public.creator_profiles;
drop policy if exists "anon can read creator profiles" on public.creator_profiles;
drop policy if exists "anon can update creator profile status" on public.creator_profiles;
drop policy if exists "creator_profiles_insert" on public.creator_profiles;
drop policy if exists "creator_profiles_read_own" on public.creator_profiles;

-- Only creator_profiles_select (from 0026) should remain: read own row or
-- any approved creator's row, no insert/update/delete policy at all.
