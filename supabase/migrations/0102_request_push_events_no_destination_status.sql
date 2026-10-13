-- 0102_request_push_events_no_destination_status.sql
--
-- Request-notifications repair — real-device QA + direct Staging
-- inspection found request_push_events rows like
-- "swap / created -> sent, attempt_count 1" and
-- "timeChange / approved -> sent, attempt_count 1" even though
-- web_push_subscriptions had zero active rows for the recipient(s) at that
-- moment (and no push_tokens row either) — i.e. nothing was actually
-- delivered to anyone, yet the event was marked 'sent', the same terminal
-- status a genuinely successful delivery gets.
--
-- Root cause (supabase/functions/send-request-push/index.ts, the
-- "load all active delivery targets BEFORE sending" step): when both
-- expoTokens and webSubscriptions come back empty, the function calls
-- mark_request_push_event(dedupeKey, 'sent') and returns
-- { ok: true, sent: 0, reason: 'no active push destinations' } — correctly
-- reporting sent:0 in its own response, but recording the SAME 'sent'
-- status as an actual delivery in the durable table, which is what made
-- this invisible from a straight read of request_push_events: 'sent' reads
-- as "this worked", not "there was nothing to send to".
--
-- Fix: a new, distinct terminal status 'no_destination'. It is deliberately
-- NOT the same as 'failed' (which claim_request_push_event() already
-- treats as retryable) — resending "X created a swap request" long after
-- the fact, once someone finally subscribes, would be confusing, not
-- helpful, and nothing re-invokes this function for an old event anyway.
-- It IS made reclaimable the same way 'failed' is, purely for defense in
-- depth against a legitimate near-immediate retry of the exact same call
-- (a flaky client resubmitting) finding a destination that appeared in the
-- meantime — a 'sent' row is never reclaimable either way, so an event
-- that genuinely delivered is still never touched again.
--
-- This is purely a status-semantics/reporting fix — no RLS policy, grant,
-- or authorization check anywhere in this schema is touched or loosened.
-- ============================================================================

alter table request_push_events drop constraint if exists request_push_events_status_check;
alter table request_push_events
  add constraint request_push_events_status_check
  check (status in ('sending', 'sent', 'failed', 'no_destination'));

create or replace function claim_request_push_event(
  p_dedupe_key text,
  p_kind text,
  p_request_id uuid,
  p_event text,
  p_stale_seconds int default 30
) returns boolean as $$
declare
  affected int;
begin
  insert into request_push_events (dedupe_key, kind, request_id, event, status, attempt_count)
  values (p_dedupe_key, p_kind, p_request_id, p_event, 'sending', 1)
  on conflict (dedupe_key) do update
    set status = 'sending',
        updated_at = now(),
        attempt_count = request_push_events.attempt_count + 1
    -- Mirrors src/logic/pushIdempotency.ts's decideClaimOutcome() exactly,
    -- now also reclaiming a 'no_destination' row (see header comment) —
    -- 'sent' still never matches either branch, so a genuinely successful
    -- delivery is still never touched again.
    where request_push_events.status = 'failed'
       or request_push_events.status = 'no_destination'
       or (request_push_events.status = 'sending'
           and request_push_events.updated_at < now() - make_interval(secs => p_stale_seconds));

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function mark_request_push_event(p_dedupe_key text, p_status text) returns void as $$
begin
  if p_status not in ('sent', 'failed', 'no_destination') then
    raise exception 'invalid request_push_events status: %', p_status;
  end if;
  update request_push_events
    set status = p_status, updated_at = now()
    where dedupe_key = p_dedupe_key;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- Grants are unchanged (service_role only) — re-stating them is harmless
-- and keeps this migration self-contained/idempotent to re-read.
revoke all on function claim_request_push_event(text, text, uuid, text, int) from public;
revoke all on function mark_request_push_event(text, text) from public;
grant execute on function claim_request_push_event(text, text, uuid, text, int) to service_role;
grant execute on function mark_request_push_event(text, text) to service_role;
