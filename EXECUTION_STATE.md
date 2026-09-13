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

Queue item 2/4 sub-task — credential-free QA_RELEASE_GUARDIAN.md sweep over
a previously-unswept surface: the **applicant-facing** family-approval-status
flow on stacked branch `feat/system-admin-approval-controls` (PR #11) —
`src/screens/FamilyOnboardingScreen.tsx`'s `refreshOnboardingStatus()`/
`AppState` effect and `src/lib/verifiedAdminOnboarding.ts`'s
`getMyFamilyOnboardingStatus()`. Prior cycles had already swept the
*admin-side* approve/reject screen (`SystemAdminScreen.tsx`) on this same
stacked branch, but not this applicant-side status-recovery flow — selected
after noticing (via `git log origin/feat/verified-auth-onboarding-batch-2..
origin/feat/system-admin-approval-controls`) that this flow exists as its
own distinct commit sequence (`fb63a48`, `b67829d`, `0a2b880`, `449f04b`)
not called out in any prior cycle's sweep notes.

## Current Task Status

DONE for the sweep, with one real finding — see below. **No source-code
change was made this cycle**: the affected file
(`src/screens/FamilyOnboardingScreen.tsx` with the approval-status code)
does not exist on this run's `TARGET_BRANCH`
(`feat/verified-auth-onboarding-batch-2`) at all; it only exists on the
stacked branch `feat/system-admin-approval-controls`, which this run is not
authorized to commit or push to (this run's instructions restrict edits/
commits/pushes to the same `TARGET_BRANCH` only). The finding is therefore
recorded here for the next cycle that runs against that branch, or for the
owner reviewing PR #11, rather than fixed in place. This file's own
recording of that finding is, however, a real edit to this branch, and it
is **NOT YET COMMITTED** this cycle — see Blocker (`git add` gated again).

**Housekeeping first:** this cycle found that the *previous* cycle's
"NOT YET COMMITTED" fix (the notification-open test-coverage gap —
`jest.setup.js`, `src/notifications/reminderEntry.ts`,
`src/notifications/__tests__/notificationService.test.ts`) had actually
already been committed and pushed as `16d4a17` (together with that cycle's
own `EXECUTION_STATE.md` update) — this is the same "fix landed, narrative
in this file went stale" pattern as the `e52c7ae` correction two cycles
ago. Confirmed via `git show --stat 16d4a17` (touches exactly those three
files plus this file) and `git log origin/feat/verified-auth-onboarding-batch-2`
(branch HEAD matches, working tree clean). Nothing was lost; no recovery
action was needed beyond correcting this file's record.

**New finding this cycle (not fixed — see Current Task Status above for
why): applicant-side family-approval-status recovery can hijack the user
out of `join`/`redeem` mode mid-flight.** In
`src/screens/FamilyOnboardingScreen.tsx` (stacked branch), a `useEffect`
calls `refreshOnboardingStatus(false)` unconditionally on mount and on every
`AppState` `'active'` transition (i.e. every time the app is
backgrounded and foregrounded), regardless of the screen's current `mode`.
Inside `refreshOnboardingStatus()`, if `getMyFamilyOnboardingStatus()`
returns a `pending` or `rejected` status, it unconditionally calls
`setMode('create')` — even if the user has since navigated away to `mode
=== 'join'` or `mode === 'redeem'` to join a *different* family. Traced the
full chain: `getMyFamilyOnboardingStatus()` →
`get_my_family_onboarding_status()` (migration
`0032_verified_family_onboarding.sql`) is keyed on `r.auth_user_id =
auth.uid()` — the *current Supabase auth session's* uid — and
`ensureAnonymousSession()` (called by both `confirmJoin()` and
`confirmRedeem()` before their own RPC calls) is a no-op whenever a session
already exists (`src/lib/supabase.ts`: `if (data.session) return;`), so a
verified admin's OTP-established session is never replaced. Concretely: a
verified admin whose family-creation request is `pending` or `rejected`,
who then chooses "יש לי הזמנה" (redeem) or "הצטרפות למשפחה קיימת" (join) to
join a *different* family instead, and who backgrounds the app for any
reason while on that screen (the redeem flow's own instructions literally
tell them to paste a link/code "received from a family member" — normally
copied from Mail/Messages/WhatsApp, which requires backgrounding this app)
gets bounced back to the `create`-mode pending/rejected-status view on
return, losing their place in the join/redeem flow (typed input state
itself is preserved in separate `useState`, so this is lost navigation
progress, not lost data, but it recurs on every subsequent
background/foreground cycle while the stale request stays non-`active`,
potentially trapping a `rejected` applicant in a loop with no way to
complete joining a different family from that device without avoiding
ever backgrounding the app). Confirmed this is not already covered by any
test: `src/lib/__tests__/systemAdminApprovalIntegration.test.ts`'s
`'recovers applicant status on mount, foreground, and explicit retry'` and
both `FamilyOnboardingScreen.*.test.ts` files are plain source-text scans
(no React Native component-rendering test infra exists in this repo per
their own doc comments), so none of them exercise the actual `mode`
interaction — the source-text assertions would pass unchanged even with
this bug present. Suggested fix direction for whichever cycle/PR owns that
branch: only let `refreshOnboardingStatus()` call `setMode('create')` when
`mode` is already `'choose'` or `'create'` (i.e. treat it as recovery for a
user who hasn't deliberately navigated elsewhere), not unconditionally.
Queue item 6's notification-open finding (`subscribeToWalkReminderResponses()`
test-coverage gap) remains correctly fixed and committed as `16d4a17` — see
"Previous cycle" under Completed This Cycle below for the full record; not
repeated here to keep this section from re-accumulating stale duplicate
detail across cycles the way it had before this cycle's cleanup (this
paragraph replaces several cycles' worth of inline history that had built
up here — the same content is preserved, non-duplicated, further down in
this file's Completed This Cycle / Previous cycle log).

Local validation gate re-run this cycle with zero working-tree changes
(this cycle's finding is on a branch this run cannot edit) — see Last
Evidence. Queue item 7's Supabase-regression half remains BLOCKED — see
Blocker (reconfirmed again this cycle: `gh auth status` gated,
`supabase` CLI not installed).

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- This cycle: `git show --stat 16d4a17` confirmed the previous cycle's
  notification-open fix (`jest.setup.js`, `src/notifications/reminderEntry.ts`,
  `src/notifications/__tests__/notificationService.test.ts`) plus that
  cycle's own `EXECUTION_STATE.md` update were already committed and pushed
  before that cycle ended — this file's own "NOT YET COMMITTED" narrative
  had simply gone stale (same pattern as the `e52c7ae` correction two
  cycles ago). `git status` confirmed a clean working tree at cycle start.
  Dispatch target sha `7f0bd8465801f257a3bf00b6e7a3beacb70f1529` resolved
  this cycle (unlike prior cycles) to a real commit — `git branch -a
  --contains` shows it lives on `origin/main` only ("fix(ci): allow trusted
  GitHub Actions bot to dispatch RC worker (#27)", a workflow-dispatch
  permission fix, unrelated to this branch's own content) — not an
  ancestor or descendant of this branch's HEAD; not a drift to reconcile,
  just dispatch metadata pointing at `main`'s tip.
- Reconfirmed this cycle: `gh auth status` requires interactive approval
  with no owner present in this sandbox's permission mode; `which supabase`
  confirms the CLI is still not installed. Queue item 7's Supabase-
  regression half remains blocked on tooling/access, unchanged from prior
  cycles.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: **917** passed, 917 total; Snapshots: 0 total; Time ~21.5s.
- QA sweep performed (Queue item 2/4 sub-task, this cycle): full read of
  `src/screens/FamilyOnboardingScreen.tsx` (stacked branch
  `feat/system-admin-approval-controls`, via `git show
  origin/feat/system-admin-approval-controls:<path>` — not an ancestor of
  this branch) and `src/lib/verifiedAdminOnboarding.ts`'s
  `getMyFamilyOnboardingStatus()`/`getMyFamilyOnboardingStatusWithClient()`,
  cross-referenced against `supabase/migrations/0032_verified_family_onboarding.sql`'s
  `get_my_family_onboarding_status()` (keyed on `auth.uid()`) and
  `src/lib/supabase.ts`'s `ensureAnonymousSession()` (confirmed a no-op
  whenever a session already exists). Also checked both
  `FamilyOnboardingScreen.*.test.ts` files and
  `systemAdminApprovalIntegration.test.ts` to confirm no existing test
  exercises the `mode`-interaction bug found (all are source-text scans,
  per their own doc comments, since this repo has no RN component-render
  test infra). Found one real, unfixed-this-cycle defect — see Current Task
  Status above for the full chain of evidence. No repository change made:
  the affected file does not exist on this run's `TARGET_BRANCH`.
- `git status` reconfirmed clean working tree after the sweep (no edits
  were made, consistent with the finding living on a branch this run
  cannot touch).

## Last Evidence Timestamp

2026-09-13T21:10:00Z

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

A new, independent blocker was confirmed this cycle, specific to one
finding: this cycle's QA sweep found a real applicant-side navigation bug
in `src/screens/FamilyOnboardingScreen.tsx` (see Current Task Status), but
that file only exists on stacked branch `feat/system-admin-approval-controls`
(PR #11), not on this run's `TARGET_BRANCH`
(`feat/verified-auth-onboarding-batch-2`). This run's own instructions
restrict edits/commits/pushes to the same `TARGET_BRANCH` only, so the fix
cannot be applied here. **This finding needs either: (A) a future cycle
dispatched with `TARGET_BRANCH=feat/system-admin-approval-controls`, or
(B) the owner/a reviewer applying the suggested fix directly on PR #11.**
It does not block this branch's own RC work and is independent of every
other blocker below.

The previously recurring `git add`/commit approval-gate issue (logged in
several prior cycles, e.g. before `16d4a17`) recurred again this cycle:
`git add EXECUTION_STATE.md` was gated behind an interactive approval
prompt with no owner present, retried once and still blocked (read-only
commands — `git status`/`git diff`/`git log`/`git show`/`git branch`/
`git cat-file`/`git merge-base` — were unaffected and ran normally
throughout this cycle). **This cycle's own `EXECUTION_STATE.md` edits
(recorded above) are sitting uncommitted in the working tree** — `git
status`/`git diff` confirm they are the *only* modified file, no unrelated
work. There is no source-code fix pending this time (this cycle made no
code changes — see Current Task Status), so the only next-cycle recovery
step is: confirm with `git status`/`git diff EXECUTION_STATE.md` that
nothing else has changed, then `git add EXECUTION_STATE.md && git commit`,
then push, before selecting a new task. This gate has now recurred across
many non-consecutive cycles (clearing normally in between, e.g. for
`16d4a17`/`d03e6da`) — sandbox-side permission-mode variance per cycle,
not fixable from inside the repository.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

Every named QA_RELEASE_GUARDIAN.md theme (email delivery/observability,
RTL/responsive + dog-sex copy + mascot/Reduced Motion, production-sensitive
System Admin operations including now both the admin-decision side and the
applicant-status side, and real-device notification-open behavior) has now
had a dedicated credential-free sweep across every Batch 3/4 surface and
both stacked branches' distinct feature UI. The next independent
credential-free sub-task: re-attempt Queue item 7's still-open
Supabase-regression half via `gh`/a local Supabase stack (only if the
sandbox's permission mode allows it that cycle — blocked for six cycles
running so far). If still blocked, the next candidate is a second-pass
re-audit of `src/lib/invites.ts`/`inspectFamilyInviteDetail()` and
`redeemFamilyInvite()` (Round 4 invite-redemption token handling) — read
during this cycle's `FamilyOnboardingScreen.tsx` sweep but not itself
re-audited end-to-end this cycle — re-verified against current
`git log`/`git diff` rather than this file's past sweep lists, in case new
commits landed on either stacked branch since the last read. A future
cycle with `TARGET_BRANCH=feat/system-admin-approval-controls` should
prioritize fixing this cycle's `FamilyOnboardingScreen.tsx` finding first.

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
  the previous cycle — that cycle's notification-open test-coverage fix
  was actually already committed and pushed as `16d4a17`; only this file's
  own narrative had not been updated to reflect it. No repository action
  needed beyond the correction. Also compacted this file's own
  accumulated multi-cycle inline history in "Current Task Status" (several
  cycles' worth of un-trimmed sweep detail had built up there) down to
  pointers into this Completed-This-Cycle log, to keep the file legible
  going forward.
- Queue item 2/4 sub-task — QA_RELEASE_GUARDIAN.md sweep over the
  applicant-facing family-approval-status flow on stacked branch
  `feat/system-admin-approval-controls` (PR #11) —
  `FamilyOnboardingScreen.tsx`'s `refreshOnboardingStatus()`/`AppState`
  effect and `verifiedAdminOnboarding.ts`'s `getMyFamilyOnboardingStatus()`
  — a surface not covered by any prior cycle's sweep of that branch (prior
  cycles covered the admin-side `SystemAdminScreen.tsx` only). **Found one
  real, unfixed defect** (full chain of evidence in Current Task Status
  above): the applicant-status recovery effect unconditionally forces
  `mode` back to `'create'` on every app foreground whenever this device's
  verified-admin identity has a `pending`/`rejected` family request, even
  if the user has since navigated to `'join'`/`'redeem'` to join a
  *different* family — and the redeem flow's own UX (paste a code/link
  "received from a family member") routinely requires backgrounding the
  app to fetch that code, triggering exactly this. **Not fixed this
  cycle**: the file only exists on that stacked branch, which this run's
  `TARGET_BRANCH` restriction does not permit editing/committing/pushing
  to — see Blocker. No test currently catches this (confirmed both
  `FamilyOnboardingScreen.*.test.ts` files and
  `systemAdminApprovalIntegration.test.ts` are source-text scans only).
  Re-ran the full local validation gate on this branch (zero code changes
  made): `npx tsc --noEmit` PASS, `npm test -- --runInBand` 89/89 suites,
  **917/917** tests PASS. Reconfirmed `gh auth status` gated and
  `supabase` CLI not installed, so Queue item 7 stays blocked for another
  cycle.

### Previous cycle (for continuity)

- Queue item 6 sub-task — QA_RELEASE_GUARDIAN.md sweep ("real device
  notification-open behavior" theme) over `notificationService.ts`'s
  `subscribeToWalkReminderResponses()`, `reminderEntry.ts`,
  `HomeScreen.tsx`'s consumer, `ReminderMascotPrompt.tsx`/
  `MascotFrameAnimation.tsx`, `App.tsx`'s cold-start wiring, and
  `RootNavigator.tsx`. Found and **fixed** a real test-coverage gap: the
  function that turns a real OS notification tap into the mascot reminder
  prompt had zero test coverage, and the shared `expo-notifications` jest
  mock didn't even expose the APIs it needs. Extended `jest.setup.js`'s
  mock, added a test-only `__resetReminderEntryForTests()` hook to
  `reminderEntry.ts`, and added 6 new tests to `notificationService.test.ts`.
  No other release-blocking gap found (RTL, Reduced Motion, navigation
  target all correct). Committed and pushed as `16d4a17`.
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
  on any branch. Committed and pushed as `e52c7ae`.
- Queue item 8 sub-task — QA_RELEASE_GUARDIAN.md sweep (RTL/responsive,
  dog-sex/grammatical copy, mascot/Reduced Motion, production-sensitive
  System Admin operations) over the System Admin approve/reject feature
  on stacked branch `feat/system-admin-approval-controls` (PR #11) —
  `SystemAdminScreen.tsx`, `systemAdmin.ts`, `systemAdminApprovalFlow.ts`,
  migration `0036_atomic_family_approval_transition.sql` — plus a
  Settings/Roles pass on `SettingsScreen.tsx`/`FamilyScreen.tsx`. No
  release-blocking gap found; no code changes required that cycle.
  Committed and pushed as `d03e6da`.

## Explicitly Out of Scope

- GPS / automatic walk detection
- Inactive-family lifecycle / deletion
- Expanded admin audit/analytics/reports
- Support / help desk
- Cosmetic email branding
- Any other backlog feature not in the Queue above
