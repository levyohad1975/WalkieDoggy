-- Permanent, resumable System Admin family deletion. Storage bytes are
-- removed through authenticated Storage API calls, never SQL.
create table if not exists public.family_deletion_tombstones (
  family_id uuid primary key,
  state text not null check (state in ('deleting','deleted')),
  initiated_by_auth_user_id uuid references auth.users(id) on delete set null,
  initiated_at timestamptz not null default now(),
  completed_at timestamptz,
  impact_counts jsonb not null default '{}'::jsonb,
  check ((state='deleting' and completed_at is null) or (state='deleted' and completed_at is not null))
);
alter table public.family_deletion_tombstones enable row level security;
revoke all on public.family_deletion_tombstones from public, anon, authenticated;
comment on table public.family_deletion_tombstones is 'Content-free permanent tenant deletion marker. Never store family names, member IDs, message text, paths, or other family content.';

-- Preserve audit event/action/time but detach tenant and remove family payload.
alter table public.audit_log alter column family_id drop not null;
alter table public.audit_log drop constraint if exists audit_log_family_id_fkey;
alter table public.audit_log add constraint audit_log_family_id_fkey foreign key(family_id) references public.families(id) on delete set null;

create or replace function public.system_admin_family_deletion_impact(p_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,storage as $$
declare f public.families%rowtype; t record; n bigint; counts jsonb:='{}'::jsonb; photos bigint; attachments bigint; st text; total bigint:=1;
begin
  if not public.is_verified_system_admin() then raise exception 'verified system admin required'; end if;
  if public.active_system_admin_observer_family() is not null or public.active_impersonation_target() is not null then raise exception 'exit observer or impersonation mode before family deletion'; end if;
  select * into f from public.families where id=p_family_id;
  if not found then
    select state into st from public.family_deletion_tombstones where family_id=p_family_id;
    if st='deleted' then return jsonb_build_object('family_id',p_family_id,'state','deleted','counts','{}'::jsonb,'total_rows',0,'storage_objects',0); end if;
    raise exception 'family not found';
  end if;
  select state into st from public.family_deletion_tombstones where family_id=p_family_id;
  for t in select distinct c.relname table_name from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=c.oid where ns.nspname='public' and c.relkind in ('r','p') and a.attname='family_id' and a.atttypid='uuid'::regtype and not a.attisdropped and c.relname<>'family_deletion_tombstones' order by c.relname loop
    execute format('select count(*) from public.%I where family_id=$1',t.table_name) into n using p_family_id;
    counts:=counts||jsonb_build_object(t.table_name,n); total:=total+n;
  end loop;
  select count(*) into photos from storage.objects o where o.bucket_id='family-photos' and (storage.foldername(o.name))[1]=p_family_id::text;
  select count(*) into attachments from storage.objects o join public.chat_conversations c on c.id=(public.chat_attachment_path_parts(o.name))[1] where o.bucket_id='chat-attachments' and c.family_id=p_family_id;
  counts:=counts||jsonb_build_object('families',1,'storage.family_photos',photos,'storage.chat_attachments',attachments);
  return jsonb_build_object('family_id',f.id,'family_name',f.name,'invite_code',f.invite_code,'approval_status',f.approval_status,'state',coalesce(st,'ready'),'counts',counts,'total_rows',total+photos+attachments,'storage_objects',photos+attachments);
end; $$;
revoke all on function public.system_admin_family_deletion_impact(uuid) from public,anon;
grant execute on function public.system_admin_family_deletion_impact(uuid) to authenticated;

create or replace function public.system_admin_begin_family_deletion(p_family_id uuid,p_confirmation_name text,p_confirmation_phrase text,p_expected_counts jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare f public.families%rowtype; old_t public.family_deletion_tombstones%rowtype; impact jsonb;
begin
  if not public.is_verified_system_admin() then raise exception 'verified system admin required'; end if;
  if public.active_system_admin_observer_family() is not null or public.active_impersonation_target() is not null then raise exception 'exit observer or impersonation mode before family deletion'; end if;
  if p_confirmation_phrase is distinct from 'DELETE FAMILY PERMANENTLY' then raise exception 'explicit second confirmation required'; end if;
  select * into f from public.families where id=p_family_id for update;
  if not found then select * into old_t from public.family_deletion_tombstones where family_id=p_family_id for update; if found and old_t.state='deleted' then return jsonb_build_object('state','deleted','already_deleted',true); end if; raise exception 'family not found'; end if;
  if p_confirmation_name is distinct from f.name then raise exception 'family name confirmation does not match'; end if;
  impact:=public.system_admin_family_deletion_impact(p_family_id);
  if impact->>'state'='deleting' then return jsonb_build_object('state','deleting','resumed',true); end if;
  if p_expected_counts is null or p_expected_counts is distinct from impact->'counts' then raise exception 'family data changed; review impact and confirm again'; end if;
  insert into public.family_deletion_tombstones(family_id,state,initiated_by_auth_user_id,impact_counts) values(p_family_id,'deleting',auth.uid(),impact->'counts')
    on conflict(family_id) do update set state='deleting',initiated_by_auth_user_id=excluded.initiated_by_auth_user_id,initiated_at=now(),completed_at=null,impact_counts=excluded.impact_counts where public.family_deletion_tombstones.state<>'deleted';
  return jsonb_build_object('state','deleting','resumed',false);
end; $$;
revoke all on function public.system_admin_begin_family_deletion(uuid,text,text,jsonb) from public,anon;
grant execute on function public.system_admin_begin_family_deletion(uuid,text,text,jsonb) to authenticated;

create or replace function public.system_admin_list_family_deletion_storage_objects(p_family_id uuid)
returns table(bucket_id text,object_name text) language plpgsql stable security definer set search_path=pg_catalog,public,storage as $$
begin
  if not public.is_verified_system_admin() then raise exception 'verified system admin required'; end if;
  if public.active_system_admin_observer_family() is not null or public.active_impersonation_target() is not null then raise exception 'exit observer or impersonation mode before family deletion'; end if;
  if not exists(select 1 from public.family_deletion_tombstones where family_id=p_family_id and state='deleting') then raise exception 'family deletion is not in progress'; end if;
  return query select o.bucket_id,o.name from storage.objects o where o.bucket_id='family-photos' and (storage.foldername(o.name))[1]=p_family_id::text
  union all select o.bucket_id,o.name from storage.objects o join public.chat_conversations c on c.id=(public.chat_attachment_path_parts(o.name))[1] where o.bucket_id='chat-attachments' and c.family_id=p_family_id order by 1,2;
end; $$;
revoke all on function public.system_admin_list_family_deletion_storage_objects(uuid) from public,anon;
grant execute on function public.system_admin_list_family_deletion_storage_objects(uuid) to authenticated;

create or replace function public.reject_writes_for_deleting_family() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_family_id uuid; v_old_family_id uuid;
begin
 if tg_op='DELETE' then return old; end if;
 if current_setting('app.system_admin_family_deletion',true)='on' and public.is_verified_system_admin() then return new; end if;
 v_family_id:=nullif(to_jsonb(new)->>'family_id','')::uuid;
 if tg_op='UPDATE' then v_old_family_id:=nullif(to_jsonb(old)->>'family_id','')::uuid; end if;
 if exists(select 1 from public.family_deletion_tombstones where family_id in (v_family_id,v_old_family_id) and state in ('deleting','deleted')) then raise exception using errcode='23514',message='family is deleted or permanently locked for deletion'; end if;
 return new;
end; $$;
revoke all on function public.reject_writes_for_deleting_family() from public,anon,authenticated;
do $$ declare t record; begin
 for t in select distinct c.relname table_name from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=c.oid where ns.nspname='public' and c.relkind in ('r','p') and a.attname='family_id' and a.atttypid='uuid'::regtype and not a.attisdropped and c.relname<>'family_deletion_tombstones' loop
  execute format('drop trigger if exists reject_deleting_family_writes on public.%I',t.table_name);
  execute format('create trigger reject_deleting_family_writes before insert or update on public.%I for each row execute function public.reject_writes_for_deleting_family()',t.table_name);
 end loop;
end $$;

create or replace function public.prevent_deleted_family_id_reuse() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin if exists(select 1 from public.family_deletion_tombstones where family_id=new.id) then raise exception using errcode='23514',message='a permanently deleted family id cannot be reused'; end if; return new; end; $$;
revoke all on function public.prevent_deleted_family_id_reuse() from public,anon,authenticated;
drop trigger if exists prevent_deleted_family_id_reuse on public.families;
create trigger prevent_deleted_family_id_reuse before insert on public.families for each row execute function public.prevent_deleted_family_id_reuse();
create or replace function public.reject_updates_to_deleting_family() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if current_setting('app.system_admin_family_deletion',true)='on' and public.is_verified_system_admin() then return new; end if;
 if exists(select 1 from public.family_deletion_tombstones where family_id=old.id and state in ('deleting','deleted')) then raise exception using errcode='23514',message='family is deleted or permanently locked for deletion'; end if;
 return new;
end; $$;
revoke all on function public.reject_updates_to_deleting_family() from public,anon,authenticated;
drop trigger if exists reject_updates_to_deleting_family on public.families;
create trigger reject_updates_to_deleting_family before update on public.families for each row execute function public.reject_updates_to_deleting_family();

create or replace function public.guard_family_storage_upload_during_deletion() returns trigger language plpgsql security definer set search_path=pg_catalog,public,storage as $$
declare v_family_id uuid;
begin
 if new.bucket_id='family-photos' then begin v_family_id:=nullif((storage.foldername(new.name))[1],'')::uuid; exception when invalid_text_representation then v_family_id:=null; end;
 elsif new.bucket_id='chat-attachments' then select c.family_id into v_family_id from public.chat_conversations c where c.id=(public.chat_attachment_path_parts(new.name))[1];
 else return new; end if;
 if v_family_id is not null then perform 1 from public.families f where f.id=v_family_id for key share; if exists(select 1 from public.family_deletion_tombstones where family_id=v_family_id and state in ('deleting','deleted')) then raise exception using errcode='23514',message='family is locked for deletion'; end if; end if;
 return new;
end; $$;
revoke all on function public.guard_family_storage_upload_during_deletion() from public,anon,authenticated;
drop trigger if exists family_deletion_storage_upload_guard on storage.objects;
create trigger family_deletion_storage_upload_guard before insert or update on storage.objects for each row execute function public.guard_family_storage_upload_during_deletion();

-- Suppress row-level audit payloads for bulk deletion; retain normal audit behavior otherwise.
create or replace function public.capture_user_state_change() returns trigger language plpgsql volatile security definer set search_path=public,auth as $$
declare r jsonb; fid uuid; actor uuid; actor_profile uuid; eid text;
begin
 if current_setting('app.system_admin_family_deletion',true)='on' then return case when tg_op='DELETE' then old else new end; end if;
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='families' then fid:=nullif(r->>'id','')::uuid; else begin fid:=nullif(r->>'family_id','')::uuid; exception when invalid_text_representation then fid:=null; end; end if;
 actor:=auth.uid(); if actor is not null and fid is not null then select id into actor_profile from public.users where family_id=fid and auth_user_id=actor order by removed_at nulls first,created_at limit 1; end if;
 eid:=coalesce(nullif(r->>'id',''),nullif(r->>'auth_user_id',''),nullif(r->>'user_id',''),nullif(r->>'walk_id',''));
 insert into public.system_activity_audit_log(family_id,actor_auth_user_id,actor_user_id,action,entity_type,entity_id,metadata) values(fid,actor,actor_profile,lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,eid,jsonb_build_object('operation',tg_op));
 return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.capture_user_state_change() from public,anon,authenticated;

create or replace function public.system_admin_finalize_family_deletion(p_family_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,storage as $$
declare tomb public.family_deletion_tombstones%rowtype; t record; rows_deleted int; progressed boolean; pass int:=0; remaining bigint;
begin
 if not public.is_verified_system_admin() then raise exception 'verified system admin required'; end if;
 if public.active_system_admin_observer_family() is not null or public.active_impersonation_target() is not null then raise exception 'exit observer or impersonation mode before family deletion'; end if;
 select * into tomb from public.family_deletion_tombstones where family_id=p_family_id for update;
 if not found then raise exception 'family deletion has not been started'; end if;
 if tomb.state='deleted' then return jsonb_build_object('state','deleted','already_deleted',true); end if;
 perform 1 from public.families where id=p_family_id for update;
 if not found then raise exception 'family row missing while deletion is pending'; end if;
 select count(*) into remaining from storage.objects o left join public.chat_conversations c on o.bucket_id='chat-attachments' and c.id=(public.chat_attachment_path_parts(o.name))[1]
 where (o.bucket_id='family-photos' and (storage.foldername(o.name))[1]=p_family_id::text) or (o.bucket_id='chat-attachments' and c.family_id=p_family_id);
 if remaining>0 then raise exception 'family storage objects remain; retry object cleanup'; end if;
 perform set_config('app.system_admin_family_deletion','on',true);
 delete from public.walk_duplicate_resolution_items i using public.walk_duplicate_resolution_groups g where i.group_id=g.id and g.family_id=p_family_id;
 update public.walks set duplicate_resolution_group_id=null where family_id=p_family_id;
 delete from public.walk_duplicate_resolution_groups where family_id=p_family_id;
 delete from public.walk_lifecycle_operations o using public.users u where o.actor_user_id=u.id and u.family_id=p_family_id;
 delete from public.chat_attachment_deletions d where exists(select 1 from public.chat_conversations c where c.family_id=p_family_id and c.id=(public.chat_attachment_path_parts(d.path))[1]);
 update public.audit_log set family_id=null,actor_user_id=null,target_type='family_data_redacted',target_id=null,metadata=jsonb_build_object('family_content_redacted',true,'reason','permanent family deletion') where family_id=p_family_id;
 update public.system_activity_audit_log set family_id=null,actor_user_id=null,entity_type='family_data_redacted',entity_id=null,metadata=jsonb_build_object('family_content_redacted',true,'reason','permanent family deletion') where family_id=p_family_id;
 update public.system_audit_log set metadata=jsonb_build_object('family_content_redacted',true,'reason','permanent family deletion') where target_type='family' and target_id=p_family_id;
 for t in select distinct c.relname table_name from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=c.oid where ns.nspname='public' and c.relkind in ('r','p') and a.attname='family_id' and a.atttypid='uuid'::regtype and not a.attisdropped loop
  if exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname=t.table_name and a.attname='id' and a.atttypid='uuid'::regtype and not a.attisdropped) then
   execute format('update public.system_audit_log set target_type=''family_data_redacted'',target_id=null,metadata=jsonb_build_object(''family_content_redacted'',true,''reason'',''permanent family deletion'') where target_id::text in (select id::text from public.%I where family_id=$1)',t.table_name) using p_family_id;
  end if;
 end loop;
 loop
  pass:=pass+1; progressed:=false;
  for t in select distinct c.relname table_name from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=c.oid where ns.nspname='public' and c.relkind in ('r','p') and a.attname='family_id' and a.atttypid='uuid'::regtype and not a.attisdropped and c.relname not in ('family_deletion_tombstones','audit_log','system_activity_audit_log') order by c.relname loop
   begin execute format('delete from public.%I where family_id=$1',t.table_name) using p_family_id; get diagnostics rows_deleted=row_count; if rows_deleted>0 then progressed:=true; end if;
   exception when foreign_key_violation then null; end;
  end loop;
  exit when not progressed;
  if pass>16 then raise exception 'family deletion dependency graph did not converge'; end if;
 end loop;
 for t in select distinct c.relname table_name from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=c.oid where ns.nspname='public' and c.relkind in ('r','p') and a.attname='family_id' and a.atttypid='uuid'::regtype and not a.attisdropped and c.relname not in ('family_deletion_tombstones','audit_log','system_activity_audit_log') loop
  execute format('select count(*) from public.%I where family_id=$1',t.table_name) into remaining using p_family_id; if remaining>0 then raise exception 'family rows remain in table %',t.table_name; end if;
 end loop;
 delete from public.families where id=p_family_id;
 update public.family_deletion_tombstones set state='deleted',completed_at=now() where family_id=p_family_id and state='deleting';
 insert into public.system_audit_log(actor_auth_user_id,action,target_type,target_id,metadata) values(auth.uid(),'family.permanently_deleted','family',p_family_id,jsonb_build_object('impact_counts',tomb.impact_counts,'storage_objects_removed',coalesce((tomb.impact_counts->>'storage.family_photos')::bigint,0)+coalesce((tomb.impact_counts->>'storage.chat_attachments')::bigint,0)));
 return jsonb_build_object('state','deleted','deleted_family_id',p_family_id,'row_counts',tomb.impact_counts);
end; $$;
revoke all on function public.system_admin_finalize_family_deletion(uuid) from public,anon;
grant execute on function public.system_admin_finalize_family_deletion(uuid) to authenticated;

create or replace function public.was_family_permanently_deleted(p_family_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and exists(select 1 from public.family_deletion_tombstones where family_id=p_family_id and state='deleted');
$$;
revoke all on function public.was_family_permanently_deleted(uuid) from public,anon;
grant execute on function public.was_family_permanently_deleted(uuid) to authenticated;

drop policy if exists "System Admin delete family photos during deletion" on storage.objects;
create policy "System Admin delete family photos during deletion" on storage.objects for delete to authenticated using(bucket_id='family-photos' and public.is_verified_system_admin() and exists(select 1 from public.family_deletion_tombstones t where t.family_id::text=(storage.foldername(name))[1] and t.state='deleting'));
drop policy if exists "System Admin delete chat attachments during deletion" on storage.objects;
create policy "System Admin delete chat attachments during deletion" on storage.objects for delete to authenticated using(bucket_id='chat-attachments' and public.is_verified_system_admin() and exists(select 1 from public.chat_conversations c join public.family_deletion_tombstones t on t.family_id=c.family_id and t.state='deleting' where c.id=(public.chat_attachment_path_parts(name))[1]));

-- Retire the narrower QA-only delete endpoint.
create or replace function public.system_admin_delete_test_family(p_family_id uuid,p_confirm text) returns void language plpgsql volatile security definer set search_path=public as $$ begin raise exception 'test family deletion is retired; use the audited permanent family deletion flow'; end; $$;
revoke all on function public.system_admin_delete_test_family(uuid,text) from public,anon,authenticated;
