-- Disposable real-Postgres regression rehearsal. All writes roll back.
do $local_only$
begin
 if current_database()<>'postgres' or coalesce(inet_server_addr()::text,'')<>'127.0.0.1' or current_setting('port')<>'54322' then
  raise exception 'Fixture is restricted to isolated local Supabase on 127.0.0.1:54322';
 end if;
end;$local_only$;
begin;
do $fixture$
declare
 fam uuid:=gen_random_uuid(); auth_user uuid:=gen_random_uuid(); prof uuid:=gen_random_uuid(); dogid uuid:=gen_random_uuid();
 r1 uuid:=gen_random_uuid(); ed uuid:=gen_random_uuid(); es uuid:=gen_random_uuid(); ep uuid:=gen_random_uuid(); eg uuid:=gen_random_uuid();
 wd uuid:=gen_random_uuid(); ws uuid:=gen_random_uuid(); wp uuid:=gen_random_uuid(); wg uuid:=gen_random_uuid(); gd uuid:=gen_random_uuid(); gg uuid:=gen_random_uuid();
 rr uuid:=gen_random_uuid(); er uuid:=gen_random_uuid(); wr uuid:=gen_random_uuid(); gr uuid:=gen_random_uuid();
 rd uuid:=gen_random_uuid(); red uuid:=gen_random_uuid(); res uuid:=gen_random_uuid(); rep uuid:=gen_random_uuid(); reg uuid:=gen_random_uuid();
 wred uuid:=gen_random_uuid(); wres uuid:=gen_random_uuid(); wrep uuid:=gen_random_uuid(); wreg uuid:=gen_random_uuid();
 gred uuid:=gen_random_uuid(); greg uuid:=gen_random_uuid();
 rraw uuid:=gen_random_uuid(); eraw uuid:=gen_random_uuid(); wraw uuid:=gen_random_uuid(); graw uuid:=gen_random_uuid();
 pts jsonb:='[{"lat":31.0,"lng":34.0,"at":"2026-10-12T12:00:00Z"}]'::jsonb; result text;
