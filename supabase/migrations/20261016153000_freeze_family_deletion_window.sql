-- Complete the deletion freeze for in-progress families. The first migration
-- rejected inserts and updates, but allowed ordinary deletes while Storage
-- cleanup was resumable. Preserve that deployed history and close the gap
-- additively here.
create or replace function public.reject_writes_for_deleting_family()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_family_id uuid;
  v_old_family_id uuid;
begin
  if current_setting('app.system_admin_family_deletion',true)='on'
     and public.is_verified_system_admin() then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if tg_op='DELETE' then
    v_family_id:=nullif(to_jsonb(old)->>'family_id','')::uuid;
  else
    v_family_id:=nullif(to_jsonb(new)->>'family_id','')::uuid;
    if tg_op='UPDATE' then
      v_old_family_id:=nullif(to_jsonb(old)->>'family_id','')::uuid;
    end if;
  end if;

  if exists (
    select 1
    from public.family_deletion_tombstones
    where family_id in (v_family_id,v_old_family_id)
      and state in ('deleting','deleted')
  ) then
    raise exception using
      errcode='23514',
      message='family is deleted or permanently locked for deletion';
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;

do $$
declare t record;
begin
  for t in
    select distinct c.relname table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.oid
    where ns.nspname='public'
      and c.relkind in ('r','p')
      and a.attname='family_id'
      and a.atttypid='uuid'::regtype
      and not a.attisdropped
      and c.relname<>'family_deletion_tombstones'
  loop
    execute format(
      'drop trigger if exists reject_deleting_family_writes on public.%I',
      t.table_name
    );
    execute format(
      'create trigger reject_deleting_family_writes before insert or update or delete on public.%I for each row execute function public.reject_writes_for_deleting_family()',
      t.table_name
    );
  end loop;
end;
$$;

create or replace function public.reject_deleting_family_row()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if current_setting('app.system_admin_family_deletion',true)='on'
     and public.is_verified_system_admin() then
    return old;
  end if;
  if exists (
    select 1 from public.family_deletion_tombstones
    where family_id=old.id and state in ('deleting','deleted')
  ) then
    raise exception using
      errcode='23514',
      message='family is deleted or permanently locked for deletion';
  end if;
  return old;
end;
$$;

revoke all on function public.reject_deleting_family_row() from public,anon,authenticated;
drop trigger if exists reject_deleting_family_row on public.families;
create trigger reject_deleting_family_row
before delete on public.families
for each row execute function public.reject_deleting_family_row();
