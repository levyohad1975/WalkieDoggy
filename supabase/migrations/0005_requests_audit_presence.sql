-- ============================================================================
-- 0005_requests_audit_presence.sql
--
-- 0001-0004 are already deployed to the live project — this migration does
-- NOT touch any of those files. Everything here is additive: new tables,
-- new RLS policies (only ADDING checks to `walks`/`schedule_entries`, which
-- are re-created as narrower equivalents — see section 2 — never removing
-- an existing guarantee), and new SECURITY DEFINER functions.
--
-- ORDER MATTERS in this file: helper functions (current_profile_id(),
-- log_audit_event()) are defined before anything that calls them, so this
-- runs correctly top-to-bottom in one pass (a plpgsql function body that
-- calls a not-yet-existing function can fail at CREATE time under Postgres's
-- default check_function_bodies).
--
-- Sections:
--   1. search_path hardening for existing SECURITY DEFINER functions.
--   2. walks / schedule_entries: reject a removed user as a NEW responsible
--      assignment (INSERT/UPDATE only — SELECT/DELETE unchanged).
--   3. current_profile_id() helper.
--   3b. walks / schedule_entries WRITE AUTHORIZATION triggers — a regular
--      Member cannot bypass the swap/time-change approval workflows (or
--      delete a walk/entry, or attribute a spontaneous walk — including its
--      completion, status, completed_at and schedule_entry_id — to anyone
--      but themselves) by writing the table directly instead of going
--      through the UI/RPCs. A newly-set completed_by_user_id on an ordinary
--      completion must also name an active same-family member (Round 6).
--      Admin retains full direct control, and the approval RPCs below
--      (approve_swap_request/approve_time_change_request) still work via a
--      transaction-local trusted-write flag they set immediately before
--      their own validated writes.
--   4. audit_log table + log_audit_event().
--   5. walk_swap_requests — Member-to-Member swap request/approval.
--   6. time_change_requests — Member-to-Admin time-change request/approval.
--   7. admin_delete_family_member() / regenerate_invite_code() — re-defined
--      identically to their deployed 0004 versions, plus one audit-log call
--      each.
--   8. user_presence — lightweight last-seen tracking, Admin-only to read.
--   9. Audit triggers on walks / schedule_rules / users — server-authored
--      "walk completed", "spontaneous walk added", "schedule rule
--      created/edited/deleted", "profile edited", "profile claimed".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. search_path hardening (requirement: "set safe search_path on SECURITY
--    DEFINER functions"). An unqualified search_path on a SECURITY DEFINER
--    function is a known Postgres foot-gun (a caller-controlled schema
--    earlier in their search_path could shadow an unqualified identifier
--    used inside the function). None of these functions' logic changes —
--    this only pins the schema each one resolves unqualified names against.
-- ----------------------------------------------------------------------------

alter function current_family_id() set search_path = public;
alter function current_family_role() set search_path = public;
alter function is_family_admin(uuid) set search_path = public;
alter function find_family_by_invite_code(text) set search_path = public;
alter function create_family(text, text) set search_path = public;
alter function join_family(text) set search_path = public;
alter function claim_family_profile(uuid) set search_path = public;

-- ----------------------------------------------------------------------------
-- 2. walks / schedule_entries: a removed user must never become the NEW
--    responsible_user_id of a walk or schedule_entry. The previous policies
--    were `for all` (covering select/insert/update/delete with one check),
--    which is why this couldn't just be "added" to them — a check strong
--    enough for insert/update would also apply to (and needlessly break)
--    SELECT of old rows whose responsible user has since been removed,
--    which History depends on ("(הוסר)" display, preserved historical
--    references). Each `for all` policy is replaced with separate INSERT/
--    UPDATE/SELECT/DELETE policies: SELECT and DELETE are UNCHANGED in
--    effect (same condition as before), INSERT/UPDATE gain the active-user
--    check. completed_by_user_id is deliberately NOT constrained here — a
--    walk already legitimately completed by someone who was later removed
--    must remain writable for its OTHER fields (e.g. admin editing pee/poop
--    details afterward) without that historical reference blocking it.
-- ----------------------------------------------------------------------------

drop policy if exists "modify walks in own family" on walks;

drop policy if exists "select walks in own family" on walks;
create policy "select walks in own family" on walks
  for select using (family_id = current_family_id());

create policy "insert walks in own family" on walks
  for insert with check (
    family_id = current_family_id()
    and exists (
      select 1 from users ru
      where ru.id = responsible_user_id
        and ru.family_id = walks.family_id
        and ru.removed_at is null
    )
  );

create policy "update walks in own family" on walks
  for update using (family_id = current_family_id())
  with check (
    family_id = current_family_id()
    and exists (
      select 1 from users ru
      where ru.id = responsible_user_id
        and ru.family_id = walks.family_id
        and ru.removed_at is null
    )
  );

create policy "delete walks in own family" on walks
  for delete using (family_id = current_family_id());

drop policy if exists "modify entries in own family" on schedule_entries;

drop policy if exists "select entries in own family" on schedule_entries;
create policy "select entries in own family" on schedule_entries
  for select using (family_id = current_family_id());

create policy "insert entries in own family" on schedule_entries
  for insert with check (
    family_id = current_family_id()
    and exists (
      select 1 from users ru
      where ru.id = responsible_user_id
        and ru.family_id = schedule_entries.family_id
        and ru.removed_at is null
    )
  );

