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
"Next Safe Task" pointer: dedicated end-to-end sweep of the
**short-code join path** (distinct from the invite-token/redeem path swept
last cycle) on this run's own `TARGET_BRANCH`
(`feat/verified-auth-onboarding-batch-2`) — `src/lib/supabase.ts`'s
`findFamilyByInviteCode()`/`joinFamily()`, `FamilyOnboardingScreen.tsx`'s
`mode === 'join'` branch (`lookup()`/`confirmJoin()`), and the server-side
`find_family_by_invite_code()`/`join_family()`/`current_family_id()`
functions. Read every migration that (re)defines those three functions —
not just `0002_invite_codes_and_family_membership.sql` (the original
version) but also `0033_verified_family_onboarding_cutover.sql`, which
`CREATE OR REPLACE`s all three as part of the verified-onboarding cutover
— to audit the actual, currently-active definitions rather than the
original ones.

## Current Task Status

DONE. **No defect found.** Key correction to the prior sweep-index entry
("only referenced in passing" as of two cycles ago): `0002`'s original
`find_family_by_invite_code()`/`join_family()` are NOT what's live today —
`0033_verified_family_onboarding_cutover.sql` (`CREATE OR REPLACE`)
superseded both, plus `current_family_id()`, so this cycle audited the
0033 versions as the actual current behavior. Specifically checked and
found correct: both `find_family_by_invite_code()` and `join_family()`
filter `f.approval_status = 'active'` at query time (fail-closed — a
`pending`/`rejected` family's code returns the same "not found" outcome as
a genuinely-invalid code, so a guesser can't distinguish "no such code"
from "code exists but family isn't approved yet", which is itself a
deliberate non-disclosure property, not an oversight); `current_family_id()`
(0033) also re-checks `approval_status = 'active'` on every call (it's
`stable`, evaluated per-query, not cached), so every RLS check
transitively re-verifies the family is still active, not just at
join-time; `join_family()`'s `ON CONFLICT ... DO UPDATE` role logic can
only ever downgrade a device's role to `'member'` on a family switch or
preserve `'admin'` when re-joining the *same* family it's already admin
of — never escalate to `'admin'` via the join RPC. Confirmed
`FamilyOnboardingScreen.tsx`'s `lookup()`/`confirmJoin()` split correctly
re-lookups on every code-text edit (`onChangeText` clears `found`/
`joinError`, and the confirm button is only rendered while `found` is
non-null for the exact currently-typed code), so there's no
stale-`found`-vs-edited-`code` mismatch, and `confirmJoin()` calls
`ensureAnonymousSession()` before `joinFamily()` so `auth.uid()` is never
null when the RPC's own auth check runs. Confirmed the short-code's
weaker-than-invite-token disclosure surface (`{id, name, dog_name}` only,
no rate limiting) is a pre-existing, explicitly-documented product
tradeoff — `0028_family_invite_detail_preview.sql`'s own header comment
contrasts it directly with the invite-token path ("do not broaden
disclosure based only on a short family code" / "a family invite TOKEN...
is a different kind of secret entirely") — not a new gap introduced by
this branch's onboarding work. Client-side test coverage
(`supabaseFamily.test.ts`) is wrapper-only (RPC-name/param/response-mapping),
same documented limitation ("cannot verify RLS/SECURITY DEFINER behavior
from this sandbox") as every other RPC-wrapper test in this codebase — not
a gap specific to this surface.

No code changes were made this cycle (nothing to fix). This is a valid
`DONE` sweep outcome, same as Queue item 8's and the invite-token sweep's
prior-cycle outcomes (no release-blocking gap found there either).

Local validation gate re-run this cycle after a fresh `npm ci` (no
`node_modules` present at cycle start, same as last cycle — each cycle
appears to start from a clean sandbox) — see Last Evidence. Queue item 7's
Supabase-regression half remains BLOCKED — see Blocker (reconfirmed again
this cycle: `gh auth status` gated, `supabase` CLI not installed, `docker
info` also gated behind interactive approval — same pattern as last
cycle).

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- This cycle: `git status` confirmed a clean working tree at cycle start
  (HEAD `d5d0a0e`, matches `origin/feat/verified-auth-onboarding-batch-2`).
  Dispatch target sha `6f0365386fdd456957bdbca1ee67a86e7eb3688f` reconfirmed
  via `git merge-base --is-ancestor` to NOT be an ancestor of this branch's
  HEAD (same recurring pattern as every prior cycle's dispatch-sha check —
  workflow_dispatch metadata points at `main`'s tip, not this branch) — not
  a drift to reconcile.
- Reconfirmed this cycle: `gh auth status` requires interactive approval
  with no owner present; `which supabase` confirms the CLI is still not
  installed (exit 1); `docker info` was ALSO gated behind interactive
  approval this cycle, same as last cycle. Queue item 7's
  Supabase-regression half remains blocked on tooling/access, unchanged in
  outcome from prior cycles.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start — confirmed each cycle
  starts from a clean sandbox, not a persisted one).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: **917** passed, 917 total; Snapshots: 0 total; Time ~16.2s.
- QA sweep performed this cycle (Queue item 1/2 credential-free sub-task —
  short-code join path, this run's own `TARGET_BRANCH`): full read of
  `supabase/migrations/0002_invite_codes_and_family_membership.sql` (original
  `find_family_by_invite_code`/`join_family`/`current_family_id`) AND
  `0033_verified_family_onboarding_cutover.sql` (the actual currently-live
  `CREATE OR REPLACE` versions of all three), `src/lib/supabase.ts`'s
  `findFamilyByInviteCode()`/`joinFamily()`, `src/screens/FamilyOnboardingScreen.tsx`'s
  `mode === 'join'` branch (`lookup()`/`confirmJoin()` plus its render
  section), `src/lib/__tests__/supabaseFamily.test.ts`, and
  `0032_verified_family_onboarding.sql`/`0028_family_invite_detail_preview.sql`'s
  header comments for the documented short-code-vs-token disclosure
  tradeoff. No defect found — see Current Task Status for the full list of
  specific invariants checked. Also confirmed (via
  `git log -1 -- src/screens/SystemAdminScreen.tsx` and a case-insensitive
  grep for `approval|reject|pending` in that file) that this branch's own
  `SystemAdminScreen.tsx` has no family-approval UI at all — the
  `system_admin_set_family_approval()` RPC (0032) exists in the DB on this
  branch but is only reachable from the stacked branch's UI; this is the
  expected incremental-batch boundary, not a new gap.
- `git status` reconfirmed clean working tree after the sweep (no repo
  changes needed this cycle beyond this file's own update).

## Last Evidence Timestamp

2026-09-14T07:30:00Z

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
prompt with no owner present. Plain read-only git commands (`git status`,
`git rev-parse`, `git log`, `git cat-file`, `git branch -a --contains`,
`git merge-base`) ran normally throughout this cycle with no approval
needed — only `git fetch` (network) and `git add`/commit-adjacent
(working-tree-mutating) commands were gated, consistent with most prior
cycles' pattern. **This cycle's own `EXECUTION_STATE.md` edits (recorded
above) may be sitting uncommitted in the working tree** at the point this
paragraph is read back — no other file was touched this cycle (no
source-code fix was needed — see Current Task Status), so if so the only
next-cycle recovery step is: confirm with `git status`/`git diff
EXECUTION_STATE.md` that nothing else has changed, then `git add
EXECUTION_STATE.md && git commit`, then push, before selecting a new task.
This gate has now recurred across many non-consecutive cycles (clearing
normally in between, e.g. for `16d4a17`/`d03e6da`/`d5d0a0e`) —
sandbox-side permission-mode variance per cycle, not fixable from inside
the repository.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

Every named QA_RELEASE_GUARDIAN.md theme (email delivery/observability,
RTL/responsive + dog-sex copy + mascot/Reduced Motion, production-sensitive
System Admin operations, real-device notification-open behavior,
invite-redemption token handling, and now the short-code join path) has
had a dedicated credential-free sweep across every Batch 3/4 surface on
this branch and the stacked branches' distinct feature UI. The next
independent credential-free sub-task: re-attempt Queue item 7's still-open
Supabase-regression half via `gh`/a local Supabase stack (only if the
sandbox's permission mode allows it that cycle — blocked for eight cycles
running so far). If still blocked, the next candidate is a credential-free
sweep of the **`create_verified_family` Edge Function's `AUTO_APPROVE_NEW_FAMILIES`
wiring itself** (Queue item 2) — `supabase/functions/create-verified-family/index.ts`:
confirm how/whether it reads an `AUTO_APPROVE_NEW_FAMILIES` env var and
passes `p_auto_approve` through to the RPC (0032/0033 define the RPC's
`p_auto_approve` parameter and the `pending`/`active` branching this cycle
already audited from the RPC side inward; the Edge Function's own
env-var-to-parameter wiring has not yet had its own dedicated sweep in
this file's history) — not yet swept end-to-end in this file's history. A
future cycle with `TARGET_BRANCH=feat/system-admin-approval-controls`
should still prioritize fixing the `FamilyOnboardingScreen.tsx`
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
