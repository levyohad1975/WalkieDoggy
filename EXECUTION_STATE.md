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

Queue item 5 — Batch 4 regression: repository-level, credential-free sweep
of migrations `0026`/`0027`/`0028`/`0031` (admin direct reschedule, History/
Statistics server enforcement, invite detail preview, admin mutual walk
swap) and their client call sites, following the same upstream
`Batch 2 Supabase Rehearsal` workflow run (id `34754710595`, conclusion
`success`) on `feat/verified-auth-onboarding-batch-2` @
`63c00fb7e84f1f2b371e6739d5d3d05dda6754f7` — this cycle's repo state was
already one commit ahead of that sha (`94a19a5`, the prior cycle's own
Queue-item-4 close-out), reconciled as expected drift, not new work lost.

## Current Task Status

DONE. All four migrations and their identified client call sites
(`src/lib/walkAdmin.ts`, `src/store/scheduleStore.ts`
(`rescheduleWalk`/`swapTwoWalks`), `src/lib/invites.ts` +
`FamilyOnboardingScreen.tsx` (`inspectFamilyInviteDetail`),
`src/lib/permissionedWalks.ts` + `HistoryScreen.tsx`/`StatisticsScreen.tsx`/
`HomeScreen.tsx`, `src/data/supabaseRepository.ts`'s `toWalk`/swap-column
mapping) were read in full. No release-blocking gap found:

- `admin_reschedule_walk`/`admin_swap_walks` (0026/0031) are admin-gated via
  `is_family_admin()` (fail-closed under impersonation), collision/pending/
  same-family checked, audited, and their client wrappers
  (`src/lib/walkAdmin.ts`) do not perform any redundant second raw write —
  matches `scheduleStore.ts`'s own documented single-authoritative-write
  correction.
- The 0031 `admin_swap_walks` "both walks must belong to the same dog"
  constraint is a no-op in practice, not a latent UI gap: `familyStore.ts`
  models exactly one `dog: Dog | null` per family (not an array), so every
  walk in a family already shares the same `dogId` — confirmed by reading
  `familyStore.ts` rather than assumed.
- `swapWalksMutual` (`src/logic/walkActions.ts`) reproduces
  `admin_swap_walks`'s `swap_original_user_id`
  coalesce-preserve-across-swaps semantics exactly, and
  `supabaseRepository.ts`'s `toWalk`/write-mapping round-trips all four
  `swap_*` columns consistently with it.
- `inspect_family_invite_detail` (0028) is additive/narrower-safe per its
  own header reasoning (never returns family_id/token_hash/raw token; rich
  fields only for a still-pending/unexpired token) and
  `FamilyOnboardingScreen.tsx` only renders `dogPhotoUrl`/`members` when
  present, matching the RPC's own pending-only gating.
- `has_member_permission`/the tightened `walks` RLS policy/
  `list_history_walks`/`list_statistics_walks`/`get_last_resolved_walk`
  (0027) fail closed on an unknown permission key and on no active family;
  `permissionedWalks.ts`'s wrappers are the screens' actual dataset (not a
  discarded probe), matching the migration's own corrected model.
- A handful of 0026/0031 raise strings (`walk not found in this family`,
  `choose a different walk`, `one of the swap members is no longer active`,
  `both walks must belong to the same dog`) have no entry in
  `src/lib/errorMessages.ts` and fall through to the generic Hebrew
  fallback. Checked against precedent: `walk not found in this family` is a
  pre-existing 0005 string already left unmapped today, so this is
  consistent existing convention for rare/edge "stale UI" cases, not a
  regression introduced by this batch — not treated as release-blocking.

Confirmed the full local validation gate still passes with zero code
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
  clean tree, HEAD `94a19a5` (two commits ahead of the trigger's target sha
  `63c00fb`: `da6deea` and `94a19a5` are both the prior cycle's own
  state-tracking + Queue-item-4 close-out commits — expected and
  consistent, not a drift). Confirmed via `git show --stat` on both commits
  that `94a19a5` contains exactly the Edge Function welcome-email fix, its
  regression test, and the `EXECUTION_STATE.md` update described in the
  previous cycle's evidence below — nothing lost, nothing to redo.
- `gh auth status` again required interactive approval with no owner
  present in this sandbox's permission mode this cycle too — same
  secondary GitHub-tooling blocker already on file, not retried
  repeatedly, not new information.
