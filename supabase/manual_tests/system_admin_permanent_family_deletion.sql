-- Isolated CI-only integration rehearsal. Every family in this test is a
-- deterministic synthetic fixture, and the whole transaction rolls back.
do $guard$
begin
  if current_database()<>'postgres' or current_setting('app.system_admin_family_deletion_fixture',true) is distinct from 'local' then
    raise exception 'family deletion rehearsal requires the isolated local fixture flag';
  end if;
end;
$guard$;

begin;
set local app.trusted_write='on';
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
values
 ('e0000000-0000-4000-8000-000000000101','authenticated','authenticated','family-delete-admin@example.test',now(),'{}','{}',now(),now(),false),
 ('e0000000-0000-4000-8000-000000000102','authenticated','authenticated','family-delete-other@example.test',now(),'{}','{}',now(),now(),false)
on conflict(id) do nothing;
insert into public.system_admins(auth_user_id) values('e0000000-0000-4000-8000-000000000101') on conflict do nothing;
insert into public.families(id,name,invite_code) values
 ('e1000000-0000-4000-8000-000000000101','Synthetic delete target','DELTEST1'),
 ('e1000000-0000-4000-8000-000000000102','Synthetic protected neighbor','DELTEST2');
insert into public.family_auth_members(auth_user_id,family_id,role) values
 ('e0000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101','admin'),
 ('e0000000-0000-4000-8000-000000000102','e1000000-0000-4000-8000-000000000102','admin');
insert into public.users(id,family_id,auth_user_id,name,avatar,color,role) values
 ('e2000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101','e0000000-0000-4000-8000-000000000101','Synthetic Admin','🐶','#111111','admin'),
 ('e2000000-0000-4000-8000-000000000102','e1000000-0000-4000-8000-000000000102','e0000000-0000-4000-8000-000000000102','Protected Neighbor','🐕','#222222','admin');
insert into public.profile_auth_sessions(auth_user_id,family_id,user_id) values
 ('e0000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101','e2000000-0000-4000-8000-000000000101'),
 ('e0000000-0000-4000-8000-000000000102','e1000000-0000-4000-8000-000000000102','e2000000-0000-4000-8000-000000000102');
insert into public.dogs(id,family_id,name) values
 ('e3000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101','Synthetic Dog'),
 ('e3000000-0000-4000-8000-000000000102','e1000000-0000-4000-8000-000000000102','Protected Dog');
insert into public.schedule_entries(id,family_id,dog_id,date,time,responsible_user_id) values
 ('e4000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101','e3000000-0000-4000-8000-000000000101',current_date,'08:00','e2000000-0000-4000-8000-000000000101');
insert into public.walks(id,family_id,schedule_entry_id,dog_id,date,scheduled_time,responsible_user_id,status) values
 ('e5000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101','e4000000-0000-4000-8000-000000000101','e3000000-0000-4000-8000-000000000101',current_date,'08:00','e2000000-0000-4000-8000-000000000101','done');
insert into public.walk_gps_sessions(id,walk_id,family_id,dog_id,distance_meters,point_count) values
 ('e6000000-0000-4000-8000-000000000101','e5000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101','e3000000-0000-4000-8000-000000000101',125,4);
insert into public.chat_conversations(id,kind,family_id,created_by_user_id) values
 ('e7000000-0000-4000-8000-000000000101','family','e1000000-0000-4000-8000-000000000101','e2000000-0000-4000-8000-000000000101');
insert into public.chat_conversation_members(conversation_id,user_id,family_id) values
 ('e7000000-0000-4000-8000-000000000101','e2000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101');
insert into public.chat_messages(id,conversation_id,family_id,sender_user_id,body) values
 ('e8000000-0000-4000-8000-000000000101','e7000000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000101','e2000000-0000-4000-8000-000000000101','synthetic secret message');
insert into public.audit_log(family_id,actor_user_id,action,target_type,target_id,metadata) values
 ('e1000000-0000-4000-8000-000000000101','e2000000-0000-4000-8000-000000000101','walk.updated','walk','e5000000-0000-4000-8000-000000000101','{"private":"fixture"}');
