-- Cancel an accidentally-started active walk.
-- Scheduled walks return to pending. Spontaneous/unplanned active walks are removed.
-- GPS is client-side assistive state and is explicitly discarded by gpsStore; no GPS session is written on cancel.
create or replace function cancel_walk(target_walk_id uuid)
returns walks
language plpgsql
security definer
set search_path = public
as $$
declare
  w walks;
  actor uuid;
  restored walks;
begin
  actor := current_profile_id();
  if actor is null then raise exception 'no active profile found for this session'; end if;

  select * into w from walks where id = target_walk_id for update;
  if not found then raise exception 'walk not found'; end if;
  if w.status <> 'in_progress' then raise exception 'walk is not in progress'; end if;
  if not is_family_admin(w.family_id) and w.responsible_user_id is distinct from actor then
    raise exception 'only the responsible member (or an admin) may cancel this walk';
  end if;

  perform set_config('app.trusted_write','on',true);

  if coalesce(w.is_unplanned, false) and w.schedule_entry_id is null then
    delete from walks where id = target_walk_id;
    return null;
  end if;

  update walks set
    status='pending',
    started_at=null,
    started_by_user_id=null,
    completed_at=null,
    completed_by_user_id=null,
    ended_by_user_id=null,
    duration_minutes=null,
    updated_at=now()
  where id=target_walk_id
  returning * into restored;

  return restored;
end;
$$;

grant execute on function cancel_walk(uuid) to authenticated;
