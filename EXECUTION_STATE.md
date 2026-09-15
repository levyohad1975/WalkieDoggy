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
target sha `c718adf8...`): `git status`/`git log` showed HEAD at
`f41e766` with a **clean working tree**. This file's own
previously-committed narrative (the content read at the very start of
this cycle) described its own in-flight commit as "attempted this
cycle" for the mascot coverage work — `git show --stat f41e766`
confirmed that exact commit (`EXECUTION_STATE.md` + `mascotStage.test.ts`
+ `celebrationAnimationManifest.test.ts`) **did land** as `f41e766`, and
`f41e766` matches what the checked-out working tree's `EXECUTION_STATE.md`
already said — i.e. the file was internally consistent with its own HEAD
this time (no drift to reconcile). `node_modules` was absent at cycle
start (fresh sandbox); ran `npm ci` (907 packages, clean, same 19
pre-existing moderate advisories). `gh auth status` and `docker info`
re-checked fresh this cycle: both still gated behind the same
interactive approval prompt. Retried `git rm` on the four dead
scratch/debug files (`tmp_coverage_inspect.js`,
`src/lib/__tests__/__scratch_platform_probe.test.ts`,
`src/lib/__tests__/__scratch_pushTokens_probe.test.ts`,
`src/notifications/__tests__/__scratch_isolate_probe.test.ts`) — gated
again (thirty-sixth consecutive cycle blocked).

Selected this cycle's single bounded unit: close the one coverage gap
the prior cycle explicitly deferred — `src/mascot/messageEngine.ts` line
158, `selectMessage()`'s `if (candidates.length === 0)` fallback
(pre-change: 97.36/81.39/100/96.96, uncovered line 158). Read the file
plus its existing test file (`messageEngine.test.ts`) and, this time,
pulled the exact `lcov`/`BRDA` branch detail (`coverage/lcov.info`,
gitignored, not committed) rather than relying on the text reporter's
summary column alone — this surfaced that the file's true branch gap was
**larger than line 158 alone**: the text reporter's "Uncovered Line #s"
column only lists lines with an uncovered *statement*, so five other
partial-branch gaps on already-100%-statement lines (142, 143, 146, 151,
167/169) were real but had never been individually named by any prior
cycle's narrative, which had mislabeled the entire 81.39%-branch gap as
"just line 158." Traced every branch to real call sites/reachability:

- Line 158 (zero-candidates fallback): needs `jest.mock`-ing
  `messageLibrary.ts` to simulate an empty `MESSAGE_LIBRARY` — the real
  library always has variants per category. Created a new file,
  `src/mascot/__tests__/messageEngineFallback.test.ts` (a **separate**
  file, not added to `messageEngine.test.ts`, because `jest.mock` at
  module scope would otherwise mock `MESSAGE_LIBRARY` for that whole
  file's other, non-mocked assertions too). 2 tests: fallback id/text
  with and without a `dogName` in context.
- Lines 142 (`ctx: MessageContext = {}`), 143
  (`options: SelectMessageOptions = {}`), 146 (`options.history ??
  defaultMessageHistory`): every existing test call supplied `ctx` and
  `options` explicitly (with `history` always inside `options`), so the
  three defaults were never exercised — same default-parameter pattern
  as every prior default-argument closure this campaign has done. Added
  1 test in `messageEngine.test.ts` calling `selectMessage('encouragement')`
  with only the category argument.
- Lines 167/169 (`pool.length > 0 ? pool : candidates` and `... ??
  effectivePool[0]`): the existing "anti-repetition window is bounded"
  test never actually drives `pool` to empty, because it uses the
  *default* `windowSize` (3), which is smaller than every real
  category's variant count — `recentIds()` always evicts old entries
  before the whole category is excluded, so `pool` never reaches zero
  length, and the `Math.floor(random() * length)` index is always
  in-bounds so the `?? effectivePool[0]` arm never fires either. Added 2
  new tests to `messageEngine.test.ts`: (a) `windowSize` set to the
  category's own total variant count with `random: () => 0`, walking the
  whole category in order via real anti-repetition bookkeeping until the
  pool is provably fully exhausted and the fallback-to-`candidates` arm
  fires for real; (b) a `random` implementation that returns `1`
  (violating the documented `[0, 1)` contract) to exercise the
  out-of-range defensive fallback.
- Line 151 (`m.presets.includes(preset)`): unreachable with the real
  library, since every shipped template today omits `presets` entirely
  (confirmed in `messageEngine.test.ts`'s own comment). Added 1 more test
  to `messageEngineFallback.test.ts`, in a second `describe` block using
  `jest.resetModules()` + `jest.doMock()` + `require()` (rather than the
  file-level `jest.mock()` used by the first block, so the two mocked
  shapes don't collide within one file) with a single mocked template
  tagged `presets: ['calm']`, then selecting with the `'default'`
  preset — proving the presets-mismatch filter actually excludes it and
  falls back correctly. This is a genuine behavioral test of the
  not-yet-used presets feature (see `personalityPresets.ts`), not pure
  coverage padding.

`src/mascot/messageEngine.ts` now measures **100%/100%/100%/100%** (up
from 97.36/81.39/100/96.96).

## Prior cycle's Current Task (superseded, kept for continuity — condensed)

Prior cycle closed two other previously-untracked `src/mascot/` gaps
found in the same full-repo sweep that surfaced `messageEngine.ts` line
158: `mascotStage.ts` (100/83.33/100/100 → 100/100/100/100, 2 tests for
the omitted-`now` default-parameter branch on both exported functions)
and `celebrationAnimationManifest.ts` (100/83.33/100/100 →
100/100/100/100, 1 test for the no-match/`undefined` branch). Committed
as `f41e766`. Full detail in git history of this file if needed; the
`src/lib/id.ts` / `pushIdempotency.ts` / `walkRequestStatusLine.ts` /
`pushRouting.ts` default-parameter closures from two cycles ago are
summarized in "Recent cycles" below.

## Current Task Status

**Work complete and locally validated; commit/push attempted this cycle
— see Last Evidence for the exact outcome, and the standing instruction
for the next cycle to verify via `git log`/`git show --stat` before
trusting this claim, since the commit has landed asynchronously after
this text was written in several prior cycles.** `src/mascot/messageEngine.ts`:
6 new tests across two files, coverage **100%/100%/100%/100%**, up from
97.36%/81.39%/100%/96.96%. This closes the entire named coverage-gap
queue again (no known file left with an untested reachable branch as of
this cycle's fresh measurement — see Next Safe Task for the residual
non-gap/genuinely-hard items).

Full local validation gate: `npx tsc --noEmit` — **PASS**, zero errors.
`npm test -- --runInBand` — **PASS**: 98/98 suites, **1237** tests passed
(1231 baseline + 6 new: 3 in `messageEngine.test.ts` + 3 in the new
`messageEngineFallback.test.ts`). `git status`/`git diff --stat`
confirmed exactly two changed files from HEAD `f41e766`:
`src/mascot/__tests__/messageEngine.test.ts` (modified, +21/-0) and
`src/mascot/__tests__/messageEngineFallback.test.ts` (new file,
41 lines) — no unrelated files touched.

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
  `c718adf8...`): `git status`/`git log --oneline -8`/`git show --stat
  f41e766` confirmed HEAD is `f41e766`, clean working tree. `f41e766`
  contains exactly `EXECUTION_STATE.md` + `mascotStage.test.ts` +
  `celebrationAnimationManifest.test.ts` — the prior cycle's own
  commit/push **did land**, and this file's own narrative already
  matched HEAD (no drift found this cycle).
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
  cycle — thirty-sixth consecutive cycle blocked on the scratch-file
  cleanup.
- `npx jest --coverage --collectCoverageFrom="src/mascot/messageEngine.ts"
  --coverageReporters=text --runInBand src/mascot/__tests__/messageEngine.test.ts`
  (before change) — 97.36/81.39/100/96.96, matching the prior cycle's
  sweep exactly.
- Pulled `--coverageReporters=lcov` output (`coverage/lcov.info`,
  gitignored) to get exact `BRDA` branch-arm hit counts rather than
  relying on the text reporter's summary line, which surfaced 5
  additional real branch gaps beyond line 158 that no prior cycle's
  narrative had named individually (full reasoning in Current Task
  above): lines 142, 143, 146 (default-parameter branches), 167/169
  (pool-exhaustion + out-of-range-`random()` defensive fallback), and
  151 (presets-mismatch filter arm).
- Added 2 tests to a new `src/mascot/__tests__/messageEngineFallback.test.ts`
  (line 158's zero-candidates fallback, with/without `dogName`), 1 more
  test to the same new file in a second `describe` block using
  `jest.resetModules()`/`jest.doMock()`/`require()` (line 151's
  presets-mismatch arm), and 3 tests to the existing
  `src/mascot/__tests__/messageEngine.test.ts` (lines 142/143/146's
  omitted-argument defaults in one test; lines 167/169's genuine
  pool-exhaustion and out-of-range-`random()` cases in two more).
- `npx jest --coverage --collectCoverageFrom="src/mascot/messageEngine.ts"
  --coverageReporters=text --runInBand src/mascot/__tests__/messageEngine.test.ts
  src/mascot/__tests__/messageEngineFallback.test.ts` (after change) —
  **100%/100%/100%/100%**; 2/2 suites, 25/25 tests passed.
- `npx tsc --noEmit` (full repo, after the change) — **PASS**, zero
  errors.
- `npm test -- --runInBand` (full local validation gate, final) —
  **PASS**: Test Suites: 98 passed, 98 total; Tests: **1237** passed,
  1237 total (1231 + 6 new); Snapshots: 0 total; Time ~21.9s.
- `git status --porcelain=v1 --untracked-files=all` / `git diff --stat`
  confirmed exactly two changed files from HEAD `f41e766` before this
  file's own edit was added to the working set:
  `src/mascot/__tests__/messageEngine.test.ts` (modified) and
  `src/mascot/__tests__/messageEngineFallback.test.ts` (new) — no
  unrelated files touched, aside from the four already-tracked
  scratch/debug files noted above (untouched, removal blocked again this
  cycle) and the gitignored `coverage/` directory generated by the lcov
  runs above (not committed).
- `git add` (of the three intended files) and `git commit` (both plain
  and with an explicit pathspec, to avoid needing a separate `git add`)
  each returned "This command requires approval" this cycle — gated,
  same interactive-approval-prompt class as `gh auth status`/`docker
  info`/the scratch-file `git rm` above, not a code or content problem.
  `git log -3`/`git status --porcelain` immediately after confirmed HEAD
  is still `f41e766` and the three files remain uncommitted in the
  working tree as of the end of this cycle. Per the recurring
  self-reporting-drift pattern documented in Blocker below, a future
  cycle must check `git show --stat`/`git log` first — this commit may
  land asynchronously after this text is written, the same way several
  prior cycles' own "gated" commits turned out to have actually landed
  by the next cycle's reconciliation.

## Last Evidence Timestamp

2026-09-15T05:40:00Z

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
sandbox's permission mode allows it (thirty-six consecutive cycles
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
whether this cycle's own `EXECUTION_STATE.md` + `messageEngine.test.ts` +
new `messageEngineFallback.test.ts` commit attempt (on top of `f41e766`)
landed, and (b) whether any further commit exists beyond that which this
file's own text never mentions (the recurring drift pattern — see
Current Task/Blocker above). Reconcile before starting new work either
way.

Retry `git rm tmp_coverage_inspect.js
src/lib/__tests__/__scratch_platform_probe.test.ts
src/lib/__tests__/__scratch_pushTokens_probe.test.ts
src/notifications/__tests__/__scratch_isolate_probe.test.ts` the moment
the sandbox's permission mode allows it — four inert, dead files with no
functional impact, pure housekeeping, blocked for thirty-six cycles
running.

The quantitative-Jest-coverage angle has now closed every file on its
tracked list, including this cycle's `src/mascot/messageEngine.ts`
closure (97.36/81.39/100/96.96 → 100%/100%/100%/100%, full reasoning in
Current Task above). Remaining known items, both previously assessed as
not quick wins and unaffected by this cycle's work:

1. `src/lib/webPush.ts` (0%) — read in full several cycles ago and
   confirmed genuinely hard to unit-test from this sandbox: it depends on
   browser-only globals (`window`, `navigator.serviceWorker`, global
   `Notification`) that this project's `jest-expo`/React Native test
   environment does not provide. A future cycle could still attempt it
   (e.g. stubbing `global.window`/`global.navigator`/`global.Notification`
   manually before `require`-ing the module) but should expect real
   friction, not a quick win.
2. `src/data/repository.ts` (0%) — NOT a real gap: a pure TypeScript
   `interface` file (`Repository`) with one trivial marker class
   (`RepositoryError extends Error {}`); interfaces carry no runtime code
   to cover. Skip unless a future cycle wants a single trivial
   `new RepositoryError('x') instanceof Error` smoke test purely for the
   class.

A future cycle should still run a fresh full-repo `--collectCoverageFrom`-
free `jest --coverage` sweep periodically to check for any further
drift/new gaps introduced by other branches' work, **and this time also
pull `--coverageReporters=lcov`'s `BRDA` detail (not just the default
text summary) for any file whose branch % is below 100** — this cycle's
own discovery (5 branch gaps on `messageEngine.ts` that the plain text
reporter's "Uncovered Line #s" column never surfaced, because that
column only lists lines with an uncovered *statement*, not a
partially-covered branch on an otherwise-covered line) is proof the plain
text summary alone is not sufficient to certify "100%" claims from any
prior cycle — a future cycle with time budget remaining could reasonably
re-check the highest-value already-"100%"-labeled files this way before
trusting the label. Treat "fully closed" claims from any single cycle as
provisional until a `lcov`-detail re-sweep re-confirms them.

Screens/components sit at or near 0% coverage project-wide, which is an
existing, consistent architectural pattern (no render-testing harness in
use anywhere in this codebase yet), not a new/isolated gap — treat that as
a much larger, separate undertaking rather than a quick win.

Remaining independent credential-free sub-tasks, in order: (1) re-attempt
Queue item 7's still-open Supabase-regression half via `gh`/a local
Supabase stack (only if the sandbox's permission mode allows it that
cycle — blocked for thirty-six cycles running so far); (2) if `gh`
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

- Reconciliation confirmed HEAD (`f41e766`) matched this file's own
  narrative with a clean working tree; the prior cycle's own commit/push
  had landed — no drift this time, proceeded straight to new work.
  `npm ci` (907 packages, fresh sandbox). `gh auth status`/`docker info`
  both freshly reconfirmed gated. Retried `git rm` on the four dead
  scratch/debug files — blocked again (thirty-sixth cycle).
- Closed `src/mascot/messageEngine.ts`'s `selectMessage()` coverage gap
  (97.36/81.39/100/96.96 → 100/100/100/100) — the item the prior cycle
  explicitly deferred (line 158's zero-candidates fallback), plus 5
  further branch gaps on lines 142/143/146/151/167/169 discovered this
  cycle by reading raw `lcov`/`BRDA` detail instead of trusting the text
  reporter's summary column. 6 new tests across a new
  `messageEngineFallback.test.ts` (2 `jest.mock` + 1 `jest.doMock` tests)
  and 3 added to the existing `messageEngine.test.ts`. Full reasoning in
  Current Task above. Full validation gate: `npx tsc --noEmit` PASS,
  `npm test -- --runInBand` **1237/1237** tests PASS (1231 + 6 new),
  98/98 suites. `git status`/`git diff --stat` confirmed exactly two
  changed files from HEAD `f41e766` before this file's own edit joined
  the working set — no unrelated files touched.

### Recent cycles (condensed — full detail in git history of this file)

- Closed two previously-untracked `src/mascot/` gaps found in a
  full-repo sweep: `mascotStage.ts` (100/83.33/100/100 →
  100/100/100/100, 2 new tests for the omitted-`now` default-parameter
  branch on both exported functions) and
  `celebrationAnimationManifest.ts` (100/83.33/100/100 →
  100/100/100/100, 1 new test for the no-match/`undefined` branch).
  Full validation gate passed; committed as `f41e766`.
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
