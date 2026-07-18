-- Phase E follow-up: world_levels.terrain only ever covered district-level
-- terrain settings (seed/waterLevel/shoreline/splines/shaders). The editor's
-- LevelLayout also carries a sky gradient and a lighting rig, both editable
-- per-level and previously round-tripped through the standalone editor's
-- local-storage backup — without a real column for them, every save would
-- silently drop the level back to default sky/lighting on next load.

alter table public.world_levels
  add column if not exists sky_gradient jsonb not null default '{}'::jsonb,
  add column if not exists lighting     jsonb not null default '{}'::jsonb;
