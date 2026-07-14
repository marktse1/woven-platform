-- Brings platform_tool_builds up to the same tracking shape game_builds
-- (0008) has, so the shared Sandbox extraction pipeline can write to either
-- table with the same result shape. Additive only — every existing row
-- keeps working with ForgeClient.tsx exactly as before (id, version,
-- build_url, entry_file, changelog, is_current, pushed_at untouched).

alter table public.platform_tool_builds add column if not exists status text not null default 'ready';
alter table public.platform_tool_builds add column if not exists source_kind text not null default 'static';
alter table public.platform_tool_builds add column if not exists build_command text;
alter table public.platform_tool_builds add column if not exists storage_prefix text;
alter table public.platform_tool_builds add column if not exists file_count integer;
alter table public.platform_tool_builds add column if not exists total_bytes bigint;
alter table public.platform_tool_builds add column if not exists error text;
alter table public.platform_tool_builds add column if not exists uploaded_by text;

create index if not exists platform_tool_builds_tool_idx on public.platform_tool_builds (tool_id, is_current);
