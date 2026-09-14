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

Queue item 3 credential-free sub-task, per the previous cycle's own "Next
Safe Task" pointer (Queue item 7's Supabase-regression half reconfirmed
blocked again first — see Last Evidence): dedicated audit of the
`send-email` Edge Function's `SEND_EMAIL_HOOK_SECRET` / Standard Webhooks
signature-verification wiring on this run's own `TARGET_BRANCH`
(`feat/verified-auth-onboarding-batch-2`) — this was the one named
candidate in the previous cycle's Next Safe Task note that had not yet
had a dedicated sweep the way `AUTO_APPROVE_NEW_FAMILIES` and the
`email-provider-webhook` signature check already had.

## Current Task Status

DONE. **No defect found.** Full read of
`supabase/functions/send-email/index.ts`,
`src/lib/__tests__/sendEmailHook.test.ts`, the `[functions.send-email]`
section of `supabase/config.toml`, and
`docs/engineering/VERIFIED_AUTH_ONBOARDING_ROLLOUT.md`'s documented
`SEND_EMAIL_HOOK_SECRET` contract and deployment steps. Verified: (1) raw
request bytes are read via `req.text()` and passed to the official
`npm:standardwebhooks@1.0.0` verifier's `wh.verify(payload, headers)`
*before* the body is ever treated as parsed JSON — `email_data.token` is
only read after `wh.verify()` returns, confirmed by index-ordering in the
`Deno.serve` body (matches the existing test's own ordering assertions);
(2) any verification failure (missing/invalid signature) is caught and
answered with a generic 401 without inspecting the body further —
fail-closed; (3) `req.headers` is converted with `Object.fromEntries`,
and the Fetch `Headers` spec normalizes all header names to lowercase on
iteration, so the `webhook-id`/`webhook-timestamp`/`webhook-signature`
headers the verifier expects arrive correctly cased regardless of the
caller's casing; (4) the function is registered with `verify_jwt = false`
in `supabase/config.toml` (required, since Auth calls this hook
server-to-server with a Standard Webhooks signature, never a
Supabase-issued JWT — confirmed this is still the case and the config
comment matches the code); (5) `RESEND_API_KEY`/`WELCOME_EMAIL_FROM` env
var names are used identically here and in
`create-verified-family/index.ts` (`sendViaResend`), so there is no
naming-drift risk between the two Edge Functions that both send through
Resend; (6) confirmed no console logging call anywhere in the file
includes the OTP token, the hook secret, the Resend API key, the
Authorization header, or the raw/parsed payload — only fixed generic
strings are logged on failure, matching the file's own security-model
comment and the existing test's forbidden-word scan; (7) replay-window /
timestamp-tolerance protection is delegated entirely to the official
`standardwebhooks` verifier (the same trust boundary the file's own
comment documents — "mirrors the official Supabase Send Email Hook
pattern"), which is appropriate: re-implementing that check locally would
be the actual security regression risk, not the current design. No gap —
test-coverage or otherwise — was found on this surface; the existing
`sendEmailHook.test.ts` (present since the feature's original commit,
`b1b2495`) already covers the ordering, fail-closed, and no-sensitive-
logging invariants exercised above. No repository change was made this
cycle as a result.

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

- This cycle: `git status` confirmed a clean working tree at cycle start
  (HEAD `0bc88c3`, matches `origin/feat/verified-auth-onboarding-batch-2`)
  — confirms the previous cycle's recovery commit landed cleanly (its
  uncommitted test file + `EXECUTION_STATE.md` update are both present in
  `0bc88c3`, already on `origin`). Dispatch target sha
  `6f0365386fdd456957bdbca1ee67a86e7eb3688f` is `main`'s workflow_dispatch
  metadata tip, not this branch's — same recurring, already-understood
  non-drift pattern as every prior cycle.
- Reconfirmed this cycle: `gh auth status` → "This command requires
  approval" (no owner present); `which supabase` → exit 1 (still not
  installed); `docker info` → "This command requires approval". Queue item
  7's Supabase-regression half stays blocked on tooling/access, unchanged
  from prior cycles — tenth consecutive cycle blocked.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start — every cycle so far
  starts from a clean sandbox, not a persisted one).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: **918** passed, 918 total (unchanged — no code change this
  cycle); Snapshots: 0 total; Time ~22.5s.
