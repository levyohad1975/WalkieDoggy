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

Queue item 1/2 credential-free sub-task, per the previous cycle's own
"Next Safe Task" pointer: second-pass re-audit of `src/lib/invites.ts`
(`inspectFamilyInvite`/`inspectFamilyInviteDetail`/`redeemFamilyInvite`,
Round 4 invite-redemption token handling) on **this run's own
`TARGET_BRANCH`** (`feat/verified-auth-onboarding-batch-2`, not a stacked
branch this time — so any defect found here would actually be fixable in
this cycle). Re-verified against current `git log`/file contents rather
than relying on the prior sweep list, covering the full chain: migrations
`0008_family_invites.sql`, `0009_family_invites_pgcrypto_fix.sql`,
`0028_family_invite_detail_preview.sql`; the client wrapper
`src/lib/invites.ts` and its test file; the UI consumers
`src/components/InviteShareModal.tsx` and `src/screens/FamilyOnboardingScreen.tsx`'s
`redeem` mode (`inspectInvite`/`confirmRedeem`); and
`src/store/authStore.ts`'s `completeInviteRedemption()`/
`retryPendingInviteRedemptionVerification()`/`verifyAndCommitPendingRedemption()`
or the whoami-verified commit ordering.

## Current Task Status

DONE. **No defect found** — this surface is already heavily hardened (the
migrations alone document 9 correction rounds; `authStore.ts`'s redemption
path documents its own "Round 4" whoami-verification-before-commit
ordering with an explicit three-way verified/unverified/mismatch outcome).
Specifically checked and found correct: token is 256-bit
server-generated randomness, hashed (sha256) before storage, never
returned by list/inspect endpoints; `redeem_family_invite()` takes a
`select ... for update` row lock before branching on status (serializes
concurrent redemption of the same token); expiry is derived
(`status='pending' AND expires_at<=now()`), never a persisted status;
target-family/removed/already-claimed are all re-checked fresh at
redemption time, not trusted from invite-creation time; the collision
guards (different-family / already-has-a-claimed-profile) fail closed;
the invite-detail enrichment (dog photo + member list, migration 0028)
is gated to `status = 'pending'` only, matching `inspect_family_invite()`'s
existing minimal-disclosure default for every other status; the client
(`InviteShareModal.tsx`) never auto-opens the link (explicit Hebrew copy
tells the user so) and drops the raw token from memory on modal close;
`FamilyOnboardingScreen.tsx`'s `redeem` mode never logs/persists the raw
token (confirmed no `AsyncStorage`/Zustand/`console.*` reference to
`redeemToken`/`redeemInput`); `authStore.ts`'s
`verifyAndCommitPendingRedemption()` only commits `familyId`/`currentUserId`
after a fresh `getWhoAmI()` confirms `realProfileId === pending.targetUserId`,
leaves the pending marker untouched on an inconclusive (offline/RPC-failure)
check rather than guessing, and never re-calls `redeemFamilyInvite()` on
retry (replaying an already-consumed token would incorrectly surface
"invite already used"). Also explicitly confirmed this branch's own
(simpler, pre-approval-feature) `FamilyOnboardingScreen.tsx` does **not**
contain the `refreshOnboardingStatus()`/`AppState`-driven `setMode('create')`
effect that the previous cycle found buggy on stacked branch
`feat/system-admin-approval-controls` — that logic genuinely does not exist
on this branch (this branch's file predates that feature entirely, per
`git log --oneline -- src/screens/FamilyOnboardingScreen.tsx` showing only
`08c5074`/`0ba307b`/`37db85e`), so the previous cycle's "file doesn't exist
on this TARGET_BRANCH" reconciliation was correct, not stale.

No code changes were made this cycle (nothing to fix). This is a valid
`DONE` sweep outcome, same as Queue item 8's prior cycle (no release-blocking
gap found there either).

