-- Content/age rating field (schema only for now — selection UI and
-- enforcement land later) and a moderation audit trail so staff can take
-- down an already-LIVE game (reported content, ToS violation, no
-- ad-based-freemium/predatory-monetization policy, etc.), not just gate new
-- submissions at initial review (see game_submissions, 0010, for that).
--
-- content_rating is distinct from the existing games.rating column, which
-- is a star-rating average from reviews — different concept, same table,
-- deliberately different name to avoid collision.
--
-- games.status has no CHECK constraint in this codebase (it's a plain text
-- column read/written as a string everywhere), so no migration is needed to
-- add "suspended" as a valid value — it's just one more string the app
-- writes. Documented here for anyone reading the migration history: valid
-- values are draft | in_review | live | rejected | suspended.

alter table public.games add column if not exists content_rating text; -- e.g. E | T | M | AO — nullable, unset until the rating UI ships

create table if not exists public.game_moderation_actions (
  id                    uuid primary key default gen_random_uuid(),
  game_id               uuid not null references public.games (id) on delete cascade,
  action                text not null, -- approved | rejected | suspended | reinstated
  reason                text not null,
  actor_clerk_user_id   text not null,
  created_at            timestamptz not null default now()
);

create index if not exists game_moderation_actions_game_idx on public.game_moderation_actions (game_id, created_at desc);

alter table public.game_moderation_actions enable row level security;
-- No policy created on purpose, same rationale as staff_roles (0012): this
-- is a moderation audit log, not something the browser should ever read or
-- write directly. Only lib/staff.ts-gated API routes touch it, via the
-- service-role client.
