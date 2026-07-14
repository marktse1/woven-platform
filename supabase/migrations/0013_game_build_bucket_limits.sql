-- Creates the game-builds bucket used by the creator upload/publish
-- pipeline. Private (not public like forge-content, 0011) — every read
-- goes through a signed URL or a public-read policy scoped to a specific
-- ready+is_current build's storage prefix (added by the upload API routes,
-- not here, since it needs to reference specific rows).
--
-- File size limit follows 0006's precedent (500MB, already verified to
-- work on this project's Pro plan) rather than the 1GB figure floated in
-- planning — raise this (and the project-wide global limit in the
-- Supabase dashboard, which isn't reachable via SQL, per 0006's note) if a
-- real Unity/Godot upload actually needs more.

insert into storage.buckets (id, name, public, file_size_limit)
values ('game-builds', 'game-builds', false, 524288000) -- 500 MB per file
on conflict (id) do update set file_size_limit = 524288000;

-- No bucket-wide storage.objects policy: every access to this bucket goes
-- through the service-role client in a Next.js API route (signed upload
-- URLs, signed/public-scoped-per-build read URLs), never a direct anon-key
-- client call. See app/api/uploads/games/sign/route.ts.
