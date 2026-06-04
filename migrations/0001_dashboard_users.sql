-- ─────────────────────────────────────────────────────────────────────────────
-- dashboard_users — per-user identity + role + org scope for the PulseOS dashboard
-- multi-user auth layer (src/server/auth-users.ts).
--
-- REVIEW ARTIFACT — do NOT auto-apply. Apply to prod only after review
-- (it touches auth + RLS). Requires Supabase Auth enabled (auth.users exists).
--
-- ADMIN-ONLY by design: there are NO insert/update/delete policies for the
-- authenticated role, so the ONLY way to create/modify users is the service-role
-- admin path in auth-users.ts (createUser/setUserDisabled), which the Users API
-- routes gate behind role = 'admin'. Authenticated users may read ONLY their own
-- row. Fail-closed.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.dashboard_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null default 'admin'
                check (role = 'admin'),
  org_id      uuid,
  disabled    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.dashboard_users is
  'PulseOS dashboard accounts: maps auth.users -> role + org scope. Writes are service-role only (admin path in src/server/auth-users.ts).';

-- updated_at touch trigger
create or replace function public.dashboard_users_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_dashboard_users_touch on public.dashboard_users;
create trigger trg_dashboard_users_touch
  before update on public.dashboard_users
  for each row execute function public.dashboard_users_touch_updated_at();

-- RLS: forced. Service-role bypasses RLS (admin ops). Authenticated users read
-- only their own row; NO authenticated write policies => writes are admin-only.
alter table public.dashboard_users enable row level security;
alter table public.dashboard_users force row level security;

drop policy if exists dashboard_users_self_read on public.dashboard_users;
create policy dashboard_users_self_read on public.dashboard_users
  for select to authenticated
  using (id = auth.uid());

create index if not exists idx_dashboard_users_org
  on public.dashboard_users (org_id);

-- ── Bootstrapping the first admin (run manually, replacing the placeholder) ──
-- 1) Create the auth user (Supabase dashboard, or via auth-users.createUser once
--    one admin exists). 2) Promote to admin:
--   update public.dashboard_users set role = 'admin'
--   where email = 'REPLACE_WITH_ADMIN_EMAIL';
