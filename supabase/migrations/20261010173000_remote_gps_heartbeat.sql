-- A tracking acknowledgement is live only while the target foreground app
-- continues to heartbeat. Suspended or closed PWAs expire safely.
create or replace function heartbeat_remote_gps_tracking(p_command_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c remote_gps_commands; consent_ok boolean; family_ok boolean;
begin
 select * into c from remote_gps_commands where id=p_command_id for update;
 if not found or c.target_auth_user_id is distinct from auth.uid()
   or c.target_user_id is distinct from real_current_profile_id()
   or c.family_id is distinct from current_family_id() then raise exception 'command not found'; end if;
 if c.status<>'tracking' then raise exception 'tracking is not active'; end if;
 select enabled into consent_ok from remote_gps_consents where family_id=c.family_id and user_id=c.target_user_id;
 select remote_gps_enabled into family_ok from families where id=c.family_id;
 if consent_ok is distinct from true or family_ok is distinct from true then
  update remote_gps_commands set status='failed',failure_reason='consent_revoked',acknowledged_at=now() where id=c.id;
  insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action) values(c.family_id,c.walk_id,c.target_user_id,c.target_user_id,'consent_revoked');
  return;
 end if;
 update remote_gps_commands set acknowledged_at=now() where id=c.id;
end; $$;
revoke all on function heartbeat_remote_gps_tracking(uuid) from public,anon;
grant execute on function heartbeat_remote_gps_tracking(uuid) to authenticated;

create or replace function get_remote_gps_walk_status(p_walk_id uuid)
returns table(command_id uuid,status text,failure_reason text,expires_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare f uuid:=current_family_id();a uuid:=real_current_profile_id();
begin
 if f is null or not is_family_admin(f) then raise exception 'admin required'; end if;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,a,c.target_user_id,'expired' from remote_gps_commands c
   where c.walk_id=p_walk_id and c.family_id=f and c.status='pending' and c.expires_at<=now();
 update remote_gps_commands set status='expired',failure_reason='expired',acknowledged_at=now()
  where walk_id=p_walk_id and family_id=f and status='pending' and expires_at<=now();
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,a,c.target_user_id,'failed' from remote_gps_commands c
   where c.walk_id=p_walk_id and c.family_id=f and c.status='tracking' and c.acknowledged_at<now()-interval '30 seconds';
 update remote_gps_commands set status='failed',failure_reason='target_inactive',acknowledged_at=now()
  where walk_id=p_walk_id and family_id=f and status='tracking' and acknowledged_at<now()-interval '30 seconds';
 return query select c.id,c.status,c.failure_reason,c.expires_at from remote_gps_commands c
  where c.walk_id=p_walk_id and c.family_id=f order by c.created_at desc limit 1;
end; $$;
revoke all on function get_remote_gps_walk_status(uuid) from public,anon;
grant execute on function get_remote_gps_walk_status(uuid) to authenticated;
