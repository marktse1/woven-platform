-- Dynamic public-read policy for the game-builds bucket's dist/ objects,
-- scoped to exactly the rows that are actually ready+live — the mechanism
-- referenced but not fully specified in the original plan ("ready+is_current
-- builds get a public-read policy scoped to that row's prefix").
--
-- Why this needs to be a real Postgres RLS policy rather than per-object
-- signed URLs: the game-player iframe (mirroring ForgeClient.tsx's existing
-- `new URL(entryFile, buildUrl)` pattern) needs a plain fetchable base URL
-- it can join arbitrary relative asset paths onto — a signed URL is scoped
-- to one specific object, not a prefix, so it can't serve as that base.
-- Instead, storage.objects gets a SELECT policy that dynamically checks
-- game_builds/platform_tool_builds for a matching ready+current row.
--
-- Path shape assumed: "{gameId}/{version}/dist/..." (game-builds) or
-- "{toolId}/{version}/dist/..." (also game-builds, tool builds share the
-- same bucket+prefix convention — see app/api/uploads/tools routes).
-- storage.foldername(name) splits the object path into an array of folder
-- segments; foldername(name)[1]/[2] are the id/version.

drop policy if exists game_builds_public_read on storage.objects;
create policy game_builds_public_read on storage.objects
  for select
  using (
    bucket_id = 'game-builds'
    and (storage.foldername(name))[3] = 'dist'
    and (
      exists (
        select 1 from public.game_builds gb
        where gb.storage_prefix = (storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]
          and gb.status = 'ready'
          and gb.is_current = true
      )
      or exists (
        select 1 from public.platform_tool_builds ptb
        where ptb.storage_prefix = (storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]
          and ptb.status = 'ready'
          and ptb.is_current = true
      )
    )
  );

-- No insert/update/delete policy on storage.objects for this bucket — every
-- write goes through the service-role client in an API route (signed
-- upload URLs for the raw zip, direct admin-client uploads for the
-- extracted dist/source files), never a direct anon-key client call.
