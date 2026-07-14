-- Documents the shape of tables that already exist in the live database but
-- were never captured in a tracked migration (created by hand via the
-- Supabase SQL editor/dashboard at some point before this migrations
-- directory existed). This file is a best-effort no-op against the live
-- database: every statement is `create table if not exists`, so it changes
-- nothing there. Its purpose is to let 0008+ safely `references` these
-- tables when migrations are replayed from scratch (e.g. `supabase db
-- reset` against a fresh local database).
--
-- Deliberately NOT included here: RLS enable/policy statements, unique
-- constraints, or anything else that could behave differently against a
-- table that already has real data and a real (unknown) policy set live.
-- If you need to know the live schema exactly, check the Supabase
-- dashboard's table editor — this file only lists the columns this codebase
-- is known to read/write, inferred from grepping `.select()`/`.insert()`/
-- `.update()` calls across app/ and lib/.

create table if not exists public.creator_profiles (
  id                       uuid primary key default gen_random_uuid(),
  clerk_user_id            text not null,
  studio_name              text,
  handle                   text,
  status                   text not null default 'pending', -- pending | approved | rejected
  country                  text,
  team_size                text,
  about                    text,
  links                    jsonb,
  engines                  text[],
  stripe_account_id        text,
  stripe_charges_enabled   boolean not null default false,
  created_at               timestamptz not null default now()
);

create table if not exists public.games (
  id                 uuid primary key default gen_random_uuid(),
  creator_id         uuid references public.creator_profiles (id) on delete set null,
  slug               text,
  title              text not null,
  short_description  text,
  engine             text,
  status             text not null default 'draft', -- draft | in_review | live | rejected
  price_cents        integer not null default 0,
  pass_included      boolean not null default false,
  tags               text[] not null default '{}',
  plays              integer not null default 0,
  rating             numeric,
  created_at         timestamptz not null default now()
);

create table if not exists public.user_library (
  id                     uuid primary key default gen_random_uuid(),
  clerk_user_id          text not null,
  game_id                uuid references public.games (id) on delete cascade,
  source                 text not null default 'purchase', -- purchase | pass | grant
  payment_intent_id      text,
  creator_amount_cents   integer,
  creator_paid_out       boolean not null default false,
  created_at             timestamptz not null default now()
);

create table if not exists public.platform_tools (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,
  name         text not null,
  engine       text,
  status       text not null default 'active', -- active | disabled
  description  text,
  created_at   timestamptz not null default now()
);

create table if not exists public.platform_tool_builds (
  id           uuid primary key default gen_random_uuid(),
  tool_id      uuid references public.platform_tools (id) on delete cascade,
  version      text,
  build_url    text,
  entry_file   text default 'index.html',
  changelog    text,
  is_current   boolean not null default false,
  pushed_at    timestamptz default now()
);