- QA sweep performed this cycle (Queue item 3 credential-free sub-task —
  `send-email` Edge Function's `SEND_EMAIL_HOOK_SECRET`/Standard Webhooks
  wiring, this run's own `TARGET_BRANCH`): full read of
  `supabase/functions/send-email/index.ts`,
  `src/lib/__tests__/sendEmailHook.test.ts`, the `[functions.send-email]`
  section of `supabase/config.toml`, and
  `docs/engineering/VERIFIED_AUTH_ONBOARDING_ROLLOUT.md`'s documented
  contract/deployment steps for the hook — full list of invariants checked
  in Current Task Status. **No defect found; no gap found.** No repository
  change was needed or made this cycle.
- `git status`/`git diff --stat` confirmed no working-tree changes from
  this cycle's audit itself — only this file's own end-of-cycle update
  (below) needs to be committed.

## Last Evidence Timestamp

2026-09-14T07:55:22Z

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
several prior cycles, e.g. before `16d4a17`) had cleared for the prior
cycle: its uncommitted work (the pending-family test plus its
`EXECUTION_STATE.md` update) is confirmed landed and pushed as `0bc88c3`
(`origin/feat/verified-auth-onboarding-batch-2` matches HEAD at this
cycle's start — see Last Evidence). **It recurred again this cycle**:
both a standalone `git add EXECUTION_STATE.md` and a combined
`git add && git commit` were gated behind an interactive approval prompt
with no owner present, immediately after this cycle's send-email audit
found no code to change but this file's own update still needed
committing. Plain read-only git commands (`git status`, `git diff --stat`,
`git log`) ran normally throughout this cycle with no approval needed —
only working-tree-mutating commands were gated, consistent with the
established pattern. This gate has now recurred across many
non-consecutive cycles (clearing normally in between, e.g. for
`16d4a17`/`d03e6da`/`d5d0a0e`/`c117837`/`0bc88c3`) — sandbox-side
permission-mode variance per cycle, not fixable from inside the
repository. **This cycle's only change — this file's own update — is
sitting uncommitted in the working tree** as of this entry; `git status`/
`git diff --stat` reconfirmed exactly `EXECUTION_STATE.md` differs from
HEAD, nothing else. Next-cycle recovery step: confirm with `git status`/
`git diff --stat` that still only this file differs from HEAD, then
`git add EXECUTION_STATE.md && git commit`, then push, before selecting a
new task.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

**Immediate next step, before selecting a new sweep**: land this cycle's
uncommitted work (this file's own update) — see the recovery step at the
end of the Blocker section. No code change is pending this time, only the
state file itself.

Every named QA_RELEASE_GUARDIAN.md theme (email delivery/observability,
RTL/responsive + dog-sex copy + mascot/Reduced Motion, production-sensitive
System Admin operations, real-device notification-open behavior,
invite-redemption token handling, the short-code join path, the
`AUTO_APPROVE_NEW_FAMILIES` Edge Function wiring, and now the
`send-email`/`SEND_EMAIL_HOOK_SECRET` Standard Webhooks wiring) has had a
dedicated credential-free sweep across every Batch 3/4 surface on this
branch and the stacked branches' distinct feature UI. The next independent
credential-free sub-task, once this cycle's commit lands: re-attempt Queue
item 7's still-open Supabase-regression half via `gh`/a local Supabase
stack (only if the sandbox's permission mode allows it that cycle —
blocked for ten cycles running so far). If still blocked, the remaining
not-yet-swept candidate is: a Settings/Roles QA pass on this branch
specifically (Queue item 4) beyond the System Admin approve/reject surface
already swept on the stacked branch. A future cycle with
`TARGET_BRANCH=feat/system-admin-approval-controls` should still
prioritize fixing the `FamilyOnboardingScreen.tsx`
applicant-status-recovery finding recorded under Blocker above.

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

- Queue item 3 credential-free sub-task — dedicated audit of the
  **`send-email` Edge Function's `SEND_EMAIL_HOOK_SECRET`/Standard
  Webhooks signature-verification wiring**, on this run's own
  `TARGET_BRANCH`. **No defect found; no gap found** — full list of
  invariants checked in Current Task Status above (verify-before-trust
  byte ordering, fail-closed 401 on bad signature, correct header
  lowercasing via `Object.fromEntries(req.headers)`, `verify_jwt = false`
  config matches the code's own trust model, `RESEND_API_KEY`/
  `WELCOME_EMAIL_FROM` naming matches `create-verified-family`'s usage, no
  sensitive value ever logged, replay-window protection correctly
  delegated to the official `standardwebhooks` verifier rather than
  reimplemented locally). No repository change was needed or made. Re-ran
  the full local validation gate after a fresh `npm ci` (no `node_modules`
  present at cycle start): `npx tsc --noEmit` PASS, `npm test --
  --runInBand` 89/89 suites, **918/918** tests PASS (unchanged from prior
  cycle — no code change). Reconfirmed `gh auth status` gated, `supabase`
  CLI not installed, `docker info` gated — Queue item 7 stays blocked for
  another (tenth) cycle. Also confirmed the prior cycle's previously-
  uncommitted deliverable (the pending-family test in
  `FamilyOnboardingScreen.authGuardAndErrors.test.ts`) landed and is now
  on `origin` as part of `0bc88c3` — no recovery action needed this cycle
  for that item.

### Previous cycle

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

### Three cycles ago

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
