-- 0032_verified_family_onboarding.sql
--
-- Issue #3 / Batch 2: server-authoritative verified family creation.
-- REPOSITORY ONLY: applying this migration is a separate production action.
-- It must be rolled out together with the create-verified-family Edge
-- Function and the compatible client because direct create_family execution
-- is deliberately revoked below.

alter table families
  add column if not exists approval_status text not null default 'active',
  add column if not exists created_by_auth_user_id uuid references auth.users(id) on delete set null;

do $$
begin
  alter table families
    add constraint families_approval_status_check
    check (approval_status in ('pending', 'active', 'rejected'));
exception
  when duplicate_object then null;
end
$$;

create index if not exists families_approval_status_idx
  on families (approval_status, created_at desc);

create table if not exists family_onboarding_requests (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null unique references families(id) on delete cascade,
  verified_email text not null,
  requested_at timestamptz not null default now()
);

alter table family_onboarding_requests enable row level security;
-- No direct client policies. The Edge Function's service-role-only RPC and
-- the status RPC below are the only supported surfaces.

create or replace function current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.family_id
  from family_auth_members m
  join families f on f.id = m.family_id
  where m.auth_user_id = auth.uid()
    and f.approval_status = 'active'
  limit 1;
$$;

create or replace function current_family_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from family_auth_members m
  join families f on f.id = m.family_id
  where m.auth_user_id = auth.uid()
    and f.approval_status = 'active'
  limit 1;
$$;

create or replace function is_family_admin(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from family_auth_members m
    join families f on f.id = m.family_id
    where m.auth_user_id = auth.uid()
      and m.family_id = target_family_id
      and m.role = 'admin'
      and f.approval_status = 'active'
  );
$$;

create or replace function create_verified_family(
  p_auth_user_id uuid,
  p_family_name text,
  p_dog_name text default null,
  p_auto_approve boolean default true
)
returns table (
  id uuid,
  name text,
  invite_code text,
  approval_status text,
  created boolean
)
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_auth_user auth.users%rowtype;
  v_existing_family families%rowtype;
  v_family_id uuid;
  v_code text;
  v_status text;
  v_attempts integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  select * into v_auth_user from auth.users where auth.users.id = p_auth_user_id;
  if v_auth_user.id is null
     or coalesce(v_auth_user.is_anonymous, true)
     or v_auth_user.email is null
     or v_auth_user.email_confirmed_at is null then
    raise exception 'verified email identity required';
  end if;

  select f.* into v_existing_family
  from family_onboarding_requests r
  join families f on f.id = r.family_id
  where r.auth_user_id = p_auth_user_id;

  if v_existing_family.id is not null then
    return query
    select v_existing_family.id, v_existing_family.name,
           v_existing_family.invite_code, v_existing_family.approval_status,
           false;
    return;
  end if;

  if p_family_name is null or length(trim(p_family_name)) = 0 then
    raise exception 'family_name is required';
  end if;

  v_status := case when p_auto_approve then 'active' else 'pending' end;

  loop
    v_code := generate_invite_code();
    v_attempts := v_attempts + 1;
    begin
      insert into families (
        name, invite_code, approval_status, created_by_auth_user_id
      ) values (
        trim(p_family_name), v_code, v_status, p_auth_user_id
      ) returning families.id into v_family_id;
      exit;
    exception when unique_violation then
      if v_attempts > 20 then
        raise exception 'could not generate a unique invite_code';
      end if;
    end;
  end loop;

  insert into family_auth_members (auth_user_id, family_id, role)
  values (p_auth_user_id, v_family_id, 'admin');

  if p_dog_name is not null and length(trim(p_dog_name)) > 0 then
    insert into dogs (family_id, name)
    values (v_family_id, trim(p_dog_name));
  end if;

  insert into family_onboarding_requests (
    auth_user_id, family_id, verified_email
  ) values (
    p_auth_user_id, v_family_id, lower(v_auth_user.email)
  );

  insert into system_audit_log (
    actor_auth_user_id, action, target_type, target_id, metadata
  ) values (
    p_auth_user_id,
    'family.created',
    'family',
    v_family_id,
    jsonb_build_object(
      'approval_status', v_status,
      'verified_identity', true
    )
  );

  return query
  select f.id, f.name, f.invite_code, f.approval_status, true
  from families f
  where f.id = v_family_id;
end;
$$;

revoke all on function create_verified_family(uuid, text, text, boolean) from public;
revoke all on function create_verified_family(uuid, text, text, boolean) from anon;
revoke all on function create_verified_family(uuid, text, text, boolean) from authenticated;
grant execute on function create_verified_family(uuid, text, text, boolean) to service_role;

-- The legacy RPC accepted anonymous sessions and could bypass manual approval.
-- The compatible client now uses the Edge Function instead.
revoke execute on function create_family(text, text) from anon;
revoke execute on function create_family(text, text) from authenticated;

create or replace function get_my_family_onboarding_status()
returns table (
  family_id uuid,
  family_name text,
  approval_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, f.approval_status
  from family_onboarding_requests r
  join families f on f.id = r.family_id
  where r.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function get_my_family_onboarding_status() from public;
grant execute on function get_my_family_onboarding_status() to authenticated;

create or replace function system_admin_set_family_approval(
  p_family_id uuid,
  p_approval_status text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;
  if p_approval_status not in ('active', 'rejected') then
    raise exception 'invalid approval status';
  end if;

  update families
  set approval_status = p_approval_status
  where id = p_family_id;

  if not found then
    raise exception 'family not found';
  end if;

  insert into system_audit_log (
    actor_auth_user_id, action, target_type, target_id, metadata
  ) values (
    auth.uid(),
    'family.approval_changed',
    'family',
    p_family_id,
    jsonb_build_object('approval_status', p_approval_status)
  );
end;
$$;

revoke all on function system_admin_set_family_approval(uuid, text) from public;
grant execute on function system_admin_set_family_approval(uuid, text) to authenticated;

create or replace function find_family_by_invite_code(code text)
returns table (id uuid, name text, dog_name text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, d.name
  from families f
  left join dogs d on d.family_id = f.id
  where upper(f.invite_code) = upper(code)
    and f.approval_status = 'active'
  limit 1;
$$;

create or replace function join_family(code text)
returns table (id uuid, name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to join a family';
  end if;

  select f.id into v_family_id
  from families f
  where upper(f.invite_code) = upper(code)
    and f.approval_status = 'active'
  limit 1;

  if v_family_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into family_auth_members (auth_user_id, family_id, role)
  values (auth.uid(), v_family_id, 'member')
  on conflict (auth_user_id) do update set
    family_id = excluded.family_id,
    role = case
      when family_auth_members.family_id = excluded.family_id
       and family_auth_members.role = 'admin'
      then 'admin' else 'member' end;

  return query select f.id, f.name from families f where f.id = v_family_id;
end;
$$;
