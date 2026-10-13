-- 0045_system_admin_observer_all_family_statuses.sql
-- System Admin must be able to inspect every family, including pending/rejected.

create or replace function active_system_admin_observer_family()
returns uuid language sql stable security definer set search_path = public as $$
  select s.family_id
  from system_admin_observer_sessions s
  join system_admins a on a.auth_user_id = s.system_admin_auth_user_id
  join families f on f.id = s.family_id
  where s.system_admin_auth_user_id = auth.uid() and s.ended_at is null
  order by s.started_at desc limit 1;
$$;

create or replace function active_system_admin_observer_profile()
returns uuid language sql stable security definer set search_path = public as $$
  select s.target_user_id
  from system_admin_observer_sessions s
  join system_admins a on a.auth_user_id = s.system_admin_auth_user_id
  join families f on f.id = s.family_id
  left join users u on u.id = s.target_user_id and u.family_id = s.family_id and u.removed_at is null
  where s.system_admin_auth_user_id = auth.uid() and s.ended_at is null
    and (s.target_user_id is null or u.id is not null)
  order by s.started_at desc limit 1;
$$;

create or replace function begin_system_admin_observer(p_family_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, auth as $$
declare v_target_user_id uuid; v_family_name text;
begin
  if not is_system_admin() then raise exception 'system admin permission required'; end if;
  select f.name into v_family_name from families f where f.id=p_family_id;
  if v_family_name is null then raise exception 'family not found'; end if;

  update system_admin_observer_sessions set ended_at=now(), ended_reason='replaced'
  where system_admin_auth_user_id=auth.uid() and ended_at is null;

  select u.id into v_target_user_id
  from family_auth_members m
  join profile_auth_sessions ps on ps.auth_user_id=m.auth_user_id and ps.family_id=m.family_id
  join users u on u.id=ps.user_id and u.family_id=m.family_id and u.removed_at is null
  where m.family_id=p_family_id and m.role='admin'
  order by u.created_at limit 1;

  if v_target_user_id is null then
    select u.id into v_target_user_id from users u
    where u.family_id=p_family_id and u.removed_at is null
    order by u.created_at limit 1;
  end if;

  insert into system_admin_observer_sessions(system_admin_auth_user_id,family_id,target_user_id)
  values(auth.uid(),p_family_id,v_target_user_id);

  insert into system_audit_log(actor_auth_user_id,action,target_type,target_id,metadata)
  values(auth.uid(),'system_observer.started','family',p_family_id,
    jsonb_build_object('target_user_id',v_target_user_id,'read_only',true,'hidden_from_family',true));

  return jsonb_build_object('family_id',p_family_id,'family_name',v_family_name,'target_user_id',v_target_user_id);
end; $$;
