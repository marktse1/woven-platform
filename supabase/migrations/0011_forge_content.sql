-- Shared-content hosting for Forge authoring tools (e.g. the Three.js
-- worldbuilder at slug "weave-forge"): levels a creator saves, and a
-- catalog of shared assets those levels reference. Backs the
-- forge-content storage bucket and the /api/forge/content/* + save-level
-- routes. Reads are public (the external tool app fetches these
-- cross-origin, unauthenticated) — writes are service-role only, gated by
-- a short-lived signed token minted by ForgeClient.tsx, not by RLS.

create table if not exists public.forge_levels (
  id             uuid primary key default gen_random_uuid(),
  clerk_user_id  text not null,
  name           text not null,
  slug           text,
  storage_path   text not null,      -- path inside forge-content, e.g. "levels/{id}.json"
  is_public      boolean not null default false,
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists forge_levels_owner_idx on public.forge_levels (clerk_user_id);
create index if not exists forge_levels_public_idx on public.forge_levels (is_public);

alter table public.forge_levels enable row level security;

drop policy if exists forge_levels_select on public.forge_levels;
create policy forge_levels_select on public.forge_levels
  for select using (true);

create table if not exists public.forge_assets (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  category        text,
  storage_path    text not null,     -- path inside forge-content, e.g. "assets/{id}/model.glb"
  thumbnail_path  text,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

alter table public.forge_assets enable row level security;

drop policy if exists forge_assets_select on public.forge_assets;
create policy forge_assets_select on public.forge_assets
  for select using (true);

insert into storage.buckets (id, name, public)
values ('forge-content', 'forge-content', true)
on conflict (id) do nothing;
