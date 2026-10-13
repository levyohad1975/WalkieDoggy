-- Bind each push subscription to its exact auth session so an offline-device
-- prompt never fans out to sibling devices signed in as the same profile.
alter table push_tokens add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;
alter table web_push_subscriptions add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;
create index if not exists push_tokens_auth_user_active_idx on push_tokens(auth_user_id) where is_active;
create index if not exists web_push_auth_user_active_idx on web_push_subscriptions(auth_user_id) where is_active;
update push_tokens p set auth_user_id=(select min(s.auth_user_id::text)::uuid from profile_auth_sessions s where s.user_id=p.user_id)
 where p.auth_user_id is null and (select count(*) from profile_auth_sessions s where s.user_id=p.user_id)=1;
update web_push_subscriptions p set auth_user_id=(select min(s.auth_user_id::text)::uuid from profile_auth_sessions s where s.user_id=p.user_id)
 where p.auth_user_id is null and (select count(*) from profile_auth_sessions s where s.user_id=p.user_id)=1;

create or replace function upsert_push_token(p_token text,p_platform text)
returns void language plpgsql volatile security definer set search_path=public as $$
declare actor uuid:=real_current_profile_id();fam uuid:=current_family_id();device uuid:=auth.uid();
begin
 if actor is null or fam is null or device is null then raise exception 'no active profile found for this session'; end if;
 if p_platform not in ('ios','android','web','unknown') or nullif(trim(p_token),'') is null then raise exception 'invalid push token'; end if;
 insert into push_tokens(user_id,family_id,token,platform,is_active,last_error,auth_user_id) values(actor,fam,p_token,p_platform,true,null,device)
 on conflict(token) do update set user_id=excluded.user_id,family_id=excluded.family_id,platform=excluded.platform,is_active=true,last_error=null,auth_user_id=excluded.auth_user_id,updated_at=now();
end; $$;
revoke all on function upsert_push_token(text,text) from public,anon;
grant execute on function upsert_push_token(text,text) to authenticated;

create or replace function upsert_web_push_subscription(p_endpoint text,p_p256dh text,p_auth text)
returns void language plpgsql volatile security definer set search_path=public as $$
declare actor uuid:=real_current_profile_id();fam uuid:=current_family_id();device uuid:=auth.uid();
begin
 if device is null or actor is null or fam is null then raise exception 'no active profile found for this session'; end if;
 if not exists(select 1 from users where id=actor and family_id=fam and removed_at is null) then raise exception 'active profile does not belong to current family'; end if;
 if nullif(trim(p_endpoint),'') is null or nullif(trim(p_p256dh),'') is null or nullif(trim(p_auth),'') is null then raise exception 'invalid web push subscription'; end if;
 insert into web_push_subscriptions(user_id,family_id,endpoint,p256dh,auth,is_active,last_error,auth_user_id) values(actor,fam,p_endpoint,p_p256dh,p_auth,true,null,device)
 on conflict(endpoint) do update set user_id=excluded.user_id,family_id=excluded.family_id,p256dh=excluded.p256dh,auth=excluded.auth,is_active=true,last_error=null,auth_user_id=excluded.auth_user_id,updated_at=now();
end; $$;
revoke all on function upsert_web_push_subscription(text,text,text) from public,anon;
grant execute on function upsert_web_push_subscription(text,text,text) to authenticated;

create or replace function remote_gps_device_notification_context(p_command_id uuid)
returns table(target_user_id uuid,target_auth_user_id uuid,walk_id uuid)
language plpgsql security definer set search_path=public as $$
begin
 if current_family_id() is null or not is_family_admin(current_family_id()) then raise exception 'admin required'; end if;
 return query select c.target_user_id,c.target_auth_user_id,c.walk_id from remote_gps_commands c
  where c.id=p_command_id and c.family_id=current_family_id() and c.requested_by_user_id=real_current_profile_id()
   and c.status='pending' and c.expires_at>now();
end; $$;
revoke all on function remote_gps_device_notification_context(uuid) from public,anon;
grant execute on function remote_gps_device_notification_context(uuid) to authenticated;
