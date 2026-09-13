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

Diagnose and validate CI coverage for the PR #7 / PR #11 stacked pair
(item 7 of the Queue below), and watch for the owner's response to the
Staging-credential unblock question.

## Current Task Status

DONE for this cycle's executed sub-task (see Last Evidence). No task is
currently RUNNING; the worker is at READY, watching for the next trigger
(new push, CI result, or owner response) before selecting/executing the
next queue item.

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance: originally installed on `chore/agentic-execution-v1`
  (PR [#13](https://github.com/levyohad1975/WalkieDoggy/pull/13),
  merged into `main` by the owner on 2026-09-13); this copy of the same
  files was restored directly onto this RC branch by the owner
  (commits `23c155b`, `8742761`) so it travels with PR #7.

## Last Evidence

- PR #7 head `8742761976b52ea5ed687f16627470659d794778`: both CI checks
  (`Typecheck and tests`, `local-supabase-rehearsal`) passed —
  https://github.com/levyohad1975/WalkieDoggy/actions/runs/34745395212
  and https://github.com/levyohad1975/WalkieDoggy/actions/runs/34745395237.
  `mergeable_state: clean`.
- Root cause diagnosed for PR #11's missing automatic CI: `ci.yml` and
  `batch2-supabase-rehearsal.yml` originally triggered `pull_request` only
  for `branches: [main]`; PR #11 was retargeted from `main` to
  `feat/verified-auth-onboarding-batch-2`, so its pushes stopped matching
  either filter. Confirmed by contrast against PR #13 (base `main`),
  which got an automatic passing run on the same unmodified workflow
  file.
- Fix applied by the owner directly on this branch (commit `c8d67c9`,
  "ci: support stacked PR validation"): removed the `branches: [main]`
  restriction from both workflows' `pull_request` triggers and added
  `workflow_dispatch` to `ci.yml`. Confirmed working — PR #7's own CI ran
  automatically on the very next push.
- While PR #11's branch had not yet inherited that fix, produced
  substitute evidence for its head `9bb94b4850cab84487fbbc02ffeb7a4342e4e029`
  directly: local `tsc --noEmit` (clean) and `npm test -- --runInBand`
  (91 suites / 925 tests passing) via a read-only detached checkout of
  that head, plus a real GitHub Actions run via manual `workflow_dispatch`
  of `batch2-supabase-rehearsal.yml` against `feat/system-admin-approval-controls`
  — run #15 (id `34737391054`), conclusion: success.
- Responsive-containment + native-only `direction` refactor (commits
  `77b884a`, `53ec016`, `ca2ee87`, `385182b`) — Playwright regression at
  375/768/1024/1440/1920px: 0 console errors, no overflow; `tsc` clean;
  89/89 suites, 909/909 tests passing at the time.

## Last Evidence Timestamp

2026-09-13T07:33:06Z (most recent: PR #7 CI green on `8742761`)

## Blocker

Live Staging E2E (family creation persistence, invite/join code/link/QR,
second-member join, real OTP/email delivery, System Admin live approve/
reject) requires a real non-Production Supabase project and a Resend
account with a verified sending domain. Neither is available in this
sandbox: no `.env`, no linked Supabase project, no Resend/Supabase
account-level tool, no privileged Docker for a local stack. Two unblock
options were posted on PR #7: (A) the owner runs the non-Production
deployment/config steps and shares evidence to verify, or (B) the owner
grants this session the credentials directly. Unanswered as of the last
check.

This blocker does not stop execution — see Queue below for independent
safe tasks that do not depend on it.

## Next Safe Task

No further independent, not-yet-executed, credential-free RC task is
identified as of this cycle. PR #11's branch still needs a re-sync from
PR #7 to inherit the CI trigger fix and regain automatic CI (the owner's
action, not pushed by this worker per the no-race rule on PR #11's
branch). Watching for: that re-sync, new PR activity, or the owner's
response to the Staging-credential question — any of which may open a
new executable item.

## Approval Required

None currently pending. Will be set to a specific action (merge, deploy,
migration, secrets/data change, or another irreversible/high-impact
action) the moment one is reached, and execution stops at
`WAITING_APPROVAL` until the owner responds.

## Active Worker

Claude (session `session_0189gMeA8fbcDQi7a8N3dZ13`) — watching, no task
currently `RUNNING`.

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

- Diagnosed PR #11's missing automatic CI (base-branch retarget vs.
  `branches: [main]` trigger filter) — see Last Evidence.
- Produced substitute local + dispatched-CI evidence for PR #11's head
  `9bb94b4` — see Last Evidence.
- Verified the owner's trigger-config fix (`c8d67c9`) works: PR #7 CI is
  green automatically on `8742761`.
- Fast-forwarded this branch to the owner's latest pushes (`c8d67c9`,
  `23c155b`, `8742761`) with a clean working tree throughout.

## Explicitly Out of Scope

- GPS / automatic walk detection
- Inactive-family lifecycle / deletion
- Expanded admin audit/analytics/reports
- Support / help desk
- Cosmetic email branding
- Any other backlog feature not in the Queue above