Local validation gate re-run this cycle after a fresh `npm ci` (no
`node_modules` present at cycle start) — see Last Evidence. Queue item 7's
Supabase-regression half remains BLOCKED — see Blocker (reconfirmed again
this cycle: `gh auth status` gated, `supabase` CLI not installed, and this
cycle `docker info` was ALSO gated behind interactive approval, unlike some
recent cycles where `docker` itself was reachable).

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- This cycle: `git status` confirmed a clean working tree at cycle start
  (HEAD `28821a5`, matches `origin/feat/verified-auth-onboarding-batch-2`).
  Dispatch target sha `6f0365386fdd456957bdbca1ee67a86e7eb3688f` resolved to
  a real commit ("Merge pull request #29 from
  levyohad1975/fix/agentic-watchdog-gh-jq") that `git branch -a --contains`
  shows lives on `origin/main` only — same recurring pattern as prior
  cycles' dispatch-sha checks (workflow_dispatch metadata points at `main`'s
  tip, not this branch); confirmed via `git merge-base --is-ancestor` (not
  an ancestor of this branch's HEAD) — not a drift to reconcile.
- Reconfirmed this cycle: `gh auth status` requires interactive approval
  with no owner present; `which supabase` confirms the CLI is still not
  installed; `docker info` was ALSO gated behind interactive approval this
  cycle (a stricter sandbox permission mode than some recent prior cycles,
  where plain `docker info` succeeded even though the CLI/stack still
  weren't usable for a real local Supabase run). Queue item 7's
  Supabase-regression half remains blocked on tooling/access, unchanged in
  outcome from prior cycles.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: **917** passed, 917 total; Snapshots: 0 total; Time ~14.7s.
- QA sweep performed this cycle (Queue item 1/2 credential-free sub-task —
  invite-redemption token handling, this run's own `TARGET_BRANCH`): full
  read of `supabase/migrations/0008_family_invites.sql`,
  `0009_family_invites_pgcrypto_fix.sql`,
  `0028_family_invite_detail_preview.sql`, `src/lib/invites.ts` +
  `src/lib/__tests__/invites.test.ts`, `src/components/InviteShareModal.tsx`,
  `src/screens/FamilyOnboardingScreen.tsx` (this branch's own version, via a
  direct file read — not the stacked branch), and
  `src/store/authStore.ts`'s `completeInviteRedemption()`/
  `retryPendingInviteRedemptionVerification()`/
  `verifyAndCommitPendingRedemption()`. No defect found — see Current Task
  Status for the full list of specific invariants checked. Also confirmed
  (via `git log --oneline -- src/screens/FamilyOnboardingScreen.tsx`) that
  this branch's file genuinely predates the applicant-approval-status
  feature the previous cycle found buggy on the stacked branch, so that
  prior cycle's "does not exist on this TARGET_BRANCH" call was correct.
- `git status` reconfirmed clean working tree after the sweep (no repo
  changes needed this cycle beyond this file's own update).

## Last Evidence Timestamp

2026-09-14T00:00:00Z

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
normally. This cycle `docker info` was ALSO gated behind the same kind of
interactive approval prompt (a stricter sandbox permission mode than some
recent prior cycles, where plain `docker info` succeeded even though a
real local Supabase stack still wasn't usable) — either way, the
`supabase` CLI remains not installed, so Queue item 7's Supabase-regression
half stays blocked on tooling/access regardless of `docker`'s own
reachability this cycle.

**Still-open, independent of this branch:** the applicant-side navigation
bug found two cycles ago in `src/screens/FamilyOnboardingScreen.tsx`'s
`refreshOnboardingStatus()`/`AppState` effect (unconditional
`setMode('create')` on foreground can hijack a user out of `join`/`redeem`
mode) still only exists on stacked branch
`feat/system-admin-approval-controls` (PR #11) — confirmed again this
cycle that it is NOT present on this run's own `TARGET_BRANCH`. Still
needs either (A) a future cycle dispatched with
`TARGET_BRANCH=feat/system-admin-approval-controls`, or (B) the
owner/a reviewer applying the fix directly on PR #11 (suggested direction:
only call `setMode('create')` when `mode` is already `'choose'`/`'create'`).
Not reproduced in full detail again here — see two-cycles-ago's entry in
git history of this file for the complete chain of evidence.

The previously recurring `git add`/commit approval-gate issue (logged in
several prior cycles, e.g. before `16d4a17`) recurred again this cycle:
`git add EXECUTION_STATE.md` was gated behind an interactive approval
prompt with no owner present, retried twice more and still blocked. Plain
read-only git commands (`git status`, `git rev-parse`, `git log`,
`git cat-file`, `git branch -a --contains`, `git merge-base`) ran normally
throughout this cycle with no approval needed — only `git fetch` (network)
and `git add`/commit-adjacent (working-tree-mutating) commands were gated,
consistent with most prior cycles' pattern. **This cycle's own
`EXECUTION_STATE.md` edits (recorded above) are sitting uncommitted in the
working tree** — no other file was touched this cycle (no source-code fix
was needed — see Current Task Status), so the only next-cycle recovery step
is: confirm with `git status`/`git diff EXECUTION_STATE.md` that nothing
else has changed, then `git add EXECUTION_STATE.md && git commit`, then
push, before selecting a new task. This gate has now recurred across many
non-consecutive cycles (clearing normally in between, e.g. for
`16d4a17`/`d03e6da`) — sandbox-side permission-mode variance per cycle, not
fixable from inside the repository.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

Every named QA_RELEASE_GUARDIAN.md theme (email delivery/observability,
RTL/responsive + dog-sex copy + mascot/Reduced Motion, production-sensitive
System Admin operations, real-device notification-open behavior, and now
invite-redemption token handling) has had a dedicated credential-free sweep
across every Batch 3/4 surface on this branch and the stacked branches'
distinct feature UI. The next independent credential-free sub-task:
re-attempt Queue item 7's still-open Supabase-regression half via `gh`/a
local Supabase stack (only if the sandbox's permission mode allows it that
cycle — blocked for seven cycles running so far, now including `docker`
itself this cycle). If still blocked, the next candidate is a
credential-free sweep of the **short-code join path** (distinct from the
invite-token path just audited): `src/lib/supabase.ts`'s
`findFamilyByInviteCode()`/`joinFamily()` and
`FamilyOnboardingScreen.tsx`'s `mode === 'join'` branch (`lookup()`/
`confirmJoin()`), cross-referenced against migration
`0002_invite_codes_and_family_membership.sql` — not yet given its own
dedicated end-to-end sweep in this file's history (only referenced in
passing as the "different kind of secret" comparison inside migration
0028's own header comment). A future cycle with
`TARGET_BRANCH=feat/system-admin-approval-controls` should still prioritize
fixing the `FamilyOnboardingScreen.tsx` applicant-status-recovery finding
recorded under Blocker above.

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

- Queue item 1/2 credential-free sub-task — second-pass QA_RELEASE_GUARDIAN.md
  sweep of invite-redemption token handling (`src/lib/invites.ts`,
  migrations 0008/0009/0028, `InviteShareModal.tsx`,
  `FamilyOnboardingScreen.tsx`'s `redeem` mode,
  `authStore.ts`'s `completeInviteRedemption()`/
  `retryPendingInviteRedemptionVerification()`), this time on this run's own
  `TARGET_BRANCH` rather than a stacked branch — full detail in Current Task
  Status above. **No defect found**; this surface is already correctly
  hardened (256-bit server-generated token, sha256-hashed at rest, row-locked
  redemption, derived (never persisted) expiry, fresh re-checks of target
  state at redemption time, fail-closed collision guards, whoami-verified
  commit ordering with a genuine three-way verified/unverified/mismatch
  outcome). Also reconfirmed the applicant-status-recovery bug found two
  cycles ago genuinely does not exist on this branch's own
  `FamilyOnboardingScreen.tsx` (that file here predates the feature
  entirely) — the prior cycle's TARGET_BRANCH reconciliation was correct.
  No repository change was needed. Re-ran the full local validation gate
  after a fresh `npm ci`: `npx tsc --noEmit` PASS, `npm test -- --runInBand`
  89/89 suites, **917/917** tests PASS. Reconfirmed `gh auth status` gated,
  `supabase` CLI not installed, and — new this cycle — `docker info` itself
  also gated (stricter sandbox permission mode than some recent prior
  cycles), so Queue item 7 stays blocked for another cycle.

### Previous cycle (for continuity)

- Queue item 2/4 sub-task — QA_RELEASE_GUARDIAN.md sweep over the
  applicant-facing family-approval-status flow on stacked branch
  `feat/system-admin-approval-controls` (PR #11) —
  `FamilyOnboardingScreen.tsx`'s `refreshOnboardingStatus()`/`AppState`
  effect and `verifiedAdminOnboarding.ts`'s `getMyFamilyOnboardingStatus()`
  — a surface not covered by any prior cycle's sweep of that branch (prior
  cycles covered the admin-side `SystemAdminScreen.tsx` only). **Found one
  real, unfixed defect**: the applicant-status recovery effect
  unconditionally forces `mode` back to `'create'` on every app foreground
  whenever this device's verified-admin identity has a `pending`/`rejected`
  family request, even if the user has since navigated to `'join'`/
  `'redeem'` to join a *different* family — and the redeem flow's own UX
  (paste a code/link "received from a family member") routinely requires
  backgrounding the app to fetch that code, triggering exactly this. **Not
  fixed that cycle**: the file only exists on that stacked branch, which
  that run's `TARGET_BRANCH` restriction did not permit editing/committing/
  pushing to. No test caught this (both `FamilyOnboardingScreen.*.test.ts`
  files and `systemAdminApprovalIntegration.test.ts` are source-text scans
  only). Suggested fix direction (still open — see Blocker above): only
  call `setMode('create')` when `mode` is already `'choose'`/`'create'`.
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
