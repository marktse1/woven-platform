-- Real discount/sale support for games, backing the store's "Specials"
-- filter with actual data instead of aliasing it to another sort with no
-- sale concept behind it.

alter table public.games add column if not exists original_price_cents integer;

-- A row only counts as "on sale" when this is set AND genuinely higher
-- than the current price — re-validated on every update (not just
-- insert), so a later price edit can't leave a stale, meaningless
-- original_price_cents behind.
alter table public.games drop constraint if exists games_original_price_check;
alter table public.games add constraint games_original_price_check
  check (original_price_cents is null or original_price_cents > price_cents);
