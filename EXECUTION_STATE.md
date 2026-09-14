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

Per the previous cycle's own "Next Safe Task" pointer (Queue item 7's
Supabase-regression half reconfirmed blocked again first — see Last
Evidence): a **second, full end-to-end re-read of the diff between this
run's own `TARGET_BRANCH` (`feat/verified-auth-onboarding-batch-2`) and
`main`** (`git diff origin/main...HEAD`), specifically looking for
anything the prior theme-by-theme sweeps might have missed, since every
named `QA_RELEASE_GUARDIAN.md` theme already had at least one dedicated
sweep as of last cycle.

## Current Task Status

DONE. **No defect found.** Read the full 32-file diff
(`git diff origin/main...HEAD`, 2281 insertions/54 deletions excluding
this file's own history) end to end, with particular attention to the
smaller UI-only files no prior cycle's theme sweep had named explicitly:
`src/components/Countdown.tsx`/`NextWalkCard.tsx`/`WalkRow.tsx`,
`src/navigation/RootNavigator.tsx`, `src/screens/LoginScreen.tsx`/
`HistoryScreen.tsx`/`ScheduleScreen.tsx`/`StatisticsScreen.tsx`, and
`src/theme/tokens.ts`. Findings: (1) a `nativeDirection()` helper added to
`theme/tokens.ts` replaces bare `direction: 'ltr'|'rtl'` style props
across those five components/screens — well-reasoned and correctly
scoped: RN's `direction` `ViewStyle` prop is required on native to pin a
fixed physical row order under RTL, but `react-native-web`'s style
validator silently strips that exact key and logs a `console.error` on
every render, so the helper returns `{}` on web and `{ direction: value }`
on native, a true behavior no-op with an observability improvement; the
existing structural tests (`Countdown.test.ts`,
`tabBarRtlContract.test.ts`) were updated in lockstep to assert
`nativeDirection(...)` instead of the literal, so regression coverage
carried over rather than being lost; (2) `LoginScreen.tsx`/
`HistoryScreen.tsx`/`ScheduleScreen.tsx`/`StatisticsScreen.tsx` each
gained an identical `Platform.OS === 'web'`-gated `maxWidth:
breakpoints.desktopContent, alignSelf: 'center'` wrapper, the same
desktop-containment pattern already used elsewhere (e.g. HomeScreen per
`LoginScreen.tsx`'s own comment) — native layout is untouched since the
extra style only applies under the web check. No release-blocking gap
found in this pass. Also noted, for context and not actionable from this
sandbox: `.github/workflows/batch2-supabase-rehearsal.yml` already exists
on this branch (`workflow_dispatch`-enabled, plus path-triggered on
`supabase/**` PRs) and implements exactly a CI-side, credential-free
Supabase rehearsal for Batch 2 — ephemeral migration history rebuilt onto
`supabase/schema.sql`, a real `supabase start`/`db reset --local`, and
`psql` assertions on the `0032`-`0034` schema/RPC/RLS/grant surface. This
is Queue item 7's Supabase-regression path already implemented, just not
triggerable from this sandbox (`gh` gated, `supabase` CLI absent
locally — see Blocker). Separately, `origin/main` (not this branch) has
since grown a distinct Gmail-backed **Staging OTP E2E** CI executor
(`docs/engineering/STAGING_OTP_E2E.md`, merged via PRs #30/#35/#37, bound
to GitHub Environment `staging`, refuses `main` as its own target branch)
with a defined evidence contract for a real, non-Production OTP round-trip
— its own doc states intent to extend it to "family creation persistence,
join artifacts, and second-member join" next, i.e. toward Queue items 1-3.
That executor lives in `main`'s CI/governance layer, is out of this
feature branch's diff and this cycle's scope, and still requires
GitHub-side dispatch/secrets this sandbox cannot reach (`gh` gated) — not
something actionable this cycle, but recorded for continuity since it
changes the Blocker's long-term unblock story. No repository change was
made this cycle as a result of either review.

Local validation gate re-run this cycle after a fresh `npm ci` (no
`node_modules` present at cycle start, same as every prior cycle — each
cycle starts from a clean sandbox) — see Last Evidence. Queue item 7's
Supabase-regression half remains BLOCKED — see Blocker (reconfirmed again
this cycle: `gh auth status` gated, `supabase` CLI not installed, `docker
info` also gated behind interactive approval — same pattern as every
prior cycle).

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- This cycle: `git status`/`git rev-parse HEAD` confirmed a clean working
  tree at cycle start (HEAD `dc5c46f`, matches
  `origin/feat/verified-auth-onboarding-batch-2`) — confirms the previous
  cycle's own end-of-cycle commit landed cleanly and pushed with no
  recovery action needed this time.
- Reconfirmed this cycle: `gh auth status` → "This command requires
  approval" (no owner present); `which supabase` → exit 1 (still not
  installed); `docker info` → "This command requires approval". Queue item
  7's Supabase-regression half stays blocked on tooling/access, unchanged
  from prior cycles — twelfth consecutive cycle blocked.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start — every cycle so far
  starts from a clean sandbox, not a persisted one).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: **918** passed, 918 total (unchanged — no code change this
  cycle); Snapshots: 0 total; Time ~22s.
