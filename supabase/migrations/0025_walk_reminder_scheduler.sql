-- ----------------------------------------------------------------------------
-- 0025_walk_reminder_scheduler.sql
--
-- BATCH 2: server-side, authoritative scheduled walk reminders (Master
-- Specification's notification requirements + the 5 decisions approved
-- before Batch 1). Purely additive on top of the expected 0001-0024
-- baseline this repository ships with — no existing table, column,
-- function, RLS policy, or trigger is altered or dropped. `create table if
-- not exists` / `create extension if not exists` guard against re-running
-- THIS migration a second time; they do not reconcile an already-existing
-- same-named object of a different shape — see 0022-0024's own headers for
-- the same caveat, which applies identically here.
--
-- WHY THIS EXISTS: every reminder before this migration was a LOCAL
-- notification scheduled on one device via expo-notifications (see
-- src/notifications/notificationService.ts) — it never fires if that
-- device's app isn't running, the PWA is closed, or the device is off.
-- Decision 4 (approved before Batch 1) requires an AUTHORITATIVE
-- server-side reminder that fires regardless of any client's state, with
-- native local notifications demoted to a fallback used only when no
-- server-reachable push channel is registered. This migration builds the
-- DATA/COMPUTE side of that: what's due, exactly-once delivery bookkeeping,
-- and the read-only helpers the new send-walk-reminders Edge Function and
-- the RN client both need. It does NOT itself send anything — sending
-- happens in supabase/functions/send-walk-reminders/index.ts, invoked on a
-- schedule (see this batch's report for the pg_cron/pg_net setup, which is
-- a manual, environment-specific deployment step and deliberately NOT part
-- of this migration — same reasoning as VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
-- never appearing in a migration: it depends on this project's own
-- deployed function URL and a secret, neither of which belongs in
-- version-controlled SQL).
--
-- STAGES: exactly four, fixed by this migration's CHECK constraints and by
-- due_walk_reminders()'s own hard-coded stage list below — T-15, T, T+15,
-- T+30 (minutes relative to the walk's scheduled time). There is no code
-- path anywhere in this migration (or the Edge Function that reads it)
-- that can ever produce a 5th stage for the same walk occurrence — this is
-- what makes "no endless reminders after T+30" (Decision 5) true by
-- construction rather than by convention.
--
-- TIMEZONE: every "is this due yet" computation below interprets a walk's
-- `date` + `scheduled_time` in ITS FAMILY's authoritative timezone
-- (`families.timezone`, migration 0022) via `... at time zone f.timezone`
-- — never the database server's local time and never a client's device
-- timezone. This is what makes the server-side scheduler "authoritative"
-- per Decision 3.
--
-- REVISION NOTE (Batch 2 review, applied before this migration was ever
-- applied to any database — edited in place rather than appended as a new
-- migration, same as the Batch 1 correction round): two issues were found
-- and fixed here — (1) Part 1/2's dedup bookkeeping was keyed at the WALK
-- level, so one recipient's successful delivery could permanently mask a
-- different recipient's (e.g. a Family Admin's) failed delivery at T+30;
-- it is now keyed per RECIPIENT — see Part 1's header. (2) Part 5's
-- has_active_remote_push_channel() answered a PROFILE-wide question, which
-- could wrongly suppress one device's local fallback because a different
-- device signed in as the same family member had a channel; it now takes
-- the calling device's own token/endpoint and answers a device-specific
-- question — see Part 5's header.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Part 1: walk_reminder_events — durable, exactly-once-per-STAGE-PER-
-- RECIPIENT bookkeeping.
--
-- CORRECTION (Batch 2 review): the first draft of this migration keyed this
-- table at the WALK level only — one row per (walk_id, stage, fire_at),
-- shared by every recipient of that stage (the responsible member, plus
-- every other admin at T+30). Because that one shared row was marked 'sent'
-- as soon as ANY recipient's delivery succeeded, a responsible-member
-- success could permanently mask a failed admin escalation: the admin's
-- failed delivery would never be retried, since the walk-level row already
-- read 'sent'. That does not satisfy "escalate to Family Admin(s)" as a
-- durable guarantee.
--
-- FIX: the natural key now includes recipient_user_id — one row per
-- (walk_id, stage, fire_at, recipient_user_id). Every recipient's delivery
-- is claimed, sent, and marked completely independently: one recipient's
-- success can never suppress a retry for a different recipient's failure.
-- Still directly mirrors request_push_events (0014) — same claim/mark
-- atomicity argument (not repeated here), just one more key column.
--
-- WITHIN one recipient's row, delivery may still involve MULTIPLE push
-- destinations (an Expo token AND a Web Push subscription both registered
-- for the same person) — those are still sent together and the row is
-- marked 'sent' once ANY of that one person's own destinations succeeds,
-- exactly like send-request-push's existing "totalSent > 0 -> sent, don't
-- retry a partial success" rule. This is a deliberate, DIFFERENT case from
-- the bug above: once one of a PERSON's own devices has shown them the
-- notification, that person has been reached — retrying their other,
-- already-redundant channel risks a duplicate on the channel that already
-- succeeded, not a lost notification. The bug being fixed here was about
-- two DIFFERENT PEOPLE sharing one row, not one person's own multiple
-- channels — see this batch's report for the full reasoning ("apply the
-- same reasoning to multiple push destinations where appropriate" was
-- considered and deliberately not extended to this narrower, same-person
-- case).
--
-- `fire_at` (truncated to the minute) remains part of the key for the same
-- reason as before: it makes "the scheduled time changed" self-healing —
-- editing a walk's time changes every stage's computed fire_at, so the OLD
-- key becomes irrelevant on its own, with nothing to detect or clean up.
-- ----------------------------------------------------------------------------

