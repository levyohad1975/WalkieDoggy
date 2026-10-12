-- Preserve walk history and GPS data when schedule entries are removed.
alter table public.walks drop constraint if exists walks_schedule_entry_id_fkey;
alter table public.walks add constraint walks_schedule_entry_id_fkey
  foreign key (schedule_entry_id) references public.schedule_entries(id) on delete set null;
comment on constraint walks_schedule_entry_id_fkey on public.walks is
  'Schedule-entry deletion detaches walks instead of cascading into walk history or GPS data.';

create or replace function public.delete_schedule_entry_idempotent(p_entry_id uuid)
returns text language plpgsql security definer set search_path = ''
as $function$
declare v_family_id uuid; v_target_family_id uuid; v_deleted integer;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Authenticated family context required'; end if;
  v_family_id := public.current_family_id();
  if v_family_id is null then raise exception using errcode='42501', message='Active family context required'; end if;
  if p_entry_id is null then raise exception using errcode='22004', message='Schedule entry id is required'; end if;
  select e.family_id into v_target_family_id from public.schedule_entries e where e.id=p_entry_id for update;
  if not found then return 'already_absent'; end if;
  if v_target_family_id is distinct from v_family_id then
    raise exception using errcode='42501', message='Schedule entry delete is not authorized';
  end if;

  -- Only ordinary pending occurrences are deleted. Any GPS-bearing walk is
  -- retained even when its status is unexpectedly still pending.
  delete from public.walks w
   where w.family_id=v_family_id and w.schedule_entry_id=p_entry_id and w.status='pending'
     and not exists(select 1 from public.walk_gps_sessions gps where gps.walk_id=w.id);
  update public.walks w set schedule_entry_id=null
   where w.family_id=v_family_id and w.schedule_entry_id=p_entry_id;
  delete from public.schedule_entries e where e.id=p_entry_id and e.family_id=v_family_id;
  get diagnostics v_deleted=row_count;
  if v_deleted=0 then return 'already_absent'; end if;
  return 'deleted';
end;
$function$;
revoke all on function public.delete_schedule_entry_idempotent(uuid) from public, anon, authenticated;
grant execute on function public.delete_schedule_entry_idempotent(uuid) to authenticated;

create or replace function public.admin_delete_schedule_rule(p_rule_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare fid uuid; deleted_entries integer;
begin
  fid:=current_family_id();
  if fid is null or not is_family_admin(fid) then raise exception 'family admin required'; end if;
  if not exists(select 1 from schedule_rules where id=p_rule_id and family_id=fid) then
    raise exception 'schedule rule not found';
  end if;
  -- Detach all historical/GPS-bearing walks, including anomalous pending
  -- rows with GPS. Remove only ordinary pending future occurrences.
  update walks w set schedule_entry_id=null
   where w.family_id=fid
     and exists(select 1 from schedule_entries e where e.id=w.schedule_entry_id and e.rule_id=p_rule_id and e.family_id=fid)
     and not (w.status='pending' and not exists(select 1 from walk_gps_sessions gps where gps.walk_id=w.id));
  delete from walks w
   where w.family_id=fid and w.status='pending'
     and exists(select 1 from schedule_entries e where e.id=w.schedule_entry_id and e.rule_id=p_rule_id and e.family_id=fid)
     and not exists(select 1 from walk_gps_sessions gps where gps.walk_id=w.id);
  delete from schedule_entries e where e.family_id=fid and e.rule_id=p_rule_id;
  get diagnostics deleted_entries=row_count;
  delete from schedule_rules where id=p_rule_id and family_id=fid;
  return jsonb_build_object('ok',true,'deleted_entries',deleted_entries);
end;
$function$;
revoke all on function public.admin_delete_schedule_rule(uuid) from public, anon;
grant execute on function public.admin_delete_schedule_rule(uuid) to authenticated;

-- Disable the obsolete no-confirmation overload; the current app calls
-- admin_reset_family_activity(true).
do $revoke_legacy_reset$
begin
  if to_regprocedure('public.admin_reset_family_activity()') is not null then
    execute 'revoke all on function public.admin_reset_family_activity() from public, anon, authenticated';
  end if;
end;
$revoke_legacy_reset$;
notify pgrst, 'reload schema';
