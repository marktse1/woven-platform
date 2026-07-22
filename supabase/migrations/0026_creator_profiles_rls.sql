-- creator_profiles had RLS never enabled at all — any anon-key holder could
-- read every creator's Stripe Connect account id/charges-enabled flag, or
-- PATCH any row's status straight to 'approved' with zero server-side
-- enforcement (the admin page's staff gating is real for the UI, but the
-- underlying table write had no backing check at all).
--
-- No insert/update/delete policy is added here on purpose — every write now
-- goes through a service-role-backed API route (app/api/creator/apply,
-- app/api/creator/profile, app/api/admin/creators/[id]/decide), matching
-- this repo's established pattern for every other sensitive table, instead
-- of trying to encode "which status transitions are legal" into a `with
-- check` clause for a raw client upsert.

alter table public.creator_profiles enable row level security;

-- Public byline/studio-page reads (approved creators only) + a creator's
-- own row regardless of status, so pending/rejected applicants can still
-- see their own application status.
create policy creator_profiles_select on public.creator_profiles
  for select
  using (status = 'approved' or clerk_user_id = (select auth.jwt()->>'sub'));
