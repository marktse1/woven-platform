-- Rich preview data (title/description/image) for the first link found in a
-- studio_post's body text, computed once at publish time by
-- lib/linkPreview.ts rather than re-fetched on every page view. Shape:
-- { url, title, description, image } | null.

alter table public.studio_posts add column if not exists link_preview jsonb;
