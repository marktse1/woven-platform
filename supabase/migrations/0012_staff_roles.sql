-- Real, server-enforced staff/admin roster. Replaces the client-side
-- BOOTSTRAP_ADMIN_EMAIL string check (app/admin/page.tsx, app/admin/tools/page.tsx)
-- and the localStorage-backed team roster in app/admin/page.tsx, neither of
-- which is actually enforced server-side today (see 0001's header note and
-- the Woven creator-upload-system plan for why that's a real gap now that
-- staff approval gates publishing arbitrary executable code).
--
-- Deliberately does NOT get an RLS policy at all — unlike every other table
-- in this migration set, there is no `for select using (true)`. With RLS
-- enabled and zero policies, the anon/authenticated Supabase roles get zero
-- access (not even reads); only the service-role key (used exclusively by
-- lib/staff.ts's isStaff() helper, server-side) can read or write this
-- table. Staff membership must never be discoverable or editable from the
-- browser.
--
-- clerk_user_id is nullable + not unique on its own because the actual
-- Clerk user id for the existing bootstrap admin isn't known at migration
-- authoring time — the seed row below is keyed by email instead. lib/staff.ts
-- matches on clerk_user_id first, falling back to email, and a hardcoded
-- BOOTSTRAP_ADMIN_EMAIL check remains as a permanent safety net so this
-- migration can never lock the current admin out, regardless of whether
-- the email/clerk_user_id match lines up perfectly on day one.

create table if not exists public.staff_roles (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text,
  email           text not null,
  role            text not null default 'reviewer', -- auditor | reviewer | senior_reviewer | admin
  created_at      timestamptz not null default now(),
  created_by      text
);

create unique index if not exists staff_roles_email_idx on public.staff_roles (lower(email));
create index if not exists staff_roles_clerk_user_idx on public.staff_roles (clerk_user_id);

alter table public.staff_roles enable row level security;
-- No policy created on purpose — see header comment.

insert into public.staff_roles (email, role, created_by)
values ('starfox.and.mark@gmail.com', 'admin', 'migration:0012_staff_roles')
on conflict (lower(email)) do nothing;
