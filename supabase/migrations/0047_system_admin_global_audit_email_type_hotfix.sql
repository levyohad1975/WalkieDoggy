-- 0047_system_admin_global_audit_email_type_hotfix.sql
-- Normalize auth.users.email (varchar) to the RPC's public text contract.

CREATE OR REPLACE FUNCTION public.system_admin_list_global_audit(p_limit integer DEFAULT 200)
 RETURNS TABLE(event_id uuid, source text, family_id uuid, family_name text, actor_user_id uuid, actor_name text, actor_auth_user_id uuid, actor_email text, action text, target_type text, target_id text, metadata jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;

  return query
  with events as (
    select
      a.id as event_id,
      'family_audit'::text as source,
      a.family_id,
      a.actor_user_id,
      u.auth_user_id as actor_auth_user_id,
      a.action,
      a.target_type,
      a.target_id::text,
      a.metadata,
      a.created_at
    from audit_log a
    left join users u on u.id = a.actor_user_id

    union all

    select
      s.id,
      'system_audit'::text,
      case when s.target_type = 'family' then s.target_id else null end,
      null::uuid,
      s.actor_auth_user_id,
      s.action,
      s.target_type,
      s.target_id::text,
      s.metadata,
      s.created_at
    from system_audit_log s

    union all

    select
      x.id,
      'state_change'::text,
      x.family_id,
      x.actor_user_id,
      x.actor_auth_user_id,
      x.action,
      x.entity_type,
      x.entity_id,
      x.metadata,
      x.created_at
    from system_activity_audit_log x
  )
  select
    e.event_id,
    e.source,
    e.family_id,
    f.name,
    e.actor_user_id,
    u.name,
    e.actor_auth_user_id,
    coalesce(au.email::text, r.verified_email)::text,
    e.action,
    e.target_type,
    e.target_id,
    e.metadata,
    e.created_at
  from events e
  left join families f on f.id = e.family_id
  left join users u on u.id = e.actor_user_id
  left join auth.users au on au.id = e.actor_auth_user_id
  left join family_onboarding_requests r
    on r.family_id = e.family_id and r.auth_user_id = e.actor_auth_user_id
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$
;
