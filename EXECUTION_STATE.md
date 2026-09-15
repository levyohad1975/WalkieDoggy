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

Reconciliation at cycle start (this cycle, manual `workflow_dispatch`,
target sha `c718adf8...`): `git status`/`git log` showed HEAD at `86e3e34`
with a **clean working tree**, exactly matching
`origin/feat/verified-auth-onboarding-batch-2` (branch reported "up to
date"). `git show --stat 86e3e34` confirmed it contains exactly
`EXECUTION_STATE.md` + the four coverage files the prior cycle's own
narrative described (`id.test.ts`, `pushIdempotency.test.ts`,
`pushRouting.test.ts`, `walkRequestStatusLine.test.ts`) — i.e. that
cycle's commit/push **did land**, and this time the file's own narrative
already matched HEAD (no drift to reconcile this cycle, unlike most prior
cycles). `node_modules` was absent at cycle start (fresh sandbox); ran
`npm ci` (907 packages, clean, same 19 pre-existing moderate advisories).
`gh auth status` and `docker info` re-checked fresh this cycle: both
still gated behind the same interactive approval prompt. Retried `git rm`
on the four dead scratch/debug files (`tmp_coverage_inspect.js`,
`src/lib/__tests__/__scratch_platform_probe.test.ts`,
`src/lib/__tests__/__scratch_pushTokens_probe.test.ts`,
`src/notifications/__tests__/__scratch_isolate_probe.test.ts`) — gated
again (thirty-fifth consecutive cycle blocked).

Selected this cycle's single bounded unit: a fresh full-repo
`jest --coverage` sweep (no `--collectCoverageFrom` filter) to check for
coverage drift/new gaps beyond the previously-closed named list, per the
prior cycle's own "Next Safe Task" instruction. Result: every
previously-closed file remained at 100% (or its previously-documented
provably-maximal level — `localRepository.ts` line 111,
`syncQueue.ts` lines 289/300/321, `presence.ts` line 136, all still
correctly untested per their earlier unreachability proofs). The sweep
surfaced three **not-previously-tracked** branch gaps in `src/mascot/`:
`celebrationAnimationManifest.ts` line 54 (100/83.33/100/100),
`mascotStage.ts` lines 53 and 65 (100/83.33/100/100), and
`messageEngine.ts` line 158 (97.36/81.39/100/96.96).

Read all three files plus their existing test files
(`mascotStage.test.ts`, `celebrationAnimationManifest.test.ts`,
`messageEngine.test.ts`) and traced every real call site
(`grep -rn` across `src/`):

- `mascotStage.ts` lines 53/65 (`now: Date = new Date()` default
  parameters on `deriveMascotStageForPendingWalk()` and
  `deriveMascotMoment()`): every existing test call and every real call
  site (`NextWalkCard.tsx` passes `new Date()` explicitly) supplies `now`
  explicitly, so the default-time branch was never taken — same pattern
  as last cycle's `pushIdempotency.ts`/`walkRequestStatusLine.ts`/
  `id.ts` closures. Added 2 tests: one calling
  `deriveMascotStageForPendingWalk()` with `now` omitted, one calling
  `deriveMascotMoment()` with `now` omitted (both use a walk far in the
  future so the result is deterministic regardless of the real current
  time).
- `celebrationAnimationManifest.ts` line 54
  (`CELEBRATION_ANIMATION_MANIFEST.find(...)`): the "no match found"
  (`undefined`) branch was never exercised — the sole real call site
  (`WalkCompletionCelebration.tsx`) always passes a celebration whose id
  comes from `CELEBRATION_LIBRARY` (`walkCompletionCelebration.ts`),
  which happens to contain the exact same 9 ids as the animation
  manifest today, but the two arrays are independently maintained
  literals with no type-level correspondence guarantee — a future edit
  adding a `CELEBRATION_LIBRARY` entry without a matching manifest entry
  (or vice versa) would hit this branch for real, so it is a genuine
  config-drift-guard branch, not defensive dead code proven impossible by
  the type system (unlike `localRepository.ts`'s line 111, which a class
  invariant makes provably impossible). Added 1 test asserting
  `animationManifestFor({ id: 'not-a-real-celebration-id' })` is
  `undefined`.
- `messageEngine.ts` line 158 (`selectMessage()`'s
  `if (candidates.length === 0)` fallback) — **not closed this cycle**:
  the line's own comment already documents it as "should be unreachable
  (every category has variants)," the same config-drift-guard class as
  the `celebrationAnimationManifest.ts` case above, but exercising it
  would require `jest.mock`-ing `messageLibrary.ts`'s `MESSAGE_LIBRARY`
  export to simulate a category with zero templates (the existing test
  file does no mocking of that module today) — more invasive than a
  same-file default-argument or literal-id test, so left for a future
  cycle rather than rushed into this one's bounded unit, same treatment
  as `webPush.ts`'s "genuinely hard, expect friction" categorization
  below.

## Prior cycle's Current Task (superseded, kept for continuity)

Reconciliation at cycle start: `git status`/`git log` showed HEAD at
`865554f` with a **clean working tree**, exactly matching
`origin/feat/verified-auth-onboarding-batch-2` (branch reported "up to
date"). `git show --stat 865554f` confirmed it contains exactly
`EXECUTION_STATE.md` + `src/lib/__tests__/errorMessages.test.ts` (216
insertions/181 deletions across the two files) — i.e. the prior cycle's
own commit/push, which that cycle's own narrative described as
"attempted this cycle and gated (blocked)," **did in fact land** (the
same self-reporting-drift pattern documented across many prior cycles,
the "under-claimed" variant, recurring again). No further reconciliation
action needed; proceeded straight to new work. `node_modules` was absent
at cycle start (fresh sandbox); ran `npm ci` (907 packages, clean, same
19 pre-existing moderate advisories) before any test/coverage command.
`gh auth status` and `docker info` re-checked fresh this cycle: both
still gated behind the same interactive approval prompt, no change from
prior cycles. Retried `git rm` on the four dead scratch/debug files
(`tmp_coverage_inspect.js`,
`src/lib/__tests__/__scratch_platform_probe.test.ts`,
`src/lib/__tests__/__scratch_pushTokens_probe.test.ts`,
`src/notifications/__tests__/__scratch_isolate_probe.test.ts`) — gated
again (thirty-fourth consecutive cycle blocked).

Selected this cycle's single bounded unit: closing out the last
remaining named coverage-gap group from the prior cycle's "Next Safe
Task" list — the four default-parameter/optional-argument branch gaps in
`src/logic/pushRouting.ts` (line 132), `src/logic/pushIdempotency.ts`
(line 47), `src/logic/walkRequestStatusLine.ts` (line 67), and
`src/lib/id.ts` (line 8). Fresh-measured coverage matched the prior
sweep exactly (100/96.15/100/100, 100/91.66/100/100, 100/96/100/100,
100/66.66/100/100 respectively) before any change. Read all four files
plus their existing test files (`id.ts` has **no** dedicated test file at
all — only exercised indirectly via `familyStore`/`scheduleStore` tests
that always pass an explicit prefix argument) and determined each
uncovered branch is real and reachable, not defensive dead code:

- `lib/id.ts` line 8 (`_prefix = ''`): every real call site
  (`ScheduleScreen.tsx`, `familyStore.ts`, `scheduleStore.ts`) passes an
  explicit prefix, so the *default* branch (calling with zero arguments)
  was never exercised anywhere in the test suite. Created a new
  `src/lib/__tests__/id.test.ts` (3 tests: no-arg call matches the UUID
  v4 regex, the prefix argument is never embedded in the output,
  uniqueness across calls).
- `logic/pushIdempotency.ts` line 47 (`now: Date = new Date()`): every
  existing `decideClaimOutcome()` test call passes `now` explicitly, so
  the default-time branch was never taken. Added 1 test calling
  `decideClaimOutcome(null)` with no second argument.
- `logic/walkRequestStatusLine.ts` line 67 (`now: Date = new Date()`):
  same pattern — every existing call passes `NOW` explicitly. Added 1
  test calling `computeWalkRequestStatusLine()` with the `now` parameter
  omitted.
- `logic/pushRouting.ts` line 132
  (`(ctx.familyAdminUserIds ?? []).filter(Boolean)`): every existing
  timeChange-`created` test supplies an explicit `familyAdminUserIds`
  array, so the `?? []` fallback (the field omitted entirely) was never
  taken. Added 1 test calling `validateAndRoutePushEvent()` for a
  timeChange `created` event with no `familyAdminUserIds` key at all,
  asserting it resolves to zero recipients and `authorized: false`.

All four files now measure **100%/100%/100%/100%**, closing out the
entire named coverage-gap list from every prior cycle's tracked queue
(the quantitative-Jest-coverage angle is now fully exhausted — see Next
Safe Task below for the one remaining genuinely-hard file,
`src/lib/webPush.ts`, and the one non-gap, `src/data/repository.ts`).

## Current Task Status

**Work complete and locally validated; commit/push attempted this cycle
— see Last Evidence for the exact outcome, and the standing instruction
for the next cycle to verify via `git log`/`git show --stat` before
trusting this claim, since the commit has landed asynchronously after
this text was written in several prior cycles.** `src/mascot/mascotStage.ts`:
2 new tests, coverage **100%/100%/100%/100%**, up from
100%/83.33%/100%/100%. `src/mascot/celebrationAnimationManifest.ts`: 1 new
test, coverage **100%/100%/100%/100%**, up from 100%/83.33%/100%/100%.

Full local validation gate: `npx tsc --noEmit` — **PASS**, zero errors.
`npm test -- --runInBand` — **PASS**: 97/97 suites, **1231** tests passed
(1228 baseline + 3 new: 2 in `mascotStage.test.ts` + 1 in
`celebrationAnimationManifest.test.ts`). `git status`/`git diff --stat`
confirmed exactly two changed files from HEAD `86e3e34`:
`src/mascot/__tests__/mascotStage.test.ts` (+11/-0),
`src/mascot/__tests__/celebrationAnimationManifest.test.ts` (+6/-1) — no
unrelated files touched.

Also carried forward from prior cycles (still true, not re-verified this
cycle): every named `QA_RELEASE_GUARDIAN.md` theme still has at least one
dedicated credential-free sweep with no unresolved release-blocking gap —
see "Completed This Cycle" history below for the full list of which cycle
covered which theme, and Blocker below for the still-open
`FamilyOnboardingScreen.tsx` applicant-navigation defect (the one known,
unfixed, actionable finding from the whole campaign, on the stacked
branch only).

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- This cycle start (manual `workflow_dispatch`, target sha
  `c718adf8...`): `git status`/`git log --oneline -5`/`git show --stat
  86e3e34` confirmed HEAD is `86e3e34`, clean working tree, exactly
  matches `origin/feat/verified-auth-onboarding-batch-2` (branch reported
  identical SHA for local and origin, "up to date"). `86e3e34` contains
  exactly `EXECUTION_STATE.md` + the four prior-cycle coverage test files
  — the prior cycle's own commit/push **did land**, and this file's own
  narrative already matched HEAD (no drift found this cycle).
- `npm ci` — succeeded (no `node_modules` was present at cycle start; 907
  packages added, no failure; 19 moderate `npm audit` advisories noted,
  none newly introduced this cycle).
- `gh auth status` — "This command requires approval" (gated, same as
  every prior cycle). `docker info` — "This command requires approval"
  (gated, same as every prior cycle). Both freshly re-checked this cycle.
- `git rm tmp_coverage_inspect.js
  src/lib/__tests__/__scratch_platform_probe.test.ts
  src/lib/__tests__/__scratch_pushTokens_probe.test.ts
  src/notifications/__tests__/__scratch_isolate_probe.test.ts` — "This
  command requires approval" (blocked). Same blocker as every prior
  cycle — thirty-fifth consecutive cycle blocked on the scratch-file
  cleanup.
- `npx jest --coverage --coverageReporters=text --runInBand` (full
  repo, no filter, before change) — 97/97 suites, 1228/1228 tests
  passed; every previously-closed file confirmed still 100% (or its
  documented provably-maximal level); surfaced three not-previously-
  tracked gaps: `src/mascot/celebrationAnimationManifest.ts` line 54
  (100/83.33/100/100), `src/mascot/mascotStage.ts` lines 53/65
  (100/83.33/100/100), `src/mascot/messageEngine.ts` line 158
  (97.36/81.39/100/96.96).
- Read all three files plus their existing test files and traced every
  real call site (`grep -rn` across `src/`) to confirm reachability —
  full reasoning in Current Task above. Determined 2 of the 3 are
  closeable now (`mascotStage.ts`, `celebrationAnimationManifest.ts`);
  the third (`messageEngine.ts` line 158) needs `jest.mock`-ing
  `messageLibrary.ts` and was left for a future cycle.
- Added 2 tests to `src/mascot/__tests__/mascotStage.test.ts` (omitted-
  `now` default-parameter branch on both exported functions), 1 test to
  `src/mascot/__tests__/celebrationAnimationManifest.test.ts`
  (`animationManifestFor()` returns `undefined` for an unknown id).
- `npx jest --coverage --collectCoverageFrom="src/mascot/mascotStage.ts"
  --collectCoverageFrom="src/mascot/celebrationAnimationManifest.ts"
  --coverageReporters=text --runInBand
  src/mascot/__tests__/mascotStage.test.ts
  src/mascot/__tests__/celebrationAnimationManifest.test.ts` (after
  change) — both files **100%/100%/100%/100%**; 2/2 suites, 17/17 tests
  passed.
- `npx tsc --noEmit` (full repo, after the change) — **PASS**, zero
  errors.
- `npm test -- --runInBand` (full local validation gate, final) —
  **PASS**: Test Suites: 97 passed, 97 total; Tests: **1231** passed,
  1231 total (1228 + 3 new); Snapshots: 0 total; Time ~17.6s.
- `git status --porcelain=v1 --untracked-files=all` / `git diff --stat`
  confirmed exactly two changed files from HEAD `86e3e34` before this
  file's own edit was added to the working set:
  `src/mascot/__tests__/mascotStage.test.ts` (+11/-0),
  `src/mascot/__tests__/celebrationAnimationManifest.test.ts` (+6/-1) —
  no unrelated files touched, aside from the four already-tracked
  scratch/debug files noted above (untouched, removal blocked again this
  cycle).

## Last Evidence Timestamp

2026-09-15T05:10:00Z

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

**Update this cycle (context, not yet actionable from this sandbox) — the
Staging OTP E2E executor's own stated next step has now shipped:**
`origin/main` (a separate lineage from this feature branch, out of this
cycle's editable scope) merged PR #40
(`test/staging-family-e2e-v1` -> `main`, merge commit `fd4346d8...` — this
is the `target_sha` this run's own dispatch context named, which is why it
was inspected this cycle even though it sits on `main`, not this branch)
adding a **Staging Family E2E** workflow
(`.github/workflows/staging-family-e2e.yml`) and harness
(`scripts/staging-family-e2e.mjs`) that is exactly Queue item 1's
credentialed half: it requests a real OTP, reads it from the dedicated
Gmail test inbox, calls `create-verified-family`, verifies the persisted
`get_my_family_onboarding_status()` row matches, verifies
`find_family_by_invite_code()` resolves the invite code from a second
anonymous session, and — only when the created family's approval status is
`active` (not `pending`, i.e. only when `AUTO_APPROVE_NEW_FAMILIES` is
effectively true for that Staging project) — has the second device actually
call `join_family()` and confirms it joined. It takes a
`target_branch` `workflow_dispatch` input (defaulting to
`feat/verified-auth-onboarding-batch-2`, this branch), explicitly refuses
`main` as a target, and requires GitHub Environment `staging` secrets
(`SUPABASE_STAGING_URL`, `SUPABASE_STAGING_ANON_KEY`,
`STAGING_OTP_TEST_EMAIL`, three `STAGING_OTP_GMAIL_*` OAuth values) — none
of which this worker ever sees directly, since the workflow runs the
script in CI. This is a real, close-to-complete, non-Production-only
evidence path for Queue item 1's "persisted family, invite/join code,
second-member join" requirement, contingent on: (a) the `staging`
GitHub Environment actually having those six secrets configured
(unverifiable from this sandbox), and (b) someone/something with `gh`
access (or repository UI access) actually dispatching it and reading the
result — this sandbox's `gh auth status` remains gated (reconfirmed this
cycle), so neither triggering nor reading a run of this workflow is
possible from here. This workflow file and script are NOT edited or
copied onto this branch this cycle — they live on `main`, and even a
same-content version on this branch would fall under the
`.github/workflows/**` no-edit restriction, so building/adjusting this
harness is not something this worker can do regardless of branch. Owner/a
future cycle with `gh`/environment access should: (1) confirm the
`staging` GitHub Environment has all six secrets, (2) dispatch
`staging-family-e2e.yml` with `target_branch=feat/verified-auth-onboarding-batch-2`,
(3) read the run's `$GITHUB_STEP_SUMMARY`/logs for `STAGING_FAMILY_E2E_OK`
or `STAGING_FAMILY_E2E_PENDING_OK`. This does not unblock anything this
cycle, but is the most concrete unblock path yet found for Queue item 1.

The pre-existing (older, narrower) **Staging OTP E2E executor**
(`docs/engineering/STAGING_OTP_E2E.md`, merged via PRs #30/#35/#37,
OTP-round-trip only, no family creation) also still lives on `main` — its
own doc's stated intent to extend toward family creation is what the
`staging-family-e2e.yml` workflow above now delivers, so this older
executor is superseded by, not in addition to, the one just described for
Queue item 1's purposes. Both remain equally unreachable from this sandbox
for the same `gh`-gating reason.

Separately, `gh` CLI access itself remains gated behind an interactive
approval prompt with no owner present to answer it in this sandbox's
permission mode (freshly reconfirmed this cycle), so GitHub-side PR/CI
state (PR #7, PR #11, workflow run metadata) still cannot be pulled
directly. This is a secondary, independent blocker from the
Staging-credentials one above; it affects only GitHub-metadata
inspection, not local repository work, which proceeded normally.
`docker info` was also freshly reconfirmed gated this cycle (same
interactive approval prompt) — either way, the `supabase` CLI remains not
installed, so Queue item 7's Supabase-regression half stays blocked on
tooling/access regardless of `docker`'s own reachability. This cycle's
sandbox permission mode again gated `git rm` on the same four
tracked scratch/debug files — `tmp_coverage_inspect.js` (committed several
cycles ago), `src/lib/__tests__/__scratch_platform_probe.test.ts` and
`src/lib/__tests__/__scratch_pushTokens_probe.test.ts` (both committed by
`5dbfb16`, a throwaway exploratory precursor to that same cycle's real
`pushTokensNative.test.ts`), and `src/notifications/__tests__/
__scratch_isolate_probe.test.ts` (committed by `13bf18d`, same class of
throwaway precursor) — left in place, not blocking any other work. A
future cycle should retry `git rm` on all four together the moment the
sandbox's permission mode allows it (thirty-five consecutive cycles
blocked as of this cycle).

**Still-open, independent of this branch:** the applicant-side navigation
bug found in a prior cycle in `src/screens/FamilyOnboardingScreen.tsx`'s
`refreshOnboardingStatus()`/`AppState` effect (unconditional
`setMode('create')` on foreground can hijack a user out of `join`/`redeem`
mode) only exists on stacked branch `feat/system-admin-approval-controls`
(PR #11) — this run's own `TARGET_BRANCH` has a `FamilyOnboardingScreen.tsx`
but `grep`-confirmed this cycle that it contains neither
`refreshOnboardingStatus` nor `AppState` at all, so the buggy code path
genuinely does not exist here. Still needs either (A) a future cycle
dispatched with
`TARGET_BRANCH=feat/system-admin-approval-controls`, or (B) the
owner/a reviewer applying the fix directly on PR #11 (suggested direction:
only call `setMode('create')` when `mode` is already `'choose'`/`'create'`).
Not reproduced in full detail again here — see two-cycles-ago's entry in
git history of this file for the complete chain of evidence.

The recurring `git add`/commit self-reporting drift (a cycle's own
`EXECUTION_STATE.md` narrative says a change "could not commit," but the
commit actually lands asynchronously after that text is written) has now
shown up in a **second variant**: the cycle that produced `0b48693` did
not merely under-claim its own commit — it landed a real, verified
6-test `walkActions.test.ts` change with **no `EXECUTION_STATE.md` edit
attempt narrated at all**, which this cycle's reconciliation had to
reconstruct purely from `git show --stat` (see Current Task above).
Every future cycle's first step must still be: check `git show
--stat`/`git log` against this file's own narrative before trusting it —
both for commits this file claims are pending that may have already
landed, and for commits on HEAD this file never mentions at all — land/
record whatever the reconciliation finds, and only then start new work.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

**First step for the next cycle:** re-derive state from `git log`/`git
show --stat` before trusting this file's own narrative — check both (a)
whether this cycle's own `EXECUTION_STATE.md` + the two modified mascot
test files commit attempt (on top of `86e3e34`) landed, and (b) whether
any further commit exists beyond that which this file's own text never
mentions (the recurring drift pattern — see Current Task/Blocker above).
Reconcile before starting new work either way.

Retry `git rm tmp_coverage_inspect.js
src/lib/__tests__/__scratch_platform_probe.test.ts
src/lib/__tests__/__scratch_pushTokens_probe.test.ts
src/notifications/__tests__/__scratch_isolate_probe.test.ts` the moment
the sandbox's permission mode allows it — four inert, dead files with no
functional impact, pure housekeeping, blocked for thirty-five cycles
running.

The quantitative-Jest-coverage angle closed every file on its original
tracked list several cycles ago; this cycle's fresh full-repo sweep found
and closed two more (previously untracked) real gaps —
`src/mascot/mascotStage.ts` and
`src/mascot/celebrationAnimationManifest.ts`, both now
100%/100%/100%/100% (full reasoning in Current Task above). Remaining
known items, all previously assessed as not quick wins:

1. `src/mascot/messageEngine.ts` line 158 (97.36/81.39/100/96.96,
   `selectMessage()`'s zero-candidates fallback) — new finding this
   cycle. Same config-drift-guard class as the
   `celebrationAnimationManifest.ts` gap just closed, but exercising it
   needs `jest.mock('../messageLibrary', ...)` to fake an empty category,
   which the existing `messageEngine.test.ts` does not do today. A future
   cycle should attempt this with a scoped mock rather than editing the
   real `MESSAGE_LIBRARY` data.
2. `src/lib/webPush.ts` (0%) — read in full several cycles ago and
   confirmed genuinely hard to unit-test from this sandbox: it depends on
   browser-only globals (`window`, `navigator.serviceWorker`, global
   `Notification`) that this project's `jest-expo`/React Native test
   environment does not provide. A future cycle could still attempt it
   (e.g. stubbing `global.window`/`global.navigator`/`global.Notification`
   manually before `require`-ing the module) but should expect real
   friction, not a quick win.
3. `src/data/repository.ts` (0%) — NOT a real gap: a pure TypeScript
   `interface` file (`Repository`) with one trivial marker class
   (`RepositoryError extends Error {}`); interfaces carry no runtime code
   to cover. Skip unless a future cycle wants a single trivial
   `new RepositoryError('x') instanceof Error` smoke test purely for the
   class.

A future cycle should still run a fresh full-repo `--collectCoverageFrom`-
free `jest --coverage` sweep periodically to check for any further
drift/new gaps introduced by other branches' work — this cycle's sweep is
proof the tracked list can still miss real gaps until a full sweep is
re-run, so treat "fully closed" claims from any single cycle as
provisional until the next fresh sweep re-confirms them.

Screens/components sit at or near 0% coverage project-wide, which is an
existing, consistent architectural pattern (no render-testing harness in
use anywhere in this codebase yet), not a new/isolated gap — treat that as
a much larger, separate undertaking rather than a quick win.

Remaining independent credential-free sub-tasks, in order: (1) re-attempt
Queue item 7's still-open Supabase-regression half via `gh`/a local
Supabase stack (only if the sandbox's permission mode allows it that
cycle — blocked for thirty-five cycles running so far); (2) if `gh`
becomes reachable, dispatch or check for a completed run of the
`staging-family-e2e.yml` workflow on `main` (see Blocker above) with
`target_branch=feat/verified-auth-onboarding-batch-2` — this is now the
single most direct, concrete unblock path found so far for Queue item 1's
credentialed half (persisted family, invite-code lookup, second-device
join), contingent only on the `staging` GitHub Environment already having
its six secrets configured; (3) Queue item 5 (Batch 4 regression) if/when
independent, credential-free repository evidence for it exists — no
`batch-4`-named branch or work exists in this repository yet, so this
item currently has no distinct surface to regress beyond what Batch 2/3
sweeps already covered. A future cycle with
`TARGET_BRANCH=feat/system-admin-approval-controls` should still
prioritize fixing the `FamilyOnboardingScreen.tsx`
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

- Reconciliation confirmed HEAD (`86e3e34`) matched
  `origin/feat/verified-auth-onboarding-batch-2` with a clean working
  tree; the prior cycle's own commit/push had landed and its own
  narrative already matched HEAD — no drift this time, proceeded
  straight to new work. `npm ci` (907 packages, fresh sandbox). `gh auth
  status`/`docker info` both freshly reconfirmed gated. Retried `git rm`
  on the four dead scratch/debug files — blocked again (thirty-fifth
  cycle).
- Ran a fresh full-repo `jest --coverage` sweep (no filter) to check for
  drift/new gaps beyond the previously-closed named list. Confirmed no
  regression on any previously-closed file, and found two new,
  previously-untracked, genuinely-reachable gaps: `src/mascot/
  mascotStage.ts` (100/83.33/100/100 → 100/100/100/100, 2 new tests for
  the omitted-`now` default-parameter branch on both exported functions)
  and `src/mascot/celebrationAnimationManifest.ts` (100/83.33/100/100 →
  100/100/100/100, 1 new test for `animationManifestFor()`'s
  no-match/`undefined` branch) — both are default-parameter/config-
  drift-guard branches confirmed genuinely reachable (not defensive dead
  code) by tracing every real call site; full reasoning in Current Task
  above. A third gap found in the same sweep,
  `src/mascot/messageEngine.ts` line 158, needs `jest.mock`-ing a
  library import to close and was left for a future cycle rather than
  folded into this one. Full validation gate: `npx tsc --noEmit` PASS,
  `npm test -- --runInBand` **1231/1231** tests PASS (1228 + 3 new),
  97/97 suites. `git status`/`git diff --stat` confirmed exactly two
  changed files from HEAD `86e3e34` before this file's own edit joined
  the working set — no unrelated files touched.

### Recent cycles (condensed — full detail in git history of this file)

- Closed the last remaining named coverage-gap group from the original
  tracked list: `src/lib/id.ts` (100/66.66/100/100 → 100/100/100/100,
  new `id.test.ts`, 3 tests), `src/logic/pushIdempotency.ts`
  (100/91.66/100/100 → 100/100/100/100, 1 new test),
  `src/logic/walkRequestStatusLine.ts` (100/96/100/100 →
  100/100/100/100, 1 new test), `src/logic/pushRouting.ts`
  (100/96.15/100/100 → 100/100/100/100, 1 new test) — all four
  default-parameter/optional-argument branches. Full validation gate
  passed; committed as `86e3e34`.

The multi-cycle quantitative-Jest-coverage angle has closed every file it
has targeted to 100%/100%/100%/100% (or provably-maximal reachable
coverage, where a documented residual gap is genuinely unreachable
defensive code — `localRepository.ts`/`syncQueue.ts`'s four lines and
`presence.ts`'s line 136 are the most recently proved instances of this,
see Current Task above). In roughly most-recent-first order:
`errorMessages.ts`, `familyInvites.ts`, `walkActions.ts`,
`reminderMessages.ts`, `nextWalk.ts`, `remoteReminderChannel.ts`,
`verifiedAdminOnboarding.ts`, `requests.ts`,
the 9-file branch-coverage batch (`permissionedWalks.ts`/`permissions.ts`/
`walkCompletionCelebration.ts`/`walkDateContext.ts`/`statistics.ts`/
`history.ts`/`dateFormat.ts`/`timeInput.ts`/`walkAttention.ts`),
`notificationService.ts`, `systemAdmin.ts`, `invites.ts`,
`requestLifecycle.ts`, `rotation.ts`, `walkAdmin.ts`, `uploadImage.ts`,
`realtime.ts`, `supabase.ts` (short-code join/session/PIN-claim/
QA-sandbox/impersonation layer), `syncQueue.ts`,
`offlineFirstRepository.ts`, `supabaseRepository.ts`, and
`familyManagement.ts` (the deletion/rotation-reassignment logic). Each
cycle's entry followed the same shape: measure fresh coverage, read the
file plus its existing test file, add the missing error-propagation/
null-fallback/branch-arm tests, re-run the full local validation gate
(`npx tsc --noEmit` + `npm test -- --runInBand`), confirm via
`git status`/`git diff --stat` that only the intended file(s) changed,
then commit/push (subject to the recurring self-reporting-drift pattern
documented in Current Task/Blocker above, which affected roughly half of
these cycles' own end-of-cycle narrative but never the underlying work).
`gh auth status` and `docker info` were gated throughout this entire
span, so Queue item 7's Supabase-regression half stayed blocked for
every one of these cycles.

Also during this span, two Queue-item-4/2/3 credential-free QA sweeps
(no code change) found **no defect**: the Settings/Roles
backend-authorization model (every admin-only mutation re-derives caller
status server-side, never from client-supplied role) and the
`send-email` Edge Function's Standard Webhooks signature-verification
wiring (fail-closed, constant-time-verified upstream, no sensitive value
logged). One sweep of the `AUTO_APPROVE_NEW_FAMILIES` wiring found and
fixed a real test-coverage gap in `FamilyOnboardingScreen.tsx`'s pending
family gate.

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
