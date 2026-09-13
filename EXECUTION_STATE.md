# EXECUTION_STATE.md — Walkie Doggy Agentic Execution V1

This file is the **single execution source of truth** for the Release
Candidate work in progress. It is read and updated by every execution
worker (Claude, Codex, or otherwise) at the start and end of every cycle.

The operating loop is always:

> **Execute → Produce Evidence → Update State → Select Next Safe Task → Execute again.**

A worker never stops simply because one task is blocked. A blocker on one
path must not stop execution when another independent safe Release
Candidate task exists. See `docs/engineering/AGENTIC_EXECUTION_V1.md` for
the full protocol, state machine, and evidence rules this file is governed
by.

Allowed task states: `READY`, `RUNNING`, `VERIFYING`, `DONE`, `BLOCKED`,
`STALLED`, `WAITING_APPROVAL`.

---

## Release / Goal

Issue #3 — verified-admin family onboarding and System Admin approval
controls, driven to Release Candidate readiness. Owner → Control Room →
Claude Execution Worker → GitHub/CI/Staging → Evidence → Next Safe Task.

## Current Task

Queue item 8 (QA Guardian sub-task) — credential-free QA_RELEASE_GUARDIAN.md
sweep (Hebrew RTL/responsive, dog-sex/grammatical copy, mascot/Reduced
Motion, plus production-sensitive System Admin operations) over the
System Admin family approve/reject feature on the stacked
`feat/system-admin-approval-controls` branch (PR #11) and a light
Settings/Roles pass on `SettingsScreen.tsx`/`FamilyScreen.tsx`. Selected
per the prior cycle's own "Next Safe Task" note, since Queue item 7's
Supabase-regression half was re-confirmed still blocked this cycle (see
Last Evidence/Blocker) and this sub-task does not depend on it.

## Current Task Status

DONE. Fresh (this-cycle) independent read against the QA_RELEASE_GUARDIAN.md
themes. No release-blocking gap found:

- System Admin approve/reject (`src/screens/SystemAdminScreen.tsx`,
  `src/lib/systemAdmin.ts`'s `setSystemAdminFamilyApproval`,
  `src/lib/systemAdminApprovalFlow.ts`, migration
  `0036_atomic_family_approval_transition.sql`, all read via `git show
  origin/feat/system-admin-approval-controls:<path>` — this branch is not
  an ancestor of the current branch, so its content is not in this
  checkout): the mutation RPC re-checks `is_system_admin()` server-side,
  row-locks the family (`for update`), only allows a `pending` ->
  `active`/`rejected` transition, and re-verifies `approval_status =
  'pending'` in the `UPDATE` itself so a concurrent decision raises
  `'family approval changed concurrently'` instead of silently
  double-applying — genuine defense in depth, not just a UI-hidden
  button. `commitFamilyApprovalAndRefresh()` deliberately calls
  `onCommitted()` (clearing the stale approve/reject controls) before the
  fallible follow-up read, and a distinct `SystemAdminApprovalRefreshError`
  is surfaced so a refresh failure after a successful commit reads as
  "saved, but reload the panel" rather than as a failed decision the
  admin might retry (which would just hit the now-correct "no longer
  pending" guard, not double-apply, but would be a confusing UX dead
  end) — covered by
  `src/lib/__tests__/systemAdminApprovalFlow.test.ts` and
  `src/lib/__tests__/systemAdminApprovalIntegration.test.ts`'s
  source-contract assertions on both the screen and the migration.
  RTL: the new `familyTitleRow`/`actionRow` styles use bare
  `flexDirection: 'row-reverse'` with no `nativeDirection` pin, but this
  matches this exact file's own pre-existing, un-pinned `row`/
  `row-reverse` rows (list-item container, search row) — per the
  established convention (see prior cycle's `EditWalkModal.tsx` chip-grid
  note and `theme/tokens.ts`'s `nativeDirection` doc comment),
  `nativeDirection` is only needed to *override* the automatic RTL flip
  for rows whose physical order must stay fixed (digits, Countdown.tsx's
  bug); a name+status-badge row has no such fixed-order meaning to
  preserve, so the ambient RTL flip is the correct behavior here, not a
  gap. No dog-sex copy anywhere in this feature (family-level admin
  decision text only, no dog reference).
- Settings/Roles: `SettingsScreen.tsx` (already merged to `main`/this
  branch, no separate stacked-branch content to fetch) — all copy via
  `RtlText`, right-aligned; `hubRow`/`dogCard` use
  `flexDirection:'row'` + `nativeDirection('ltr')` correctly pinning
  against the ambient flip so icon/chevron/label physical order stays
  fixed regardless of RTL; no dog pronouns; no mascot/motion on this
  screen. `FamilyScreen.tsx`'s member-role labels (`row.role === 'admin'
  ? 'מנהל' : 'בן משפחה'`) are pre-existing (carries "Round 6F/7/8" QA-fix
  comments already, unrelated to Batches 3/4 or either stacked branch)
  and not dog-sex copy at all — noted, not actionable: unlike the dog-name
  fallback's established "X/ה" gender-neutral pattern used elsewhere in
  this app, these two role labels have no neutral-slash form, but
  relabeling a role string is a copy/design-language decision (Joint work
  per `AGENTS.md`'s Creative/Engineering routing), not a code-correctness
  or security defect, and is out of this QA sweep's scope to change
  unilaterally.

Local validation gate reconfirmed on the current branch with zero code
changes needed for this sweep — see Last Evidence. Queue item 7's
Supabase-regression half remains BLOCKED — see Blocker.

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- Repo state reconciled at cycle start: on `feat/verified-auth-onboarding-batch-2`,
  clean tree, HEAD `bc490fc` (the prior cycle's own successful commit of
  its Queue-item-8 QA sweep close-out and this file's update — confirmed
  via `git show --stat bc490fc`: `EXECUTION_STATE.md` only, no source
  changes — so the prior cycle's own "THIS CYCLE ONLY" git-add-approval
  blocker resolved itself before that cycle ended too, same pattern as the
  cycle before it; nothing was lost or needs redoing). Trigger's target
  sha `eff4228` remains an older ancestor on this same branch; branch has
  legitimately advanced past it since dispatch, not a drift to reconcile.
- `gh auth status` and `git add EXECUTION_STATE.md` both again required
  interactive approval with no owner present in this sandbox's permission
  mode this cycle — same recurring blockers already on file, retried once
  each (not repeatedly) to reconfirm still current, not new information.
  `docker ps` succeeded (daemon reachable, zero containers running) but no
  local Supabase stack is running and the `supabase` CLI is still not
  installed — Queue item 7's Supabase-regression half remains blocked for
  the same reason as prior cycles.
- QA sweep performed (Queue item 8 sub-task, this cycle): read-only
  inspection of the System Admin approve/reject feature via `git show
  origin/feat/system-admin-approval-controls:<path>` for
  `src/screens/SystemAdminScreen.tsx`, `src/lib/systemAdmin.ts`,
  `src/lib/systemAdminApprovalFlow.ts`,
  `supabase/migrations/0036_atomic_family_approval_transition.sql`,
  `src/lib/__tests__/systemAdminApprovalFlow.test.ts`, and
  `src/lib/__tests__/systemAdminApprovalIntegration.test.ts` (that branch
  is not an ancestor of the current branch's HEAD, so its working tree was
  never checked out — `git checkout --detach` was attempted to also run
  that branch's own test suite locally and was itself gated behind the
  same interactive-approval prompt as `git add`, so this sweep is
  code-reading evidence only, not a fresh test run on that branch); plus a
  same-checkout read of `src/screens/SettingsScreen.tsx` and
  `src/screens/FamilyScreen.tsx` for Settings/Roles. Finding: sound, no
  release-blocking gap — full reasoning recorded in Current Task Status
  above.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: 910 passed, 910 total; Snapshots: 0 total; Time ~11s. No test or
  source changes were needed for this cycle's QA sweep on the current
  branch — this run reconfirms the exact baseline the prior cycle already
  left green.

## Last Evidence Timestamp

2026-09-13T17:15:00Z

## Blocker

Live Staging E2E (family creation persistence, invite/join code/link/QR,
second-member join, real OTP/email delivery, System Admin live approve/
reject) requires a real non-Production Supabase project and a Resend
account with a verified sending domain. Neither is available in this
sandbox: no `.env`, no linked Supabase project, no Resend/Supabase
account-level tool, no `supabase` CLI, no privileged Docker confirmed for a
local stack. Two unblock options were posted on PR #7: (A) the owner runs
the non-Production deployment/config steps and shares evidence to verify,
or (B) the owner grants this session the credentials directly. Unanswered
as of the last check.

Separately, `gh` CLI access itself remains gated behind an interactive
approval prompt with no owner present to answer it in this sandbox's
permission mode (reconfirmed this cycle, `gh auth status` → "This command
requires approval"), so GitHub-side PR/CI state (PR #7, PR #11, workflow
run metadata) still cannot be pulled directly. This is a secondary,
independent blocker from the Staging-credentials one above; it affects
only GitHub-metadata inspection, not local repository work, which
proceeded normally. `docker` itself is reachable this cycle, but no local
Supabase stack is running and the `supabase` CLI is not installed, so
Queue item 7's Supabase-regression half stays blocked on tooling, not on
the `docker`-approval issue specifically.

THIS CYCLE ONLY — the same intermittent blocker recurred again: `git add`
(and, newly this cycle, `git checkout --detach <other-branch>` for
read-only inspection) were gated behind an interactive approval prompt
with no owner present in this cycle's sandbox permission mode (read-only
commands — `git status`/`git log`/`git diff`/`git show`/`git branch`/
`git fetch`/`git merge-base` — were unaffected and ran normally
throughout, which is how this cycle's QA sweep read the other branches'
file content without ever switching this checkout's HEAD). The two prior
cycles each hit this same `git add` gate and it resolved itself before
the cycle ended (`9656c76`, then `bc490fc`, both committed successfully);
if it does not clear by the end of this cycle either, this file's own
update is recorded in the working tree only, NOT committed or pushed this
cycle, and the next cycle should re-attempt committing this file first,
before selecting a new task, so the queue history stays continuous.
Nothing is lost either way — this is only this cycle's own edit, not
prior work. Given the pattern across three cycles now (blocked →
resolved → blocked → resolved, with no code-side trigger), this continues
to look like sandbox-side permission-mode variance per cycle rather than
anything fixable from inside the repository.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

This cycle's Queue item 8 sub-task (QA_RELEASE_GUARDIAN.md sweep over the
System Admin approve/reject feature on stacked branch
`feat/system-admin-approval-controls`/PR #11, plus a Settings/Roles pass)
is closed out with no actionable defect found (see Current Task
Status/Last Evidence above). Next: re-attempt Queue item 7's still-open
Supabase-regression half via `gh`/a local Supabase stack (only if the
sandbox's permission mode and available tooling allow it that cycle — the
`supabase` CLI has not been installed in any cycle so far); if still
blocked, the QA_RELEASE_GUARDIAN.md sweep (Queue item 8) has now covered
every named Batch 3/4 surface plus both stacked branches' distinct
feature UI (System Admin approve/reject, invite-preview, reschedule/swap,
History/Statistics, Settings/Roles) — the next independent credential-free
sub-task would be re-reading the email-delivery surface (Queue item 3's
`email_delivery_log`/Resend-webhook code, e.g.
`supabase/migrations/0034_email_delivery_log.sql` and its client/webhook
handler) for the same QA themes, since that is release-critical, has a
dedicated migration already visible via `git show
origin/feat/system-admin-approval-controls:<path>` the same way this
cycle's sweep worked, and does not require live Resend credentials to
review the code and RLS/authorization shape (only the live send/webhook
path itself needs Staging credentials, which stay blocked).

## Approval Required

None currently pending. Will be set to a specific action (merge, deploy,
migration, secrets/data change, or another irreversible/high-impact
action) the moment one is reached, and execution stops at
`WAITING_APPROVAL` until the owner responds.

## Active Worker

_(name/session id of the worker currently holding `RUNNING`, if any)_

## Heartbeat Status

OK

## Queue

Release Candidate queue, in priority order (see
`docs/engineering/AGENTIC_EXECUTION_V1.md` section D for the full
definition of each item and the explicitly-out-of-scope list):

1. Complete Staging family-creation E2E from verified OTP through:
   persisted family, invite/join code, join link, QR, second-member join.
2. Validate `AUTO_APPROVE_NEW_FAMILIES=true/false` plus System Admin
   approve/reject.
3. Validate release-critical: welcome email, system-owner email, Resend
   webhook, `email_delivery_log`.
4. Settings / Roles / System Admin QA and release-blocking fixes.
5. Batch 4 regression.
6. Real iPhone E2E: RTL, navigation, family flows.
7. Full CI and Supabase regression.
8. QA Guardian.

Then: **RELEASE CANDIDATE APPROVAL GATE** — stop and request owner
approval. Do not proceed past this gate autonomously.

Items 1–3 and 6 require the live Staging credentials described in
Blocker above. Items 4, 5, and 7 have independent, credential-free
sub-tasks (repository-level QA, regression sweeps, CI runs) that can
proceed even while 1–3/6 are blocked.

## Completed This Cycle

- Queue item 8 sub-task — QA_RELEASE_GUARDIAN.md sweep (RTL/responsive,
  dog-sex/grammatical copy, mascot/Reduced Motion, production-sensitive
  System Admin operations) over the System Admin approve/reject feature
  on stacked branch `feat/system-admin-approval-controls` (PR #11) —
  `SystemAdminScreen.tsx`, `systemAdmin.ts`, `systemAdminApprovalFlow.ts`,
  migration `0036_atomic_family_approval_transition.sql` — plus a
  Settings/Roles pass on `SettingsScreen.tsx`/`FamilyScreen.tsx`. No
  release-blocking gap found; no code changes required this cycle.
  Re-ran the full local validation gate as evidence: `npx tsc --noEmit`
  PASS, `npm test -- --runInBand` 89/89 suites, 910/910 tests PASS (this
  file's Last Evidence entry, 2026-09-13T17:15:00Z). Reconfirmed `gh` CLI
  is still approval-gated in this sandbox and no local Supabase stack/CLI
  is available, so Queue item 7 stays blocked for another cycle.

### Previous cycle (for continuity)

- Queue item 8 sub-task — QA_RELEASE_GUARDIAN.md sweep (RTL/responsive,
  dog-sex/grammatical copy, mascot/Reduced Motion) over
  `EditWalkModal.tsx`/`SwapWalkPickerModal.tsx`/
  `FamilyOnboardingScreen.tsx`'s 0028 invite-preview block/
  `HistoryScreen.tsx`/`StatisticsScreen.tsx`. No release-blocking gap
  found. Committed and pushed as `bc490fc`.
- Queue item 5 — Batch 4 regression: full read of migrations
  0026/0027/0028/0031 and their client call sites
  (`walkAdmin.ts`/`invites.ts`/`permissionedWalks.ts`/`scheduleStore.ts`/
  `walkActions.ts`/`supabaseRepository.ts`/`FamilyOnboardingScreen.tsx`/
  `HomeScreen.tsx`/`errorMessages.ts`). No release-blocking gap found.
  Committed and pushed as `9656c76`.

## Explicitly Out of Scope

- GPS / automatic walk detection
- Inactive-family lifecycle / deletion
- Expanded admin audit/analytics/reports
- Support / help desk
- Cosmetic email branding
- Any other backlog feature not in the Queue above
