-- Woven — modular tools, creator asset library, and tool submissions
-- Apply via the Supabase SQL editor or `supabase db push`.
--
-- NOTE on auth: the app currently talks to Supabase from the browser with the
-- anon key and scopes rows by Clerk user id in the query (same pattern as
-- creator_profiles). The policies below are permissive to match that. Harden
-- later by wiring the Clerk JWT into Supabase and switching to auth.jwt()-based
-- RLS (see clerk_user_id columns).

-- ---------------------------------------------------------------------------
-- Creator asset library
-- ---------------------------------------------------------------------------
create table if not exists public.creator_assets (
  id            uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  name          text not null,
  kind          text not null default 'model',          -- model | texture | other
  format        text not null default 'glb',
  visibility    text not null default 'private',         -- private | shared | public
  shared_with   text[] not null default '{}',            -- clerk_user_ids with access when visibility = shared
  storage_path  text not null,                           -- path inside the creator-assets bucket
  thumbnail_url text,
  file_bytes    bigint not null default 0,
  poly_count    integer,                                 -- triangle count of the stored model
  meta          jsonb not null default '{}'::jsonb,       -- arbitrary stats (maps, dims, source asset, etc.)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists creator_assets_owner_idx on public.creator_assets (clerk_user_id);
create index if not exists creator_assets_visibility_idx on public.creator_assets (visibility);

alter table public.creator_assets enable row level security;

drop policy if exists creator_assets_rw on public.creator_assets;
create policy creator_assets_rw on public.creator_assets
  for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Retopology / optimization jobs (Tier-2: adaptive retopo + hi->lo bake worker)
-- ---------------------------------------------------------------------------
create table if not exists public.retopo_jobs (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text not null,
  source_asset_id uuid references public.creator_assets (id) on delete set null,
  output_asset_id uuid references public.creator_assets (id) on delete set null,
  status          text not null default 'queued',         -- queued | processing | done | failed
  -- request params
  classification  text not null default 'auto',            -- auto | object | biped | quadruped | creature
  target_polys    integer,                                 -- desired triangle budget for the low-poly result
  mode            text not null default 'decimate',        -- decimate (keep UVs) | retopo (new UVs + bake)
  adaptive        boolean not null default true,           -- spend more polys on high-curvature regions
  bake_maps       text[] not null default '{normal,ao}',   -- maps to bake hi->lo
  -- results
  stats           jsonb not null default '{}'::jsonb,       -- {sourcePolys, resultPolys, reduction, ...}
  error           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index if not exists retopo_jobs_owner_idx on public.retopo_jobs (clerk_user_id);
create index if not exists retopo_jobs_status_idx on public.retopo_jobs (status);

alter table public.retopo_jobs enable row level security;

drop policy if exists retopo_jobs_rw on public.retopo_jobs;
create policy retopo_jobs_rw on public.retopo_jobs
  for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Member-submitted tools awaiting admin review
-- ---------------------------------------------------------------------------
create table if not exists public.tool_submissions (
  id               uuid primary key default gen_random_uuid(),
  clerk_user_id    text not null,                          -- submitter
  name             text not null,
  slug             text not null,
  summary          text,
  description      text,
  category         text not null default 'utility',        -- modeling | texturing | audio | utility | other
  kind             text not null default 'hosted',         -- hosted (iframe URL) | native (in-repo module)
  build_url        text,                                   -- for hosted tools
  entry_file       text default 'index.html',
  icon             text default '🧩',
  engine           text,
  status           text not null default 'pending',        -- pending | approved | rejected | changes_requested
  review_notes     text,
  reviewed_by      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists tool_submissions_slug_idx on public.tool_submissions (slug);
create index if not exists tool_submissions_status_idx on public.tool_submissions (status);

alter table public.tool_submissions enable row level security;

drop policy if exists tool_submissions_rw on public.tool_submissions;
create policy tool_submissions_rw on public.tool_submissions
  for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Private storage bucket for uploaded models
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('creator-assets', 'creator-assets', false)
on conflict (id) do nothing;

-- Bucket access: scoped by the first path segment = clerk_user_id.
-- (Permissive to match the current anon-key client; tighten with Clerk JWT later.)
drop policy if exists creator_assets_objects_rw on storage.objects;
create policy creator_assets_objects_rw on storage.objects
  for all using (bucket_id = 'creator-assets') with check (bucket_id = 'creator-assets');
