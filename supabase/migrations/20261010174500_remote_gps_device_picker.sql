-- Expose exact device identities bound to this admin's own family and the
-- responsible member's active explicit consent.
create or replace function list_remote_gps_target_devices(p_walk_id uuid)
returns table(target_auth_user_id uuid,target_user_id uuid,display_name text,device_label text)
language plpgsql security definer set search_path=public as $$
declare w walks;
begin
 select * into w from walks where id=p_walk_id and family_id=current_family_id();
 if not found or not is_family_admin(w.family_id) then raise exception 'admin required'; end if;
 return query select s.auth_user_id,u.id,u.name,'מכשיר ••••'||right(s.auth_user_id::text,4)
  from users u join remote_gps_consents c on c.user_id=u.id and c.family_id=u.family_id and c.enabled
   join profile_auth_sessions s on s.user_id=u.id and s.family_id=u.family_id
  where u.family_id=w.family_id and u.removed_at is null and u.id=w.responsible_user_id
   and (select remote_gps_enabled from families where id=u.family_id) order by s.updated_at desc;
end; $$;
revoke all on function list_remote_gps_target_devices(uuid) from public,anon;
grant execute on function list_remote_gps_target_devices(uuid) to authenticated;

create or replace function request_remote_gps_device_start(p_walk_id uuid,p_target_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare w walks;a uuid:=real_current_profile_id();target_user uuid;cid uuid;existing_auth uuid;
begin
 if auth.uid() is null or a is null then raise exception 'active profile required'; end if;
 select * into w from walks where id=p_walk_id for update;
 if not found or w.family_id is distinct from current_family_id() then raise exception 'walk not found'; end if;
 if not is_family_admin(w.family_id) then raise exception 'admin required'; end if;
 if w.status not in ('pending','in_progress') then raise exception 'walk unavailable'; end if;
 if not (select remote_gps_enabled from families where id=w.family_id) then raise exception 'remote gps disabled'; end if;
 select s.user_id into target_user from profile_auth_sessions s
  join remote_gps_consents c on c.user_id=s.user_id and c.family_id=s.family_id and c.enabled
  join users u on u.id=s.user_id and u.family_id=s.family_id and u.removed_at is null
  where s.auth_user_id=p_target_auth_user_id and s.family_id=w.family_id and s.user_id=w.responsible_user_id;
 if target_user is null then raise exception 'target device has no active consent'; end if;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select family_id,walk_id,a,rc.target_user_id,'expired' from remote_gps_commands rc where rc.walk_id=p_walk_id and rc.status='pending' and rc.expires_at<=now();
 update remote_gps_commands set status='expired',failure_reason='expired',acknowledged_at=now() where walk_id=p_walk_id and status='pending' and expires_at<=now();
 select id,target_auth_user_id into cid,existing_auth from remote_gps_commands where walk_id=p_walk_id and status in ('pending','tracking') for update;
 if cid is not null then
  if existing_auth is distinct from p_target_auth_user_id then raise exception 'walk already has a command for another device'; end if;
  return cid;
 end if;
 insert into remote_gps_commands(family_id,walk_id,target_user_id,target_auth_user_id,requested_by_user_id)
  values(w.family_id,p_walk_id,target_user,p_target_auth_user_id,a) returning id into cid;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action) values(w.family_id,p_walk_id,a,target_user,'requested');
 return cid;
end; $$;
revoke all on function request_remote_gps_device_start(uuid,uuid) from public,anon;
grant execute on function request_remote_gps_device_start(uuid,uuid) to authenticated;
