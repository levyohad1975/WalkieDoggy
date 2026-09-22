-- 0044_system_admin_hidden_observer.sql
-- Read-only, cross-family observer mode for System Admin.
-- The observer is invisible to family membership/presence and cannot mutate family data.

create table if not exists system_admin_observer_sessions (
  id uuid primary key default gen_random_uuid(),
  system_admin_auth_user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  target_user_id uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text
);

create unique index if not exists one_active_system_admin_observer_per_auth
  on system_admin_observer_sessions(system_admin_auth_user_id)
  where ended_at is null;
create index if not exists system_admin_observer_family_idx
  on system_admin_observer_sessions(family_id, started_at desc);

alter table system_admin_observer_sessions enable row level security;
-- No direct client policies. Session lifecycle is RPC-only.

create or replace function active_system_admin_observer_family()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.family_id
  from system_admin_observer_sessions s
  join system_admins a on a.auth_user_id = s.system_admin_auth_user_id
  join families f on f.id = s.family_id and f.approval_status = 'active'
  where s.system_admin_auth_user_id = auth.uid()
    and s.ended_at is null
  order by s.started_at desc
  limit 1;
$$;
revoke all on function active_system_admin_observer_family() from public;
grant execute on function active_system_admin_observer_family() to authenticated;

create or replace function active_system_admin_observer_profile()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.target_user_id
  from system_admin_observer_sessions s
  join system_admins a on a.auth_user_id = s.system_admin_auth_user_id
  join families f on f.id = s.family_id and f.approval_status = 'active'
  left join users u on u.id = s.target_user_id and u.family_id = s.family_id and u.removed_at is null
  where s.system_admin_auth_user_id = auth.uid()
    and s.ended_at is null
    and (s.target_user_id is null or u.id is not null)
  order by s.started_at desc
  limit 1;
$$;
revoke all on function active_system_admin_observer_profile() from public;
grant execute on function active_system_admin_observer_profile() to authenticated;

-- While observing, all ordinary family SELECT policies resolve against the
-- observed family. Outside observer mode, behavior is unchanged.
create or replace function current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    active_system_admin_observer_family(),
    (
      select m.family_id
      from family_auth_members m
      join families f on f.id = m.family_id
      where m.auth_user_id = auth.uid()
        and f.approval_status = 'active'
      limit 1
    )
  );
$$;

create or replace function current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    active_system_admin_observer_profile(),
    active_impersonation_target(),
    real_current_profile_id()
  );
$$;

-- SECURITY: 0033 originally dropped current_family_role()/is_family_admin()
-- to bare device-level family_auth_members lookups (stale admin device
-- keeps authority after persona demotion; an impersonating admin resolves
-- as real admin server-side). 0038 restored persona-anchored,
-- impersonation-safe versions. An earlier draft of THIS migration
-- re-introduced 0033's broken bodies wrapped in an observer-mode coalesce,
-- silently undoing 0038's fix for every non-observing caller. Fixed here:
-- restore 0038's exact logic for the non-observer path, add only the
-- observer-mode branch on top.
create or replace function current_family_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  persona_id uuid;
  persona_role text;
  persona_family uuid;
  fam_id uuid;
begin
  if active_system_admin_observer_family() is not null then
    return 'admin';
  end if;

  -- From here down: verbatim 0038 logic (persona-anchored, fail-closed,
  -- bootstrap-only device fallback).
  persona_id := real_current_profile_id();
  if persona_id is not null then
    select role, family_id into persona_role, persona_family
    from users where id = persona_id;

    if not exists (
      select 1 from families
      where id = persona_family and approval_status = 'active'
    ) then
      return null; -- fail closed: this persona's family is not (or no longer) active
    end if;

    return persona_role;
  end if;

  fam_id := current_family_id(); -- already gated on approval_status = 'active'
  if fam_id is null then
    return null; -- no active family membership at all
  end if;

  if exists (select 1 from users where family_id = fam_id and removed_at is null) then
    return null; -- fail closed: an active persona exists somewhere in this family, and this device holds none of them
  end if;

  return (select role from family_auth_members where auth_user_id = auth.uid() and family_id = fam_id limit 1);
end;
$$;

