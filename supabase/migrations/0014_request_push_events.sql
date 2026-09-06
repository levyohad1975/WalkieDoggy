-- ----------------------------------------------------------------------------
-- 0014_request_push_events.sql
--
-- IDEMPOTENCY CORRECTION for supabase/functions/send-request-push: that
-- function already computes a stable `dedupeKey` (kind:requestId:event —
-- see src/logic/pushRouting.ts's buildDedupeKey(), the single source of
-- truth for this shape) but, before this migration, never persisted or
-- checked it — an otherwise-authorized caller could invoke the function
-- repeatedly while the persisted request status still matched the claimed
-- event and get a duplicate push every time (a requester re-tapping
-- something that re-triggers the "created" notify, a decider's client
-- retrying after a flaky network response, etc).
--
-- This table durably records one logical send attempt per dedupe key.
-- Uniqueness is enforced at the DB level via a PRIMARY KEY, and the actual
-- exactly-once-in-the-common-case guarantee comes from
-- claim_request_push_event()'s single atomic
-- `INSERT ... ON CONFLICT (dedupe_key) DO UPDATE ... WHERE <retryable>`
-- statement below — Postgres serializes concurrent conflicting writers on
-- the same key via normal row-level locking, so only one of two racing
-- invocations for the same dedupe key can ever have its INSERT/UPDATE
-- actually take effect (and therefore only one ever proceeds to call the
-- Expo push API) — this is NOT enforced by any application-level "check
-- then act" logic, which would be racy.
--
-- STATE MODEL: 'sending' (claimed, Expo call in flight) -> 'sent' (Expo
-- call succeeded — permanently done, never resent) or 'failed' (Expo call
-- failed/threw — retryable by a later legitimate call). A 'sending' row
-- older than the staleness window (30s — see claim_request_push_event's
-- p_stale_seconds default, and src/logic/pushIdempotency.ts's
-- DEFAULT_STALE_MS, kept in sync) is treated as abandoned (the invocation
-- that claimed it crashed/timed out mid-flight) and becomes reclaimable —
-- otherwise a single crashed invocation would permanently block every
-- future legitimate retry of that exact event.
--
-- RLS: this table is NOT client-writable or client-readable AT ALL. RLS is
-- enabled with zero policies for `anon`/`authenticated` (the roles a
-- mobile client's JWT resolves to), so both roles get an unconditional
-- deny on every operation regardless of any WITH CHECK/USING clause — only
-- the service-role key (which bypasses RLS entirely, same as every other
-- privileged path in this schema) can touch it directly. On top of that,
-- the two functions below additionally REVOKE EXECUTE from PUBLIC and
-- GRANT it only to service_role, so even a client that somehow guessed the
-- function names couldn't call them either — belt and suspenders.
-- ----------------------------------------------------------------------------

create table if not exists request_push_events (
  dedupe_key text primary key,
  kind text not null check (kind in ('swap', 'timeChange')),
  request_id uuid not null,
  event text not null check (event in ('created', 'approved', 'rejected')),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempt_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists request_push_events_request_id_idx on request_push_events (request_id);

alter table request_push_events enable row level security;
-- Deliberately NO policies created for anon/authenticated — RLS enabled
-- with zero permissive policies means every operation from those roles is
-- denied outright. Only a service-role connection (which bypasses RLS)
-- can read/write this table.

-- Atomically claims a dedupe key for sending, or reports that it's already
-- been sent / is still being sent by another concurrent invocation.
-- Returns true iff THIS call is the one that should proceed to actually
-- call the Expo push API.
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
    -- Mirrors src/logic/pushIdempotency.ts's decideClaimOutcome() exactly:
    -- retry a 'failed' row unconditionally, or reclaim a 'sending' row
    -- only once it's stale (crashed/timed-out invocation) — a fresh
    -- 'sending' row, or any 'sent' row, matches neither branch, so the
    -- UPDATE is skipped for it and this statement affects zero rows.
    where request_push_events.status = 'failed'
       or (request_push_events.status = 'sending'
           and request_push_events.updated_at < now() - make_interval(secs => p_stale_seconds));

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- Records the outcome of a claimed send attempt. Called exactly once per
-- claimed attempt, after the Expo API call resolves (success or failure).
create or replace function mark_request_push_event(p_dedupe_key text, p_status text) returns void as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'invalid request_push_events status: %', p_status;
  end if;
  update request_push_events
    set status = p_status, updated_at = now()
    where dedupe_key = p_dedupe_key;
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function claim_request_push_event(text, text, uuid, text, int) from public;
revoke all on function mark_request_push_event(text, text) from public;
grant execute on function claim_request_push_event(text, text, uuid, text, int) to service_role;
grant execute on function mark_request_push_event(text, text) to service_role;
