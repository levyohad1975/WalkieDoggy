-- ----------------------------------------------------------------------------
-- 0106_schedule_entry_time_override_flag.sql
--
-- P0 BUG: editing a scheduled walk's time via admin_reschedule_walk (0026)
-- did not survive an app restart — the next schedule load reverted it back
-- to the rule's recurring time.
--
-- ROOT CAUSE (confirmed by tracing the full client+server write path, no
-- live reproduction needed): admin_reschedule_walk correctly persists a
-- one-off time edit to BOTH walks.scheduled_time and the linked
-- schedule_entries.time (see 0026's own body) — the write itself was never
-- the problem. src/store/scheduleStore.ts's loadScheduleForFamily() runs
-- src/logic/rotation.ts's planStaleRuleEntryReconciliation() on EVERY
-- schedule load as a self-heal for a different, older bug (entries left
-- stuck at a stale time by a rule-time edit made before commit 807e4db's
-- reconciliation fix shipped). That self-heal's test for "is this entry
-- stale" was simply `entry.time !== rule.time` for every entry of that
-- (rule, date) — but schedule_entries.time's own, pre-existing doc comment
-- already documents per-entry time overrides as a deliberate, supported
-- feature ("editable per-entry without touching the rule"). A deliberate
-- one-off edit and a genuine pre-807e4db stale leftover are therefore
-- STRUCTURALLY INDISTINGUISHABLE by time value alone — both look like "no
-- entry for this (rule, date) matches the rule's time" — so the self-heal
-- silently reverted every deliberate one-off edit back to the rule's time
-- on the very next load, exactly matching the reported symptom.
--
-- FIX: add an explicit, persisted bit recording "this entry's time was
-- deliberately overridden for this occurrence only" — admin_reschedule_walk
-- now sets it when it updates schedule_entries.time. The client-side self-
-- heal (planStaleRuleEntryReconciliation) now treats any entry with this
-- flag set as correctly represented regardless of its time value, so it is
-- never again reverted — see that function's own updated doc comment in
-- src/logic/rotation.ts for the exact rule. Local/demo mode's equivalent
-- write path (scheduleStore.rescheduleWalk's non-Supabase branch) sets the
-- same flag client-side, with no server column to update there.
--
-- Never cleared automatically once set: a one-off edit is permanent for
-- that occurrence, by design (see EditWalkModal's own "שינוי חד-פעמי, לא
-- משפיע על שאר הסבב" subtitle) — nothing in this migration or the
-- self-heal clears it, and no other path should either.
--
-- BACKWARD COMPATIBILITY — `not null default false` means every existing
-- row (including ones with a historical, undetected one-off edit from
-- before this migration) defaults to "not overridden." Such a row, if it
-- genuinely still diverges from its rule's time, will be corrected by the
-- self-heal exactly once more on the next load after this migration ships
-- — a one-time, harmless re-convergence for any pre-existing edit, not a
-- regression: it is the exact same "revert to rule time" behavior those
-- rows were already subject to before this fix, just not repeated forever
-- afterward once the admin re-applies the edit (which will now set the
-- flag and stick).
-- ----------------------------------------------------------------------------

alter table schedule_entries
  add column if not exists time_overridden boolean not null default false;

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

  if not is_family_admin(w.family_id) then
    raise exception 'admin permission required';
  end if;

  if w.status <> 'pending' then
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
    -- 0106 FIX: mark this occurrence's entry as deliberately overridden so
    -- the client's stale-rule-entry self-heal (planStaleRuleEntryReconciliation
    -- in src/logic/rotation.ts) never reverts this edit back to the rule's
    -- recurring time on a later schedule load — see this migration's header.
    update schedule_entries set time = p_new_time, time_overridden = true where id = w.schedule_entry_id;
  end if;

  update walks
  set scheduled_time = p_new_time, updated_at = now()
  where id = w.id;

  perform set_config('app.trusted_write', 'off', true);

  perform log_audit_event(w.family_id, me, 'walk_admin_rescheduled', 'walk', w.id,
    jsonb_build_object('old_time', old_time, 'new_time', p_new_time));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- Grants unchanged from 0026 — re-asserted defensively, same convention
-- used throughout this schema when create-or-replace touches a function's
-- grants-sensitive body.
revoke all on function admin_reschedule_walk(uuid, text) from public;
grant execute on function admin_reschedule_walk(uuid, text) to authenticated;

comment on function admin_reschedule_walk(uuid, text) is
  'Family Admin DIRECT time edit for a pending walk (Batch 3, Task 6) — not a request, no approval step. Admin-gated server-side via is_family_admin() (false during impersonation). Checks schedule_entries collisions, updates walks.scheduled_time and the linked schedule_entries.time (+ time_overridden=true, so the client self-heal never reverts this one-off edit — see 0106) under app.trusted_write, and logs a walk_admin_rescheduled audit event. The server-side walk-reminder-scheduler (0025) recomputes fire_at from the new scheduled_time on its own next run, so no separate reminder-cleanup step is needed here.';
