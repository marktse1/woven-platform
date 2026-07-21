-- Studio profile pages (app/studio/[handle]) resolve creators by handle —
-- needs uniqueness to be a safe lookup key. Only one creator_profiles row
-- exists in the live DB today, so this is safe to add with zero collisions.
create unique index if not exists creator_profiles_handle_unique
  on public.creator_profiles (handle) where handle is not null;
