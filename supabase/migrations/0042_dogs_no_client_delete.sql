-- ============================================================================
-- 0042_dogs_no_client_delete.sql
--
-- Closes a real, first-time-discovered gap found by a systematic sweep of
-- every non-SELECT RLS policy across all 41 prior migrations: `dogs` is the
-- only table in this schema whose "own family" write policy was ever
-- written as a single `for all` (schema.sql:528-529, still the current
-- applied definition -- no migration 0001-0041 ever touches a policy on
-- `dogs`), which folds INSERT/UPDATE/**DELETE** into one check that only
-- verifies `family_id = current_family_id()` -- i.e. "any authenticated
-- member of this family", with no admin gate and, more importantly, no
-- consideration of what DELETE on this table actually does.
--
-- Why this is a real, reachable gap, not a style nitpick:
--
-- schema.sql declares all three of these as `on delete cascade` (never
-- `restrict`, unlike users.*_user_id):
--   schedule_rules.dog_id   references dogs(id) on delete cascade
--   schedule_entries.dog_id references dogs(id) on delete cascade
--   walks.dog_id            references dogs(id) on delete cascade
--
-- Postgres's own row-security documentation is explicit that a
-- foreign-key-triggered cascade always bypasses RLS on the referencing
-- (child) table -- it has to, to preserve referential integrity regardless
-- of who is allowed to see/touch those child rows directly. That means
-- `schedule_rules`'s own admin-only insert/update/delete policies (0004,
-- the established convention for "permanent schedule configuration" this
-- exact migration deliberately introduced for schedule_rules but never
-- extended to `dogs`) and `walks`'s history-window SELECT policy (0027)
-- are both irrelevant once a `dogs` row is deleted: the cascade fires
-- unconditionally and deletes every schedule_rules/schedule_entries/walks
-- row for that dog, wiping the family's entire schedule and walk history.
--
-- Concrete reachable scenario: any ordinary, non-admin Member -- a
-- legitimately claimed persona with a real, currently-valid session, no
-- exotic race needed -- can call `DELETE FROM dogs WHERE id = ...` directly
-- (e.g. `supabase.from('dogs').delete().eq('id', dogId)`, or any equivalent
-- PostgREST call) for their own family's dog. The RN app's own UI never
-- exposes such a button (src/screens/SettingsScreen.tsx only wires
-- upsert/save for the dog, never delete), but per this schema's own
-- repeatedly-established threat model -- UI gating is a convenience, RLS is
-- the only real boundary -- that is irrelevant: `"modify dogs in own
-- family"` has no admin check and would allow it, cascading to
-- unrecoverably delete the whole family's schedule and history with a
-- single REST call.
--
-- Fix, matching this schema's own established convention exactly: `users`
-- already has this exact precedent (0003_family_admin_roles.sql
-- deliberately dropped its own DELETE policy with the comment
-- "Intentionally no DELETE policy... blocked by RLS" once a real
-- soft-delete flow existed). There is no "delete a dog" feature anywhere in
-- this app (confirmed: no client call site, no UI, and a family has
-- exactly one dog row created only via create_verified_family()/
-- create_family(), both SECURITY DEFINER and unaffected by this table's
-- client-facing RLS policies), so the correct fix is the same: split the
-- single `for all` into INSERT/UPDATE (kept open to any family member,
-- preserving today's actual behavior -- any member may edit the dog's
-- name/photo, per supabaseRepository.ts's plain `.upsert()` call with no
-- role gating) and add no DELETE policy at all, so RLS blocks every
-- client-issued DELETE on `dogs` unconditionally.
-- ============================================================================

drop policy if exists "modify dogs in own family" on dogs;

create policy "insert dogs in own family" on dogs
  for insert with check (family_id = current_family_id());

create policy "update dogs in own family" on dogs
  for update using (family_id = current_family_id())
  with check (family_id = current_family_id());

-- Intentionally no DELETE policy on `dogs` -- see the comment block above.
-- No client feature ever deletes a dog row, and doing so would cascade-
-- delete the family's entire schedule_rules/schedule_entries/walks history
-- (all three are `on delete cascade`), bypassing every other table's own
-- RLS policies in the process since FK cascades are not subject to RLS.
