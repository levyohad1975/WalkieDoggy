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

Reconciliation at cycle start: `git status`/`git log` showed HEAD at
`f88dbd8` with a **clean working tree**, exactly matching
`origin/feat/verified-auth-onboarding-batch-2` (branch reported "up to
date"). `git show --stat f88dbd8` confirmed it contains exactly
`EXECUTION_STATE.md` + `src/logic/__tests__/familyInvites.test.ts` (4
insertions) — i.e. the prior cycle's own commit/push, which that cycle's
own narrative described as "attempted this cycle, outcome to be
confirmed," **did in fact land** (both the commit and the push to origin
succeeded asynchronously after that cycle's text was written — the same
self-reporting-drift pattern documented in many prior cycles, the
"under-claimed" variant). No further reconciliation action needed;
proceeded straight to new work. This run's own dispatch context named
`target_sha=c718adf8...` — checked and found to be `origin/main`'s
"Merge PR #25: add isolated Gemini PR reviewer" commit, **not** an
ancestor or descendant of this branch's HEAD (`git merge-base
--is-ancestor` both directions returned false) — i.e. it is simply
`main`'s tip at dispatch time, unrelated to this feature branch's own
history, matching the same pattern noted for a prior cycle's `target_sha`
(see Blocker below); no action needed beyond noting it. `gh auth status`
and `docker info` re-checked fresh this cycle: both still gated behind
the same interactive approval prompt, no change from prior cycles.
`node_modules` was absent at cycle start (fresh sandbox); ran `npm ci`
(907 packages, clean, same 19 pre-existing moderate advisories) before
any test/coverage command.

Selected this cycle's single bounded unit: continuing the
quantitative-Jest-coverage sweep down the prior cycle's named list.
`src/data/localRepository.ts` (99.21%/97.91%/100%/100%, line 111,
fresh-measured, matching prior sweep exactly): read the file (298 lines)
in full. Line 111 is `persist()`'s `if (!this.cache) return;` guard.
Traced reachability: `this.cache` starts `null` but is **never reset to
null anywhere else in the class** — every write path either assigns it
directly (`replaceAll`, or the `seedStore()` branch inside `load()`) or
calls `await this.load()` first, which guarantees a non-null cache by the
time it returns. Every one of the 14 call sites of `this.persist()` in
the file follows one of those two patterns. **Provably unreachable**,
same pattern as `presence.ts`'s line 136 (prior cycle) — no test added.

`src/data/syncQueue.ts` (100%/95.16%/100%/100%, lines 289/300/321,
fresh-measured, matching prior sweep exactly): read the file (605 lines).
The three lines are the `?? []` fallback inside `persist()`/
`persistConflicts()`/`persistQuarantined()` respectively (`this.queue ??
[]` etc.). Traced all 9 call sites of the three methods (`grep -n`
confirmed the full list): every one runs after the corresponding
`load()`/`loadConflicts()`/`loadQuarantined()` call (or a direct field
assignment) earlier in the same method, guaranteeing the field is already
non-null. **Provably unreachable**, same pattern — no test added.

Swept the remaining named "single-line branch gap" group for a real
target: `pushRouting.ts` (132), `pushIdempotency.ts` (47),
`walkRequestStatusLine.ts` (67), `lib/id.ts` (8) — all read; each is a
default-parameter/optional-argument branch never exercised with its
non-default value (low value, left for a future cycle, consistent with
this group's "lowest priority" label from the prior cycle). `lib/
errorMessages.ts` (100%/92.85%/100%/100%, line 35, fresh-measured) turned
out to be the real, closeable gap in this group: line 35 is
`rawMessageOf()`'s final `return String(error ?? '');` — Lines coverage
was already 100% (the statement executes), but **branch** coverage was
not: every existing test exercises this line only with a non-nullish
`error` (a plain string), so the `?? ''` fallback's null/undefined arm
was never taken. This is a real, reachable case (any call site that
literally `throw`s `null`/`undefined`, or passes a nullish value through
some other path) — not defensive dead code, since JavaScript allows
throwing any value including `null`/`undefined`. Added 1 new test to
`src/lib/__tests__/errorMessages.test.ts` (`rawMessageOf(null)` and
`rawMessageOf(undefined)` both assert `''`).

## Current Task Status

**Work complete and locally validated; commit/push attempted this cycle
and gated (blocked) — see Last Evidence for the exact outcome, and the
standing instruction for the next cycle to verify via `git log`/`git
show --stat` before trusting this claim, since the commit has landed
asynchronously after this text was written in several prior cycles.**
`localRepository.ts`: no code
change (provably unreachable line, coverage unchanged at
99.21%/97.91%/100%/100%, line 111 stays permanently uncovered by design).
`syncQueue.ts`: no code change (same reasoning, coverage unchanged at
100%/95.16%/100%/100%, lines 289/300/321 stay permanently uncovered by
design). `errorMessages.ts`: coverage after the new test —
**100%/100%/100%/100%**, up from 100%/92.85%/100%/100%.

Full local validation gate: `npx tsc --noEmit` — **PASS**, zero errors.
`npm test -- --runInBand` — **PASS**: 96/96 suites, **1222** tests passed
(1221 baseline + 1 new). `git status`/`git diff --stat` confirmed exactly
one changed file from HEAD `f88dbd8`:
`src/lib/__tests__/errorMessages.test.ts` (5 insertions) — no unrelated
files touched.

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

- This cycle start: `git status`/`git log --oneline -20`/`git show --stat
  f88dbd8` confirmed HEAD is `f88dbd8`, clean working tree, exactly
  matches `origin/feat/verified-auth-onboarding-batch-2` (branch reported
  "up to date"). `f88dbd8` contains exactly `EXECUTION_STATE.md` +
  `src/logic/__tests__/familyInvites.test.ts` (4 insertions) — the prior
  cycle's own commit/push it described as unconfirmed **did land**.
- `git rev-parse --verify` + `git log -1`/`git merge-base --is-ancestor`
  (both directions) on this run's dispatch `target_sha`
  (`c718adf8361035657f9610f43d90e4ba4dbb4398`) — resolves to `origin/main`'s
  "Merge PR #25: add isolated Gemini PR reviewer" commit; confirmed via
  `git branch -a --contains` to sit only on `origin/main` and
  `origin/fix/agentic-action-required-bypass`, unrelated to this branch's
  history (not an ancestor or descendant of HEAD). No action taken —
  informational only, matches a pattern already noted for a prior cycle's
  differently-valued `target_sha`.
- `gh auth status` — "This command requires approval" (gated, same as
  every prior cycle). `docker info` — "This command requires approval"
  (gated, same as every prior cycle). Both freshly re-checked this cycle.
- `npm ci` — succeeded (no `node_modules` was present at cycle start; 907
  packages added, no failure; 19 moderate `npm audit` advisories noted,
  none newly introduced this cycle, not investigated further — pre-existing
  dependency-audit noise, not a Queue item).
- `npx jest --coverage --collectCoverageFrom="src/data/localRepository.ts"
  --coverageReporters=text --runInBand` (full suite) —
  **99.21%/97.91%/100%/100%**, uncovered line 111; 96/96 suites, 1221/1221
  tests passed — matches the prior sweep's recorded figure exactly, no
  drift. Read `src/data/localRepository.ts` (298 lines) in full and proved
  line 111 (`persist()`'s `if (!this.cache) return;`) is unreachable — full
  reasoning in Current Task above. No test added; no code change.
- `npx jest --coverage --collectCoverageFrom="src/data/syncQueue.ts"
  --coverageReporters=text --runInBand` (full suite) —
  **100%/95.16%/100%/100%**, uncovered lines 289/300/321; 96/96 suites,
  1221/1221 tests passed — matches the prior sweep's recorded figure
  exactly, no drift. Read `src/data/syncQueue.ts` (605 lines) in full,
  `grep -n` confirmed all 9 call sites of the three `persist*` helpers, and
  proved all three uncovered lines' `?? []` fallbacks are unreachable —
  full reasoning in Current Task above. No test added; no code change.
- `npx jest --coverage --collectCoverageFrom="src/logic/pushRouting.ts"
  --collectCoverageFrom="src/logic/pushIdempotency.ts"
  --collectCoverageFrom="src/logic/walkRequestStatusLine.ts"
  --collectCoverageFrom="src/lib/errorMessages.ts"
  --collectCoverageFrom="src/lib/id.ts" --coverageReporters=text
  --runInBand` (full suite) — `pushRouting.ts` 100%/96.15%/100%/100%
  (line 132), `pushIdempotency.ts` 100%/91.66%/100%/100% (line 47),
  `walkRequestStatusLine.ts` 100%/96%/100%/100% (line 67), `lib/id.ts`
  100%/66.66%/100%/100% (line 8) — all read, all default-parameter branch
  gaps, left for a future cycle (lowest priority per prior cycle's own
  label). `lib/errorMessages.ts` 100%/92.85%/100%/100% (line 35) — read
  and confirmed a real, reachable gap (the `error ?? ''` nullish fallback
  in `rawMessageOf()` — see Current Task above).
- Added 1 new test to `src/lib/__tests__/errorMessages.test.ts`
  (`rawMessageOf(null)`/`rawMessageOf(undefined)` both assert `''`).
- `npx jest --coverage --collectCoverageFrom="src/lib/errorMessages.ts"
  --coverageReporters=text --runInBand` (full suite, final) —
  **100%/100%/100%/100%**, up from 100%/92.85%/100%/100%; 96/96 suites,
  1222/1222 tests passed.
- `npx tsc --noEmit` (full repo, after the change) — **PASS**, zero
  errors.
- `npm test -- --runInBand` (full local validation gate, final) —
  **PASS**: Test Suites: 96 passed, 96 total; Tests: **1222** passed,
  1222 total (1221 + 1 new); Snapshots: 0 total; Time ~25.4s.
- `git status --porcelain=v1 --untracked-files=all` / `git diff --stat`
  confirmed exactly one changed file from HEAD `f88dbd8` before this
  file's own edit was added to the working set:
  `src/lib/__tests__/errorMessages.test.ts` (5 insertions) — no
  unrelated files touched, aside from the four already-tracked
  scratch/debug files noted below (untouched, removal blocked again this
  cycle).
- `git rm tmp_coverage_inspect.js
  src/lib/__tests__/__scratch_platform_probe.test.ts
  src/lib/__tests__/__scratch_pushTokens_probe.test.ts
  src/notifications/__tests__/__scratch_isolate_probe.test.ts` — "This
  command requires approval" (blocked). Same blocker as every prior
  cycle — thirty-third consecutive cycle blocked on the scratch-file
  cleanup.
- `git add src/lib/__tests__/errorMessages.test.ts EXECUTION_STATE.md` —
  "This command requires approval" (gated). Immediately re-checked with
  `git log --oneline -3` + `git status --porcelain=v1`: HEAD is still
  `f88dbd8`, both files remain modified/uncommitted in the working tree —
  genuinely blocked this cycle, confirmed within the same cycle rather
  than discovered next cycle. The next cycle's first step must still be
  to check `git log`/`git show --stat` before assuming this — a commit
  could still land asynchronously after this text is written (the
  recurring pattern documented across many prior cycles — see Current
  Task above for this cycle's own instance of it, from the prior cycle's
  side).

## Last Evidence Timestamp

2026-09-15T04:10:00Z

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
sandbox's permission mode allows it (thirty-one consecutive cycles
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
whether this cycle's own `EXECUTION_STATE.md` +
`src/lib/__tests__/errorMessages.test.ts` commit attempt (on top of
`f88dbd8`) landed, and (b) whether any further commit exists beyond that
which this file's own text never mentions (the recurring drift pattern —
see Current Task/Blocker above, both variants). Reconcile before starting
new work either way.

Retry `git rm tmp_coverage_inspect.js
src/lib/__tests__/__scratch_platform_probe.test.ts
src/lib/__tests__/__scratch_pushTokens_probe.test.ts
src/notifications/__tests__/__scratch_isolate_probe.test.ts` the moment
the sandbox's permission mode allows it — four inert, dead files with no
functional impact, pure housekeeping, blocked for thirty-three cycles
running.

The quantitative-Jest-coverage angle (started many cycles ago) has closed
every file it has targeted so far to 100%/100%/100%/100% (or provably-
maximal reachable coverage), most recently `src/lib/errorMessages.ts`
this cycle (100%/92.85%/100%/100% → 100%/100%/100%/100%, closing
`rawMessageOf()`'s `error ?? ''` nullish-fallback branch) and
`src/logic/familyInvites.ts` the cycle before (also now 100% across the
board). This cycle also examined `src/data/localRepository.ts`
(99.21%/97.91%/100%/100%, line 111) and `src/data/syncQueue.ts`
(100%/95.16%/100%/100%, lines 289/300/321) and determined — full
reasoning in Current Task above — that all four uncovered lines are
**provably unreachable**, not real gaps; both files should be treated as
closed/skip, alongside `src/logic/presence.ts` and `src/data/repository.ts`
below, not retried by a future cycle. Remaining real, non-"known-hard"
gaps a fresh full-repo sweep several cycles ago surfaced, now narrowed to:

1. `src/logic/pushRouting.ts` (line 132), `src/logic/pushIdempotency.ts`
   (line 47), `src/logic/walkRequestStatusLine.ts` (line 67), `src/lib/id.ts`
   (line 8) — all read this cycle; each is a default-parameter/optional-
   argument branch never exercised with its non-default value (e.g.
   `generateId()` always called with no `_prefix` argument in every
   existing test). Real but low-value gaps — closeable with one trivial
   test per file (call the function with an explicit non-default
   argument) whenever a future cycle wants to pick them up; lowest
   priority of the remaining list, `lib/errorMessages.ts` already closed
   this cycle and removed from this group.
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

With this cycle's four files resolved (two closed to 100%, two confirmed
provably-unreachable), the named-list angle is nearly exhausted — a
future cycle should pick up item 1 above (the four default-parameter
gaps) if it wants one more quick win, then run a fresh full-repo
`--collectCoverageFrom` sweep to check for drift/new gaps before
considering this angle fully closed out.

Screens/components sit at or near 0% coverage project-wide, which is an
existing, consistent architectural pattern (no render-testing harness in
use anywhere in this codebase yet), not a new/isolated gap — treat that as
a much larger, separate undertaking rather than a quick win.

Remaining independent credential-free sub-tasks, in order: (1) re-attempt
Queue item 7's still-open Supabase-regression half via `gh`/a local
Supabase stack (only if the sandbox's permission mode allows it that
cycle — blocked for thirty-three cycles running so far); (2) if `gh`
becomes reachable, dispatch or check for a completed run of the new
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

- Reconciliation confirmed HEAD (`f88dbd8`) matched
  `origin/feat/verified-auth-onboarding-batch-2` with a clean working
  tree; the prior cycle's own "commit/push attempted this cycle" narrative
  turned out to have landed after all (both the commit and the push
  succeeded asynchronously) — no recovery action needed, proceeded
  straight to new work. Checked this run's dispatch `target_sha`
  (`c718adf8...`) and found it to be `main`'s tip at dispatch time,
  unrelated to this branch — informational only, no action needed.
  Examined `src/data/localRepository.ts` (99.21%/97.91%/100%/100%, line
  111) and `src/data/syncQueue.ts` (100%/95.16%/100%/100%, lines
  289/300/321, both the prior cycle's named top picks) and **proved all
  four uncovered lines are unreachable** rather than adding contrived
  tests — full reasoning in Current Task above; marked resolved in Next
  Safe Task rather than retried by a future cycle. Swept the remaining
  named single-line-branch-gap group (`pushRouting.ts`,
  `pushIdempotency.ts`, `walkRequestStatusLine.ts`, `lib/errorMessages.ts`,
  `lib/id.ts`) and found `lib/errorMessages.ts` had the one real,
  closeable gap: 1 new test in `src/lib/__tests__/errorMessages.test.ts`
  covering `rawMessageOf()`'s `error ?? ''` nullish fallback for a
  literal `null`/`undefined` thrown value, reaching
  **100%/100%/100%/100%**. Full validation gate: `npx tsc --noEmit` PASS,
  `npm test -- --runInBand` **1222/1222** tests PASS (1221 + 1 new),
  96/96 suites. `git status`/`git diff --stat` confirmed exactly one
  changed file (`src/lib/__tests__/errorMessages.test.ts`, 5 insertions)
  from HEAD `f88dbd8` before this file's own edit joined the working set.
  `git add`/`git commit -a` both gated this cycle (blocked, confirmed via
  `git log`/`git status` immediately after) — genuinely uncommitted, not
  yet landed as of this text. Retried `git rm` on the four dead
  scratch/debug files — blocked again (thirty-third cycle).

### Recent cycles (condensed — full detail in git history of this file)

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