- QA sweep performed this cycle (second full end-to-end re-read of
  `git diff origin/main...HEAD`, this run's own `TARGET_BRANCH`): reviewed
  all 32 changed files, with particular focus on the smaller UI-only files
  (`Countdown.tsx`/`NextWalkCard.tsx`/`WalkRow.tsx`/`RootNavigator.tsx`'s
  `nativeDirection()` web-console-warning fix; `LoginScreen.tsx`/
  `HistoryScreen.tsx`/`ScheduleScreen.tsx`/`StatisticsScreen.tsx`'s web
  desktop max-width containment) that no prior theme-named sweep had
  called out individually. **No defect found; no gap found.** Also
  surveyed `origin/main`'s recent history (`git log origin/main`, `git
  show origin/main:docs/engineering/STAGING_OTP_E2E.md`) and confirmed
  `.github/workflows/batch2-supabase-rehearsal.yml` already exists on this
  branch — both recorded in Current Task Status for continuity, neither
  actionable from this sandbox this cycle. No repository change was
  needed or made this cycle.
- `git status`/`git diff --stat` confirmed no working-tree changes from
  this cycle's audit itself — only this file's own end-of-cycle update
  (below) needs to be committed.

## Last Evidence Timestamp

2026-09-14T09:20:00Z

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

**Update this cycle (context, not yet actionable from this sandbox):**
`origin/main` (a separate lineage from this feature branch, out of this
cycle's editable scope) has since grown a dedicated CI-only **Staging OTP
E2E executor** (`docs/engineering/STAGING_OTP_E2E.md`, merged via PRs
#30/#35/#37) that reads a real OTP from a dedicated Gmail test inbox via a
GitHub Actions workflow bound to GitHub Environment `staging`, so it never
hands Staging/Gmail credentials to this worker directly. It defines a
concrete evidence contract (Supabase Staging accepts the OTP request, the
email actually arrives, the code is extracted only inside the runner,
Supabase Staging returns an authenticated session, workflow emits
`STAGING_OTP_E2E_OK`) and explicitly states the next intended extension is
"family creation persistence, join artifacts, and second-member join" —
i.e. directly toward unblocking Queue items 1-3/6. This does not unblock
anything this cycle (this sandbox still cannot dispatch or read GitHub
Actions runs — `gh auth status` gated), but it is a live, evolving unblock
path the owner/a future cycle with `gh`/environment access should check for
a completed run before re-treating 1-3/6 as fully blocked.

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
several prior cycles, e.g. before `16d4a17`) had cleared for the prior
cycle: its only change (this file's own update) is confirmed landed and
pushed as `6a902de` (`origin/feat/verified-auth-onboarding-batch-2`
matched HEAD at this cycle's start — see Last Evidence), so no recovery
action was needed at the start of this cycle. This gate has recurred
across many non-consecutive cycles historically (clearing normally in
between, e.g. for `16d4a17`/`d03e6da`/`d5d0a0e`/`c117837`/`0bc88c3`/
`6a902de`) — sandbox-side permission-mode variance per cycle, not fixable
from inside the repository. If it recurs again on this cycle's own
end-of-cycle commit, the recovery step for the next cycle is: confirm
with `git status`/`git diff --stat` that only `EXECUTION_STATE.md` differs
from HEAD, then `git add EXECUTION_STATE.md && git commit`, then push,
before selecting a new task.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

Every named QA_RELEASE_GUARDIAN.md theme has at least one dedicated
credential-free sweep across every Batch 3/4 surface on this branch and
the stacked branches' distinct feature UI, with **no unresolved
release-blocking gap** on any of them, and this cycle's second full
end-to-end diff re-read (`origin/main...HEAD`) found nothing the
theme-by-theme sweeps had missed either. Remaining independent
credential-free sub-tasks, in order: (1) re-attempt Queue item 7's
still-open Supabase-regression half via `gh`/a local Supabase stack (only
if the sandbox's permission mode allows it that cycle — blocked for
twelve cycles running so far); (2) check whether `origin/main`'s new
Staging OTP E2E executor (see Blocker above) has a completed run with
`gh`, if `gh` becomes reachable — this could produce real evidence toward
Queue items 1-3/6 without needing credentials in this sandbox directly;
(3) Queue item 5 (Batch 4 regression) if/when independent,
credential-free repository evidence for it exists — no `batch-4`-named
branch or work exists in this repository yet, so this item currently has
no distinct surface to regress beyond what Batch 2/3 sweeps already
covered. A future cycle with `TARGET_BRANCH=feat/system-admin-approval-controls`
should still prioritize fixing the `FamilyOnboardingScreen.tsx`
applicant-status-recovery finding recorded under Blocker above — that
remains the one known, unfixed, actionable defect from this whole
campaign.

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

- Second full end-to-end re-read of `git diff origin/main...HEAD` (32
  files, 2281 insertions/54 deletions) on this run's own `TARGET_BRANCH`,
  focused on the smaller UI-only files no prior theme sweep had named
  individually. **No defect found; no gap found** — the `nativeDirection()`
  web-console-warning fix (`theme/tokens.ts`, applied across
  `Countdown.tsx`/`NextWalkCard.tsx`/`WalkRow.tsx`/`RootNavigator.tsx`/
  `HistoryScreen.tsx`/`StatisticsScreen.tsx`) and the `LoginScreen.tsx`/
  `HistoryScreen.tsx`/`ScheduleScreen.tsx`/`StatisticsScreen.tsx` web
  desktop max-width containment are both well-reasoned, correctly
  platform-scoped, and already covered by updated structural tests. Also
  discovered and recorded for continuity (not actionable this cycle):
  `.github/workflows/batch2-supabase-rehearsal.yml` already implements
  Queue item 7's Supabase-regression path in CI; `origin/main` has grown a
  separate Gmail-backed Staging OTP E2E CI executor
  (`docs/engineering/STAGING_OTP_E2E.md`) intended to next extend toward
  family creation/join flows — see Blocker above for full detail on both.
  No repository change was needed or made. Re-ran the full local
  validation gate after a fresh `npm ci` (no `node_modules` present at
  cycle start): `npx tsc --noEmit` PASS, `npm test -- --runInBand` 89/89
  suites, **918/918** tests PASS (unchanged from prior cycle — no code
  change). Reconfirmed `gh auth status` gated, `supabase` CLI not
  installed, `docker info` gated — Queue item 7 stays blocked for another
  (twelfth) cycle. Also confirmed the prior cycle's deliverable (its own
  `EXECUTION_STATE.md` update) landed and is now on `origin` as `dc5c46f`
  — no recovery action needed this cycle.

### Previous cycle

- Queue item 4 credential-free sub-task — dedicated **Settings/Roles
  backend-authorization** sweep, on this run's own `TARGET_BRANCH`. **No
  defect found; no gap found** — full list of invariants checked: every
  admin-only mutation re-derives caller admin status server-side via
  `is_family_admin()`, never from a client-supplied role; zero-admin guard
  enforced in the database with a shared advisory lock, not just client
  UX; `member_permission_overrides` has no client write RLS policy,
  RPC-gated only; QA impersonation can only narrow an admin's view, never
  escalate a member's. Independently re-verified by reading the actual RPC
  SQL in `0007_multi_admin_roles.sql`/`0023_member_permission_overrides.sql`
  directly. No repository change was needed or made. Re-ran the full local
  validation gate after a fresh `npm ci`: `npx tsc --noEmit` PASS, `npm
  test -- --runInBand` 89/89 suites, **918/918** tests PASS. Reconfirmed
  `gh auth status` gated, `supabase` CLI not installed, `docker info`
  gated — Queue item 7 stayed blocked for another (eleventh) cycle.
  Committed and pushed as `dc5c46f`.

### Two cycles ago

- Queue item 3 credential-free sub-task — dedicated audit of the
  **`send-email` Edge Function's `SEND_EMAIL_HOOK_SECRET`/Standard
  Webhooks signature-verification wiring**, on that run's own
  `TARGET_BRANCH`. **No defect found; no gap found** — verify-before-trust
  byte ordering, fail-closed 401 on bad signature, correct header
  lowercasing via `Object.fromEntries(req.headers)`, `verify_jwt = false`
  config matches the code's own trust model, `RESEND_API_KEY`/
  `WELCOME_EMAIL_FROM` naming matches `create-verified-family`'s usage, no
  sensitive value ever logged, replay-window protection correctly
  delegated to the official `standardwebhooks` verifier rather than
  reimplemented locally. No repository change was needed or made. Re-ran
  the full local validation gate after a fresh `npm ci`: `npx tsc
  --noEmit` PASS, `npm test -- --runInBand` 89/89 suites, **918/918**
  tests PASS (unchanged — no code change that cycle). Reconfirmed `gh
  auth status` gated, `supabase` CLI not installed, `docker info` gated —
  Queue item 7 stayed blocked for another (tenth) cycle. Committed and
  pushed as `6a902de`.

### Three cycles ago

- Queue item 2 credential-free sub-task — dedicated sweep of the
  **`create-verified-family` Edge Function's `AUTO_APPROVE_NEW_FAMILIES`
  wiring** (env var → `autoApproveFromEnvironment()` →
  `create_verified_family`'s `p_auto_approve` → `active`/`pending` →
  client `submitCreate()` gate), on this run's own `TARGET_BRANCH`. Wiring
  itself: **no defect found** — fail-safe parsing (throws on invalid
  values instead of silently defaulting), service-role-only RPC grants
  matching the Edge Function's service-role key usage, idempotent
  re-request behavior, and doc/code contract match all confirmed. **Found
  and fixed one real test-coverage gap**: `FamilyOnboardingScreen.tsx`'s
  `submitCreate()` pending-family gate (the `return` before
  `setFamilyId(family.id)` that stops an unapproved family from being
  treated as joined) had zero test coverage. Added a structural regression
  test to `FamilyOnboardingScreen.authGuardAndErrors.test.ts` in the same
  source-text-scan style as that file's existing tests. Re-ran the full
  local validation gate after a fresh `npm ci`: `npx tsc --noEmit` PASS,
  `npm test -- --runInBand` 89/89 suites, **918/918** tests PASS (917 + 1
  new). Reconfirmed `gh auth status` gated, `supabase` CLI not installed,
  `docker info` gated — Queue item 7 stays blocked for another (ninth)
  cycle. That cycle's commit was initially blocked by a `git add` approval
  gate, but landed successfully as `0bc88c3` (confirmed at the start of
  the following cycle — see Last Evidence above).

### Five cycles ago

- Queue item 1/2 credential-free sub-task — dedicated end-to-end
  QA_RELEASE_GUARDIAN.md sweep of the **short-code join path**
  (`src/lib/supabase.ts`'s `findFamilyByInviteCode()`/`joinFamily()`,
  `FamilyOnboardingScreen.tsx`'s `mode === 'join'` branch, and the
  currently-live `0033_verified_family_onboarding_cutover.sql` versions of
  `find_family_by_invite_code()`/`join_family()`/`current_family_id()` —
  not just the original `0002` versions), on this run's own
  `TARGET_BRANCH` — full detail in Current Task Status above. **No defect
  found**; both RPCs correctly fail-closed on `approval_status != 'active'`
  (same outcome as an invalid code, so pending/rejected-family existence
  isn't disclosed), `current_family_id()` re-checks `approval_status`
  per-query, and `join_family()`'s role-upsert logic can only downgrade or
  preserve a device's role, never escalate it. Also confirmed the
  short-code path's weaker disclosure surface (no rate limiting) is a
  pre-existing, explicitly-documented product tradeoff (0028's own header
  comment), not a new gap, and that this branch's `SystemAdminScreen.tsx`
  has no family-approval UI (expected — that's the stacked branch's
  feature). No repository change was needed. Re-ran the full local
  validation gate after a fresh `npm ci`: `npx tsc --noEmit` PASS,
  `npm test -- --runInBand` 89/89 suites, **917/917** tests PASS.
  Reconfirmed `gh auth status` gated, `supabase` CLI not installed, `docker
  info` gated — Queue item 7 stays blocked for another (eighth) cycle.

### Earlier cycles (for continuity)

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
