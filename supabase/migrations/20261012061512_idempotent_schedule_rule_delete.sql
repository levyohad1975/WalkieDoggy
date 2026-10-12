-- Safely replay schedule-rule deletes whose target is already absent.
-- Existing rules still use admin_delete_schedule_rule(), preserving its
-- schedule-entry and walk cleanup behavior. Foreign-family targets are denied.
create or replace function public.delete_schedule_rule_idempotent(p_rule_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_family_id uuid;
  v_target_family_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated family context required';
  end if;

  v_family_id := public.current_family_id();
  if v_family_id is null or not public.is_family_admin(v_family_id) then
    raise exception using errcode = '42501', message = 'Active family administrator context required';
  end if;

  if p_rule_id is null then
    raise exception using errcode = '22004', message = 'Schedule rule id is required';
  end if;

  select r.family_id
    into v_target_family_id
    from public.schedule_rules as r
   where r.id = p_rule_id
   for update;

  if not found then
    return 'already_absent';
  end if;

  if v_target_family_id is distinct from v_family_id then
    raise exception using errcode = '42501', message = 'Schedule rule delete is not authorized';
  end if;

  -- Keep the established server-side cleanup for walks and schedule entries.
  perform public.admin_delete_schedule_rule(p_rule_id);
  return 'deleted';
end;
$function$;

revoke all on function public.delete_schedule_rule_idempotent(uuid) from public, anon, authenticated;
grant execute on function public.delete_schedule_rule_idempotent(uuid) to authenticated;
