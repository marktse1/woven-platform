-- Versioned build history for creator-uploaded games, mirroring the shape
-- platform_tool_builds already has for Forge tools. A game can have many
-- builds over time; at most one per game has is_current = true, and that's
-- the one served into the game-player iframe.
--
-- Unlike 0001's tables, writes to this table are never expected to happen
-- from the browser (anon key) — every mutation goes through a Next.js API
-- route using the Supabase service-role client after a real Clerk auth()
-- check. The RLS policy below reflects that: reads are open (needed for
-- public game listings / build history), writes are not granted to the
-- anon/authenticated roles at all, so only the service role (which bypasses
-- RLS entirely) can insert/update/delete.

create table if not exists public.game_builds (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references public.games (id) on delete cascade,
  version         text,
  build_url       text,                                     -- public/signed base URL of the servable dist/ tree once ready
  entry_file      text not null default 'index.html',
  engine          text,                                      -- detected or creator-declared (three.js | playcanvas | babylon | phaser | godot-web | unity-webgl | custom-html5)
  changelog       text,
  is_current      boolean not null default false,
  status          text not null default 'processing',        -- processing | ready | failed
  source_kind     text not null default 'static',             -- static (no build step) | buildable (has a source/ tree + build command)
  build_command   text,                                       -- recorded at upload time for 'buildable' source_kind, reused by the rebuild pipeline
  storage_prefix  text not null,                               -- e.g. "{gameId}/{version}" inside the game-builds bucket
  file_count      integer,
  total_bytes     bigint,
  error           text,
  pushed_at       timestamptz,
  uploaded_by     text not null,                               -- clerk_user_id
  created_at      timestamptz not null default now()
);

create index if not exists game_builds_game_idx on public.game_builds (game_id, is_current);

alter table public.game_builds enable row level security;

drop policy if exists game_builds_select on public.game_builds;
create policy game_builds_select on public.game_builds
  for select using (true);
