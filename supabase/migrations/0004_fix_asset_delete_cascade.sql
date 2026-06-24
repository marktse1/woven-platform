-- Fixes a silently-broken delete: pipeline_steps.input_asset_id/output_asset_id
-- referenced creator_assets with no ON DELETE behavior (defaulting to NO ACTION),
-- so deleting any asset ever used in a Pipeline Studio session hit a foreign-key
-- violation that the UI swallowed without telling the user. Deleting an asset
-- should remove its own step history (not other assets), so CASCADE here is
-- safe and matches "delete this model" meaning gone, history and all.

alter table public.pipeline_steps drop constraint if exists pipeline_steps_input_asset_id_fkey;
alter table public.pipeline_steps
  add constraint pipeline_steps_input_asset_id_fkey
  foreign key (input_asset_id) references public.creator_assets (id) on delete cascade;

alter table public.pipeline_steps drop constraint if exists pipeline_steps_output_asset_id_fkey;
alter table public.pipeline_steps
  add constraint pipeline_steps_output_asset_id_fkey
  foreign key (output_asset_id) references public.creator_assets (id) on delete cascade;
