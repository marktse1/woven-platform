-- Purchase entitlements for creator_assets sold via the "sellable" listing
-- visibility (0019). 0019's own comment flagged this as the missing piece:
-- "the actual .glb bytes stay owner-only until a purchase/entitlement
-- system exists (tracked separately, not built yet)" — this migration is
-- that system.

create table public.marketplace_purchases (
  id                       uuid primary key default gen_random_uuid(),
  clerk_user_id            text not null,
  item_type                text not null check (item_type in ('asset')),
  item_id                  uuid not null, -- creator_assets.id when item_type='asset' — no FK, same "opaque, client-stamped" precedent as creator_assets.group_id (0022)
  price_paid_cents         integer not null,
  stripe_payment_intent_id text,
  creator_amount_cents     integer,
  creator_paid_out         boolean not null default false,
  created_at               timestamptz not null default now(),
  unique (clerk_user_id, item_type, item_id)
);

alter table public.marketplace_purchases enable row level security;

create policy marketplace_purchases_select_own on public.marketplace_purchases
  for select to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

-- No insert/update/delete policy for anon/authenticated on purpose — only
-- the service-role Stripe webhook writes here, same rationale as
-- game_moderation_actions (0014) and user_library's purchase path (0023's
-- comment: "only the Stripe purchase webhook ever worked, since it uses
-- the service-role key and bypasses RLS entirely").

-- Grants a buyer read access to a purchased asset's actual storage object.
create policy creator_assets_objects_select_purchased on storage.objects
  for select to authenticated
  using (
    bucket_id = 'creator-assets'
    and exists (
      select 1 from public.creator_assets ca
      join public.marketplace_purchases mp on mp.item_type = 'asset' and mp.item_id = ca.id
      where ca.storage_path = storage.objects.name
        and mp.clerk_user_id = (select auth.jwt()->>'sub')
    )
  );
