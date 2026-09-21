-- 0048_system_admin_audit_detail_filter.sql
-- Detailed, filterable System Admin audit trail. Staging/RC first.

create or replace function capture_user_state_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_safe_old jsonb;
  v_safe_new jsonb;
  v_family_id uuid;
  v_actor_auth uuid;
  v_actor_user uuid;
  v_entity_id text;
  v_changed_fields jsonb;
  v_metadata jsonb;
begin
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row := coalesce(v_new, v_old);

  -- Never copy authentication/PIN/token material into the audit payload.
  v_safe_old := coalesce(v_old, '{}'::jsonb)
    - array['pin_hash','token_hash','invite_token_hash','provider_message_id'];
  v_safe_new := coalesce(v_new, '{}'::jsonb)
    - array['pin_hash','token_hash','invite_token_hash','provider_message_id'];

  if tg_table_name = 'families' then
    v_family_id := nullif(v_row ->> 'id', '')::uuid;
  else
    begin
      v_family_id := nullif(v_row ->> 'family_id', '')::uuid;
    exception when invalid_text_representation then
      v_family_id := null;
    end;
  end if;

  v_actor_auth := auth.uid();

  if v_actor_auth is not null and v_family_id is not null then
    select u.id into v_actor_user
    from users u
    where u.family_id = v_family_id
      and (
        u.auth_user_id = v_actor_auth
        or exists (
          select 1 from profile_auth_sessions ps
          where ps.family_id = v_family_id
            and ps.user_id = u.id
            and ps.auth_user_id = v_actor_auth
        )
      )
    order by u.removed_at nulls first, u.created_at
    limit 1;
  end if;

  v_entity_id := coalesce(
    nullif(v_row ->> 'id', ''),
    nullif(v_row ->> 'auth_user_id', ''),
    nullif(v_row ->> 'user_id', ''),
    nullif(v_row ->> 'walk_id', '')
  );

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
      into v_changed_fields
    from (
      select key as k
      from jsonb_each(v_safe_new)
      where (v_safe_old -> key) is distinct from value
        and key not in ('updated_at','last_seen_at')
    ) changed;

    v_metadata := jsonb_build_object(
      'operation', tg_op,
      'changed_fields', v_changed_fields,
      'before', v_safe_old,
      'after', v_safe_new
    );
  elsif tg_op = 'INSERT' then
    v_metadata := jsonb_build_object('operation', tg_op, 'values', v_safe_new);
  else
    v_metadata := jsonb_build_object('operation', tg_op, 'values', v_safe_old);
  end if;

  insert into system_activity_audit_log (
    family_id, actor_auth_user_id, actor_user_id,
    action, entity_type, entity_id, metadata
  ) values (
    v_family_id, v_actor_auth, v_actor_user,
    lower(tg_table_name) || '.' || lower(tg_op),
    tg_table_name,
    v_entity_id,
    v_metadata
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function system_admin_list_global_audit_v2(
  p_limit integer default 200,
  p_family_id uuid default null
)
returns table(
  event_id uuid,
  source text,
  family_id uuid,
  family_name text,
  actor_user_id uuid,
  actor_name text,
  actor_auth_user_id uuid,
  actor_email text,
  action text,
  target_type text,
  target_id text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
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
  ),
  enriched as (
    select
      e.*,
      f.name as resolved_family_name,
      u.name as resolved_actor_name,
      coalesce(au.email::text, r.verified_email)::text as resolved_actor_email,
      e.metadata || jsonb_strip_nulls(jsonb_build_object(
        'responsible_user_name', (
          select ru.name from users ru
          where ru.family_id=e.family_id
            and ru.id::text=e.metadata->>'responsible_user_id'
          limit 1
        ),
        'completed_by_user_name', (
          select cu.name from users cu
          where cu.family_id=e.family_id
            and cu.id::text=e.metadata->>'completed_by_user_id'
          limit 1
        ),
        'target_user_name', (
          select tu.name from users tu
          where tu.family_id=e.family_id
            and tu.id::text=e.metadata->>'target_user_id'
          limit 1
        )
      )) as enriched_metadata
    from events e
    left join families f on f.id=e.family_id
    left join users u on u.id=e.actor_user_id
    left join auth.users au on au.id=e.actor_auth_user_id
    left join family_onboarding_requests r
      on r.family_id=e.family_id and r.auth_user_id=e.actor_auth_user_id
    where p_family_id is null or e.family_id=p_family_id
  )
  select
    e.event_id, e.source, e.family_id, e.resolved_family_name,
    e.actor_user_id, e.resolved_actor_name, e.actor_auth_user_id,
    e.resolved_actor_email, e.action, e.target_type, e.target_id,
    e.enriched_metadata, e.created_at
  from enriched e
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

revoke all on function system_admin_list_global_audit_v2(integer, uuid) from public;
grant execute on function system_admin_list_global_audit_v2(integer, uuid) to authenticated;
