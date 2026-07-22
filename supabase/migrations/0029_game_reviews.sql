-- Steam-style game reviews, gated on actually owning AND having played the
-- game — not just owning it. Enforcement lives here, in RLS, not just in
-- the UI: every hard lesson from this session's security work said a
-- client-side-only gate isn't a real gate.
--
-- user_library's live schema has drifted from every migration/app-code
-- expectation before this one too (its created_at is actually named
-- purchased_at in the real database — discovered while writing this,
-- not touched here since nothing depends on the name "created_at"
-- existing on this table). Adding first_played_at additively regardless.

alter table public.user_library add column if not exists first_played_at timestamptz;

drop policy if exists user_library_update_own on public.user_library;
create policy user_library_update_own on public.user_library
  for update to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'))
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

create table public.game_reviews (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  clerk_user_id text not null,
  rating smallint not null check (rating between 1 and 5),
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, clerk_user_id)
);

alter table public.game_reviews enable row level security;

create policy game_reviews_select on public.game_reviews
  for select using (true);

-- with check verifies ownership AND first_played_at is not null via a
-- subquery against user_library — this is the actual enforcement of
-- "owned and played," not just a UI-level convenience check.
create policy game_reviews_insert_own on public.game_reviews
  for insert to authenticated
  with check (
    clerk_user_id = (select auth.jwt()->>'sub')
    and exists (
      select 1 from public.user_library ul
      where ul.game_id = game_reviews.game_id
        and ul.clerk_user_id = game_reviews.clerk_user_id
        and ul.first_played_at is not null
    )
  );

create policy game_reviews_update_own on public.game_reviews
  for update to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'))
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

-- Keeps games.rating's long-documented intent (0014: "a star-rating
-- average from reviews") finally true, no app-level aggregation needed.
create function public.recompute_game_rating() returns trigger as $$
begin
  update public.games set rating = (
    select avg(rating)::numeric(3,2) from public.game_reviews
    where game_id = coalesce(new.game_id, old.game_id)
  ) where id = coalesce(new.game_id, old.game_id);
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists game_reviews_recompute on public.game_reviews;
create trigger game_reviews_recompute
  after insert or update or delete on public.game_reviews
  for each row execute function public.recompute_game_rating();
