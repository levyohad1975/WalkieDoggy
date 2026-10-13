-- 0103_mark_results_seen_no_raise.sql
-- Real-device QA fix — "bell opens an error dialog" (Staging-only; never
-- applied to Production without separate explicit approval).
--
-- mark_my_request_results_seen() (migration 0019) raised an exception
-- ('no active profile claimed on this family') whenever current_profile_id()/
-- current_family_id() couldn't resolve an identity for the calling device —
-- the exact same condition touch_last_seen() (migrations/0006_qa_impersonation.sql)
-- already treats as a harmless no-op ("no active claimed profile yet ...
-- nothing to record"). Marking a request result "seen" is the same kind of
-- best-effort, low-stakes housekeeping as presence — never something that
-- should fail loudly for a caller whose identity resolution hit a transient
-- gap. The client-side fix (requestsStore.ts's markResultsSeen() no longer
-- surfaces ANY failure from this RPC as a user-facing error, matching
-- touchLastSeen()'s own established contract) already stops this from ever
-- showing an "אופס" dialog again; this migration brings the RPC itself in
-- line with its sibling's own convention instead of leaving an inconsistency
-- where one identity-housekeeping RPC raises and the other doesn't.
--
-- No authorization change: still SECURITY DEFINER, still only ever updates
-- rows where requested_by_user_id = the CALLER's own resolved identity —
-- a caller with no resolvable identity now simply updates zero rows (a
-- correct, harmless no-op) instead of raising.
create or replace function mark_my_request_results_seen()
returns void as $$
declare
  me uuid;
  my_family uuid;
begin
  me := current_profile_id();
  my_family := current_family_id();

  if me is null or my_family is null then
    return; -- no active claimed profile right now — nothing to mark, same convention as touch_last_seen()
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
