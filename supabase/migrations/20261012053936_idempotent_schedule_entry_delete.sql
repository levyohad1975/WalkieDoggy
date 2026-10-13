-- Safely replay queued schedule-entry deletes that already completed.
-- A plain DELETE ... RETURNING returns zero rows for both an absent row and an
-- RLS-hidden row. This RPC checks the server-derived active family before
-- mutating, and never reports a foreign-family row as a successful delete.
create or replace function public.delete_schedule_entry_idempotent(p_entry_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_family_id uuid;
  v_target_family_id uuid;
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated family context required';
  end if;

  v_family_id := public.current_family_id();
  if v_family_id is null then
    raise exception using errcode = '42501', message = 'Active family context required';
  end if;

  if p_entry_id is null then
    raise exception using errcode = '22004', message = 'Schedule entry id is required';
  end if;

  select e.family_id
    into v_target_family_id
    from public.schedule_entries as e
   where e.id = p_entry_id
   for update;

  if not found then
    return 'already_absent';
  end if;

  if v_target_family_id is distinct from v_family_id then
    raise exception using errcode = '42501', message = 'Schedule entry delete is not authorized';
  end if;

  delete from public.schedule_entries as e
   where e.id = p_entry_id
     and e.family_id = v_family_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    -- Another authorized delete may have committed while this request waited.
    return 'already_absent';
  end if;

  return 'deleted';
end;
$function$;

revoke all on function public.delete_schedule_entry_idempotent(uuid) from public, anon, authenticated;
grant execute on function public.delete_schedule_entry_idempotent(uuid) to authenticated;
