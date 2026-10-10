-- Preserve recurring schedule anchors when resetting family activity.
-- 0100 regressed this by deleting schedule_entries, causing scheduleStore's
-- self-healing/backfill to recreate the just-reset walk occurrences.
-- Activity history (walks and cascading GPS/request/reminder rows) is removed;
-- family, members, dogs, schedule_rules and schedule_entries remain intact.
create or replace function public.admin_reset_family_activity(p_confirm boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
  deleted_walks integer;
begin
  if p_confirm is distinct from true then
    raise exception 'explicit confirmation required';
  end if;

  fid := current_family_id();
  if fid is null or not is_family_admin(fid) then
    raise exception 'family admin required';
  end if;

  delete from walks where family_id = fid;
  get diagnostics deleted_walks = row_count;

  return jsonb_build_object('ok', true, 'deleted_walks', deleted_walks);
end;
$$;

revoke all on function public.admin_reset_family_activity(boolean) from public, anon;
grant execute on function public.admin_reset_family_activity(boolean) to authenticated;
notify pgrst, 'reload schema';
