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

Queue item 6 sub-task — credential-free QA_RELEASE_GUARDIAN.md sweep
("real device notification-open behavior" theme) over the native
notification-open / deep-link entry point:
`src/notifications/notificationService.ts`'s
`subscribeToWalkReminderResponses()`, `src/notifications/reminderEntry.ts`,
its `HomeScreen.tsx` consumer, and `App.tsx`'s wiring of it at cold start.
Selected per the prior cycle's own "Next Safe Task" note, as the one named
QA_RELEASE_GUARDIAN.md theme not yet covered by a dedicated sweep.

## Current Task Status

DONE for the sweep; the fix it produced is implemented, type-checked, and
test-covered in the working tree this cycle, but **NOT YET COMMITTED** —
see Blocker (`git add` is gated behind the same recurring
interactive-approval prompt as several prior cycles). The next cycle must
commit this fix first, before selecting a new task, so the queue history
stays continuous.

**Housekeeping first:** this cycle found that the *previous* cycle's
"NOT YET COMMITTED" fix (the webhook timing-safe signature comparison) had
actually already been committed and pushed as `e52c7ae` — that commit
included both the fix and that cycle's own `EXECUTION_STATE.md` update, but
the narrative text in this file (written before the commit succeeded) was
never revised afterward to say so. Confirmed via `git show --stat e52c7ae`
(touches exactly `supabase/functions/email-provider-webhook/index.ts`,
`src/lib/__tests__/emailDeliveryLog.test.ts`, and this file) and `git log
origin/feat/verified-auth-onboarding-batch-2` (this branch's HEAD matches).
No action was needed beyond correcting this file's record — nothing was
lost. **New finding, fixed this cycle:** `subscribeToWalkReminderResponses()`
— the sole function that turns a real OS notification tap (cold-launch or
live) into the `reminderEntry.publishReminderOpen()` event `HomeScreen.tsx`
reacts to (its mascot reminder prompt) — had **zero test coverage**, and
not by omission alone: the shared `jest.setup.js` mock for
`expo-notifications` never exposed
`getLastNotificationResponseAsync`/`clearLastNotificationResponseAsync`/
`addNotificationResponseReceivedListener`, so the function's own
`if (!Notifications?.addNotificationResponseReceivedListener) return () =>
undefined;` guard silently made it a no-op under any test that happened to
call it — the exact cold-launch "consume the last response once so a later
normal Home visit can't replay it" logic (the part most likely to silently
regress) was entirely untested. Fixed by extending the shared mock
(`jest.setup.js`) with those three APIs, adding a test-only
`__resetReminderEntryForTests()` hook to `reminderEntry.ts` (mirrors
`notificationService.ts`'s existing `__resetNotificationCapabilityCacheForTests()`
pattern, needed so one test's `publishReminderOpen()` can't leak into
another's `subscribeToReminderOpens()` call via its "replay last event to a
late subscriber" behavior), and adding 6 new tests to
`notificationService.test.ts` covering: cold-launch dispatch of a genuine
payload + exactly-once `clearLastNotificationResponseAsync`, cold-launch
with no pending response, cold-launch with a foreign/malformed payload
(rejected), the live OS listener dispatching correctly, the returned
unsubscribe function removing the OS subscription, and a Web/unavailable
environment being a safe no-op that touches no notification API. This is
code-review-plus-test-coverage evidence only — a real device still cannot
be exercised in this sandbox (see Blocker), so live tap-to-open UX itself
remains unverified on hardware; the finding does not block RC readiness on
its own, but closes the coverage gap this exact sweep exists to catch.
Also confirmed no other release-blocking gap in the code read for this
sweep: `App.tsx` subscribes once at cold start and unsubscribes on
unmount, cleanly independent of `restoreSession()`; `HomeScreen.tsx`'s
`reminderPromptMessage` guards against a stale/foreign walk id and a
resolved (`!== 'pending'`) walk before ever rendering the prompt, and its
copy goes through `renderMessageTemplate`'s existing gender-neutral
`dogSex` convention; `navigation.navigate('Home')` targets a real,
flat (non-nested) bottom-tab route (`RootNavigator.tsx`), so there is no
nested-stack pop-to-top gap; `MascotFrameAnimation` (used by
`ReminderMascotPrompt`) correctly defaults to `reducedMotion = true` before
the OS setting resolves and honors `reduceMotionChanged` thereafter — no
RTL or Reduced-Motion gap found.

Fresh (this-cycle) independent read against the QA_RELEASE_GUARDIAN.md
themes:

- **Finding (fixed in working tree, uncommitted):**
  `supabase/functions/email-provider-webhook/index.ts`'s
  `verifySvixSignature()` compared the computed HMAC signature against
  each `svix-signature` header candidate with a plain `candidate ===
  expected` — a short-circuiting string comparison that leaks
  byte-position-dependent timing information, in principle letting a
  network attacker recover a valid signature one byte at a time (a
  textbook CWE-208 timing side-channel), unlike its sibling function
  `send-email/index.ts`, which delegates its own signature check to the
  vetted `standardwebhooks` library. Blast radius was already narrow (a
  forged signature could only flip an email's own delivery-status row via
  `update_email_delivery_status()` — no auth/family-membership/RLS
  exposure), but the fix was small, safe, and fully local, so it was
  implemented rather than only logged: added a `timingSafeBase64Equal()`
  helper (decodes both sides, returns false on invalid base64 without
  throwing, requires equal length, then XORs and accumulates over every
  byte with no early exit) and switched the `.some()` comparison to use
  it. Covered by a new source-contract test in
  `src/lib/__tests__/emailDeliveryLog.test.ts` (`'compares the webhook
  signature in constant time instead of a short-circuiting ==='`) asserting
  the old `=== expected` pattern is gone and the new helper/XOR-accumulate
  logic is present. No RLS/migration/schema change — code-only, no
  production action.
- **Everything else checked, no release-blocking gap:** `0034`'s RLS shape
  (no client policies, service-role-only mutation RPCs re-checking
  `auth.role() = 'service_role'`, admin-gated read RPC re-checking
  `is_system_admin()`) matches the same trust model as `system_audit_log`
  (0024)/`family_onboarding_requests` (0032) reviewed in prior cycles.
  `create-verified-family`'s `sendAndLogEmail()` correctly logs both the
  `'sent'` and `'failed'` outcome of every welcome/system-owner send
  attempt without ever letting a *logging* failure escalate a best-effort
  email failure (logging errors are only `console.error`'d, never thrown)
  and without dropping the existing `warnings` array contract callers
  already depend on. `send-email`'s OTP hook never logs the token, hook
  secret, Resend key, or raw/parsed payload — only fixed generic messages
  on failure — and correctly reads the raw body with `req.text()` and
  verifies it via the vetted library before any JSON parsing. Both
  webhook-style functions (`send-email`, `email-provider-webhook`) reject
  with 401 before the body is trusted, matching `config.toml`'s
  `verify_jwt = false` only being set for the two functions that need it.
  No dog-sex copy in any of the four files (family/admin-facing copy
  only). Emails use `dir="rtl"` correctly; not app-screen RTL so the
  broader RTL/nativeDirection convention doesn't apply here.
- **Separately noted, not actionable:** `system_admin_list_email_delivery_log()`
  (0034's admin read RPC, correctly gated on `is_system_admin()`) has no
  client-side caller anywhere in the repository — checked
  `src/lib/systemAdmin.ts`, `SystemAdminScreen.tsx` on both the current
  branch and the stacked `feat/system-admin-approval-controls`
  branch/PR #11 via `git grep` across `origin/feat/system-admin-approval-controls`,
  `origin/feat/settings-roles-batch-3`, and `origin/main`: zero matches for
  the RPC name in any `src/` file on any branch. The write path (log +
  webhook-driven status updates) is real and exercised; only the
  admin-facing *view* of that log has no UI. This is a genuine
  observability gap in spirit, but building that admin panel is squarely
  "Expanded admin audit/analytics/reports", which `EXECUTION_STATE.md`'s
  own Explicitly-Out-of-Scope list already excludes from this Release
  Candidate — so it is recorded here as a known limitation for a future,
  separately-scoped ticket, not treated as a blocker of this RC.

Local validation gate re-run on the current branch with the fix applied —
see Last Evidence. Queue item 7's Supabase-regression half remains
BLOCKED — see Blocker (this cycle also confirmed `npm view` registry
access is gated the same way, so installing the `supabase` CLI is not an
option in this sandbox either).

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
  clean tree, HEAD `e52c7ae`. `git show --stat e52c7ae` confirmed this
  commit already contains BOTH the prior cycle's webhook timing-safe-comparison
  fix (`supabase/functions/email-provider-webhook/index.ts`,
  `src/lib/__tests__/emailDeliveryLog.test.ts`) AND that cycle's own
  `EXECUTION_STATE.md` update, and `git log origin/...` confirmed it is
  pushed — so, despite this file's own prior text saying "NOT YET
  COMMITTED", the fix was in fact already committed and pushed before that
  cycle ended; only this file's narrative was stale. Nothing was lost, no
  recovery action was needed. Trigger's target sha
  `7f0bd8465801f257a3bf00b6e7a3beacb70f1529` is not a known object in this
  repository (`git cat-file -t` returns nothing) — same recurring "branch
  has legitimately advanced past a stale dispatch sha" situation as prior
  cycles, not a drift to reconcile.
- Reconfirmed this cycle: `gh auth status` and `npm view <pkg> version`
  (registry access) both still require interactive approval with no owner
  present in this sandbox's permission mode; `which supabase` confirms the
  CLI is still not installed; `docker ps` succeeds (daemon reachable, zero
  containers running) but no local Supabase stack is running. Queue item 7's
  Supabase-regression half remains blocked on tooling/access, unchanged
  from prior cycles.
- QA sweep performed (Queue item 6 sub-task, this cycle): full read of
  `src/notifications/notificationService.ts` (`subscribeToWalkReminderResponses()`
  and its cold-launch/live-listener logic), `src/notifications/reminderEntry.ts`,
  `src/screens/HomeScreen.tsx`'s `subscribeToReminderOpens`/`reminderPromptMessage`
  consumer, `src/components/ReminderMascotPrompt.tsx`,
  `src/components/MascotFrameAnimation.tsx` (Reduced Motion), `App.tsx`'s
  cold-start wiring, and `src/navigation/RootNavigator.tsx` (confirmed
  `navigation.navigate('Home')` targets a real flat bottom-tab route, no
  nested-stack pop-to-top gap). Finding and fix: see Current Task Status
  above.
- Fix implemented this cycle (uncommitted, working tree only — see
  Blocker): `jest.setup.js` (extended the
  shared `expo-notifications` mock with `getLastNotificationResponseAsync`,
  `clearLastNotificationResponseAsync`, `addNotificationResponseReceivedListener`),
  `src/notifications/reminderEntry.ts` (added test-only
  `__resetReminderEntryForTests()`), and
  `src/notifications/__tests__/notificationService.test.ts` (6 new tests
  under a new `subscribeToWalkReminderResponses` describe block). `git diff`
  inspected directly — scoped to exactly this fix, no unrelated changes.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: **917** passed, 917 total (911 baseline + 6 new tests this cycle);
  Snapshots: 0 total; Time ~20.5s.
- `git add` (retried once, not repeatedly) required interactive approval
  with no owner present in this sandbox's permission mode — same recurring
  blocker prior cycles hit intermittently. **NOT YET COMMITTED** — see
  Blocker for the required next-cycle recovery step. The fix itself is
  fully evidenced above (tsc/test PASS against the exact working-tree diff),
  it is only the commit/push step that is blocked this cycle.

## Last Evidence Timestamp

2026-09-13T20:10:00Z

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
permission mode (reconfirmed this cycle, `gh auth status` → requires
approval), so GitHub-side PR/CI state (PR #7, PR #11, workflow run
metadata) still cannot be pulled directly. This is a secondary, independent
blocker from the Staging-credentials one above; it affects only
GitHub-metadata inspection, not local repository work, which proceeded
normally. `docker` itself is reachable this cycle, but no local Supabase
stack is running and the `supabase` CLI is not installed, so Queue item 7's
Supabase-regression half stays blocked on tooling, not on the
`docker`-approval issue specifically.

THIS CYCLE ONLY — the same intermittent blocker recurred again: `git add`
was gated behind an interactive approval prompt with no owner present in
this cycle's sandbox permission mode, retried once and still blocked
(read-only commands — `git status`/`git log`/`git diff`/`git show`/
`git branch`/`git cat-file` — were unaffected and ran normally throughout).
**Three files (`jest.setup.js`, `src/notifications/reminderEntry.ts`,
`src/notifications/__tests__/notificationService.test.ts`) plus this
file's own update have a real, validated fix sitting uncommitted in the
working tree** (notification-open test coverage — see Current Task
Status/Last Evidence). `npx tsc --noEmit` and `npm test -- --runInBand`
(917/917) both PASS against the current working tree including this fix,
so the fix itself is fully evidenced even though it has not yet been
committed or pushed. **The next cycle's very first action must be
`git add jest.setup.js src/notifications/reminderEntry.ts
src/notifications/__tests__/notificationService.test.ts EXECUTION_STATE.md
&& git commit` (check `git status`/`git diff` first to confirm nothing
else changed and no unrelated work is swept in), then push, before
selecting any new task.** This same `git add` gate has now recurred across
multiple non-consecutive cycles (it cleared normally in between, including
for `e52c7ae`) — still looks like sandbox-side permission-mode variance per
cycle, not anything fixable from inside the repository.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

**First, before anything else:** commit and push the three files already
fixed and validated in this cycle's working tree (see Blocker) —
`jest.setup.js`, `src/notifications/reminderEntry.ts`,
`src/notifications/__tests__/notificationService.test.ts` — together with
this file's own update. Re-run `npx tsc --noEmit`/`npm test --
--runInBand` once more right before committing only if any other change
has touched the tree meanwhile; otherwise this cycle's PASS result already
covers exactly this diff.

After that is committed and pushed: re-attempt Queue item 7's still-open
Supabase-regression half via `gh`/a local Supabase stack (only if the
sandbox's permission mode allows it that cycle — this cycle reconfirmed
both `gh auth status` and `npm view` registry access are gated, and the
`supabase` CLI is still not installed, so this has now failed the same way
for five cycles running). If still blocked: every named
QA_RELEASE_GUARDIAN.md theme (email delivery/observability, RTL/responsive
+ dog-sex copy + mascot/Reduced Motion, production-sensitive System Admin
operations, and now real-device notification-open behavior) has now had a
dedicated credential-free sweep across every Batch 3/4 surface and both
stacked branches' distinct feature UI. The next independent credential-free
sub-task would be a second-pass re-audit of the single highest-risk area
(System Admin approval transition + email delivery, both touching
money-adjacent trust/security boundaries), re-verified against current
`git log`/`git diff` rather than this file's past sweep lists in case new
commits landed on either stacked branch since the last read.

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

- Housekeeping: corrected this file's stale "NOT YET COMMITTED" claim from
  the previous cycle — that cycle's webhook timing-safe-comparison fix was
  actually already committed and pushed as `e52c7ae`; only this file's own
  narrative had not been updated to reflect it. No repository action
  needed beyond the correction.
- Queue item 6 sub-task — QA_RELEASE_GUARDIAN.md sweep ("real device
  notification-open behavior" theme) over the notification-open/deep-link
  entry point: `notificationService.ts`'s `subscribeToWalkReminderResponses()`,
  `reminderEntry.ts`, `HomeScreen.tsx`'s consumer, `ReminderMascotPrompt.tsx`/
  `MascotFrameAnimation.tsx`, `App.tsx`'s cold-start wiring, and
  `RootNavigator.tsx`. Found and **fixed** a real test-coverage gap:
  `subscribeToWalkReminderResponses()` — the function that turns a real OS
  notification tap into the mascot reminder prompt — had zero test
  coverage, and the shared `expo-notifications` jest mock didn't even
  expose the APIs it needs, so the function's own unavailable-guard made it
  silently a no-op under any test that called it. Extended `jest.setup.js`'s
  mock, added a test-only `__resetReminderEntryForTests()` hook to
  `reminderEntry.ts`, and added 6 new tests to `notificationService.test.ts`
  covering cold-launch dispatch/consume-once, no-response, malformed
  payload rejection, the live OS listener, unsubscribe cleanup, and the
  Web/unavailable no-op path. No other release-blocking gap found in the
  surface read (RTL, Reduced Motion, navigation target all correct — see
  Current Task Status for detail). Re-ran the full local validation gate:
  `npx tsc --noEmit` PASS, `npm test -- --runInBand` 89/89 suites,
  **917/917** tests PASS (911 baseline + 6 new).
  **NOT YET COMMITTED** — `git add` was gated behind the same recurring
  interactive-approval prompt as several prior cycles; see Blocker for the
  required next-cycle recovery step. Reconfirmed `gh auth status` and
  `npm view` (registry access) are both still approval-gated and no
  `supabase` CLI is available, so Queue item 7 stays blocked for another
  cycle.

### Previous cycle (for continuity)

- Queue item 3 sub-task — QA_RELEASE_GUARDIAN.md sweep ("email
  delivery/observability and failure handling" theme) over
  `0034_email_delivery_log.sql`, `create-verified-family/index.ts`,
  `email-provider-webhook/index.ts`, `send-email/index.ts`. Found and
  **fixed** a real timing-side-channel gap: the Resend webhook's
  signature check used a short-circuiting `===` instead of a
  constant-time comparison. Added `timingSafeBase64Equal()` in
  `supabase/functions/email-provider-webhook/index.ts` and a covering test
  in `src/lib/__tests__/emailDeliveryLog.test.ts`. Also confirmed (noted,
  not actionable — out of RC scope) that the admin read RPC
  `system_admin_list_email_delivery_log()` has no client-side UI consumer
  on any branch. Committed and pushed as `e52c7ae` (together with that
  cycle's own state-file update).

- Queue item 8 sub-task — QA_RELEASE_GUARDIAN.md sweep (RTL/responsive,
  dog-sex/grammatical copy, mascot/Reduced Motion, production-sensitive
  System Admin operations) over the System Admin approve/reject feature
  on stacked branch `feat/system-admin-approval-controls` (PR #11) —
  `SystemAdminScreen.tsx`, `systemAdmin.ts`, `systemAdminApprovalFlow.ts`,
  migration `0036_atomic_family_approval_transition.sql` — plus a
  Settings/Roles pass on `SettingsScreen.tsx`/`FamilyScreen.tsx`. No
  release-blocking gap found; no code changes required that cycle.
  Committed and pushed as `d03e6da`.
- Queue item 8 sub-task (cycle before that) — QA_RELEASE_GUARDIAN.md sweep
  (RTL/responsive, dog-sex/grammatical copy, mascot/Reduced Motion) over
  `EditWalkModal.tsx`/`SwapWalkPickerModal.tsx`/
  `FamilyOnboardingScreen.tsx`'s 0028 invite-preview block/
  `HistoryScreen.tsx`/`StatisticsScreen.tsx`. No release-blocking gap
  found. Committed and pushed as `bc490fc`.
- Queue item 5 (two cycles before that) — Batch 4 regression: full read of
  migrations 0026/0027/0028/0031 and their client call sites
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
