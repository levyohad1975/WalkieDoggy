-- ----------------------------------------------------------------------------
-- 0026_admin_reschedule_walk.sql
--
-- BATCH 3 — Task 6: DIRECT ADMIN TIME EDIT.
--
-- Upgrade-safe on top of the 0001-0025 baseline. Adds exactly one new RPC,
-- admin_reschedule_walk(p_walk_id, p_new_time) — no table/column changes.
--
-- WHY THIS IS NEEDED: enforce_walk_write_authorization() (latest definition
-- in 0015) already blocks a NON-admin from changing walks.scheduled_time
-- directly (it requires an approved time-change request instead), and
-- already lets an admin (is_family_admin(family_id)) through untouched.
-- That means a raw client UPDATE of walks.scheduled_time, issued from an
-- authenticated admin session, is already NOT a client-trust vulnerability
-- — the trigger is the real gate either way. However, two real gaps exist
-- in that raw-update path that approve_time_change_request() (0006) already
-- solved for the request/approval flow and this migration now gives the
-- direct-admin-edit path too:
--   1. No schedule_entries time-collision check — a raw update could leave
--      two schedule_entries-backed walks for the same dog/day/time.
--   2. No audit logging at all for a time change — audit_walk_change()
--      (0005, still the sole/authoritative definition) only logs an
--      unplanned-walk insert or a status transition to 'done'/'skipped', not
--      a scheduled_time change via any path.
--
-- This function mirrors approve_time_change_request()'s exact pattern
-- (admin check via is_family_admin — which already resolves to `false`
-- while the caller is impersonating, see is_family_admin's 0006 definition
-- — collision check, app.trusted_write bypass so the direct-edit trigger
-- branch is skipped instead of the request-required branch, then an audit
-- event) rather than inventing a new one. It is NOT a time-change request:
-- it writes walks.scheduled_time (and the linked schedule_entries.time, if
-- any) immediately, with no counterpart request row and no approval step —
-- exactly the "DIRECT EDIT ... administrative action by Family Admin ...
-- NOT a request" distinction the batch's spec requires.
--
-- Reminder self-healing (requirement: "old reminder event keys do not
-- suppress reminders for the new time"): walk_reminder_events (0025) keys
-- delivery bookkeeping on (walk_id, stage, fire_at, recipient_user_id),
-- where fire_at is recomputed live from walks.scheduled_time on every
-- scheduler run (see 0025's Part 1 comment: "editing a walk's time changes
-- every stage's computed fire_at, so the OLD key becomes irrelevant on its
-- own, with nothing to detect or clean up"). Because this function updates
-- the authoritative walks.scheduled_time column exactly like every other
-- reschedule path in this codebase, that self-healing applies here with no
-- extra work — the walk-reminder-scheduler pg_cron job simply computes a
-- new fire_at from the new time on its next run and schedules against that.
-- ----------------------------------------------------------------------------

create or replace function admin_reschedule_walk(p_walk_id uuid, p_new_time text)
returns void as $$
declare
  me uuid;
  w record;
  old_time text;
begin
  if p_new_time !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'invalid time format';
  end if;

  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into w from walks where id = p_walk_id for update;
  if w.id is null or w.family_id is distinct from current_family_id() then
    raise exception 'walk not found in this family';
  end if;

  -- Server-side authorization is this check, not any client-supplied flag.
  -- is_family_admin() already returns false while the caller is
  -- impersonating (0006), so an admin who is currently impersonating a
  -- member cannot reach this direct-edit path either — matching the
  -- "admin status alone must not grant responsible-member actions, and
  -- impersonation must behave exactly like that simulated member" rules
  -- elsewhere in this codebase.
  if not is_family_admin(w.family_id) then
    raise exception 'admin permission required';
  end if;

  if w.status <> 'pending' then
    -- Reuses the exact phrase create_time_change_request() (0006) already
    -- raises for the same condition, so this new RPC's rejection is picked
    -- up by the SAME existing friendlyErrorMessage() Hebrew mapping
    -- (src/lib/errorMessages.ts) without needing a new entry there.
    raise exception 'walk is no longer pending';
  end if;

  old_time := w.scheduled_time;
  if p_new_time = old_time then
    return; -- idempotent no-op — nothing changed, nothing to audit.
  end if;

  perform set_config('app.trusted_write', 'on', true);

  if w.schedule_entry_id is not null then
    if exists (
      select 1 from schedule_entries se
      where se.dog_id = w.dog_id
        and se.date = w.date
        and se.time = p_new_time
        and se.id <> w.schedule_entry_id
    ) then
      perform set_config('app.trusted_write', 'off', true);
      raise exception 'that time is already taken by another scheduled walk';
    end if;
    update schedule_entries set time = p_new_time where id = w.schedule_entry_id;
  end if;

  update walks
  set scheduled_time = p_new_time, updated_at = now()
  where id = w.id;

  perform set_config('app.trusted_write', 'off', true);

  perform log_audit_event(w.family_id, me, 'walk_admin_rescheduled', 'walk', w.id,
    jsonb_build_object('old_time', old_time, 'new_time', p_new_time));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- Same tightened-grants convention as 0023's newer permission-override RPCs
-- (revoke the Postgres default PUBLIC-executable grant, re-grant only to
-- authenticated) rather than 0006's looser default, since this is new code.
revoke all on function admin_reschedule_walk(uuid, text) from public;
grant execute on function admin_reschedule_walk(uuid, text) to authenticated;

comment on function admin_reschedule_walk(uuid, text) is
  'Family Admin DIRECT time edit for a pending walk (Batch 3, Task 6) — not a request, no approval step. Admin-gated server-side via is_family_admin() (false during impersonation). Checks schedule_entries collisions, updates walks.scheduled_time (and the linked schedule_entries.time) under app.trusted_write, and logs a walk_admin_rescheduled audit event. The server-side walk-reminder-scheduler (0025) recomputes fire_at from the new scheduled_time on its own next run, so no separate reminder-cleanup step is needed here.';
