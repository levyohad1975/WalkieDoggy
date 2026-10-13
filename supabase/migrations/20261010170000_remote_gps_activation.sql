-- Complete the existing 0110 remote GPS groundwork. Both family and target
-- profile must consent; only the intended authenticated target device polls.
alter table families add column if not exists remote_gps_enabled boolean not null default false;
alter table remote_gps_commands drop constraint if exists remote_gps_commands_status_check;
alter table remote_gps_commands add constraint remote_gps_commands_status_check check (status in ('pending','tracking','failed','expired','stopped'));
drop index if exists remote_gps_commands_one_pending;
create unique index remote_gps_commands_one_open_per_walk on remote_gps_commands(walk_id) where status in ('pending','tracking');

create table if not exists remote_gps_audit (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references families(id) on delete cascade,
 walk_id uuid not null references walks(id) on delete cascade, actor_user_id uuid not null references users(id),
 target_user_id uuid not null references users(id),
 action text not null check(action in ('requested','tracking','failed','expired','stopped','consent_revoked','family_disabled')),
 created_at timestamptz not null default now()
);
alter table remote_gps_audit enable row level security;
create policy "family admins can view remote gps audit" on remote_gps_audit for select to authenticated
 using(family_id=current_family_id() and is_family_admin(family_id));
revoke all on remote_gps_audit from public,anon,authenticated;
grant select on remote_gps_audit to authenticated;

create or replace function set_family_remote_gps_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare f uuid:=current_family_id(); a uuid:=real_current_profile_id();
begin
 if f is null or a is null or not is_family_admin(f) then raise exception 'admin required'; end if;
 update families set remote_gps_enabled=p_enabled where id=f;
 if not p_enabled then
  insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
   select family_id,walk_id,a,target_user_id,'family_disabled' from remote_gps_commands where family_id=f and status in ('pending','tracking');
  update remote_gps_commands set status='failed',failure_reason='family_disabled',acknowledged_at=now() where family_id=f and status in ('pending','tracking');
 end if;
end; $$;
revoke all on function set_family_remote_gps_enabled(boolean) from public,anon;
grant execute on function set_family_remote_gps_enabled(boolean) to authenticated;

create or replace function get_remote_gps_settings()
returns jsonb language plpgsql security definer set search_path=public as $$
declare f uuid:=current_family_id(); u uuid:=real_current_profile_id();
begin
 if f is null or u is null then raise exception 'active profile required'; end if;
 return jsonb_build_object('familyEnabled',(select remote_gps_enabled from families where id=f),
  'consentEnabled',coalesce((select enabled from remote_gps_consents where family_id=f and user_id=u),false),
  'isAdmin',is_family_admin(f));
end; $$;
revoke all on function get_remote_gps_settings() from public,anon;
grant execute on function get_remote_gps_settings() to authenticated;

create or replace function list_remote_gps_targets(p_walk_id uuid)
returns table(user_id uuid,display_name text) language plpgsql security definer set search_path=public as $$
declare w walks;
begin
 select * into w from walks where id=p_walk_id and family_id=current_family_id();
 if not found or not is_family_admin(w.family_id) then raise exception 'admin required'; end if;
 return query select u.id,u.name from users u join remote_gps_consents c on c.user_id=u.id and c.family_id=u.family_id and c.enabled
  join profile_auth_sessions s on s.user_id=u.id and s.family_id=u.family_id
  where u.family_id=w.family_id and u.removed_at is null and u.id=w.responsible_user_id
   and (select remote_gps_enabled from families where id=u.family_id) order by u.name;
end; $$;
revoke all on function list_remote_gps_targets(uuid) from public,anon;
grant execute on function list_remote_gps_targets(uuid) to authenticated;

