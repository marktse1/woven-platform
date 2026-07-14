-- Draft/review record for a creator game upload, parallel to tool_submissions
-- (0001) but scoped to games instead of hosted tools. A row here tracks one
-- upload attempt from "zip landed in storage" through staff decision.
--
-- Same RLS shape as game_builds (0008): reads open, writes service-role only.

create table if not exists public.game_submissions (
  id                 uuid primary key default gen_random_uuid(),
  clerk_user_id      text not null,
  game_id            uuid references public.games (id) on delete cascade,
  build_id           uuid references public.game_builds (id) on delete set null,
  title              text,
  engine             text,
  status             text not null default 'draft',  -- draft | validating | pending_review | approved | rejected | changes_requested
  validation_result  jsonb not null default '{}'::jsonb, -- raw Sandbox pipeline result: { ok, engine, entryFile, fileCount, totalBytes, warnings[], error? }
  review_notes       text,
  reviewed_by        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists game_submissions_owner_idx on public.game_submissions (clerk_user_id);
create index if not exists game_submissions_status_idx on public.game_submissions (status);

alter table public.game_submissions enable row level security;

drop policy if exists game_submissions_select on public.game_submissions;
create policy game_submissions_select on public.game_submissions
  for select using (true);
