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

Queue item 4 — Settings/Roles/System Admin QA: repository-level,
credential-free read of `src/screens/SystemAdminScreen.tsx`,
`src/store/systemAdminStore.ts`, `src/lib/systemAdmin.ts`, and the
`0024`/`0029`/`0030` System Admin migrations against
`docs/qa/QA_RELEASE_GUARDIAN.md`'s "Settings/Roles backend authorization"
theme, following the upstream `Batch 2 Supabase Rehearsal` workflow run
(id `34754710595`, conclusion `success`) on
`feat/verified-auth-onboarding-batch-2` @
`63c00fb7e84f1f2b371e6739d5d3d05dda6754f7`.

## Current Task Status

DONE. The four named files/migrations were read in full: System Admin v1
(0024/0029/0030) is read-only, fail-closed, and correctly re-authorizes
every RPC server-side via `is_system_admin()` (verified-identity-only since
0030) — no gap found there, and the missing approve/reject UI in
`SystemAdminScreen.tsx` is expected (that capability is scoped to the
separate stacked branch/PR, `feat/system-admin-approval-controls` /
PR #11, confirmed present as `remotes/origin/feat/system-admin-approval-controls`).

While cross-referencing `system_admin_set_family_approval` (0032) for that
QA pass, found and fixed one real release-relevant gap in adjacent Queue
item 3 territory (welcome email correctness) — see Last Evidence. Queue
item 7's Supabase-regression half remains BLOCKED — see Blocker.

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- Repo state reconciled at cycle start: on `feat/verified-auth-onboarding-batch-2`,
  clean tree, HEAD `da6deea` (one commit ahead of the trigger's target sha
  `63c00fb`, the trigger's own prior state-tracking commit from the
  previous cycle — expected and consistent, not a drift).
- Trigger evidence recorded: upstream `Batch 2 Supabase Rehearsal` workflow
  run `34754710595` concluded `success` against `63c00fb` — this run
  provisions an ephemeral GitHub-hosted Supabase stack (supabase/setup-cli,
  `supabase start`/`db reset --local`) and asserts, at the SQL level, the
  Batch 2 authorization contract: `families.approval_status`/
  `created_by_auth_user_id` columns exist, `create_verified_family()` /
  `system_admin_set_family_approval()` exist, `create_family` EXECUTE is
  revoked from anon/authenticated, `create_verified_family` is service-role
  only, `current_family_id()` is approval-status-aware, `email_delivery_log`
  exists with RLS enabled and zero client policies, and
  `record_email_delivery_attempt`/`update_email_delivery_status` are
  service-role-only while `system_admin_list_email_delivery_log` is
  authenticated-gated. This is real automated evidence for the schema/
  authorization layer of Queue items 2/3, independent of the Staging-E2E
  blocker below (it does not exercise the real UI/OTP/Resend path).
- `gh auth status` and `docker info` both returned "This command requires
  approval" in this sandbox's permission mode with no owner present to
  answer it — consistent with the prior cycle's finding. Did not retry
  repeatedly; this is the same secondary GitHub/Supabase-tooling blocker
  already on file, not new information.
- QA read performed (Queue item 4): `src/screens/SystemAdminScreen.tsx`,
  `src/store/systemAdminStore.ts`, `src/lib/systemAdmin.ts`, and migrations
  `0024`/`0029`/`0030` in full. Finding: sound. `is_system_admin()` is
  fail-closed and verified-identity-only (0030 fixes an anonymous-session
  bypass in 0024), every RPC re-checks it server-side regardless of
  client-side UI hiding, and `SystemAdminScreen.tsx`'s read-only v1 scope
  (no approve/reject UI) is intentional — that capability belongs to the
  separate stacked branch, confirmed present as
  `remotes/origin/feat/system-admin-approval-controls` (PR #11), not to
  this branch's `create_verified_family`/`system_admin_set_family_approval`
  foundation (0032).
- **Fix applied** while cross-referencing 0032's `system_admin_set_family_approval`
  against the Edge Function that calls the plain `create_verified_family`
  path (`supabase/functions/create-verified-family/index.ts`): the welcome
  email sent immediately on family creation was unconditional — it always
  said "the family was created" and handed out the invite code/join
  link/QR, even when `AUTO_APPROVE_NEW_FAMILIES=false` produced a `pending`
  family. `find_family_by_invite_code()`/`join_family()` (0033) only
  resolve `approval_status = 'active'` families, so that link/QR silently
  fail to work until a system admin approves — directly contradicting the
  in-app pending screen's own promise
  (`FamilyOnboardingScreen.tsx`: "נשלח עדכון לאחר אישור מנהל המערכת").
  Fixed by branching the welcome email's subject/body on
  `row.approval_status === 'pending'`: the pending branch now states the
  request is awaiting system-admin approval and withholds the join
  link/QR, while the active branch is unchanged. Added a regression test
  in `verifiedFamilyServerBoundary.test.ts` asserting the pending-approval
  wording appears before the active-only join-link interpolation in the
  Edge Function source (matching this repo's existing text-based Edge
  Function test convention, since these Deno functions aren't executed
  under Jest). No migration change needed — `record_email_delivery_attempt`'s
  `message_type` check already allows `family_welcome` for both branches.
  Files changed: `supabase/functions/create-verified-family/index.ts`,
  `src/lib/__tests__/verifiedFamilyServerBoundary.test.ts`.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox.
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: 910 passed, 910 total (one new test vs. the prior cycle's 909);
  Snapshots: 0 total; Time ~15s.
- This cycle's changes (the Edge Function fix, the new test, and this file)
  are committed and pushed to `feat/verified-auth-onboarding-batch-2` as
  part of closing out this cycle — see `git log` on that branch for the
  exact SHA immediately following `da6deea`.

## Last Evidence Timestamp

2026-09-13T12:05:00Z

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

Separately, this cycle found `gh` CLI access itself gated behind an
interactive approval prompt with no owner present to answer it, so
GitHub-side PR/CI state (PR #7, PR #11, workflow run metadata) could not
be pulled directly this cycle. This is a secondary, independent blocker
from the Staging-credentials one above; it affects only GitHub-metadata
inspection, not local repository work, which proceeded normally.

This blocker does not stop execution — see Queue below for independent
safe tasks that do not depend on it.

## Next Safe Task

Queue item 5 — Batch 4 regression: a repository-level, credential-free
sweep of the Batch 4 System Admin / mutual-swap / reschedule surface
(migrations `0026`/`0027`/`0028`/`0031` and their client call sites) for
any release-blocking authorization or correctness gap fixable without live
credentials, following the same read-then-fix pattern used this cycle for
Queue item 4. If nothing actionable turns up, fall back to Queue item 7's
still-open Supabase-regression half by re-attempting `gh`/`docker` access
(only if the sandbox's permission mode allows it that cycle), or otherwise
to a fresh line-by-line QA pass over `docs/qa/QA_RELEASE_GUARDIAN.md`'s
remaining untouched themes (Hebrew RTL/responsive, dog-sex/grammatical
copy, mascot/Reduced Motion) for the files already touched by this Batch.

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

- Queue item 4 — Settings/Roles/System Admin QA: full read of
  `SystemAdminScreen.tsx`/`systemAdminStore.ts`/`systemAdmin.ts` and
  migrations 0024/0029/0030. No release-blocking gap found in the named
  scope; confirmed the approve/reject UI gap is intentionally deferred to
  PR #11 (`feat/system-admin-approval-controls`), not a defect on this
  branch.
- Adjacent fix (Queue item 3 territory, found during the above QA) —
  `create-verified-family`'s welcome email no longer claims a `pending`
  family is ready to share/join; it now sends approval-status-aware
  content and withholds the (currently non-functional) invite link/QR
  until a system admin approves. New regression test added. Evidence:
  `npx tsc --noEmit` PASS, `npm test -- --runInBand` 89/89 suites, 910/910
  tests PASS (this file's Last Evidence entry, 2026-09-13T12:05:00Z),
  committed and pushed to `feat/verified-auth-onboarding-batch-2`.

## Explicitly Out of Scope

- GPS / automatic walk detection
- Inactive-family lifecycle / deletion
- Expanded admin audit/analytics/reports
- Support / help desk
- Cosmetic email branding
- Any other backlog feature not in the Queue above