drop function if exists request_remote_gps_start(uuid,uuid);
create function request_remote_gps_start(p_walk_id uuid,p_target_user_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare w walks; a uuid:=real_current_profile_id(); target_auth uuid; cid uuid;
begin
 if auth.uid() is null or a is null then raise exception 'active profile required'; end if;
 select * into w from walks where id=p_walk_id for update;
 if not found or w.family_id is distinct from current_family_id() then raise exception 'walk not found'; end if;
 if not is_family_admin(w.family_id) then raise exception 'admin required'; end if;
 if w.status not in ('pending','in_progress') then raise exception 'walk unavailable'; end if;
 if not (select remote_gps_enabled from families where id=w.family_id) then raise exception 'remote gps disabled'; end if;
 if p_target_user_id is distinct from w.responsible_user_id then raise exception 'target must be responsible member'; end if;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select family_id,walk_id,a,target_user_id,'expired' from remote_gps_commands
   where walk_id=p_walk_id and status='pending' and expires_at<=now();
 update remote_gps_commands set status='expired',failure_reason='expired',acknowledged_at=now()
  where walk_id=p_walk_id and status='pending' and expires_at<=now();
 if exists(select 1 from remote_gps_commands where walk_id=p_walk_id and status in ('pending','tracking')) then
  select id into cid from remote_gps_commands where walk_id=p_walk_id and status in ('pending','tracking'); return cid;
 end if;
 select s.auth_user_id into target_auth from profile_auth_sessions s join remote_gps_consents c on c.user_id=s.user_id and c.family_id=s.family_id and c.enabled
  join users u on u.id=s.user_id and u.family_id=s.family_id and u.removed_at is null
  where s.user_id=p_target_user_id and s.family_id=w.family_id order by s.updated_at desc limit 1;
 if target_auth is null then raise exception 'target device has no active consent'; end if;
 insert into remote_gps_commands(family_id,walk_id,target_user_id,target_auth_user_id,requested_by_user_id)
  values(w.family_id,p_walk_id,p_target_user_id,target_auth,a) returning id into cid;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action) values(w.family_id,p_walk_id,a,p_target_user_id,'requested');
 return cid;
end; $$;
revoke all on function request_remote_gps_start(uuid,uuid) from public,anon;
grant execute on function request_remote_gps_start(uuid,uuid) to authenticated;

create or replace function get_my_remote_gps_commands()
returns table(command_id uuid,walk_id uuid,status text,expires_at timestamptz) language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or real_current_profile_id() is null then raise exception 'active profile required'; end if;
 update remote_gps_commands c set status='expired',failure_reason='expired',acknowledged_at=now()
  where c.target_auth_user_id=auth.uid() and c.status='pending' and c.expires_at<=now();
 return query select c.id,c.walk_id,c.status,c.expires_at from remote_gps_commands c
  where c.target_auth_user_id=auth.uid() and c.family_id=current_family_id() and c.status in ('pending','tracking') and c.expires_at>now()
  order by c.created_at desc;
end; $$;
revoke all on function get_my_remote_gps_commands() from public,anon;
grant execute on function get_my_remote_gps_commands() to authenticated;

