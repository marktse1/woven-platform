-- Raise the creator-assets bucket's per-file upload limit from Supabase's
-- unconfigured default (50MB) to 100MB, so hi-res/4K-textured GLBs don't get
-- rejected on upload. Note: if this project is on the Supabase Free plan,
-- there's also a project-wide global limit hard-capped at 50MB that
-- overrides this regardless - only paid plans can actually reach 100MB.

update storage.buckets
set file_size_limit = 104857600 -- 100 MB, in bytes
where id = 'creator-assets';
