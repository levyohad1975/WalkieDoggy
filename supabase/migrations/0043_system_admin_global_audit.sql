-- 0043_system_admin_global_audit.sql
-- System-owner observability: verified creator email + global audit trail.
-- Additive only. No Production deployment is implied by this repository migration.

create table if not exists system_activity_audit_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references families(id) on delete set null,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists system_activity_audit_log_created_at_idx on system_activity_audit_log (created_at desc);
create index if not exists system_activity_audit_log_family_id_idx on system_activity_audit_log (family_id, created_at desc);
alter table system_activity_audit_log enable row level security;

create or replace function capture_user_state_change()
returns trigger language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_row jsonb; v_family_id uuid; v_actor_auth uuid; v_actor_user uuid; v_entity_id text;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name = 'families' then
    v_family_id := nullif(v_row ->> 'id', '')::uuid;
  else
    begin v_family_id := nullif(v_row ->> 'family_id', '')::uuid;
    exception when invalid_text_representation then v_family_id := null; end;
  end if;
  v_actor_auth := auth.uid();
  if v_actor_auth is not null and v_family_id is not null then
    select u.id into v_actor_user from users u
    where u.family_id = v_family_id and u.auth_user_id = v_actor_auth
    order by u.removed_at nulls first, u.created_at limit 1;
  end if;
  v_entity_id := coalesce(nullif(v_row ->> 'id', ''), nullif(v_row ->> 'auth_user_id', ''),
                          nullif(v_row ->> 'user_id', ''), nullif(v_row ->> 'walk_id', ''));
  insert into system_activity_audit_log
    (family_id, actor_auth_user_id, actor_user_id, action, entity_type, entity_id, metadata)
  values
    (v_family_id, v_actor_auth, v_actor_user, lower(tg_table_name)||'.'||lower(tg_op),
     tg_table_name, v_entity_id, jsonb_build_object('operation', tg_op));
  return case when tg_op = 'DELETE' then old else new end;
end; $$;
revoke all on function capture_user_state_change() from public;

do $$
declare t text;
begin
  foreach t in array array['families','users','dogs','schedule_entries','schedule_rules','walks',
    'walk_swap_requests','time_change_requests','member_permission_overrides','family_auth_members',
    'profile_auth_sessions','impersonation_sessions']
  loop
    execute format('drop trigger if exists system_activity_audit_trigger on %I', t);
    execute format('create trigger system_activity_audit_trigger after insert or update or delete on %I for each row execute function capture_user_state_change()', t);
  end loop;
end $$;

create or replace function system_admin_list_families_v2(p_search text default null)
returns table (family_id uuid, family_name text, invite_code text, created_at timestamptz,
  member_count int, admin_names text[], dog_name text, status text, verified_email text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_system_admin() then raise exception 'system admin permission required'; end if;
  return query
  select f.id, f.name, f.invite_code, f.created_at,
    (select count(*)::int from users u where u.family_id=f.id and u.removed_at is null),
    (select coalesce(array_agg(u2.name order by u2.name),'{}') from users u2 where u2.family_id=f.id and u2.removed_at is null and u2.role='admin'),
    (select d.name from dogs d where d.family_id=f.id limit 1),
    f.approval_status, r.verified_email
  from families f left join family_onboarding_requests r on r.family_id=f.id
  where p_search is null or length(trim(p_search))=0
    or f.name ilike '%'||trim(p_search)||'%' or f.invite_code ilike '%'||trim(p_search)||'%'
    or coalesce(r.verified_email,'') ilike '%'||trim(p_search)||'%'
    or exists(select 1 from users su where su.family_id=f.id and su.removed_at is null and su.name ilike '%'||trim(p_search)||'%')
  order by f.created_at desc;
end; $$;
revoke all on function system_admin_list_families_v2(text) from public;
grant execute on function system_admin_list_families_v2(text) to authenticated;

create or replace function system_admin_list_global_audit(p_limit integer default 200)
returns table (event_id uuid, source text, family_id uuid, family_name text, actor_user_id uuid,
  actor_name text, actor_auth_user_id uuid, actor_email text, action text, target_type text,
  target_id text, metadata jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_system_admin() then raise exception 'system admin permission required'; end if;
  return query
  with events as (
    select a.id,'family_audit'::text,a.family_id,a.actor_user_id,u.auth_user_id,a.action,a.target_type,a.target_id::text,a.metadata,a.created_at
      from audit_log a left join users u on u.id=a.actor_user_id
    union all
    select s.id,'system_audit'::text,case when s.target_type='family' then s.target_id else null end,
      null::uuid,s.actor_auth_user_id,s.action,s.target_type,s.target_id::text,s.metadata,s.created_at from system_audit_log s
    union all
    select x.id,'state_change'::text,x.family_id,x.actor_user_id,x.actor_auth_user_id,x.action,x.entity_type,x.entity_id,x.metadata,x.created_at
      from system_activity_audit_log x
  )
  select e.id,e.source,e.family_id,f.name,e.actor_user_id,u.name,e.actor_auth_user_id,
    coalesce(au.email,r.verified_email),e.action,e.target_type,e.target_id,e.metadata,e.created_at
  from events e
  left join families f on f.id=e.family_id
  left join users u on u.id=e.actor_user_id
  left join auth.users au on au.id=e.actor_auth_user_id
  left join family_onboarding_requests r on r.family_id=e.family_id and r.auth_user_id=e.actor_auth_user_id
  order by e.created_at desc limit greatest(1,least(coalesce(p_limit,200),1000));
end; $$;
revoke all on function system_admin_list_global_audit(integer) from public;
grant execute on function system_admin_list_global_audit(integer) to authenticated;

create or replace function system_admin_list_email_delivery_log(p_limit integer default 50)
returns setof email_delivery_log language plpgsql stable security definer set search_path = public as $$
begin
  if not is_system_admin() then raise exception 'system admin permission required'; end if;
  return query select * from email_delivery_log order by created_at desc
    limit greatest(1,least(coalesce(p_limit,50),200));
end; $$;
revoke all on function system_admin_list_email_delivery_log(integer) from public;
grant execute on function system_admin_list_email_delivery_log(integer) to authenticated;
