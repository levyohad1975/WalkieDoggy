-- Close a walk that was left running (owner request 2026-11-16).
--
-- A walk started late one evening was never finished; it stayed active on
-- the server and blocked every new start the next morning. The 30-minute
-- "still active?" push (claim_walks_running_long) asks the walker, but
-- nothing closes the walk if nobody answers.
--
-- Rule (owner's choice: "an hour + no activity"):
--   * the walk started at least 60 minutes ago, and
--   * nothing happened for the last 30 minutes: no GPS point, no GPS
--     heartbeat from the walker's phone, no pee/poop tap (every such change
--     touches walks.updated_at, walk_gps_ownership.updated_at or a route
--     sample).
-- A long walk that is really happening keeps sending GPS/heartbeats, so it
-- is never closed under the walker.
--
-- The walk is finished like finish_walk_v12 would, as the walker:
--   completed_at = the last sign of life, but at least 20 minutes after the
--   start (a typical walk) and never later than now; duration accordingly;
--   pee/poop from the live counts; GPS ownership ended; a lifecycle event
--   'auto_finished'. walks.auto_closed_at marks it, so History can say
--   "נסגר אוטומטית" and the walker can correct it there.
--
-- Called only by the send-walk-reminders cron (service role), which pushes
-- the walker once. No client can call it.

alter table public.walks add column if not exists auto_closed_at timestamptz;

alter table public.walk_lifecycle_events drop constraint if exists walk_lifecycle_events_action_check;
alter table public.walk_lifecycle_events add constraint walk_lifecycle_events_action_check
  check (action in ('started', 'remotely_started', 'finished', 'remotely_finished', 'gps_owner_changed', 'auto_finished'));

create or replace function public.auto_close_forgotten_walks(
  p_min_age_minutes integer default 60,
  p_idle_minutes integer default 30
)
returns table(walk_id uuid, family_id uuid, recipient_user_id uuid, dog_name text, completed_at timestamptz, completed_local text, duration_minutes integer)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  c record;
  v_walker uuid;
  v_completed timestamptz;
  w public.walks;
begin
  for c in
    select x.id, x.last_activity
    from (
      select w0.id,
             greatest(
               w0.started_at,
               w0.updated_at,
               (select max(s.sampled_at) from public.walk_gps_route_samples_v11 s where s.walk_id = w0.id),
               (select max(o.updated_at) from public.walk_gps_ownership o where o.walk_id = w0.id)
             ) as last_activity
      from public.walks w0
      where w0.status = 'in_progress'
        and w0.duplicate_resolution_group_id is null
        and w0.started_at is not null
        and w0.started_at <= now() - make_interval(mins => greatest(coalesce(p_min_age_minutes, 60), 30))
    ) x
    where x.last_activity <= now() - make_interval(mins => greatest(coalesce(p_idle_minutes, 30), 15))
  loop
    select * into w from public.walks where id = c.id for update skip locked;
    -- Someone may have finished it (or it moved) since the scan.
    if not found or w.status <> 'in_progress' then continue; end if;

    v_walker := coalesce(w.actual_walker_user_id, w.responsible_user_id);
    if v_walker is null then continue; end if;
    v_completed := least(now(), greatest(c.last_activity, w.started_at + interval '20 minutes'));

    perform set_config('app.trusted_write', 'on', true);
    update public.walks set
      status = 'done',
      completed_at = v_completed,
      completed_by_user_id = v_walker,
      ended_by_user_id = null,
      had_pee = case when w.pee_count is not null then w.pee_count > 0 else w.had_pee end,
      had_poop = case when w.poop_count is not null then w.poop_count > 0 else w.had_poop end,
      duration_minutes = greatest(0, round(extract(epoch from (v_completed - w.started_at)) / 60.0)::int),
      auto_closed_at = now(),
      updated_at = now()
    where id = w.id
    returning * into w;
    update public.walk_gps_ownership
       set fencing_epoch = fencing_epoch + 1, ended_at = now(), expires_at = now(), updated_at = now()
     where walk_id = w.id and ended_at is null;
    perform set_config('app.trusted_write', 'off', true);

    insert into public.walk_lifecycle_events(family_id, dog_id, walk_id, action, actor_user_id,
      original_assignee_user_id, current_assignee_user_id, actual_walker_user_id, details)
    values (w.family_id, w.dog_id, w.id, 'auto_finished', v_walker,
      coalesce(w.swap_original_user_id, w.responsible_user_id), w.responsible_user_id, v_walker,
      jsonb_build_object('reason', 'no activity', 'last_activity', c.last_activity));

    walk_id := w.id;
    family_id := w.family_id;
    recipient_user_id := v_walker;
    dog_name := (select d.name from public.dogs d where d.id = w.dog_id);
    completed_at := w.completed_at;
    completed_local := to_char(w.completed_at at time zone coalesce(
      (select f.timezone from public.families f where f.id = w.family_id), 'Asia/Jerusalem'), 'HH24:MI');
    duration_minutes := w.duration_minutes;
    return next;
  end loop;
end $$;
revoke all on function public.auto_close_forgotten_walks(integer, integer) from public, anon, authenticated;
grant execute on function public.auto_close_forgotten_walks(integer, integer) to service_role;
