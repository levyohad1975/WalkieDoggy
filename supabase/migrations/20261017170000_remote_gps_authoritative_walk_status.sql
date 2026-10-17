-- Remote GPS targets must not reject a valid command based on a stale local
-- walk snapshot. Return only the target's own command plus authoritative,
-- minimal walk lifecycle state; acknowledge rechecks the lifecycle server-side.
drop function if exists get_my_remote_gps_commands();
create function get_my_remote_gps_commands()
returns table(
  command_id uuid,
  walk_id uuid,
  status text,
  expires_at timestamptz,
  walk_status text,
  walk_family_id uuid,
  walk_actual_walker_user_id uuid
)
language plpgsql security definer set search_path=public as $$
declare u uuid:=real_current_profile_id(); f uuid:=current_family_id();
begin
 if auth.uid() is null or u is null or f is null then raise exception 'active profile required'; end if;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,u,u,'expired' from remote_gps_commands c
   where c.target_auth_user_id=auth.uid() and c.target_user_id=u and c.family_id=f
    and c.status='pending' and c.expires_at<=now();
 update remote_gps_commands c set status='expired',failure_reason='expired',acknowledged_at=now()
  where c.target_auth_user_id=auth.uid() and c.target_user_id=u and c.family_id=f
   and c.status='pending' and c.expires_at<=now();
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,u,u,'consent_revoked' from remote_gps_commands c
   join remote_gps_consents rc on rc.user_id=c.target_user_id and rc.family_id=c.family_id
   join families fam on fam.id=c.family_id
   where c.target_auth_user_id=auth.uid() and c.target_user_id=u and c.family_id=f
    and c.status in ('pending','tracking') and (not rc.enabled or not fam.remote_gps_enabled);
 update remote_gps_commands c set status='failed',failure_reason='consent_revoked',acknowledged_at=now()
  from remote_gps_consents rc,families fam
  where c.target_auth_user_id=auth.uid() and c.target_user_id=u and c.family_id=f
   and c.status in ('pending','tracking') and rc.user_id=c.target_user_id
   and rc.family_id=c.family_id and fam.id=c.family_id and (not rc.enabled or not fam.remote_gps_enabled);
 return query
  select c.id,c.walk_id,c.status,c.expires_at,w.status,w.family_id,
   coalesce(w.actual_walker_user_id,w.responsible_user_id)
  from remote_gps_commands c join walks w on w.id=c.walk_id and w.family_id=c.family_id
  where c.target_auth_user_id=auth.uid() and c.target_user_id=u and c.family_id=f
   and c.status in ('pending','tracking') and (c.status='tracking' or c.expires_at>now())
  order by c.created_at desc;
end; $$;
revoke all on function get_my_remote_gps_commands() from public,anon;
grant execute on function get_my_remote_gps_commands() to authenticated;

create or replace function acknowledge_remote_gps_start(p_command_id uuid,p_tracking boolean,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare c remote_gps_commands; ok_consent boolean; ok_family boolean; walk_state text; walker uuid;
begin
 select * into c from remote_gps_commands where id=p_command_id for update;
 if not found or c.target_auth_user_id is distinct from auth.uid() or c.target_user_id is distinct from real_current_profile_id()
  or c.family_id is distinct from current_family_id() then raise exception 'command not found'; end if;
 if c.status<>'pending' or c.expires_at<=now() then raise exception 'command expired or already handled'; end if;
 select w.status,coalesce(w.actual_walker_user_id,w.responsible_user_id)
  into walk_state,walker from walks w where w.id=c.walk_id and w.family_id=c.family_id for share;
 if not found or walker is distinct from c.target_user_id then raise exception 'walk unavailable'; end if;
 if p_tracking and walk_state is distinct from 'in_progress' then raise exception 'walk not started'; end if;
 select enabled into ok_consent from remote_gps_consents where user_id=c.target_user_id and family_id=c.family_id;
 select remote_gps_enabled into ok_family from families where id=c.family_id;
 if ok_consent is distinct from true or ok_family is distinct from true then raise exception 'consent revoked'; end if;
 update remote_gps_commands set status=case when p_tracking then 'tracking' else 'failed' end,
  failure_reason=case when p_tracking then null else left(coalesce(p_reason,'unavailable'),100) end,
  acknowledged_at=now() where id=p_command_id;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  values(c.family_id,c.walk_id,c.target_user_id,c.target_user_id,case when p_tracking then 'tracking' else 'failed' end);
end; $$;
revoke all on function acknowledge_remote_gps_start(uuid,boolean,text) from public,anon;
grant execute on function acknowledge_remote_gps_start(uuid,boolean,text) to authenticated;
