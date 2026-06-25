-- Raise the creator-assets bucket's per-file upload limit from 100MB (0003)
-- to 500MB now that the project is on the Pro plan. Still requires the
-- project-wide global limit to be raised separately in the dashboard
-- (Project Settings -> Storage) - that setting isn't reachable via SQL.

update storage.buckets
set file_size_limit = 524288000 -- 500 MB, in bytes
where id = 'creator-assets';
