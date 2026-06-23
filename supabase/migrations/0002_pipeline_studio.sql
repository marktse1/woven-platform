-- Pipeline Studio — order-agnostic multi-step asset pipeline.
-- Apply via the Supabase SQL editor or `supabase db push`.
--
-- pipeline_sessions is a fast "what's current" pointer per source asset;
-- pipeline_steps is the append-only source of truth for the step history.
-- This lets the user apply decimate/retopo/segment/adaptive_density in any
-- order, re-run a step with different params, and keep a full audit trail —
-- a single mutable row with boolean flags can't represent that.

create table if not exists public.pipeline_sessions (
  id                uuid primary key default gen_random_uuid(),
  clerk_user_id     text not null,
  source_asset_id   uuid not null references public.creator_assets (id) on delete cascade,
  classification    text not null default 'auto',     -- auto | object | biped | quadruped | creature
  current_asset_id  uuid references public.creator_assets (id) on delete set null,
  current_step_id   uuid,
  status            text not null default 'open',      -- open | finalized | archived
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists pipeline_sessions_owner_idx on public.pipeline_sessions (clerk_user_id);
create unique index if not exists pipeline_sessions_source_idx on public.pipeline_sessions (source_asset_id);

alter table public.pipeline_sessions enable row level security;

drop policy if exists pipeline_sessions_rw on public.pipeline_sessions;
create policy pipeline_sessions_rw on public.pipeline_sessions
  for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Append-only step log. Each row is one applied operation, Tier-1 (client,
-- synchronous) or Tier-2 (Forge/Blender worker, queued via retopo_jobs).
-- ---------------------------------------------------------------------------
create table if not exists public.pipeline_steps (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.pipeline_sessions (id) on delete cascade,
  clerk_user_id   text not null,
  seq             integer not null,                    -- 1-based order applied
  op              text not null,                       -- decimate | retopo | segment | adaptive_density | finalize
  tier            text not null,                        -- tier1 | tier2
  status          text not null default 'done',         -- done (tier1) | queued | processing | done | failed (tier2)
  input_asset_id  uuid not null references public.creator_assets (id),
  output_asset_id uuid references public.creator_assets (id),
  params          jsonb not null default '{}'::jsonb,    -- {targetPolys, adaptive, segmentMode, bakeMaps, dilationPx, ...}
  stats           jsonb not null default '{}'::jsonb,     -- {sourcePolys, resultPolys, segmentCount, ...}
  error           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index if not exists pipeline_steps_session_idx on public.pipeline_steps (session_id, seq);
create index if not exists pipeline_steps_owner_idx on public.pipeline_steps (clerk_user_id);
create index if not exists pipeline_steps_status_idx on public.pipeline_steps (status) where tier = 'tier2';

alter table public.pipeline_sessions
  add constraint pipeline_sessions_current_step_fk
  foreign key (current_step_id) references public.pipeline_steps (id) on delete set null;

alter table public.pipeline_steps enable row level security;

drop policy if exists pipeline_steps_rw on public.pipeline_steps;
create policy pipeline_steps_rw on public.pipeline_steps
  for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Repurpose retopo_jobs as the Tier-2 worker queue specifically, linked back
-- to the pipeline_steps row that queued it. The existing worker-facing GET
-- (claim oldest queued)/PATCH (report result) routes in
-- app/api/tools/retopology/jobs/route.ts need no changes — they already
-- operate generically on "the oldest queued row" / "update by id".
-- ---------------------------------------------------------------------------
alter table public.retopo_jobs add column if not exists pipeline_step_id uuid references public.pipeline_steps (id) on delete set null;
alter table public.retopo_jobs add column if not exists op text not null default 'retopo'; -- retopo | segment | adaptive_density | finalize

create index if not exists retopo_jobs_pipeline_step_idx on public.retopo_jobs (pipeline_step_id);
