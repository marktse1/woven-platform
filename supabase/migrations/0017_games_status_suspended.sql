-- games.status has a CHECK constraint that only allowed
-- draft|in_review|live|rejected — missing "suspended", the value the
-- moderation takedown routes (app/api/admin/games/[gameId]/suspend) write.
-- Without this, suspending a live game fails with a check-constraint
-- violation, the same class of bug as the missing slug on insert.

alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status = any (array['draft', 'in_review', 'live', 'rejected', 'suspended']));
