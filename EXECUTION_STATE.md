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
Motion) over the UI touched by Batches 3/4: the admin reschedule/swap UI
(`EditWalkModal.tsx`, `SwapWalkPickerModal.tsx`), `FamilyOnboardingScreen.tsx`'s
0028 invite-detail preview block, and `HistoryScreen.tsx`/`StatisticsScreen.tsx`.
Selected per the prior cycle's own "Next Safe Task" note, since both
higher-priority alternatives were re-confirmed still blocked this cycle
(see Last Evidence/Blocker).

## Current Task Status

DONE. Fresh (this-cycle) independent read of each in-scope file against
the four QA_RELEASE_GUARDIAN.md themes named in Queue item 6/8 (RTL/
responsive, dog-sex/grammatical copy, mascot/Reduced Motion). No
release-blocking gap found:

- `EditWalkModal.tsx`/`SwapWalkPickerModal.tsx`: all copy renders through
  `RtlText`, right-aligned; both already carry prior-round "final QA"
  fix comments (sheet-collapse `flexGrow:0/flexShrink:1` fix, dedicated
  full-size swap picker replacing a cramped nested ScrollView) — no new
  regression found on top of that prior work. No dog-gendered copy in
  either file (walk/user text only, no dog pronouns).
- `FamilyOnboardingScreen.tsx`'s 0028 invite-detail preview block: dog
  name/photo row uses `previewDogRow: { flexDirection: 'row-reverse',
  alignItems: 'center' }` and the member-avatar row uses
  `justifyContent: 'flex-end'` — both correctly RTL-anchored, not left as
  a bare unflipped `row`. Dog-name label is gender-neutral ("שם הכלב/ה")
  matching the app's established dog-sex-neutral-copy convention.
  Mascot usage (`WalkieMascot state="idle"`) delegates Reduced-Motion
  handling entirely to `WalkieMascot.tsx` itself, which already fails
  closed to static (`useState(true)` fail-safe default until
  `AccessibilityInfo.isReduceMotionEnabled()` resolves) — no bypass
  introduced at the call site.
- `HistoryScreen.tsx`/`StatisticsScreen.tsx`: RTL rows consistently use
  the project's `nativeDirection('rtl')` pin (see `theme/tokens.ts`)
  alongside `RtlText`/`textAlign:'right'`/`writingDirection:'rtl'`;
  numeric KPI values are deliberately kept LTR via a separate
  `ltrText`/ `nativeDirection` pairing, matching the documented
  Countdown.tsx precedent for "digits must stay LTR, labels stay RTL."
  Neither screen references dog sex/pronouns at all (counts and names
  only), and `HistoryScreen.tsx`'s dog-name fallback ("הכלב/ה") is
  already gender-neutral.
- Noted, not actionable: `src/components/EditWalkModal.tsx`'s `userRow`
  chip grid (`flexDirection:'row', flexWrap:'wrap'`) does not use
  `nativeDirection('rtl')` the way History/Statistics' single-line rows
  do. Read `nativeDirection`'s own doc comment and the Countdown.tsx bug
  it fixes: the pin exists for rows whose *physical* left-to-right vs.
  right-to-left order carries meaning (digit sequences, single-line
  label rows). A wrapping chip grid has no such meaning to preserve
  either way, this component predates Batch 3/4 and already carries
  multiple past QA-round fix comments, and no test or QA record flags it
  as a regression — treated as a pre-existing, non-blocking convention
  difference, not a defect, and intentionally not touched this cycle to
  avoid an unreviewed layout change outside the requested scope.
- Also noted, not actionable: a pre-existing tracked stray file,
  `src/components/WalkRow.tsx.encoding-backup` (committed at `bea2739`,
  "before major change", unrelated to Batches 3/4). Repo-hygiene-only,
  no behavior impact; left untouched as out of scope for a QA content
  sweep.

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
  clean tree, HEAD `9656c76` (the prior cycle's own successful commit of
  its Queue-item-5 close-out and this file's update — confirmed via
  `git show --stat 9656c76`: `EXECUTION_STATE.md` only, no source changes
  — so the prior cycle's "THIS CYCLE ONLY" git-commit-approval blocker
  resolved itself before that cycle ended; nothing was lost or needs
  redoing). Trigger's target sha `eff4228` is a older ancestor on this
  same branch (`ci: add isolated Agentic Staging readiness gate (#24)`);
  branch has legitimately advanced past it since dispatch, not a drift to
  reconcile.