create or replace function acknowledge_remote_gps_start(p_command_id uuid,p_tracking boolean,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare c remote_gps_commands; ok_consent boolean; ok_family boolean;
begin
 select * into c from remote_gps_commands where id=p_command_id for update;
 if not found or c.target_auth_user_id is distinct from auth.uid() or c.target_user_id is distinct from real_current_profile_id()
  or c.family_id is distinct from current_family_id() then raise exception 'command not found'; end if;
 if c.status<>'pending' or c.expires_at<=now() then raise exception 'command expired or already handled'; end if;
 select enabled into ok_consent from remote_gps_consents where user_id=c.target_user_id and family_id=c.family_id;
 select remote_gps_enabled into ok_family from families where id=c.family_id;
 if ok_consent is distinct from true or ok_family is distinct from true then raise exception 'consent revoked'; end if;
 update remote_gps_commands set status=case when p_tracking then 'tracking' else 'failed' end,
  failure_reason=case when p_tracking then null else left(coalesce(p_reason,'unavailable'),100) end,acknowledged_at=now() where id=p_command_id;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  values(c.family_id,c.walk_id,c.target_user_id,c.target_user_id,case when p_tracking then 'tracking' else 'failed' end);
end; $$;
revoke all on function acknowledge_remote_gps_start(uuid,boolean,text) from public,anon;
grant execute on function acknowledge_remote_gps_start(uuid,boolean,text) to authenticated;

create or replace function stop_remote_gps_tracking(p_command_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c remote_gps_commands;
begin
 select * into c from remote_gps_commands where id=p_command_id for update;
 if not found or c.target_auth_user_id is distinct from auth.uid() or c.target_user_id is distinct from real_current_profile_id()
  or c.family_id is distinct from current_family_id() then raise exception 'command not found'; end if;
 if c.status<>'tracking' then raise exception 'tracking is not active'; end if;
 update remote_gps_commands set status='stopped',acknowledged_at=now() where id=p_command_id;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action) values(c.family_id,c.walk_id,c.target_user_id,c.target_user_id,'stopped');
end; $$;
revoke all on function stop_remote_gps_tracking(uuid) from public,anon;
grant execute on function stop_remote_gps_tracking(uuid) to authenticated;

create or replace function get_remote_gps_walk_status(p_walk_id uuid)
returns table(command_id uuid,status text,failure_reason text,expires_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
 if current_family_id() is null or not is_family_admin(current_family_id()) then raise exception 'admin required'; end if;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,real_current_profile_id(),c.target_user_id,'expired' from remote_gps_commands c
   where c.walk_id=p_walk_id and c.family_id=current_family_id() and c.status='pending' and c.expires_at<=now();
 update remote_gps_commands set status='expired',failure_reason='expired',acknowledged_at=now()
  where walk_id=p_walk_id and family_id=current_family_id() and status='pending' and expires_at<=now();
 return query select c.id,c.status,c.failure_reason,c.expires_at from remote_gps_commands c
  where c.walk_id=p_walk_id and c.family_id=current_family_id() order by c.created_at desc limit 1;
end; $$;
revoke all on function get_remote_gps_walk_status(uuid) from public,anon;
grant execute on function get_remote_gps_walk_status(uuid) to authenticated;

create or replace function remote_gps_notification_context(p_command_id uuid)
returns table(target_user_id uuid,walk_id uuid)
language plpgsql security definer set search_path=public as $$
begin
 if current_family_id() is null or not is_family_admin(current_family_id()) then raise exception 'admin required'; end if;
 return query select c.target_user_id,c.walk_id from remote_gps_commands c
  where c.id=p_command_id and c.family_id=current_family_id() and c.requested_by_user_id=real_current_profile_id()
   and c.status='pending' and c.expires_at>now();
end; $$;
revoke all on function remote_gps_notification_context(uuid) from public,anon;
grant execute on function remote_gps_notification_context(uuid) to authenticated;

create or replace function set_remote_gps_consent(p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare u uuid:=real_current_profile_id();f uuid:=current_family_id();
begin
 if u is null or f is null then raise exception 'active profile required'; end if;
 insert into remote_gps_consents(family_id,user_id,enabled,updated_at) values(f,u,p_enabled,now())
  on conflict(user_id) do update set family_id=excluded.family_id,enabled=excluded.enabled,updated_at=now();
 if not p_enabled then
  insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
   select family_id,walk_id,u,u,'consent_revoked' from remote_gps_commands where target_user_id=u and family_id=f and status in ('pending','tracking');
  update remote_gps_commands set status='failed',failure_reason='consent_revoked',acknowledged_at=now()
   where target_user_id=u and family_id=f and status in ('pending','tracking');
 end if;
end; $$;
revoke all on function set_remote_gps_consent(boolean) from public,anon;
grant execute on function set_remote_gps_consent(boolean) to authenticated;

create or replace function get_my_remote_gps_commands()
returns table(command_id uuid,walk_id uuid,status text,expires_at timestamptz) language plpgsql security definer set search_path=public as $$
declare u uuid:=real_current_profile_id();f uuid:=current_family_id();
begin
 if auth.uid() is null or u is null or f is null then raise exception 'active profile required'; end if;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,u,u,'expired' from remote_gps_commands c where c.target_auth_user_id=auth.uid() and c.family_id=f and c.status='pending' and c.expires_at<=now();
 update remote_gps_commands c set status='expired',failure_reason='expired',acknowledged_at=now()
  where c.target_auth_user_id=auth.uid() and c.family_id=f and c.status='pending' and c.expires_at<=now();
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,u,u,'consent_revoked' from remote_gps_commands c
   join remote_gps_consents rc on rc.user_id=c.target_user_id and rc.family_id=c.family_id
   join families fam on fam.id=c.family_id
   where c.target_auth_user_id=auth.uid() and c.family_id=f and c.status in ('pending','tracking') and (not rc.enabled or not fam.remote_gps_enabled);
 update remote_gps_commands c set status='failed',failure_reason='consent_revoked',acknowledged_at=now()
  from remote_gps_consents rc,families fam
  where c.target_auth_user_id=auth.uid() and c.family_id=f and c.status in ('pending','tracking')
   and rc.user_id=c.target_user_id and rc.family_id=c.family_id and fam.id=c.family_id and (not rc.enabled or not fam.remote_gps_enabled);
 return query select c.id,c.walk_id,c.status,c.expires_at from remote_gps_commands c
  where c.target_auth_user_id=auth.uid() and c.family_id=f and c.status in ('pending','tracking')
   and (c.status='tracking' or c.expires_at>now());
end; $$;
revoke all on function get_my_remote_gps_commands() from public,anon;
grant execute on function get_my_remote_gps_commands() to authenticated;
