-- 0046_system_admin_data_hotfix.sql
-- Keep System Admin reads aligned with the normalized role/onboarding schema.

CREATE OR REPLACE FUNCTION public.system_admin_get_family_detail(p_family_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb; fam_exists boolean;
begin
  if not is_system_admin() then raise exception 'system admin permission required'; end if;
  select exists(select 1 from families where id=p_family_id) into fam_exists;
  if not fam_exists then raise exception 'family not found'; end if;

  perform log_system_audit_event('system_admin_view_family_detail','family',p_family_id,'{}'::jsonb);

  select jsonb_build_object(
    'family', (
      select jsonb_build_object(
        'id',f.id,'name',f.name,'inviteCode',f.invite_code,'createdAt',f.created_at,
        'approvalStatus',f.approval_status
      ) from families f where f.id=p_family_id
    ),
    'dog', (
      select jsonb_build_object(
        'id',d.id,'name',d.name,'photoUrl',d.photo_url,'sex',d.sex,'walksPerDay',d.walks_per_day
      ) from dogs d where d.family_id=p_family_id order by d.created_at desc limit 1
    ),
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',u.id,'name',u.name,'avatar',u.avatar,'photoUrl',u.photo_url,
          'role',case when exists (
            select 1 from family_auth_members fam
            where fam.family_id=p_family_id and fam.role='admin'
              and (
                fam.auth_user_id=u.auth_user_id
                or exists (
                  select 1 from profile_auth_sessions pas
                  where pas.family_id=p_family_id and pas.user_id=u.id
                    and pas.auth_user_id=fam.auth_user_id
                )
              )
          ) then 'admin' else 'member' end,
          'removedAt',u.removed_at,
          'claimed',(
            u.auth_user_id is not null
            or exists(select 1 from profile_auth_sessions ps where ps.family_id=p_family_id and ps.user_id=u.id)
          )
        ) order by u.removed_at nulls first,u.created_at
      ),'[]'::jsonb)
      from users u where u.family_id=p_family_id
    ),
    'walks', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',w.id,'date',w.date,'scheduledTime',w.scheduled_time,'status',w.status,
          'responsibleUserId',w.responsible_user_id,'completedAt',w.completed_at,'isUnplanned',w.is_unplanned
        ) order by w.date desc,w.scheduled_time desc
      ),'[]'::jsonb)
      from (select * from walks w0 where w0.family_id=p_family_id order by w0.date desc,w0.scheduled_time desc limit 50) w
    ),
    'activeRequests', (
      select coalesce(jsonb_agg(req),'[]'::jsonb) from (
        select jsonb_build_object(
          'kind','swap','id',sr.id,'walkId',sr.walk_id,'requestedByUserId',sr.requested_by_user_id,
          'targetUserId',sr.target_user_id,'status',sr.status,'createdAt',sr.created_at
        ) req from walk_swap_requests sr where sr.family_id=p_family_id and sr.status='pending'
        union all
        select jsonb_build_object(
          'kind','time_change','id',tr.id,'walkId',tr.walk_id,'requestedByUserId',tr.requested_by_user_id,
          'proposedTime',tr.proposed_time,'status',tr.status,'createdAt',tr.created_at
        ) req from time_change_requests tr where tr.family_id=p_family_id and tr.status='pending'
      ) combined
    ),
    'recentAudit', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',al.id,'action',al.action,'targetType',al.target_type,
          'targetId',al.target_id,'createdAt',al.created_at
        ) order by al.created_at desc
      ),'[]'::jsonb)
      from (select * from audit_log al0 where al0.family_id=p_family_id order by al0.created_at desc limit 50) al
    )
  ) into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.system_admin_list_families_v2(p_search text DEFAULT NULL::text)
 RETURNS TABLE(family_id uuid, family_name text, invite_code text, created_at timestamp with time zone, member_count integer, admin_names text[], dog_name text, status text, verified_email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not is_system_admin() then raise exception 'system admin permission required'; end if;
  return query
  select
    f.id, f.name, f.invite_code, f.created_at,
    (select count(*)::int from users u where u.family_id=f.id and u.removed_at is null),
    (
      select coalesce(array_agg(distinct u2.name order by u2.name), '{}'::text[])
      from users u2
      where u2.family_id=f.id and u2.removed_at is null
        and exists (
          select 1 from family_auth_members fam
          where fam.family_id=f.id and fam.role='admin'
            and (
              fam.auth_user_id=u2.auth_user_id
              or exists (
                select 1 from profile_auth_sessions pas
                where pas.family_id=f.id and pas.user_id=u2.id
                  and pas.auth_user_id=fam.auth_user_id
              )
            )
        )
    ),
    (select d.name from dogs d where d.family_id=f.id order by d.created_at desc limit 1),
    f.approval_status,
    (
      select r.verified_email
      from family_onboarding_requests r
      where r.family_id=f.id and r.verified_email is not null
      order by r.requested_at desc limit 1
    )
  from families f
  where p_search is null or length(trim(p_search))=0
    or f.name ilike '%'||trim(p_search)||'%'
    or f.invite_code ilike '%'||trim(p_search)||'%'
    or exists (
      select 1 from family_onboarding_requests sr
      where sr.family_id=f.id and coalesce(sr.verified_email,'') ilike '%'||trim(p_search)||'%'
    )
    or exists (
      select 1 from users su
      where su.family_id=f.id and su.removed_at is null
        and su.name ilike '%'||trim(p_search)||'%'
    )
  order by f.created_at desc;
end; $function$
;
