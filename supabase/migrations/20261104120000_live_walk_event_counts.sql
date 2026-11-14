-- Live pee/poop counts while a walk is in progress (owner request 2026-11-04).
--
-- Until now the walker's taps on "פיפי"/"קקי" lived only in that phone's
-- localStorage and reached the server at "סיים טיול" (finish_walk_v12), so the
-- rest of the family saw nothing during the walk. This RPC lets the ACTUAL
-- WALKER publish the running totals for their own in-progress walk.
--
-- Scope and safety:
--  * Additive only: one new function, no table/column/policy change.
--  * Only pee_count / poop_count of an in_progress walk of the caller's own
--    family, and only by its actual walker (same walker rule as
--    finish_walk_v12 / append_walk_gps_route_v11). Admins keep recording on
--    their own device exactly as before.
--  * had_pee / had_poop and every other column are untouched; finish_walk_v12
--    still writes the authoritative final counts and flags at completion.
--  * Absolute totals, not increments: a retried or out-of-order call can never
--    double count. Bounded to a sane range.

create or replace function public.record_walk_event_counts_v1(
  p_walk_id uuid,
  p_pee_count integer,
  p_poop_count integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  w public.walks;
  actor uuid := public.real_current_profile_id();
begin
  if auth.uid() is null or actor is null then raise exception 'active profile required'; end if;
  if p_pee_count is null or p_poop_count is null then raise exception 'counts required'; end if;
  if p_pee_count < 0 or p_poop_count < 0 or p_pee_count > 100 or p_poop_count > 100 then
    raise exception 'event count out of range';
  end if;

  select * into w from public.walks
    where id = p_walk_id and family_id = public.current_family_id()
    for update;
  if not found or w.status <> 'in_progress' or w.duplicate_resolution_group_id is not null then
    raise exception 'active walk not found';
  end if;
  if coalesce(w.actual_walker_user_id, w.responsible_user_id) is distinct from actor then
    raise exception 'only the actual walker can record live walk events';
  end if;

  if w.pee_count is not distinct from p_pee_count and w.poop_count is not distinct from p_poop_count then
    return;
  end if;

  perform set_config('app.trusted_write', 'on', true);
  update public.walks
    set pee_count = p_pee_count,
        poop_count = p_poop_count
    where id = w.id;
end;
$$;

revoke all on function public.record_walk_event_counts_v1(uuid, integer, integer) from public, anon;
grant execute on function public.record_walk_event_counts_v1(uuid, integer, integer) to authenticated;

comment on function public.record_walk_event_counts_v1(uuid, integer, integer) is
  'Actual walker publishes running pee/poop totals for their own in-progress walk. finish_walk_v12 remains authoritative at completion.';
