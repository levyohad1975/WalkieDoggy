-- Durable walk lifecycle: pending -> in_progress -> done/skipped.
-- Family admins may start/end any family walk; regular members only their assigned walk.

alter table walks add column if not exists started_at timestamptz;
alter table walks add column if not exists started_by_user_id uuid references users(id);
alter table walks add column if not exists ended_by_user_id uuid references users(id);

alter table walks drop constraint if exists walks_status_check;
alter table walks add constraint walks_status_check
  check (status in ('pending','in_progress','done','skipped'));

create or replace function start_walk(target_walk_id uuid)
returns walks
language plpgsql
security definer
set search_path = public
as $$
declare
  w walks;
  actor uuid;
begin
  actor := current_profile_id();
  if actor is null then raise exception 'no active profile found for this session'; end if;

  select * into w from walks where id = target_walk_id for update;
  if not found then raise exception 'walk not found'; end if;
  if w.status <> 'pending' then raise exception 'walk is not pending'; end if;
  if not is_family_admin(w.family_id) and w.responsible_user_id is distinct from actor then
    raise exception 'only the responsible member (or an admin) may start this walk';
  end if;

  perform set_config('app.trusted_write','on',true);
  update walks set
    status='in_progress',
    started_at=now(),
    started_by_user_id=actor,
    updated_at=now()
  where id=target_walk_id
  returning * into w;
  return w;
end;
$$;

create or replace function finish_walk(
  target_walk_id uuid,
  actual_walker_id uuid default null,
  p_had_pee boolean default null,
  p_had_poop boolean default null,
  p_note text default null,
  p_completed_at timestamptz default null
)
returns walks
language plpgsql
security definer
set search_path = public
as $$
declare
  w walks;
  actor uuid;
  walker uuid;
begin
  actor := current_profile_id();
  if actor is null then raise exception 'no active profile found for this session'; end if;

  select * into w from walks where id=target_walk_id for update;
  if not found then raise exception 'walk not found'; end if;
  if w.status <> 'in_progress' then raise exception 'walk is not in progress'; end if;
  if not is_family_admin(w.family_id) and w.responsible_user_id is distinct from actor then
    raise exception 'only the responsible member (or an admin) may finish this walk';
  end if;

  walker := coalesce(actual_walker_id, w.responsible_user_id);
  if not exists(select 1 from users u where u.id=walker and u.family_id=w.family_id and u.removed_at is null) then
    raise exception 'actual walker must be an active member of this family';
  end if;

  perform set_config('app.trusted_write','on',true);
  update walks set
    status='done',
    completed_at=now(),
    completed_by_user_id=walker,
    ended_by_user_id=actor,
    had_pee=p_had_pee,
    had_poop=p_had_poop,
    note=p_note,
    duration_minutes=greatest(0, round(extract(epoch from (now()-started_at))/60.0)::int),
    updated_at=now()
  where id=target_walk_id
  returning * into w;
  return w;
end;
$$;

grant execute on function start_walk(uuid) to authenticated;
grant execute on function finish_walk(uuid,uuid,boolean,boolean,text) to authenticated;