create or replace function is_family_admin(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    active_system_admin_observer_family() = target_family_id
    -- Non-observer path: verbatim 0038 logic (impersonation-safe,
    -- persona-anchored is_real_family_admin()), not the raw
    -- family_auth_members lookup an earlier draft of this migration used.
    or (
      case
        when active_impersonation_target() is not null then false
        else is_real_family_admin(target_family_id)
      end
    );
$$;

create or replace function begin_system_admin_observer(p_family_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_target_user_id uuid;
  v_family_name text;
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;

  select f.name into v_family_name
  from families f
  where f.id = p_family_id and f.approval_status = 'active';
  if v_family_name is null then
    raise exception 'active family not found';
  end if;

  update system_admin_observer_sessions
  set ended_at = now(), ended_reason = 'replaced'
  where system_admin_auth_user_id = auth.uid() and ended_at is null;

  -- Prefer the profile currently associated with a Family Admin auth identity.
  select u.id into v_target_user_id
  from family_auth_members m
  join profile_auth_sessions ps
    on ps.auth_user_id = m.auth_user_id and ps.family_id = m.family_id
  join users u
    on u.id = ps.user_id and u.family_id = m.family_id and u.removed_at is null
  where m.family_id = p_family_id and m.role = 'admin'
  order by u.created_at
  limit 1;

  -- A newly created family can temporarily have no admin-linked profile yet.
  if v_target_user_id is null then
    select u.id into v_target_user_id
    from users u
    where u.family_id = p_family_id and u.removed_at is null
    order by u.created_at
    limit 1;
  end if;

  insert into system_admin_observer_sessions(
    system_admin_auth_user_id, family_id, target_user_id
  ) values (auth.uid(), p_family_id, v_target_user_id);

  insert into system_audit_log(actor_auth_user_id, action, target_type, target_id, metadata)
  values (
    auth.uid(), 'system_observer.started', 'family', p_family_id,
    jsonb_build_object('target_user_id', v_target_user_id, 'read_only', true, 'hidden_from_family', true)
  );

  return jsonb_build_object(
    'family_id', p_family_id,
    'family_name', v_family_name,
    'target_user_id', v_target_user_id
  );
end;
$$;
revoke all on function begin_system_admin_observer(uuid) from public;
grant execute on function begin_system_admin_observer(uuid) to authenticated;

create or replace function end_system_admin_observer()
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_family_id uuid;
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;

  select family_id into v_family_id
  from system_admin_observer_sessions
  where system_admin_auth_user_id = auth.uid() and ended_at is null
  order by started_at desc
  limit 1;

  update system_admin_observer_sessions
  set ended_at = now(), ended_reason = 'manual'
  where system_admin_auth_user_id = auth.uid() and ended_at is null;

  if v_family_id is not null then
    insert into system_audit_log(actor_auth_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'system_observer.ended', 'family', v_family_id, jsonb_build_object('read_only', true));
  end if;
end;
$$;
revoke all on function end_system_admin_observer() from public;
grant execute on function end_system_admin_observer() to authenticated;

-- Server-side safety boundary: even if an Admin-looking control is tapped,
-- observer mode can never change family data.
create or replace function block_system_admin_observer_mutation()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if active_system_admin_observer_family() is not null then
    raise exception 'system admin observer mode is read-only';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function block_system_admin_observer_mutation() from public;

do $$
declare t text;
begin
  foreach t in array array[
    'dogs','families','family_auth_members','family_onboarding_requests',
    'impersonation_sessions','member_permission_overrides','notifications',
    'profile_auth_sessions','schedule_entries','schedule_rules',
    'time_change_requests','user_presence','users','walk_swap_requests','walks'
  ]
  loop
    execute format('drop trigger if exists block_system_admin_observer_mutation_trigger on %I', t);
    execute format(
      'create trigger block_system_admin_observer_mutation_trigger before insert or update or delete on %I for each row execute function block_system_admin_observer_mutation()',
      t
    );
  end loop;
end $$;

-- Family photos remain readable, but observer mode cannot upload/update/delete.
drop policy if exists "upload family photos" on storage.objects;
create policy "upload family photos" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'family-photos'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = current_family_id()::text
  and active_system_admin_observer_family() is null
);

drop policy if exists "update family photos" on storage.objects;
create policy "update family photos" on storage.objects
for update to authenticated
using (
  bucket_id = 'family-photos'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = current_family_id()::text
  and active_system_admin_observer_family() is null
)
with check (
  bucket_id = 'family-photos'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = current_family_id()::text
  and active_system_admin_observer_family() is null
);

drop policy if exists "delete family photos" on storage.objects;
create policy "delete family photos" on storage.objects
for delete to authenticated
using (
  bucket_id = 'family-photos'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = current_family_id()::text
  and active_system_admin_observer_family() is null
);