create table if not exists walk_reminder_events (
  walk_id uuid not null references walks(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  stage text not null check (stage in ('T-15', 'T', 'T+15', 'T+30')),
  fire_at timestamptz not null,
  recipient_user_id uuid not null references users(id) on delete cascade,
  -- Purely informational (never consulted for authorization or dedup
  -- itself — the primary key already uniquely identifies this row) — lets
  -- a human inspecting this table see at a glance whether a given row was
  -- "the responsible member's own reminder" or "an admin escalation copy",
  -- which matters for debugging a report of a missed T+30 notification.
  recipient_role text not null check (recipient_role in ('responsible', 'admin_escalation')),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempt_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (walk_id, stage, fire_at, recipient_user_id)
);

create index if not exists walk_reminder_events_family_id_idx on walk_reminder_events(family_id);

comment on table walk_reminder_events is
  'Durable exactly-once-per-stage-per-RECIPIENT send bookkeeping for the server-side walk reminder scheduler (0025) — see this migration''s Part 1 header for why recipient_user_id is part of the key (a fix for a Batch 2 review finding: one recipient''s success must never suppress a retry for a different recipient''s failed delivery). Mirrors request_push_events (0014). Not client-readable or client-writable at all — see the RLS note below.';

alter table walk_reminder_events enable row level security;
-- Deliberately NO policies for anon/authenticated — same reasoning as
-- request_push_events (0014): RLS enabled with zero permissive policies
-- denies every operation from those roles outright, so only a service-role
-- connection (which bypasses RLS) can touch this table at all. The
-- functions below additionally revoke EXECUTE from PUBLIC and grant only to
-- service_role, so even a client that guessed the function names couldn't
-- call them either.

create or replace function claim_walk_reminder_event(
  p_walk_id uuid,
  p_family_id uuid,
  p_stage text,
  p_fire_at timestamptz,
  p_recipient_user_id uuid,
  p_recipient_role text,
  p_stale_seconds int default 30
) returns boolean as $$
declare
  affected int;
begin
  if p_recipient_role not in ('responsible', 'admin_escalation') then
    raise exception 'invalid walk_reminder_events recipient_role: %', p_recipient_role;
  end if;

  insert into walk_reminder_events (walk_id, family_id, stage, fire_at, recipient_user_id, recipient_role, status, attempt_count)
  values (p_walk_id, p_family_id, p_stage, p_fire_at, p_recipient_user_id, p_recipient_role, 'sending', 1)
  on conflict (walk_id, stage, fire_at, recipient_user_id) do update
    set status = 'sending',
        updated_at = now(),
        attempt_count = walk_reminder_events.attempt_count + 1
    -- Same retry/reclaim rule as claim_request_push_event() (0014): retry a
    -- 'failed' row unconditionally, or reclaim a 'sending' row only once
    -- it's stale (a crashed/timed-out prior invocation). A fresh 'sending'
    -- row or any 'sent' row matches neither branch, so this UPDATE affects
    -- zero rows for it — that's the actual dedup guarantee, enforced by
    -- Postgres's own row-level locking on a concurrent conflicting write,
    -- not by any "check then act" application logic. Now scoped per
    -- RECIPIENT, so this claim/reclaim decision for one person never
    -- depends on (or affects) another recipient's row.
    where walk_reminder_events.status = 'failed'
       or (walk_reminder_events.status = 'sending'
           and walk_reminder_events.updated_at < now() - make_interval(secs => p_stale_seconds));

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function mark_walk_reminder_event(
  p_walk_id uuid,
  p_stage text,
  p_fire_at timestamptz,
  p_recipient_user_id uuid,
  p_status text
) returns void as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'invalid walk_reminder_events status: %', p_status;
  end if;
  update walk_reminder_events
    set status = p_status, updated_at = now()
    where walk_id = p_walk_id and stage = p_stage and fire_at = p_fire_at and recipient_user_id = p_recipient_user_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function claim_walk_reminder_event(uuid, uuid, text, timestamptz, uuid, text, int) from public;
revoke all on function mark_walk_reminder_event(uuid, text, timestamptz, uuid, text) from public;
grant execute on function claim_walk_reminder_event(uuid, uuid, text, timestamptz, uuid, text, int) to service_role;
grant execute on function mark_walk_reminder_event(uuid, text, timestamptz, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- Part 2: due_walk_reminders() — "which (walk, stage, recipient) triples
-- are due right now, across every family", computed fresh on every call
-- from CURRENT `walks`/`families`/`family_auth_members` rows. Nothing about
-- a walk's schedule is ever pre-materialized ahead of its fire time, which
-- is precisely what makes the re-check requirements (exists / still
-- pending / time unchanged / responsible member current / not
-- completed-skipped-cancelled) hold: there is no earlier-computed,
-- potentially-stale copy of any of those facts to go stale in the first
-- place. This function only tells the caller WHICH triples look due;
-- walk_reminder_context() (Part 3) is what the Edge Function calls once per
-- (walk, stage) GROUP, immediately before claiming any of that group's
-- recipients, for one more fully-fresh read straight from `walks` at the
-- moment of sending.
--
-- CORRECTION (Batch 2 review): now returns one row per RECIPIENT (a
-- responsible-member row for every due stage, plus one admin_escalation row
-- per OTHER active admin for T+30 specifically) rather than one row per
-- (walk, stage) — this is what lets the exclusion below (NOT EXISTS against
-- walk_reminder_events) work at the correct, per-recipient granularity: a
-- walk+stage with one recipient already 'sent' and another still pending
-- correctly still returns the still-pending recipient's row, rather than
-- either over- or under-suppressing the whole group.
--
-- p_max_lateness_minutes bounds how far in the past a fire_at can be and
-- still be considered due (default 360 = 6 hours). This is a deliberate,
-- documented safety choice, not a spec requirement: without it, a
-- scheduler outage longer than that window would, on recovery, fire a
-- burst of very stale reminders for every walk that passed T+30 while it
-- was down. It does not affect Decision 5 ("no endless reminders after
-- T+30") — that guarantee comes from the fixed 4-stage list below, not from
-- this bound — it only stops ancient reminders from being sent at all after
-- a long outage. Revisit this constant if that trade-off should differ.
-- ----------------------------------------------------------------------------

create or replace function due_walk_reminders(p_max_lateness_minutes int default 360)
returns table (
  walk_id uuid,
  family_id uuid,
  dog_id uuid,
  stage text,
  fire_at timestamptz,
  scheduled_at timestamptz,
  recipient_user_id uuid,
  recipient_role text
) as $$
  with stages(stage, offset_minutes) as (
    values ('T-15', -15), ('T', 0), ('T+15', 15), ('T+30', 30)
  ),
  walk_stage as (
    select
      w.id as walk_id,
      w.family_id,
      w.dog_id,
      w.responsible_user_id,
      s.stage,
      date_trunc(
        'minute',
        (((w.date::text || ' ' || w.scheduled_time || ':00')::timestamp at time zone f.timezone)
          + (s.offset_minutes * interval '1 minute'))
      ) as fire_at,
      ((w.date::text || ' ' || w.scheduled_time || ':00')::timestamp at time zone f.timezone) as scheduled_at
    from walks w
    join families f on f.id = w.family_id
    cross join stages s
    where w.status = 'pending'
  ),
  due_walk_stage as (
    select *
    from walk_stage
    where fire_at <= now()
      and fire_at >= now() - make_interval(mins => p_max_lateness_minutes)
  ),
  recipients as (
    -- The responsible member's own reminder — every due stage.
    select
      ws.walk_id, ws.family_id, ws.dog_id, ws.stage, ws.fire_at, ws.scheduled_at,
      ws.responsible_user_id as recipient_user_id,
      'responsible'::text as recipient_role
    from due_walk_stage ws
    union all
    -- T+30 admin escalation — every OTHER currently-active admin (never the
    -- responsible member themselves; their own copy above already covers
    -- them — see this batch's report for why a second, differently-worded
    -- copy to the same person would just be a redundant buzz).
    select
      ws.walk_id, ws.family_id, ws.dog_id, ws.stage, ws.fire_at, ws.scheduled_at,
      a.admin_user_id as recipient_user_id,
      'admin_escalation'::text as recipient_role
    from due_walk_stage ws
    cross join lateral family_admin_profile_ids(ws.family_id) as a(admin_user_id)
    where ws.stage = 'T+30'
      and a.admin_user_id is distinct from ws.responsible_user_id
  )
  select r.walk_id, r.family_id, r.dog_id, r.stage, r.fire_at, r.scheduled_at, r.recipient_user_id, r.recipient_role
  from recipients r
  where not exists (
    select 1 from walk_reminder_events e
    where e.walk_id = r.walk_id
      and e.stage = r.stage
      and e.fire_at = r.fire_at
      and e.recipient_user_id = r.recipient_user_id
      and e.status = 'sent'
  );
$$ language sql stable security definer set search_path = public;

comment on function due_walk_reminders(int) is
  'Computes which (walk, stage, recipient) triples are currently due, fresh from walks/families/family_auth_members on every call, already excluding any recipient already durably marked ''sent'' — see this migration''s Part 2 header. Returns candidates only; walk_reminder_context() is the authoritative per-walk-group re-check immediately before claiming any of a group''s recipients. service_role only.';

revoke all on function due_walk_reminders(int) from public;
grant execute on function due_walk_reminders(int) to service_role;

-- ----------------------------------------------------------------------------
-- Part 3: walk_reminder_context() — one fully-fresh read of everything the
-- Edge Function needs to (a) re-verify a candidate right before claiming it
-- and (b) build the message, in a single round trip. Returns zero rows for
-- a walk that no longer exists (deleted) — the Edge Function treats that
-- identically to "not pending".
-- ----------------------------------------------------------------------------

create or replace function walk_reminder_context(p_walk_id uuid)
returns table (
  walk_id uuid,
  family_id uuid,
  status text,
  scheduled_at timestamptz,
  scheduled_time_local text,
  responsible_user_id uuid,
  responsible_user_name text,
  dog_id uuid,
  dog_name text,
  dog_sex text,
  family_timezone text
) as $$
  select
    w.id,
    w.family_id,
    w.status,
    ((w.date::text || ' ' || w.scheduled_time || ':00')::timestamp at time zone f.timezone),
    -- Raw "HH:mm" wall-clock text, as entered in the family's own
    -- timezone — NOT derived from scheduled_at above. scheduled_at is a
    -- UTC-based instant; formatting IT back to "HH:mm" would print the
    -- walk's time in UTC instead of the family's own local time, which is
    -- exactly the wrong value for message text a family member reads.
    -- w.scheduled_time is already the correct local "HH:mm" string.
    w.scheduled_time,
    w.responsible_user_id,
    ru.name,
    w.dog_id,
    d.name,
    d.sex,
    f.timezone
  from walks w
  join families f on f.id = w.family_id
  join dogs d on d.id = w.dog_id
  left join users ru on ru.id = w.responsible_user_id
  where w.id = p_walk_id;
$$ language sql stable security definer set search_path = public;

comment on function walk_reminder_context(uuid) is
  'One fresh, fully-current read of a walk + its family/dog/responsible-member for the reminder scheduler''s pre-send re-check and message building. service_role only. Returns zero rows if the walk no longer exists.';

revoke all on function walk_reminder_context(uuid) from public;
grant execute on function walk_reminder_context(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Part 4: family_admin_profile_ids() — the T+30 admin-escalation roster,
-- factored out of what was previously ad hoc inline logic duplicated inside
-- supabase/functions/send-request-push/index.ts (family_auth_members,
-- keyed by a DEVICE's auth identity, joined to users, the family-member
-- PROFILE identity — see that function's own comment on the distinction).
-- This is the same join, now reusable by send-walk-reminders too, without
-- duplicating the reasoning a second time.
-- ----------------------------------------------------------------------------

create or replace function family_admin_profile_ids(p_family_id uuid)
returns setof uuid as $$
  select u.id
  from family_auth_members m
  join users u on u.auth_user_id = m.auth_user_id and u.family_id = m.family_id
  where m.family_id = p_family_id
    and m.role = 'admin'
    and u.removed_at is null;
$$ language sql stable security definer set search_path = public;

comment on function family_admin_profile_ids(uuid) is
  'Active (non-removed) Family Admin profile ids for a family, for the T+30 escalation fan-out. service_role only.';

revoke all on function family_admin_profile_ids(uuid) from public;
grant execute on function family_admin_profile_ids(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Part 5: has_active_remote_push_channel(p_expo_token, p_web_push_endpoint)
-- — the client-facing half of the native-local-vs-server-push
-- duplicate-suppression policy (Decision 4 / requirement 10).
--
-- CORRECTION (Batch 2 review): the first draft answered "does the
-- PROFILE have any active channel at all", checked with no device
-- identity — user_id = real_current_profile_id() only. That is wrong for a
-- profile signed in on more than one device: Device A registers a Web Push
-- subscription; Device B (same family member, no subscription of its own)
-- asks the same question and was ALSO told "yes", so Device B suppressed
-- its own local fallback even though the server has no way to reach Device
-- B specifically — a real, silent loss of reminders on Device B.
--
-- FIX: this now answers a narrower, correct question — "does THIS
-- specific token/endpoint (which the CALLER already knows is its own,
-- because it is the one that either obtained the Expo token from
-- Notifications.getExpoPushTokenAsync() or created the Web Push
-- subscription itself) currently exist, for my profile, and is it active".
-- The existing push_tokens.token / web_push_subscriptions.endpoint columns
-- are ALREADY per-device identifiers (see 0013's and 0021's own headers: a
-- device's Expo token is stable for that install; a Web Push endpoint is
-- specific to one browser subscription) — so no schema change was needed,
-- only using the identity that was already there instead of asking a
-- profile-wide existence question. Pass whichever of the two THIS device
-- actually has (a native device normally has only p_expo_token; a web
-- device only p_web_push_endpoint); pass both null if this device has
-- registered neither, which correctly resolves to false without a query.
--
-- Still reveals nothing about anyone other than the caller, and nothing
-- about the caller's OTHER devices either — it can only ever confirm or
-- deny a token/endpoint value the caller already supplied — so it remains
-- safe to grant broadly to `authenticated` without exposing
-- push_tokens/web_push_subscriptions rows themselves.
-- ----------------------------------------------------------------------------

create or replace function has_active_remote_push_channel(
  p_expo_token text default null,
  p_web_push_endpoint text default null
)
returns boolean as $$
  select
    (
      p_expo_token is not null
      and exists (
        select 1 from push_tokens
        where user_id = real_current_profile_id()
          and token = p_expo_token
          and is_active = true
      )
    )
    or (
      p_web_push_endpoint is not null
      and exists (
        select 1 from web_push_subscriptions
        where user_id = real_current_profile_id()
          and endpoint = p_web_push_endpoint
          and is_active = true
      )
    );
$$ language sql stable security definer set search_path = public;

comment on function has_active_remote_push_channel(text, text) is
  'True iff the specific Expo token / Web Push endpoint THIS CALL identifies (which must belong to the calling device itself) is registered, active, and belongs to the caller''s real (non-impersonated) claimed profile. Device-specific by construction — see this migration''s Part 5 header for the Batch 2 review correction this replaced (a profile-wide check that could suppress one device''s local fallback because a DIFFERENT device of the same profile had a channel). Used client-side to decide whether THIS device should schedule local walk-reminder notifications (Decision 4 / requirement 10).';

revoke all on function has_active_remote_push_channel(text, text) from public;
grant execute on function has_active_remote_push_channel(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Part 6: pg_cron / pg_net extensions — enabled here so the periodic
-- trigger (a `cron.schedule(...)` call invoking send-walk-reminders via
-- `net.http_post`) can be registered afterward. Deliberately NOT
-- self-registering that schedule from within this migration: doing so
-- would require embedding this project's own deployed function URL and a
-- shared secret directly in version-controlled SQL, which is exactly the
-- kind of environment-specific, sensitive value this schema otherwise
-- always keeps out of migrations (see VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY,
-- never present in any migration, only ever read via Deno.env.get at
-- runtime). The exact `cron.schedule(...)` statement to run once, by hand,
-- after deployment is given in this batch's report — not here.
--
-- Some Supabase projects require enabling pg_cron/pg_net from the Dashboard
-- (Database → Extensions) before `create extension` is permitted for them
-- at all, depending on plan/host configuration — this is a genuine
-- can't-verify-from-here item; see this batch's report's "not verifiable"
-- section. If this statement errors on your project, enable both
-- extensions from the Dashboard first, then re-run just this migration.
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
