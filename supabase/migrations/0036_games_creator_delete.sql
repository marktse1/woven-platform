-- Lets a creator delete their own game, but only while it's still draft or
-- rejected — never live/in_review/suspended, so this can't be used to yank
-- a published game out from under players or dodge an active review. All
-- child tables (game_submissions, game_builds, game_screenshots,
-- game_reviews, game_moderation_actions) already `on delete cascade` back
-- to games.id, so this alone is sufficient at the DB level.

create policy creator_delete_own_games on public.games
  for delete to authenticated
  using (
    creator_id in (select id from public.creator_profiles where clerk_user_id = (select auth.jwt()->>'sub'))
    and status in ('draft', 'rejected')
  );
