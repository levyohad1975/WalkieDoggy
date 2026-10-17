-- Synthetic, isolated fixture for the profile reservation migration rehearsal.
-- This file must only run against the disposable PostgreSQL service used by
-- profile-reservation-concurrency-validation.yml.

create role anon;
create role authenticated;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  is_anonymous boolean not null default true
);

create table public.families (
  id uuid primary key,
  name text not null,
  is_qa boolean not null default false
);

create table public.users (
  id uuid primary key,
  family_id uuid not null references public.families(id),
  auth_user_id uuid references auth.users(id),
  name text not null,
  removed_at timestamptz
);
create unique index users_auth_user_id_rehearsal_idx
  on public.users(auth_user_id) where auth_user_id is not null;

create table public.family_auth_members (
  auth_user_id uuid primary key references auth.users(id),
  family_id uuid not null references public.families(id),
  role text not null check (role in ('admin', 'member'))
);

create table public.profile_auth_sessions (
  auth_user_id uuid primary key references auth.users(id),
  family_id uuid not null references public.families(id),
  user_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, family_id)
);
alter table public.profile_auth_sessions enable row level security;

create table public.family_membership_snapshots (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  claimed_user_id uuid references public.users(id) on delete set null,
  saved_at timestamptz not null default now()
);
alter table public.family_membership_snapshots enable row level security;
revoke all on public.family_membership_snapshots from public, anon, authenticated;

create function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create function public.is_system_admin()
returns boolean
language sql stable
as $$
  select coalesce(nullif(current_setting('app.is_system_admin', true), '')::boolean, false)
$$;

-- Minimal SECURITY DEFINER stand-ins for the write effect used by the real
-- PIN and invitation RPCs. The actual claim protection under test is the
-- database trigger on profile_auth_sessions, which these RPC paths both use.
create function public.rehearsal_pin_claim(p_profile_id uuid)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id from public.users where id = p_profile_id;
  insert into public.profile_auth_sessions(auth_user_id, family_id, user_id)
  values (auth.uid(), v_family_id, p_profile_id);
end;
$$;

create function public.rehearsal_invitation_claim(p_profile_id uuid)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id from public.users where id = p_profile_id;
  insert into public.profile_auth_sessions(auth_user_id, family_id, user_id)
  values (auth.uid(), v_family_id, p_profile_id);
end;
$$;
grant execute on function public.rehearsal_pin_claim(uuid) to authenticated;
grant execute on function public.rehearsal_invitation_claim(uuid) to authenticated;

insert into public.families(id, name, is_qa) values
  ('00000000-0000-4000-8000-000000000001', 'synthetic-original', false),
  ('00000000-0000-4000-8000-000000000002', 'synthetic-qa', true),
  ('00000000-0000-4000-8000-000000000003', 'synthetic-unrelated', false);

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004');

insert into public.family_auth_members(auth_user_id, family_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'admin'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'member'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'member'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'member');

insert into public.users(id, family_id, auth_user_id, name) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'synthetic-admin-profile'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', null, 'synthetic-unrelated-profile');

insert into public.profile_auth_sessions(auth_user_id, family_id, user_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