begin
 perform set_config('request.jwt.claim.sub',auth_user::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_user,'role','authenticated')::text,true);
 insert into public.families(id,name,invite_code) values(fam,'Isolated schedule-delete fixture','fixture-'||replace(fam::text,'-',''));
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(auth_user,'authenticated','authenticated','fixture-'||replace(auth_user::text,'-','')||'@example.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
 insert into public.family_auth_members(auth_user_id,family_id,role) values(auth_user,fam,'admin');
 insert into public.users(id,family_id,auth_user_id,name) values(prof,fam,auth_user,'Fixture Admin');
 insert into public.dogs(id,family_id,name) values(dogid,fam,'Fixture Dog');
 insert into public.schedule_rules(id,family_id,dog_id,time,days_of_week,rotation_user_ids,rotation_anchor_date) values
 (r1,fam,dogid,'09:00',array[0,1,2,3,4,5,6],array[prof],current_date),
 (rr,fam,dogid,'10:00',array[0,1,2,3,4,5,6],array[prof],current_date),
 (rd,fam,dogid,'11:00',array[0,1,2,3,4,5,6],array[prof],current_date),
 (rraw,fam,dogid,'12:00',array[0,1,2,3,4,5,6],array[prof],current_date);
 insert into public.schedule_entries(id,family_id,dog_id,rule_id,date,time,responsible_user_id) values
 (ed,fam,dogid,r1,current_date,'09:00',prof),(es,fam,dogid,r1,current_date+1,'09:00',prof),
 (ep,fam,dogid,r1,current_date+2,'09:00',prof),(eg,fam,dogid,r1,current_date+3,'09:00',prof),
 (er,fam,dogid,rr,current_date,'10:00',prof),
 (red,fam,dogid,rd,current_date+1,'11:00',prof),(res,fam,dogid,rd,current_date+2,'11:00',prof),
 (rep,fam,dogid,rd,current_date+3,'11:00',prof),(reg,fam,dogid,rd,current_date+4,'11:00',prof),
 (eraw,fam,dogid,rraw,current_date,'12:00',prof);
 insert into public.walks(id,family_id,schedule_entry_id,dog_id,date,scheduled_time,responsible_user_id,status,started_at,completed_at) values
 (wd,fam,ed,dogid,current_date,'09:00',prof,'done',now()-interval '20 min',now()-interval '10 min'),
 (ws,fam,es,dogid,current_date+1,'09:00',prof,'skipped',null,now()),
 (wp,fam,ep,dogid,current_date+2,'09:00',prof,'pending',null,null),
 (wg,fam,eg,dogid,current_date+3,'09:00',prof,'pending',null,null),
 (wr,fam,er,dogid,current_date,'10:00',prof,'pending',null,null),
 (wred,fam,red,dogid,current_date+1,'11:00',prof,'done',now()-interval '20 min',now()-interval '10 min'),
 (wres,fam,res,dogid,current_date+2,'11:00',prof,'skipped',null,now()),
 (wrep,fam,rep,dogid,current_date+3,'11:00',prof,'pending',null,null),
 (wreg,fam,reg,dogid,current_date+4,'11:00',prof,'pending',null,null),
 (wraw,fam,eraw,dogid,current_date,'12:00',prof,'done',now()-interval '20 min',now()-interval '10 min');
 insert into public.walk_gps_sessions(id,walk_id,family_id,dog_id,distance_meters,point_count,route_points,created_by_user_id) values
 (gd,wd,fam,dogid,120,2,pts,prof),(gg,wg,fam,dogid,40,1,pts,prof),(gr,wr,fam,dogid,75,2,pts,prof),
 (gred,wred,fam,dogid,130,2,pts,prof),(greg,wreg,fam,dogid,30,1,pts,prof),(graw,wraw,fam,dogid,55,2,pts,prof);

 result:=public.delete_schedule_entry_idempotent(ed);
 if result<>'deleted' or not exists(select 1 from public.walks where id=wd and status='done' and schedule_entry_id is null)
   or not exists(select 1 from public.walk_gps_sessions where id=gd and walk_id=wd and route_points=pts) then raise exception 'completed history/GPS lost'; end if;
 result:=public.delete_schedule_entry_idempotent(ed);
 if result<>'already_absent' then raise exception 'repeated entry delete not idempotent'; end if;
 result:=public.delete_schedule_entry_idempotent(es);
 if result<>'deleted' or not exists(select 1 from public.walks where id=ws and status='skipped' and schedule_entry_id is null) then raise exception 'skipped history lost'; end if;
 result:=public.delete_schedule_entry_idempotent(ep);
 if result<>'deleted' or exists(select 1 from public.walks where id=wp) then raise exception 'ordinary pending occurrence not removed'; end if;
 result:=public.delete_schedule_entry_idempotent(eg);
 if result<>'deleted' or not exists(select 1 from public.walks where id=wg and schedule_entry_id is null)
   or not exists(select 1 from public.walk_gps_sessions where id=gg and walk_id=wg and route_points=pts) then raise exception 'pending GPS walk/session lost'; end if;

 perform public.admin_reschedule_walk(wr,'10:30');
 perform public.admin_reschedule_walk(wr,'10:30');
 if not exists(select 1 from public.walks where id=wr and schedule_entry_id=er and scheduled_time='10:30')
   or not exists(select 1 from public.schedule_entries where id=er and time='10:30')
   or not exists(select 1 from public.walk_gps_sessions where id=gr and walk_id=wr) then raise exception 'reschedule not stable'; end if;

 result:=public.delete_schedule_rule_idempotent(rd);
 if result<>'deleted' or exists(select 1 from public.schedule_rules where id=rd) or exists(select 1 from public.schedule_entries where rule_id=rd)
   or exists(select 1 from public.walks where id=wrep) then raise exception 'rule delete/pending cleanup failed'; end if;
 if (select count(*) from public.walks where id in (wred,wres,wreg) and schedule_entry_id is null)<>3
   or (select count(*) from public.walk_gps_sessions where id in (gred,greg) and route_points=pts)<>2 then raise exception 'rule deletion lost history/GPS'; end if;
 result:=public.delete_schedule_rule_idempotent(rd);
 if result<>'already_absent' then raise exception 'repeated rule delete not idempotent'; end if;

 delete from public.schedule_entries where id=eraw;
 if not exists(select 1 from public.walks where id=wraw and schedule_entry_id is null)
   or not exists(select 1 from public.walk_gps_sessions where id=graw and route_points=pts) then raise exception 'FK direct delete cascaded history'; end if;
 if (select confdeltype from pg_constraint where conname='walks_schedule_entry_id_fkey' and conrelid='public.walks'::regclass)<>'n' then raise exception 'FK is not ON DELETE SET NULL'; end if;
 if has_function_privilege('authenticated','public.admin_reset_family_activity()','EXECUTE') then raise exception 'legacy no-confirmation reset still executable'; end if;
 raise notice 'isolated deletion, reschedule, repeated execution, history and GPS checks passed';
end;
$fixture$;
rollback;
