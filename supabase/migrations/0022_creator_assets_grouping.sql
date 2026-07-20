-- Adds lightweight 1-level asset grouping/derivation tracking to
-- creator_assets, surfaced in the My Assets panel:
--   group_id              — assets created together in one user action
--                            share this (e.g. all textures from one
--                            Shaderade import + the resulting shader_graph
--                            asset). Not a foreign key — it's a shared
--                            opaque UUID stamped client-side, not itself a
--                            row anywhere.
--   derived_from_asset_id — single-parent derivation link (retopology
--                            output -> source mesh; Mesh Sculptor save ->
--                            the asset that was loaded before saving).
--                            on delete set null so deleting the parent
--                            never blocks/cascades deleting its derivatives.

alter table public.creator_assets add column if not exists group_id uuid;
alter table public.creator_assets add column if not exists derived_from_asset_id uuid;

alter table public.creator_assets drop constraint if exists creator_assets_derived_from_asset_id_fkey;
alter table public.creator_assets
  add constraint creator_assets_derived_from_asset_id_fkey
  foreign key (derived_from_asset_id) references public.creator_assets (id) on delete set null;

create index if not exists creator_assets_group_id_idx on public.creator_assets (group_id);
create index if not exists creator_assets_derived_from_asset_id_idx on public.creator_assets (derived_from_asset_id);
