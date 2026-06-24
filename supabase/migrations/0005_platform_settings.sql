-- Small key/value table for admin-controlled platform toggles, starting
-- with "auto-approve creator applications" (app/admin/page.tsx).

create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

drop policy if exists platform_settings_rw on public.platform_settings;
create policy platform_settings_rw on public.platform_settings
  for all using (true) with check (true);

insert into public.platform_settings (key, value)
values ('auto_approve_creators', 'false'::jsonb)
on conflict (key) do nothing;
