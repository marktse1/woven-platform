-- Adds a fourth visibility state, "sellable" (asset marketplace listing),
-- plus a price to go with it. No CHECK constraint exists on `visibility`
-- today — it's a plain text column with private|shared|public documented in
-- a comment, not enforced — so nothing needs updating to allow the new
-- value itself.
--
-- One deliberate asymmetry: creator_assets_select_public (0018) is widened
-- to also list 'sellable' rows, so a listing (name, price, thumbnail) can
-- appear in a marketplace before purchase — but the storage.objects public
-- policy (creator_assets_objects_select_public, 0018) is NOT widened here
-- and stays 'public'-only. Sellable is not the same as downloadable: the
-- actual .glb bytes stay owner-only until a purchase/entitlement system
-- exists (tracked separately, not built yet).

alter table public.creator_assets add column if not exists price_cents integer not null default 0;

drop policy if exists creator_assets_select_public on public.creator_assets;
create policy creator_assets_select_public on public.creator_assets
  for select
  using (visibility in ('public', 'sellable'));
