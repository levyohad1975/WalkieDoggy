-- 0019_request_result_seen_state.sql
-- Persist requester read-state for recent approved/rejected request outcomes.
-- The bell badge can now represent both actionable incoming requests and a
-- new result for a request the current profile created. Read-state is stored
-- on the existing request rows, so the already-configured Realtime streams
-- for these two tables propagate it across the user's devices automatically.

alter table walk_swap_requests
  add column if not exists requester_seen_at timestamptz;

alter table time_change_requests
  add column if not exists requester_seen_at timestamptz;

create or replace function mark_my_request_results_seen()
returns void as $$
declare
  me uuid;
  my_family uuid;
begin
  me := current_profile_id();
  my_family := current_family_id();

  if me is null or my_family is null then
    raise exception 'no active profile claimed on this family';
  end if;

  -- Only terminal results that still belong to the active 24-hour inbox are
  -- acknowledged. Pending requests remain actionable and therefore keep
  -- their badge until resolved; old archived results never create a badge.
  update walk_swap_requests
  set requester_seen_at = now()
  where family_id = my_family
    and requested_by_user_id = me
    and status in ('approved', 'rejected')
    and resolved_at is not null
    and resolved_at >= now() - interval '24 hours'
    and requester_seen_at is null;

  update time_change_requests
  set requester_seen_at = now()
  where family_id = my_family
    and requested_by_user_id = me
    and status in ('approved', 'rejected')
    and resolved_at is not null
    and resolved_at >= now() - interval '24 hours'
    and requester_seen_at is null;
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function mark_my_request_results_seen() from public;
grant execute on function mark_my_request_results_seen() to authenticated;