- QA read performed (Queue item 5, this cycle): full read of
  `supabase/migrations/0026_admin_reschedule_walk.sql`,
  `0027_history_statistics_server_enforcement.sql`,
  `0028_family_invite_detail_preview.sql`,
  `0031_admin_mutual_walk_swap.sql`, plus client call sites
  `src/lib/walkAdmin.ts`, `src/lib/invites.ts`, `src/lib/permissionedWalks.ts`,
  `src/store/scheduleStore.ts`, `src/logic/walkActions.ts`,
  `src/data/supabaseRepository.ts`, `src/screens/FamilyOnboardingScreen.tsx`,
  `src/screens/HomeScreen.tsx`, `src/lib/errorMessages.ts`. Finding: sound,
  no release-blocking gap — full reasoning recorded in Current Task Status
  above (admin RPCs fail-closed and audited with no redundant client
  double-write, the same-dog swap constraint is moot by construction
  because `familyStore.ts` models one dog per family, swap-attribution
  logic and swap-column mapping match the RPC exactly, invite-detail
  enrichment stays pending-only gated end to end, and the small set of
  unmapped rare-error strings matches pre-existing 0005-era convention
  rather than a new regression).
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: 910 passed, 910 total; Snapshots: 0 total; Time ~20s. No test or
  source changes were needed for this cycle's QA sweep — this run
  reconfirms the exact baseline the prior cycle already left green.

## Last Evidence Timestamp

2026-09-13T13:10:00Z

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

THIS CYCLE ONLY — a third, new blocker: `git add`/`git commit` themselves
were gated behind the same kind of interactive approval prompt in this
cycle's sandbox permission mode, with no owner present to answer it (read-only
git commands like `git status`/`git log`/`git diff` were unaffected and ran
normally). Unlike the previous two cycles (`da6deea`/`94a19a5`, both
committed and pushed successfully), this cycle's QA-sweep evidence and this
file's own update are therefore recorded in the working tree only, NOT
committed or pushed — `git status` shows `EXECUTION_STATE.md` as locally
modified. No content is lost (nothing destructive was attempted, and this
is this cycle's own edit, not prior work), and the next cycle should
re-attempt the commit/push of this file first, before selecting a new task,
so the queue history stays continuous.

This blocker does not stop execution — see Queue below for independent
safe tasks that do not depend on it.

## Next Safe Task

Queue item 5 is now closed out with no actionable defect found (see
Current Task Status/Last Evidence above). Next: re-attempt Queue item 7's
still-open Supabase-regression half via `gh`/`docker` access (only if the
sandbox's permission mode allows it that cycle — it has not in either of
the last two cycles); if still blocked, fall back to a fresh line-by-line
QA pass over `docs/qa/QA_RELEASE_GUARDIAN.md`'s remaining untouched themes
(Hebrew RTL/responsive, dog-sex/grammatical copy, mascot/Reduced Motion)
for the files already touched by Batches 3/4 (the admin reschedule/swap
modals, `FamilyOnboardingScreen.tsx`'s new invite-detail preview UI,
History/Statistics screens) — a credential-free QA sub-task of Queue item
8 that does not depend on either open blocker.

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

- Queue item 5 — Batch 4 regression: full read of migrations
  0026/0027/0028/0031 and their client call sites
  (`walkAdmin.ts`/`invites.ts`/`permissionedWalks.ts`/`scheduleStore.ts`/
  `walkActions.ts`/`supabaseRepository.ts`/`FamilyOnboardingScreen.tsx`/
  `HomeScreen.tsx`/`errorMessages.ts`). No release-blocking gap found; no
  code changes required this cycle. Re-ran the full local validation gate
  as evidence: `npx tsc --noEmit` PASS, `npm test -- --runInBand` 89/89
  suites, 910/910 tests PASS (this file's Last Evidence entry,
  2026-09-13T13:10:00Z). No commit needed — working tree stayed clean
  (docs-only `EXECUTION_STATE.md` update follows this entry).

### Previous cycle (for continuity)

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
  until a system admin approves. New regression test added. Committed and
  pushed to `feat/verified-auth-onboarding-batch-2` as `94a19a5`.

## Explicitly Out of Scope

- GPS / automatic walk detection
- Inactive-family lifecycle / deletion
- Expanded admin audit/analytics/reports
- Support / help desk
- Cosmetic email branding
- Any other backlog feature not in the Queue above