insert into public.system_activity_audit_log(family_id,actor_auth_user_id,actor_user_id,action,entity_type,entity_id,metadata) values
 ('e1000000-0000-4000-8000-000000000101','e0000000-0000-4000-8000-000000000101','e2000000-0000-4000-8000-000000000101','walks.update','walks','e5000000-0000-4000-8000-000000000101','{"private":"fixture"}');
insert into public.system_audit_log(actor_auth_user_id,action,target_type,target_id,metadata) values
 ('e0000000-0000-4000-8000-000000000101','family.viewed','family','e1000000-0000-4000-8000-000000000101','{"private":"fixture"}');
set local app.trusted_write='off';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000101","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000101',true);

do $double_confirm$
begin
  perform public.system_admin_begin_family_deletion('e1000000-0000-4000-8000-000000000101','wrong name','DELETE FAMILY PERMANENTLY','{}'::jsonb);
  raise exception 'incorrect family name was accepted';
exception when others then
  if sqlerrm not like '%family name confirmation does not match%' then raise; end if;
end;
$double_confirm$;

do $begin$
declare impact jsonb;
begin
  impact:=public.system_admin_family_deletion_impact('e1000000-0000-4000-8000-000000000101');
  if impact->>'family_name'<>'Synthetic delete target' or (impact->'counts'->>'walks')::int<>1 then raise exception 'impact manifest omitted synthetic family data'; end if;
  perform public.system_admin_begin_family_deletion('e1000000-0000-4000-8000-000000000101','Synthetic delete target','DELETE FAMILY PERMANENTLY',impact->'counts');
  begin
    insert into public.dogs(family_id,name) values('e1000000-0000-4000-8000-000000000101','stale queue replay');
    raise exception 'deleting-family write was accepted';
  exception when check_violation then null; end;
  perform public.system_admin_finalize_family_deletion('e1000000-0000-4000-8000-000000000101');
end;
$begin$;

-- Verify the neighboring fixture as the trusted rehearsal connection; the
-- authenticated System Admin's normal family RLS correctly hides it.
reset role;
do $verify$
begin
  if exists(select 1 from public.families where id='e1000000-0000-4000-8000-000000000101') then raise exception 'target family remains'; end if;
  if not exists(select 1 from public.families where id='e1000000-0000-4000-8000-000000000102') then raise exception 'unrelated family was changed'; end if;
  if not exists(select 1 from auth.users where id='e0000000-0000-4000-8000-000000000101') then raise exception 'shared auth identity was deleted'; end if;
  if not exists(select 1 from public.system_admins where auth_user_id='e0000000-0000-4000-8000-000000000101') then raise exception 'System Admin access was deleted'; end if;
  if not exists(select 1 from public.family_deletion_tombstones where family_id='e1000000-0000-4000-8000-000000000101' and state='deleted') then raise exception 'deletion tombstone missing'; end if;
  if not public.was_family_permanently_deleted('e1000000-0000-4000-8000-000000000101') then raise exception 'deleted-family probe failed'; end if;
  if exists(select 1 from public.dogs where family_id='e1000000-0000-4000-8000-000000000102') is false then raise exception 'unrelated dog was changed'; end if;
  if not exists(select 1 from public.audit_log where action='walk.updated' and family_id is null and target_id is null and metadata->>'family_content_redacted'='true') then raise exception 'family audit evidence was not preserved in redacted form'; end if;
  if not exists(select 1 from public.system_activity_audit_log where action='walks.update' and family_id is null and entity_id is null and metadata->>'family_content_redacted'='true') then raise exception 'state-change audit evidence was not preserved in redacted form'; end if;
  if not exists(select 1 from public.system_audit_log where action='family.viewed' and target_id='e1000000-0000-4000-8000-000000000101' and metadata->>'family_content_redacted'='true') then raise exception 'system audit evidence was not redacted/preserved'; end if;
  begin
    insert into public.families(id,name,invite_code) values('e1000000-0000-4000-8000-000000000101','reused','DELREUSE');
    raise exception 'deleted family ID reuse was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.dogs(family_id,name) values('e1000000-0000-4000-8000-000000000101','stale replay');
    raise exception 'stale family write was accepted';
  exception when check_violation or foreign_key_violation then null; end;
end;
$verify$;
reset role;
rollback;
