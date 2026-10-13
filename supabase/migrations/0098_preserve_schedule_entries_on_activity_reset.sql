-- Keep recurring schedule configuration/entries during an activity reset.
-- The previous reset deleted schedule_entries as well as walks. scheduleStore.load()
-- correctly interpreted the now-missing entries as a backfill gap and immediately
-- regenerated tomorrow's/future walk occurrences, making "delete all walks" appear
-- not to work.
--
-- Schedule entries are configuration-derived anchors, not activity history. Keeping
-- them preserves the routine without causing deleted walk occurrences to reappear.
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

  -- Deliberately preserve schedule_entries and schedule_rules. Existing entries
  -- prevent client self-healing from recreating the just-deleted occurrences.
  return jsonb_build_object('ok', true, 'deleted_walks', deleted_walks);
end;
$$;

revoke all on function public.admin_reset_family_activity(boolean) from public, anon;
grant execute on function public.admin_reset_family_activity(boolean) to authenticated;
notify pgrst, 'reload schema';