create policy "update entries in own family" on schedule_entries
  for update using (family_id = current_family_id())
  with check (
    family_id = current_family_id()
    and exists (
      select 1 from users ru
      where ru.id = responsible_user_id
        and ru.family_id = schedule_entries.family_id
        and ru.removed_at is null
    )
  );

create policy "delete entries in own family" on schedule_entries
  for delete using (family_id = current_family_id());

-- ----------------------------------------------------------------------------
-- 3. current_profile_id() — resolves the CALLING DEVICE's own active
--    profile id within its current family (i.e. "which users.id am I"), the
--    same concept claim_family_profile()/the Self+Admin UPDATE policy rely
--    on (auth_user_id = auth.uid()). Used throughout this file so every new
--    RPC resolves "who is calling" the same trusted way, rather than
--    trusting a client-supplied user id anywhere.
-- ----------------------------------------------------------------------------

create or replace function current_profile_id()
returns uuid as $$
  select id from users
  where auth_user_id = auth.uid()
    and family_id = current_family_id()
    and removed_at is null
  limit 1;
$$ language sql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 3b. walks / schedule_entries WRITE AUTHORIZATION (Round 3 gap fix).
--
-- The RLS policies in section 2 correctly scope INSERT/UPDATE to "same
-- family + active responsible user", but that is a ROW-level check — it
-- cannot see which COLUMNS changed or what the row looked like before, so it
-- could not by itself stop a Member from calling the client directly and
-- reassigning (`responsible_user_id`), rescheduling (`scheduled_time` /
-- schedule_entries.time), or deleting any walk/entry in their family —
-- bypassing create_swap_request()/create_time_change_request() entirely, or
-- attributing a spontaneous walk to someone other than themselves. UI-level
-- gating (ScheduleScreen/HomeScreen only showing these controls to Admin)
-- is a UX convenience, never the security boundary — see the file-level
-- comment at the top of this migration.
--
-- This is deliberately a TRIGGER, not a tighter RLS policy: RLS's WITH CHECK
-- only ever sees the (candidate) NEW row, so a condition strong enough to
-- block "change responsible_user_id" would have no way to also permit the
-- legitimate self-service fields (status/completed_at/had_pee/...) that
-- markDone()/editDoneDetails() DO need to write — WITH CHECK cannot compare
-- OLD vs NEW. A BEFORE trigger can, and can also raise a specific,
-- actionable error message per violation instead of RLS's generic "new row
-- violates row-level security policy".
--
-- ADMIN vs MEMBER, and how the approval RPCs still work:
--   is_family_admin(family_id) is checked FIRST and short-circuits the
--   trigger entirely — Admin keeps exactly the direct-write capability it
--   has today (rescheduleWalk, the direct swap/swapTwoWalks reassignment,
--   skip, addRule/updateRule/deleteRule's cascaded entry/walk writes,
--   admin_delete_family_member()'s reassignment loops — none of these
--   needed to change).
--
--   approve_swap_request() and approve_time_change_request() are called by
--   a Member (the swap target) or an Admin (time-change approver) — either
--   way, their OWN validated `update walks`/`update schedule_entries`
--   statements must still succeed even though the row's protected fields
--   are changing. Rather than trying to teach the trigger to recognize
--   "this specific UPDATE statement came from inside a trusted RPC" (not
--   generally possible — the RPC's SECURITY DEFINER context does not, by
--   itself, distinguish its writes from a client's direct write; both run
--   as the same authenticated role), each RPC sets a transaction-local GUC
--   (`app.trusted_write`) immediately before its own protected write and
--   clears it right after. `set_config(..., true)` scopes it to the
--   current transaction — and PostgREST runs each RPC call in its own
--   transaction — so this can never leak into, or be set ahead of time by,
--   an unrelated client request; a client cannot set this GUC itself for
--   its own direct writes (this migration is the only thing that calls it,
--   and it isn't exposed as a SQL function).
--
-- Residual, documented limitation: FABRICATED PLANNED INSERTS (Round 5,
-- investigated and deliberately NOT fixed this round; see below for why).
--
-- A Member's client can still INSERT a fabricated *non*-unplanned
-- walk/entry (is_unplanned = false) with an arbitrary active same-family
-- responsible_user_id — e.g. one that doesn't actually match what the
-- rotation algorithm would have generated. Unlike the vectors closed above,
-- this cannot bypass an approval workflow (there is none for routine
-- schedule generation) and cannot reassign an EXISTING walk/entry (blocked
-- by the UPDATE checks below); it can only create a new row shaped exactly
-- like the ones the client already writes legitimately via the self-healing
-- backfill in scheduleStore.load().
--
-- Investigated this round: is a validated server RPC a "reasonably small"
-- fix? The rotation math itself (src/logic/rotation.ts:
-- resolveResponsibleForDate / generateRotationSchedule) is pure, small, and
-- deterministic — counting active days between an anchor date and a target
-- date that match a day-of-week set, modulo a rotation length. Postgres'
-- `extract(dow from d)` maps identically to the JS `getUTCDay()` the client
-- uses, so a `backfill_schedule_entries(family_id, dog_id, through_date)`
-- SECURITY DEFINER RPC that recomputes the correct occurrences and
-- inserts/upserts them itself (using the same app.trusted_write bypass
-- pattern as approve_swap_request/approve_time_change_request) is feasible
-- in isolation and was drafted, then set aside — see next paragraph.
--
-- Why it is NOT a reasonably small fix once shipped: this app is
-- offline-first. scheduleStore.load()'s self-healing backfill must keep
-- working with no network — it writes the generated rows to the local
-- cache immediately and queues them for later sync via
-- OfflineFirstRepository/SyncQueue, whose SyncOperation union today only
-- knows how to replay plain table upserts (addScheduleEntries/saveWalk),
-- not RPC calls. Moving generation behind a server RPC would only take
-- effect while online; to actually CLOSE this gap (not just add a second,
-- parallel path) the write-authorization trigger below would also need to
-- start rejecting direct Member INSERTs of non-unplanned rows, which would
-- break offline self-healing outright whenever the device is offline —
-- i.e. break it in exactly the situation self-healing exists for. Doing
-- this properly is therefore a queueing/replay architecture change, not a
-- SQL-only change, and reimplementing that queueing layer was judged out
-- of scope for this round per the instruction not to expand scope blindly.
--
-- Residual risk, stated plainly: an active Member can, at will, fabricate
-- a routine (non-unplanned) walk/entry for any active same-family member
-- with a responsible_user_id of their choosing, independent of what the
-- rotation would actually produce. This does not let them reassign or
-- delete existing walks, does not bypass swap/time-change approvals, and
-- is scoped to their own family, but it does mean the "who is responsible
-- for this newly-appearing occurrence" field is not currently
-- server-validated for this one write path.
--
-- Recommended next hardening step: extend SyncQueue's SyncOperation union
-- with an RPC-shaped variant (e.g. `{ type: 'backfillSchedule'; payload:
-- { familyId, dogId, throughDate } }`) that SyncQueue.flush() replays by
-- calling the new backfill_schedule_entries() RPC instead of an upsert: it
-- queues and persists offline exactly like today's operations, but resolves
-- to a server-computed, server-validated result once flushed. Once that
-- exists on the client, tighten enforce_walk_write_authorization() /
-- enforce_schedule_entry_write_authorization() to require app.trusted_write
-- (i.e. Admin-or-RPC-only) for non-unplanned INSERTs, closing this gap
-- completely.
-- ----------------------------------------------------------------------------

create or replace function enforce_walk_write_authorization()
returns trigger as $$
declare
  actor uuid;
  fam uuid;
begin
  -- Set (and cleared) only by approve_swap_request()/approve_time_change_request()
  -- immediately around their own validated writes — see the comment block above.
  if coalesce(current_setting('app.trusted_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  fam := coalesce(new.family_id, old.family_id);

  if is_family_admin(fam) then
    return coalesce(new, old); -- Admin retains full direct control (product requirement)
  end if;

  if tg_op = 'DELETE' then
    raise exception 'members may not delete walks directly';
  end if;

  actor := current_profile_id();

  if actor is null then
    raise exception 'no active profile found for this session';
  end if;

  if tg_op = 'INSERT' then
    -- Round 6 gap fix: a Member's spontaneous/unplanned walk INSERT was only
    -- constrained on responsible_user_id, leaving completed_by_user_id,
    -- status, completed_at and schedule_entry_id free for the client to set
    -- arbitrarily — letting a Member call Supabase directly with
    -- responsible_user_id = self but completed_by_user_id = someone else,
    -- which contradicts the product rule that a Member adding a
    -- completed/spontaneous walk does NOT choose who walked: it is always
    -- attributed to themselves. Every field that jointly describes "this
    -- walk is complete, done by me, right now, and not a real schedule
    -- occurrence" is now pinned for a Member's is_unplanned insert.
    if new.is_unplanned then
      if new.responsible_user_id is distinct from actor then
        raise exception 'a spontaneous walk may only be attributed to yourself';
      end if;
      if new.completed_by_user_id is distinct from actor then
        raise exception 'a spontaneous walk completion may only be attributed to yourself';
      end if;
      if new.status is distinct from 'done' then
        raise exception 'a spontaneous walk must be recorded as already done';
      end if;
      if new.completed_at is null then
        raise exception 'a spontaneous walk must have a completion time';
      end if;
      if new.schedule_entry_id is not null then
        raise exception 'a spontaneous walk cannot be linked to a schedule entry';
      end if;
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE' — allow only the self-service fields a Member's
  -- markDone()/editDoneDetails() actually write (status, completion detail,
  -- updated_at — see set_updated_at, a separate trigger, for that one);
  -- everything that would bypass an approval workflow or alter the row's
  -- identity/history is rejected, regardless of whether the caller happens
  -- to be the walk's own responsible user (ownership grants no extra
  -- bypass — only Admin or the approval RPCs may change these fields).
  if old.responsible_user_id is distinct from new.responsible_user_id then
    raise exception 'reassigning a walk requires an approved swap request';
  end if;
  if old.scheduled_time is distinct from new.scheduled_time then
    raise exception 'changing a walk''s time requires an approved time-change request';
  end if;
  if old.family_id is distinct from new.family_id
     or old.dog_id is distinct from new.dog_id
     or old.date is distinct from new.date
     or old.schedule_entry_id is distinct from new.schedule_entry_id
     or old.is_unplanned is distinct from new.is_unplanned
     or old.swap_original_user_id is distinct from new.swap_original_user_id
     or old.swap_new_user_id is distinct from new.swap_new_user_id
     or old.swap_swapped_at is distinct from new.swap_swapped_at
     or old.swap_swapped_by_user_id is distinct from new.swap_swapped_by_user_id then
    raise exception 'this field cannot be changed directly';
  end if;
  if old.status is distinct from new.status and not (old.status = 'pending' and new.status = 'done') then
    raise exception 'invalid status transition';
  end if;

  -- Round 6 hardening: whenever completed_by_user_id is newly set or
  -- changed by a Member (in practice, only the pending -> done transition
  -- above — editWalkDetails() never touches this field once done), it must
  -- refer to a currently-active user in the SAME family. This is
  -- deliberately the minimum bar, not "must equal the walk's responsible
  -- user" or "must equal the caller": CompleteWalkModal intentionally lets
  -- a Member record that a different family member walked the dog
  -- (completedByUserId may differ from responsibleUserId — see
  -- walkActions.markWalkDone's own doc comment), so the product does not
  -- restrict completion attribution to self for ordinary (non-spontaneous)
  -- walks. A walk already completed by someone later removed remains
  -- writable for its OTHER fields without retroactively failing this check,
  -- because this only fires when completed_by_user_id itself CHANGES.
  if old.completed_by_user_id is distinct from new.completed_by_user_id
     and new.completed_by_user_id is not null
     and not exists (
       select 1 from users cu
       where cu.id = new.completed_by_user_id
         and cu.family_id = fam
         and cu.removed_at is null
     ) then
    raise exception 'a walk can only be marked completed by an active member of this family';
  end if;

  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists walks_write_authorization on walks;
create trigger walks_write_authorization
  before insert or update or delete on walks
  for each row execute function enforce_walk_write_authorization();

-- schedule_entries: no client-reachable code path ever needs a Member to
-- UPDATE or DELETE an existing entry directly (rescheduleWalk/updateRule/
-- deleteRule/deleteEntry are all Admin-only in the UI, and this makes it
-- true server-side too) — so, unlike walks, this simply blocks ALL direct
-- UPDATE/DELETE for non-admins outright. INSERT is left exactly as section 2
-- already had it (family + active-responsible-user only): the self-healing
-- backfill in scheduleStore.load() runs on ANY device, including a Member's,
-- and legitimately creates entries for whichever family member the rotation
-- assigns next — see the residual-limitation note above.
create or replace function enforce_schedule_entry_write_authorization()
returns trigger as $$
declare
  fam uuid;
begin
  if coalesce(current_setting('app.trusted_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  fam := coalesce(new.family_id, old.family_id);

  if is_family_admin(fam) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'members may not directly modify a schedule entry — use create_swap_request()/create_time_change_request() via the walk instead';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'members may not delete schedule entries directly';
  end if;

  return null;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists schedule_entries_write_authorization on schedule_entries;
create trigger schedule_entries_write_authorization
  before insert or update or delete on schedule_entries
  for each row execute function enforce_schedule_entry_write_authorization();

-- ----------------------------------------------------------------------------
-- 4. audit_log table + log_audit_event() — server-authored only. No INSERT/UPDATE/DELETE policy is
--    defined for the `authenticated` role at all, which under RLS means
--    ordinary clients can never write here directly, whatever they call —
--    only log_audit_event() (SECURITY DEFINER, executed as its owner) can,
--    and only functions defined later in this file call it. EXECUTE on
--    log_audit_event itself is explicitly revoked from PUBLIC/anon/
--    authenticated so a client can't invoke it directly as an RPC either
--    (Postgres still lets the *owner* call it internally from another
--    SECURITY DEFINER function, since ownership implies execute rights on
--    one's own objects) — this is what "prefer server-side creation for
--    security-sensitive events" and "avoid trusting arbitrary client-
--    supplied actor IDs" mean in practice here: actor is always resolved
--    server-side, never passed in trusted as-is by a caller with EXECUTE on
--    the logging function itself.
-- ----------------------------------------------------------------------------

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_family_id_idx on audit_log(family_id, created_at desc);

alter table audit_log enable row level security;

drop policy if exists "admin reads audit log" on audit_log;
create policy "admin reads audit log" on audit_log
  for select using (family_id = current_family_id() and is_family_admin(family_id));
-- No insert/update/delete policy — see comment block above.

create or replace function log_audit_event(
  p_family_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void as $$
begin
  insert into audit_log (family_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_family_id, p_actor_user_id, p_action, p_target_type, p_target_id, p_metadata);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function log_audit_event(uuid, uuid, text, text, uuid, jsonb) from public;

-- NOTE: an earlier draft of this migration exposed a client-callable
-- log_client_audit_event(p_action, ...) for a small allow-list of
-- "self-describing" events (profile_edited/profile_claimed). It was removed
-- before this migration was ever deployed (no app code called it) in favor
-- of the triggers in section 9 below: a trigger observes the actual row
-- change and derives the actor from auth.uid() itself, so the event can
-- never be logged without the change really happening, and never for an
-- action the client merely claims occurred. That is strictly more
-- trustworthy than a client-invoked "please log this" call, per the
-- "prefer trustworthy server-authored audit events where possible"
-- requirement.

-- ----------------------------------------------------------------------------
-- 5. walk_swap_requests — Member A asks Member B to take over a walk
--    currently assigned to A. Only B (the target) can approve/reject;
--    Admin is deliberately NOT a party to this workflow. Creation and
--    resolution both go through SECURITY DEFINER RPCs (never a direct
--    client INSERT/UPDATE) so every actor/target/eligibility check is
--    server-side and atomic — see the requirement: "Authorization MUST be
--    server-side, not only hidden in the UI."
-- ----------------------------------------------------------------------------

create table if not exists walk_swap_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  walk_id uuid not null references walks(id) on delete cascade,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  target_user_id uuid not null references users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Snapshot of the walk at request time, used to detect staleness on
  -- approval (requirement: "revalidate ... has not materially changed").
  -- Round 4 gap fix: scheduled_time is included alongside
  -- expected_responsible_user_id/expected_status — a swap is "please take
  -- over walk X", and if X's time has moved since the target agreed to it
  -- (e.g. an Admin's direct reschedule, or the walk's own approved
  -- time-change request resolving in between), that is exactly the kind of
  -- materially-changed-since-request situation approval must reject rather
  -- than silently apply. dog_id/date are NOT snapshotted: no code path ever
  -- changes them on an existing walk row (see enforce_walk_write_authorization()
  -- in section 3b, which blocks exactly that), so there is nothing there to
  -- go stale.
  expected_responsible_user_id uuid not null,
  expected_status text not null,
  expected_scheduled_time text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references users(id) on delete set null
);

create index if not exists walk_swap_requests_family_id_idx on walk_swap_requests(family_id);
create index if not exists walk_swap_requests_walk_id_idx on walk_swap_requests(walk_id);

alter table walk_swap_requests enable row level security;

-- Visible only to the two people involved, or an admin auditing the family
-- (admin cannot approve/reject this workflow — see the functions below —
-- but not-being-the-approver isn't the same as "must not see it exists").
drop policy if exists "select relevant swap requests" on walk_swap_requests;
create policy "select relevant swap requests" on walk_swap_requests
  for select using (
    family_id = current_family_id()
    and (
      requested_by_user_id = current_profile_id()
      or target_user_id = current_profile_id()
      or is_family_admin(family_id)
    )
  );
-- No INSERT/UPDATE/DELETE policy: every write goes through the SECURITY
-- DEFINER functions below, which validate far more than RLS conveniently
-- can (walk ownership, staleness, active-user checks) and apply the walk
-- reassignment atomically in the same transaction as the status change.

create or replace function create_swap_request(p_walk_id uuid, p_target_user_id uuid)
returns uuid as $$
declare
  me uuid;
  my_family uuid;
  w record;
  new_id uuid;
begin
  select id, family_id into me, my_family from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into w from walks where id = p_walk_id;
  if w.id is null or w.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;
  if w.status <> 'pending' then
    raise exception 'walk is no longer pending';
  end if;
  if w.responsible_user_id <> me then
    raise exception 'you can only request a swap for a walk you are responsible for';
  end if;

  if p_target_user_id = me then
    raise exception 'choose a different family member';
  end if;
  if not exists (
    select 1 from users where id = p_target_user_id and family_id = my_family and removed_at is null
  ) then
    raise exception 'target member is not an active member of this family';
  end if;

  if exists (
    select 1 from walk_swap_requests
    where walk_id = p_walk_id and status = 'pending'
  ) then
    raise exception 'a pending swap request already exists for this walk';
  end if;

  insert into walk_swap_requests (
    family_id, walk_id, requested_by_user_id, target_user_id,
    expected_responsible_user_id, expected_status, expected_scheduled_time
  ) values (
    my_family, p_walk_id, me, p_target_user_id, w.responsible_user_id, w.status, w.scheduled_time
  ) returning id into new_id;

  perform log_audit_event(my_family, me, 'swap_request_created', 'walk', p_walk_id,
    jsonb_build_object('request_id', new_id, 'target_user_id', p_target_user_id));

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function approve_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
  w record;
begin
  select id into me from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can approve this swap';
  end if;

  -- Idempotent: approving an already-approved request again is a no-op
  -- success, not an error (safe against a double-tap / duplicate network
  -- retry). Approving an already-REJECTED request is a real conflict.
  if req.status = 'approved' then
    return;
  end if;
  if req.status = 'rejected' then
    raise exception 'this request was already rejected';
  end if;

  select * into w from walks where id = req.walk_id for update;
  if w.id is null
     or w.status <> 'pending'
     or w.responsible_user_id <> req.expected_responsible_user_id
     or w.scheduled_time <> req.expected_scheduled_time then
    raise exception 'the walk has changed since this request was created and can no longer be approved';
  end if;
  if not exists (select 1 from users where id = req.target_user_id and family_id = req.family_id and removed_at is null) then
    raise exception 'you are no longer an active member of this family';
  end if;

  -- Lets this validated reassignment through enforce_walk_write_authorization()
  -- (section 3b) even when the caller (req.target_user_id) is a regular
  -- Member, not an Admin — see that trigger's doc comment. Scoped to this
  -- transaction only (PostgREST runs each RPC call in its own transaction),
  -- and cleared immediately after so it never covers any other statement.
  perform set_config('app.trusted_write', 'on', true);
  update walks
  set responsible_user_id = req.target_user_id,
      swap_original_user_id = coalesce(w.swap_original_user_id, w.responsible_user_id),
      swap_new_user_id = req.target_user_id,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = req.target_user_id,
      updated_at = now()
  where id = w.id;
  perform set_config('app.trusted_write', 'off', true);

  update walk_swap_requests
  set status = 'approved', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_approved', 'walk', w.id,
    jsonb_build_object('request_id', p_request_id, 'requested_by_user_id', req.requested_by_user_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function reject_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
begin
  select id into me from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can reject this swap';
  end if;

  if req.status = 'rejected' then
    return; -- idempotent
  end if;
  if req.status = 'approved' then
    raise exception 'this request was already approved';
  end if;

  update walk_swap_requests
  set status = 'rejected', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_rejected', 'walk', req.walk_id,
    jsonb_build_object('request_id', p_request_id, 'requested_by_user_id', req.requested_by_user_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 6. time_change_requests — Member asks ADMIN to move a walk's time.
--    Only an admin of the family may approve/reject. Approval also
--    re-validates the schedule_entries (dog_id, date, time) uniqueness
--    constraint before applying, and updates both schedule_entries.time
--    (when the walk came from a rule) and walks.scheduled_time atomically.
-- ----------------------------------------------------------------------------

create table if not exists time_change_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  walk_id uuid not null references walks(id) on delete cascade,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  proposed_time text not null check (proposed_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  expected_time text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references users(id) on delete set null
);

create index if not exists time_change_requests_family_id_idx on time_change_requests(family_id);
create index if not exists time_change_requests_walk_id_idx on time_change_requests(walk_id);

alter table time_change_requests enable row level security;

drop policy if exists "select relevant time change requests" on time_change_requests;
create policy "select relevant time change requests" on time_change_requests
  for select using (
    family_id = current_family_id()
    and (requested_by_user_id = current_profile_id() or is_family_admin(family_id))
  );

create or replace function create_time_change_request(p_walk_id uuid, p_proposed_time text)
returns uuid as $$
declare
  me uuid;
  my_family uuid;
  w record;
  new_id uuid;
begin
  if p_proposed_time !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'invalid time format';
  end if;

  select id, family_id into me, my_family from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into w from walks where id = p_walk_id;
  if w.id is null or w.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;
  if w.status <> 'pending' then
    raise exception 'walk is no longer pending';
  end if;
  if w.responsible_user_id <> me then
    raise exception 'you can only request a time change for a walk you are responsible for';
  end if;
  if p_proposed_time = w.scheduled_time then
    raise exception 'that is already this walk''s time';
  end if;

  if exists (
    select 1 from time_change_requests where walk_id = p_walk_id and status = 'pending'
  ) then
    raise exception 'a pending time-change request already exists for this walk';
  end if;

  insert into time_change_requests (family_id, walk_id, requested_by_user_id, proposed_time, expected_time)
  values (my_family, p_walk_id, me, p_proposed_time, w.scheduled_time)
  returning id into new_id;

  perform log_audit_event(my_family, me, 'time_change_request_created', 'walk', p_walk_id,
    jsonb_build_object('request_id', new_id, 'proposed_time', p_proposed_time));

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function approve_time_change_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
  w record;
begin
  select id into me from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from time_change_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if not is_family_admin(req.family_id) then
    raise exception 'admin permission required';
  end if;

  if req.status = 'approved' then
    return; -- idempotent
  end if;
  if req.status = 'rejected' then
    raise exception 'this request was already rejected';
  end if;

  select * into w from walks where id = req.walk_id for update;
  -- Round 4 gap fix: also re-check that the requester is STILL the walk's
  -- responsible user. Without this, a legitimate reassignment (swap
  -- approval, or an Admin's direct reassignment) between request-creation
  -- and approval left scheduled_time/status alone but silently changed who
  -- the time change actually applies to — e.g. A requests 13:00 -> 14:00,
  -- the walk is reassigned to B while scheduled_time stays 13:00, and
  -- approving A's now-stale request would move B's walk based on a request
  -- B never made. requested_by_user_id doubles as the "expected responsible
  -- user" snapshot here (create_time_change_request() already requires
  -- `w.responsible_user_id = me` at creation, so it IS that value at
  -- request time) — a separate expected_responsible_user_id column would
  -- only duplicate it, so this compares directly instead of adding one.
  if w.id is null
     or w.status <> 'pending'
     or w.scheduled_time <> req.expected_time
     or w.responsible_user_id <> req.requested_by_user_id then
    raise exception 'the walk has changed since this request was created and can no longer be approved';
  end if;

  -- Lets these validated writes through enforce_walk_write_authorization()/
  -- enforce_schedule_entry_write_authorization() (section 3b) — the caller
  -- here is already re-checked as Admin just above, so those triggers'
  -- own is_family_admin() bypass would also cover this, but setting the
  -- flag explicitly keeps this RPC's authority self-contained rather than
  -- incidentally correct (and matches approve_swap_request(), whose caller
  -- is NOT necessarily Admin). Scoped to this transaction only and cleared
  -- right after — see that trigger's doc comment for the full rationale.
  perform set_config('app.trusted_write', 'on', true);
  if w.schedule_entry_id is not null then
    if exists (
      select 1 from schedule_entries se
      where se.dog_id = w.dog_id
        and se.date = w.date
        and se.time = req.proposed_time
        and se.id <> w.schedule_entry_id
    ) then
      perform set_config('app.trusted_write', 'off', true);
      raise exception 'that time is already taken by another scheduled walk';
    end if;
    update schedule_entries set time = req.proposed_time where id = w.schedule_entry_id;
  end if;

  update walks
  set scheduled_time = req.proposed_time, updated_at = now()
  where id = w.id;
  perform set_config('app.trusted_write', 'off', true);

  update time_change_requests
  set status = 'approved', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'time_change_request_approved', 'walk', w.id,
    jsonb_build_object('request_id', p_request_id, 'proposed_time', req.proposed_time));
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function reject_time_change_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
begin
  select id into me from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from time_change_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if not is_family_admin(req.family_id) then
    raise exception 'admin permission required';
  end if;

  if req.status = 'rejected' then
    return; -- idempotent
  end if;
  if req.status = 'approved' then
    raise exception 'this request was already approved';
  end if;

  update time_change_requests
  set status = 'rejected', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'time_change_request_rejected', 'walk', req.walk_id,
    jsonb_build_object('request_id', p_request_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 7. admin_delete_family_member() / regenerate_invite_code() — re-defined
--    identically to their deployed 0004 versions (same validation, same
--    behavior), plus a search_path pin and one log_audit_event() call each.
-- ----------------------------------------------------------------------------

create or replace function admin_delete_family_member(
  target_user_id uuid,
  rule_updates jsonb default '[]'::jsonb,
  entry_updates jsonb default '[]'::jsonb,
  walk_updates jsonb default '[]'::jsonb
)
returns void as $$
declare
  target_family uuid;
  item jsonb;
  elem text;
  caller_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id into target_family from users where id = target_user_id;
  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  for item in select * from jsonb_array_elements(rule_updates) loop
    for elem in select * from jsonb_array_elements_text(item->'rotation_user_ids') loop
      if not exists (
        select 1 from users u
        where u.id = elem::uuid
          and u.family_id = target_family
          and u.removed_at is null
          and u.id <> target_user_id
      ) then
        raise exception 'invalid rotation_user_ids replacement in rule_updates';
      end if;
    end loop;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in entry_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in walk_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(rule_updates) loop
    update schedule_rules
    set rotation_user_ids = (
      select array_agg(elem::text::uuid)
      from jsonb_array_elements_text(item->'rotation_user_ids') as elem
    )
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    update schedule_entries
    set responsible_user_id = (item->>'responsible_user_id')::uuid
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    update walks
    set responsible_user_id = (item->>'responsible_user_id')::uuid,
        updated_at = now()
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  update users
  set removed_at = now()
  where id = target_user_id
    and family_id = target_family;

  select id into caller_id from users where auth_user_id = auth.uid() and family_id = target_family;
  perform log_audit_event(target_family, caller_id, 'family_member_removed', 'user', target_user_id, '{}'::jsonb);
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function regenerate_invite_code(target_family_id uuid)
returns text as $$
declare
  new_code text;
  attempts int := 0;
  caller_id uuid;
begin
  if not is_family_admin(target_family_id) then
    raise exception 'admin permission required';
  end if;

  loop
    new_code := generate_invite_code();
    attempts := attempts + 1;
    begin
      update families set invite_code = new_code where id = target_family_id;
      exit;
    exception when unique_violation then
      if attempts > 20 then
        raise exception 'could not generate a unique invite_code';
      end if;
    end;
  end loop;

  select id into caller_id from users where auth_user_id = auth.uid() and family_id = target_family_id;
  perform log_audit_event(target_family_id, caller_id, 'invite_code_rotated', 'family', target_family_id, '{}'::jsonb);

  return new_code;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 8. user_presence — lightweight "last seen" tracking, Admin-only to read
--    (kept as its OWN table rather than a users.last_seen_at column: the
--    existing "select users in own family" policy is family-wide, since
--    every member legitimately needs everyone's name/avatar for rosters and
--    walk rows — adding a presence column directly to `users` would leak it
--    to every member via that same broad policy, not just Admin, which
--    this requirement explicitly rules out ("Admin-only ... in RLS")).
-- ----------------------------------------------------------------------------

create table if not exists user_presence (
  user_id uuid primary key references users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table user_presence enable row level security;

drop policy if exists "read presence (admin or self)" on user_presence;
create policy "read presence (admin or self)" on user_presence
  for select using (
    family_id = current_family_id()
    and (is_family_admin(family_id) or user_id = current_profile_id())
  );
-- No insert/update/delete policy — only touch_last_seen() (below) writes
-- here, self-only, and only for the caller's own claimed profile.

create or replace function touch_last_seen()
returns void as $$
declare
  my_user_id uuid;
  my_family uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select id, family_id into my_user_id, my_family from users
  where auth_user_id = auth.uid() and family_id = current_family_id() and removed_at is null;

  if my_user_id is null then
    return; -- no active claimed profile yet (e.g. still on "pick your profile") — nothing to record
  end if;

  insert into user_presence (user_id, family_id, last_seen_at)
  values (my_user_id, my_family, now())
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at, family_id = excluded.family_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- Admin-only activity listing. Deliberately returned via a function rather
-- than opened up as a broader SELECT policy on `users`/`family_auth_members`
-- — keeps auth_user_id itself off the wire entirely (requirement: "Do NOT
-- expose raw auth_user_id to normal users"), and self-checks admin
-- permission so this can never be called as a "current family role" oracle
-- by a non-admin device.
create or replace function admin_list_family_activity()
returns table (
  user_id uuid,
  name text,
  avatar text,
  role text,
  removed_at timestamptz,
  last_seen_at timestamptz
) as $$
begin
  if not is_family_admin(current_family_id()) then
    raise exception 'admin permission required';
  end if;

  return query
  select
    u.id,
    u.name,
    u.avatar,
    fam.role,
    u.removed_at,
    up.last_seen_at
  from users u
  left join family_auth_members fam on fam.auth_user_id = u.auth_user_id
  left join user_presence up on up.user_id = u.id
  where u.family_id = current_family_id()
  order by u.removed_at nulls first, up.last_seen_at desc nulls last, u.name;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Admin-only paginated audit log reader (RLS on audit_log already restricts
-- SELECT to admins, but this keeps ordering/pagination in one server-side
-- place and validates limit/offset — "Consider pagination rather than
-- loading an unlimited history.").
create or replace function admin_list_audit_log(p_limit int default 50, p_offset int default 0)
returns table (
  id uuid,
  actor_user_id uuid,
  actor_name text,
  action text,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz
) as $$
begin
  if not is_family_admin(current_family_id()) then
    raise exception 'admin permission required';
  end if;
  if p_limit < 1 or p_limit > 200 then
    p_limit := 50;
  end if;
  if p_offset < 0 then
    p_offset := 0;
  end if;

  return query
  select al.id, al.actor_user_id, u.name, al.action, al.target_type, al.target_id, al.metadata, al.created_at
  from audit_log al
  left join users u on u.id = al.actor_user_id
  where al.family_id = current_family_id()
  order by al.created_at desc
  limit p_limit offset p_offset;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 9. Audit triggers — walks / schedule_rules / users.
--
-- These cover the audit events that (unlike swap/time-change requests,
-- which already go through narrow RPCs) currently happen via ordinary
-- direct table writes from the client: mark-done, add-a-spontaneous-walk,
-- schedule-rule create/edit/delete, and profile edit/claim. Rather than
-- rewriting every one of those call sites into a bespoke RPC just to get an
-- audit line, a row-level AFTER trigger observes the change itself —
-- meaning an event can only ever be logged if the change actually happened
-- (no client can "claim" an event without doing it), and the trigger
-- functions derive the actor from auth.uid()/current_profile_id() (or, for
-- profile_claimed, from the very row being claimed), NEVER from any
-- client-supplied value. This is what "prefer trustworthy server-authored
-- audit events" and "do not trust arbitrary client-supplied actor IDs"
-- mean applied to writes that were never going to become RPCs.
--
-- Every trigger function is SECURITY DEFINER (so it can call the
-- otherwise-locked-down log_audit_event()) with search_path pinned, exactly
-- like the RPCs above.
-- ----------------------------------------------------------------------------

-- 9a. walks — "spontaneous walk added" (on insert of an unplanned walk) and
-- "walk completed" (on the pending -> done transition). A spontaneous walk
-- is inserted already `status = 'done'` (see scheduleStore.addUnplannedWalk),
-- so these two conditions never both fire for the same write — no double
-- logging.
create or replace function audit_walk_change()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.is_unplanned then
      perform log_audit_event(
        new.family_id, current_profile_id(), 'spontaneous_walk_added', 'walk', new.id,
        jsonb_build_object(
          'date', new.date, 'time', new.scheduled_time,
          'responsible_user_id', new.responsible_user_id,
          'had_pee', new.had_pee, 'had_poop', new.had_poop
        )
      );
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'done' then
    perform log_audit_event(
      new.family_id, current_profile_id(), 'walk_completed', 'walk', new.id,
      jsonb_build_object(
        'date', new.date, 'time', new.scheduled_time,
        'completed_by_user_id', new.completed_by_user_id,
        'had_pee', new.had_pee, 'had_poop', new.had_poop
      )
    );
  end if;

  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists walks_audit on walks;
create trigger walks_audit
  after insert or update on walks
  for each row execute function audit_walk_change();

-- 9b. schedule_rules — created / edited / deleted. `current_profile_id()` is
-- still resolvable inside a DELETE trigger (it only depends on auth.uid()
-- and the users table, not on the row being deleted).
create or replace function audit_schedule_rule_change()
returns trigger as $$
declare
  fam uuid;
  actor uuid;
begin
  fam := coalesce(new.family_id, old.family_id);
  actor := current_profile_id();

  if tg_op = 'INSERT' then
    perform log_audit_event(fam, actor, 'schedule_rule_created', 'schedule_rule', new.id,
      jsonb_build_object('time', new.time, 'label', new.label));
    return new;
  elsif tg_op = 'UPDATE' then
    perform log_audit_event(fam, actor, 'schedule_rule_edited', 'schedule_rule', new.id,
      jsonb_build_object('time', new.time, 'label', new.label));
    return new;
  elsif tg_op = 'DELETE' then
    perform log_audit_event(fam, actor, 'schedule_rule_deleted', 'schedule_rule', old.id,
      jsonb_build_object('time', old.time, 'label', old.label));
    return old;
  end if;

  return null;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists schedule_rules_audit on schedule_rules;
create trigger schedule_rules_audit
  after insert or update or delete on schedule_rules
  for each row execute function audit_schedule_rule_change();

-- 9c. users — "profile claimed" and "profile edited".
--
-- profile_claimed fires exactly when auth_user_id transitions from null to
-- non-null (claim_family_profile()'s own guarded UPDATE, or the identical
-- effect of admin-assisted claiming) — the row IS the actor here, since
-- claim_family_profile() only ever lets someone claim a profile as
-- themselves (auth_user_id is set to auth.uid()).
--
-- profile_edited fires on a genuine change to name/avatar/color/photo_url —
-- deliberately EXCLUDING a removed_at transition (admin_delete_family_member()
-- already logs 'family_member_removed' itself; logging both would be a
-- confusing duplicate for the same click) and excluding the claim itself
-- (handled above). The actor is current_profile_id() — the real,
-- currently-authenticated caller — since an edit can legitimately be made
-- either by the member themselves or by an admin editing someone else (the
-- existing "Self + Admin" RLS policy already allows both); target_user_id
-- (new.id) is who was edited, which may differ from the actor.
create or replace function audit_user_profile_change()
returns trigger as $$
begin
  if old.auth_user_id is null and new.auth_user_id is not null then
    perform log_audit_event(new.family_id, new.id, 'profile_claimed', 'user', new.id, '{}'::jsonb);
    return new;
  end if;

  if old.removed_at is null and new.removed_at is not null then
    return new; -- already logged as 'family_member_removed' by the RPC that did this
  end if;

  if old.name is distinct from new.name
     or old.avatar is distinct from new.avatar
     or old.color is distinct from new.color
     or old.photo_url is distinct from new.photo_url then
    perform log_audit_event(new.family_id, current_profile_id(), 'profile_edited', 'user', new.id,
      jsonb_build_object('name', new.name));
  end if;

  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists users_audit on users;
create trigger users_audit
  after update on users
  for each row execute function audit_user_profile_change();