- `gh auth status` again required interactive approval with no owner
  present in this sandbox's permission mode this cycle too — same
  secondary GitHub-tooling blocker already on file, retried once (not
  repeatedly) to reconfirm it's still current, not new information.
  `docker ps` succeeded (daemon reachable, zero containers running) but no
  local Supabase stack is running and the `supabase` CLI is still not
  installed in this sandbox — Queue item 7's Supabase-regression half
  remains blocked for the same reason as prior cycles.
- QA sweep performed (Queue item 8 sub-task, this cycle): fresh read of
  `src/components/EditWalkModal.tsx`, `src/components/SwapWalkPickerModal.tsx`,
  `src/screens/FamilyOnboardingScreen.tsx` (0028 invite-detail preview
  block), `src/screens/HistoryScreen.tsx`, `src/screens/StatisticsScreen.tsx`,
  `src/theme/tokens.ts` (`nativeDirection`), `src/components/Countdown.tsx`
  (precedent for `nativeDirection`'s intended use), and
  `src/components/WalkieMascot.tsx` (Reduced Motion fail-safe default).
  Finding: sound, no release-blocking gap — full reasoning recorded in
  Current Task Status above.
- `npm ci` — succeeded, 907 packages installed fresh in this sandbox (fresh
  checkout, no `node_modules` present at cycle start).
- `npx tsc --noEmit` — **PASS**, zero errors, zero output.
- `npm test -- --runInBand` — **PASS**: Test Suites: 89 passed, 89 total;
  Tests: 910 passed, 910 total; Snapshots: 0 total; Time ~15s. No test or
  source changes were needed for this cycle's QA sweep — this run
  reconfirms the exact baseline the prior cycle already left green.

## Last Evidence Timestamp

2026-09-13T16:45:00Z

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

THIS CYCLE ONLY — the same intermittent blocker recurred: `git add`
itself was gated behind an interactive approval prompt with no owner
present in this cycle's sandbox permission mode (read-only git commands —
`git status`/`git log`/`git diff`/`git show`/`git branch` — were
unaffected and ran normally throughout). The prior cycle hit this same
gate and it resolved itself before that cycle ended (`9656c76` committed
successfully); this cycle it did not clear by the end of the run, so this
file's own update below is recorded in the working tree only, NOT
committed or pushed this cycle. Nothing is lost — this is only this
cycle's own edit, not prior work — and the next cycle should re-attempt
committing this file first, before selecting a new task, so the queue
history stays continuous. Given the pattern across cycles (blocked →
resolved → blocked again with no code-side trigger), this looks like
sandbox-side permission-mode variance per cycle rather than anything
fixable from inside the repository.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

This cycle's Queue item 8 sub-task (QA_RELEASE_GUARDIAN.md sweep over the
Batch 3/4-touched reschedule/swap/invite-preview/History/Statistics UI) is
closed out with no actionable defect found (see Current Task Status/Last
Evidence above). Next: re-attempt Queue item 7's still-open
Supabase-regression half via `gh`/a local Supabase stack (only if the
sandbox's permission mode and available tooling allow it that cycle — the
`supabase` CLI has not been installed in any cycle so far); if still
blocked, continue the Queue item 8 QA_RELEASE_GUARDIAN.md sweep into its
remaining untouched surface — the System Admin approve/reject screens on
the stacked `feat/system-admin-approval-controls` branch (PR #11), and the
Settings/Roles screens — for the same four themes, another credential-free
sub-task that does not depend on either open blocker.

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
  dog-sex/grammatical copy, mascot/Reduced Motion) over
  `EditWalkModal.tsx`/`SwapWalkPickerModal.tsx`/
  `FamilyOnboardingScreen.tsx`'s 0028 invite-preview block/
  `HistoryScreen.tsx`/`StatisticsScreen.tsx`. No release-blocking gap
  found; no code changes required this cycle. Re-ran the full local
  validation gate as evidence: `npx tsc --noEmit` PASS,
  `npm test -- --runInBand` 89/89 suites, 910/910 tests PASS (this file's
  Last Evidence entry, 2026-09-13T16:45:00Z). Reconfirmed `gh` CLI is
  still approval-gated in this sandbox and no local Supabase stack/CLI is
  available, so Queue item 7 stays blocked for another cycle.

### Previous cycle (for continuity)

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
