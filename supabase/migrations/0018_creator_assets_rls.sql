-- Hardens creator_assets from the permissive `using (true) with check (true)`
-- policy added in 0001 (documented there as an intentional interim state) to
-- real per-operation rules, now that the browser Supabase client attaches a
-- Clerk session token (lib/supabase.ts) via Clerk's native Supabase
-- integration. Clerk ids are strings, not uuids, so this uses
-- auth.jwt()->>'sub' throughout — auth.uid() does not work here.
--
-- retopo_jobs and tool_submissions have the identical no-op policy from 0001
-- and are NOT touched by this migration (out of scope — assets only, per
-- what was asked). Once this JWT wiring proved itself out, giving those two
-- tables the same treatment is a small, mechanical follow-up.
--
-- SELECT is split in two: public-visibility rows have no `to` restriction
-- (defaults to role PUBLIC, i.e. anon included), matching this repo's own
-- precedent for browsable content in 0015_game_builds_bucket_policy.sql —
-- a marketplace needs to be visible to visitors before they sign in, the
-- same reason live games are. Owner/shared-with rows require knowing who's
-- asking, so those stay `to authenticated` (auth.jwt() is null for anon).

drop policy if exists creator_assets_rw on public.creator_assets;

create policy creator_assets_select_public on public.creator_assets
  for select
  using (visibility = 'public');

create policy creator_assets_select_own on public.creator_assets
  for select to authenticated
  using (
    clerk_user_id = (select auth.jwt()->>'sub')
    or (select auth.jwt()->>'sub') = any(shared_with)
  );

create policy creator_assets_insert on public.creator_assets
  for insert to authenticated
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create policy creator_assets_update on public.creator_assets
  for update to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'))
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create policy creator_assets_delete on public.creator_assets
  for delete to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

-- ---------------------------------------------------------------------------
-- Storage bucket: objects live at {clerk_user_id}/{id}-{name} (see
-- lib/assets.ts uploadAsset()), so storage.foldername(name)[1] is always the
-- owning user's id — the standard Supabase pattern for user-scoped folders.
--
-- Writes are owner-only. Reads also honor creator_assets.visibility/
-- shared_with (via a join on storage_path) rather than owner-only, because
-- signedAssetUrl() runs through this same browser client — without this,
-- a shared/public asset's visibility would be set correctly in the database
-- but its signed URL would still 403 for anyone but the owner, leaving
-- sharing non-functional even once a UI exists to turn it on.
-- ---------------------------------------------------------------------------

drop policy if exists creator_assets_objects_rw on storage.objects;

-- Public assets: no `to` restriction, same reasoning as
-- creator_assets_select_public above — an anon visitor's browser client
-- calling signedAssetUrl() on a public asset needs this to succeed.
create policy creator_assets_objects_select_public on storage.objects
  for select
  using (
    bucket_id = 'creator-assets'
    and exists (
      select 1 from public.creator_assets ca
      where ca.storage_path = storage.objects.name and ca.visibility = 'public'
    )
  );

create policy creator_assets_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'creator-assets'
    and (
      (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
      or exists (
        select 1 from public.creator_assets ca
        where ca.storage_path = storage.objects.name
          and (select auth.jwt()->>'sub') = any(ca.shared_with)
      )
    )
  );

create policy creator_assets_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
  );

create policy creator_assets_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
  );

create policy creator_assets_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
  );
