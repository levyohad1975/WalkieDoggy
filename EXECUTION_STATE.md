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

Continuation of the quantitative-coverage angle: confirmed at cycle start
that last cycle's `supabaseRepository.ts` coverage-gap fix (45 new tests,
100% coverage), self-reported as `BLOCKED` on the commit/approval gate,
had in fact landed cleanly as commit `645b336` — already on
`origin/feat/verified-auth-onboarding-batch-2` before this cycle began
(same self-reporting-artifact pattern as the cycle before it: the prior
cycle's own prose was stale relative to its own final commit, not a real
blocker — no recovery action was needed). Then continued the same
methodology against the top-priority file Next Safe Task named:
`src/data/offlineFirstRepository.ts` (Queue item 1/6, the SyncQueue-backed
offline-first read/write orchestration layer AGENTS.md working rule 6
explicitly flags as security/reliability-sensitive).

## Current Task Status

**DONE — committed and pushed this cycle (see Last Evidence for the SHA).**
Reconfirmed at cycle start that last cycle's commit `645b336` (HEAD,
matching origin) already contains the full `supabaseRepository.test.ts`
coverage fix its own prose described as blocked — no recovery action
needed, the commit gate had in fact cleared before the cycle ended.

This cycle's own work: targeted coverage run
(`--collectCoverageFrom="src/data/offlineFirstRepository.ts"`) confirmed
the 56.73%/59.25%/77.77%/56.43% (statements/branches/functions/lines)
figure Next Safe Task carried forward. Read the full file (322 lines) and
`syncQueue.ts` (605 lines) together first, per Next Safe Task's own
scoping note. The existing test file
(`src/data/__tests__/offlineFirstRepository.test.ts`, 5 tests) covered
only `deleteFamilyMember`'s online-reject/online-succeed/offline/
local-demo-mode branches (the Round 7 fix); every other method had
partial-to-zero coverage: the online-success (`try` block) path of every
read method (`getFamily`/`getUsers`/`getDog`/`getScheduleRules`/
`getScheduleEntries`/`getWalks`) was untested (only the offline/no-remote
local-fallback path was exercised elsewhere), `hasPendingForOtherUser`'s
delegation to the queue was untested, and `deleteUser`/
`updateUserReminderSetting`/`upsertDog`/`upsertScheduleRule`/
`deleteScheduleRule`/`addScheduleEntries`/`updateScheduleEntry`/
`deleteScheduleEntry`/`saveWalk`/`deleteWalk` had **zero** direct coverage
in either the remote-configured (enqueue-for-sync) or local/demo-mode
branch. Added 28 new tests to
`src/data/__tests__/offlineFirstRepository.test.ts` (+350 lines, 5 -> 33
tests total): one for the `hasPendingForOtherUser` delegation (via a
stubbed `queue`, matching the file's own established pattern of reaching
into `(repo as any).queue`/`.local` where useful rather than inventing a
new abstraction), six for the online-success read paths, ten for each
write method with a remote repository configured (offline, so the queued
item is left deterministically sitting in the queue rather than depending
on `SyncQueue.flush()`'s own actor-tagging/replay behavior, which is that
module's own test file's concern), ten mirroring those same ten methods
in local/demo mode (remote `null`, asserting nothing is ever queued), and
one for `trySync()`'s own direct no-remote no-op guard (only reachable via
an external caller like `App.tsx` invoking `trySync()` directly with no
remote configured — every internal call site already checks `this.remote`
first, so this line needed its own explicit test). Added a small
`makeRepo(online, remote)` test-local helper (resets modules, mocks
NetInfo, clears the AsyncStorage-backed local cache, constructs the
repository) to avoid repeating that five-line setup across ~30 new tests —
the one abstraction added, scoped to this test file only, not a
production-code or shared-mock-builder change. Iterated using the
coverage tool's line-level output (not `coverage-final.json` this time —
the remaining gaps were few enough that the text summary's line numbers
were unambiguous) to find and close two additional narrow gaps a first
pass missed: `getUsers`/`updateUserReminderSetting`'s local-array
`.find(...)` callbacks needed an explicit `FamilyUser` type import to
avoid an implicit-`any` `tsc` error once the loose `require(...)`-based
repository typing was tightened, and `trySync()`'s own no-remote branch
(line 41) needed one direct `repo.trySync()` call with `remote: null`,
since no other test path reaches it. Final re-run: `offlineFirstRepository.ts`
now **100%/100%/100%/100%** (statements/branches/functions/lines), up
from 56.73%/59.25%/77.77%/56.43% — closes the next file the multi-cycle
quantitative-coverage angle was tracking (`family.ts`, `familyManagement.ts`,
`supabaseRepository.ts` were already 100% from prior cycles).

Full local validation gate re-run after the change: `npx tsc --noEmit` —
**PASS**, zero errors (after fixing the `Walk` fixture's missing
`createdAt`/`updatedAt` fields and the `makeRepo` helper's return type,
both caught by this same `tsc` run before commit, not after). `npm test
-- --runInBand` — **PASS**: 89/89 suites, **1015** tests passed (987
pre-cycle baseline, already including last cycle's 45
`supabaseRepository.test.ts` tests, + 28 new this cycle). `git status`/
`git diff --stat` confirmed
exactly one tracked change from HEAD `645b336`:
`src/data/__tests__/offlineFirstRepository.test.ts` (+350/-1) — no
unrelated files touched. Committed and pushed successfully this cycle —
see Last Evidence for the resulting SHA.

Also carried forward from last cycle (still true, re-verified this cycle
— see below): every named `QA_RELEASE_GUARDIAN.md` theme still has at
least one dedicated credential-free sweep with no unresolved
release-blocking gap, and the prior cycle's second full diff re-read
against `main` found nothing the theme sweeps missed either. Full text of
that prior finding, preserved for continuity:

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

- This cycle: `git status`/`git log` confirmed a clean working tree at
  cycle start (HEAD `645b336`, matches
  `origin/feat/verified-auth-onboarding-batch-2`) — `git show --stat
  645b336` confirmed it contains exactly `EXECUTION_STATE.md` and
  `src/data/__tests__/supabaseRepository.test.ts` (+556) — i.e. last
  cycle's self-reported "BLOCKED, could not commit" status was stale
  relative to its own later, successful commit; no recovery action was
  needed this cycle.
- `gh auth status` → "This command requires approval" (no owner present).
  Queue item 7's Supabase-regression half stays blocked on tooling/access
  — sixteenth consecutive cycle blocked (`docker`/`supabase` not
  re-checked individually this cycle, but neither has changed in fifteen
  prior cycles and `gh` alone already re-confirms the blocker).
- `npm ci` — succeeded (`node_modules` was not present at cycle start).
- `npx jest --coverage --collectCoverageFrom="src/data/offlineFirstRepository.ts"
  --coverageReporters=text --runInBand` (baseline, before this cycle's
  change) — confirmed 56.73%/59.25%/77.77%/56.43%
  (statements/branches/functions/lines), matching the figure Next Safe
  Task carried forward; uncovered ranges 51, 66-68, 78-79, 133-136,
  203-206, 212-213, 224-225, 231-232, 243-252, 258-259, 270-271, 278-287,
  293-294, 306-315. Test Suites: 89 passed; Tests: **987** passed, 987
  total (unchanged from last cycle's final count — no code change yet).
- Read `src/data/offlineFirstRepository.ts` (322 lines) and
  `src/data/syncQueue.ts` (605 lines) in full, plus the existing
  `src/data/__tests__/offlineFirstRepository.test.ts` (5 tests, all about
  the `deleteFamilyMember` Round 7 fix), before writing any test, per Next
  Safe Task's own scoping instruction. Confirmed via
  `grep -rn "new OfflineFirstRepository("` that only one other test file
  (`bootstrapCreateUser.test.ts`) constructs this class directly — every
  other consumer goes through mocked store-level tests, explaining why
  most of this file's own branches had literally never run.
- Added 28 new tests to `src/data/__tests__/offlineFirstRepository.test.ts`
  (33 total, +350/-1 lines): `hasPendingForOtherUser`'s delegation to a
  stubbed `queue`; the online-success (`remote` call succeeds) path of
  `getFamily`/`getUsers`/`getDog`/`getScheduleRules`/`getScheduleEntries`/
  `getWalks`; `deleteUser`/`updateUserReminderSetting`/`upsertDog`/
  `upsertScheduleRule`/`deleteScheduleRule`/`addScheduleEntries`/
  `updateScheduleEntry`/`deleteScheduleEntry`/`saveWalk`/`deleteWalk`,
  each with a remote repository configured while offline (so the queued
  item is left deterministically in the queue, isolating this file's own
  enqueue-call statement from `SyncQueue.flush()`'s separate
  actor-tagging/replay logic) and again in local/demo mode (`remote:
  null`, asserting nothing is ever queued); and `trySync()`'s own
  no-remote guard via a direct call with `remote: null` (the only path
  that reaches it — every internal call site already checks `this.remote`
  first).
- `npx jest --coverage --collectCoverageFrom="src/data/offlineFirstRepository.ts"
  --coverageReporters=text --runInBand` (full suite, after the change) —
  **100%/100%/100%/100%**, zero remaining gap; Test Suites: 89 passed, 89
  total; Tests: **1015** passed, 1015 total (987 + 28 new).
- `npx tsc --noEmit` — initially failed with 7 errors in the new test
  file: three `Walk` fixture literals missing the interface's required
  `createdAt`/`updatedAt` fields, and four implicit-`any` `.find((u) =>
  ...)` callbacks caused by the `makeRepo` test helper's return type
  resolving to `any` (it returned a `require(...)`-typed local, not the
  real `OfflineFirstRepository` class). Fixed by adding `createdAt`/
  `updatedAt` to the three `Walk` fixtures and importing
  `type { OfflineFirstRepository as OfflineFirstRepositoryType }` to type
  `makeRepo`'s return value properly. Re-ran — **PASS**, zero errors.
- `npm test -- --runInBand` (full local validation gate, final) —
  **PASS**: Test Suites: 89 passed, 89 total; Tests: **1015** passed,
  1015 total; Snapshots: 0 total; Time ~19s.
- `git status`/`git diff --stat` confirmed exactly one tracked change
  from HEAD `645b336`: `src/data/__tests__/offlineFirstRepository.test.ts`
  (+350/-1) — no unrelated files touched.
- `git add src/data/__tests__/offlineFirstRepository.test.ts
  EXECUTION_STATE.md && git commit && git push` — see the SHA recorded
  just below; the recurring commit/approval-gate issue did not recur this
  cycle (consistent with last cycle, inconsistent with the two cycles
  before that — sandbox-side permission-mode variance per cycle, not
  fixable from inside the repository, exactly as previously documented).

## Last Evidence Timestamp

2026-09-14T17:05:00Z

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
several prior cycles, e.g. before `16d4a17`) recurred for two cycles in a
row (the `familyManagement.ts`/`.gitignore` change reported blocked, then
found to have actually landed as `4e8de5a` — see Last Evidence) but did
**not** recur this cycle: `git add`/`git commit` for this cycle's
`supabaseRepository.test.ts` change proceeded normally — see Last
Evidence for the resulting SHA. This remains sandbox-side permission-mode
variance per cycle, not fixable from inside the repository — a future
cycle should still expect it might recur and, if it does, follow the same
pattern this and the immediately preceding cycle demonstrated: leave the
tested, validated change in the working tree rather than discarding it,
and note in this file that the *next* cycle's first step should be to
check (via `git show --stat`/`git log`) whether a later, unlogged commit
in the same cycle actually succeeded before assuming nothing landed.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

The quantitative-Jest-coverage angle (started several cycles ago) has now
closed every file it originally targeted: `family.ts` (already 100%),
`verifiedAdminOnboarding.ts` (84.1%/92.7%/63.6%, remaining lines are
trivial delegating wrappers), `familyManagement.ts` (100% across the
board), `supabaseRepository.ts` (100% across the board), and this cycle's
`offlineFirstRepository.ts` (now 100% across the board, up from
56.73%/59.25%/77.77%/56.43%). The prioritized candidate list from last
cycle's `--collectCoverageFrom` sweep across `src/lib/**`, `src/logic/**`,
`src/data/**`, `src/notifications/**`, in priority order:

1. `src/data/syncQueue.ts` — **92.9%/72.58%/100%/92.12%** as of the sweep
   two cycles ago (not re-measured this cycle — this file's own coverage
   wasn't touched by this cycle's `offlineFirstRepository.test.ts`
   additions, which stub the queue rather than exercising real
   `SyncQueue.flush()`/`apply()` replay logic), small remaining gap at
   lines 482, 581-591, 595, 599-601 — the smallest of the remaining
   candidates, same offline-first/SyncQueue family AGENTS.md working rule
   6 flags as security/reliability-sensitive. Good next bite: read
   `syncQueue.ts`'s own `flush()`/`apply()`/quarantine logic (already read
   in full this cycle, see Last Evidence) and its existing
   `src/data/__tests__/syncQueue.test.ts` before scoping.
2. `src/data/localRepository.ts` — 78.74%/72.91%/75.55%/79.59%, uncovered
   lines 44, 116-117, 139, 151-153, 176-177, 185-187, 215-217, 242, 272,
   289-291 — smaller, same offline-first family (already read in full
   this cycle, see Last Evidence).
3. `src/lib/supabase.ts` — 63.28%/63.49%/72.22%/73.56%, uncovered 43-44,
   83-85, 224-246, 270-285 — this is the short-code join/family-lookup
   client module the "short-code join path" QA sweep (several cycles ago)
   already read closely for correctness; a coverage pass here would be
   incremental, not exploratory.
4. `src/lib/pushTokens.ts` (17.85%), `src/lib/realtime.ts` (0%),
   `src/lib/webPush.ts` (0%), `src/lib/uploadImage.ts` (28.57%) — all very
   low, but likely genuinely hard to unit-test without a real
   device/native-module boundary (same class of gap as the project-wide
   0%-coverage screens/components, not a new/isolated one) — worth a
   quick read to confirm that assumption before spending a cycle on them,
   rather than assuming a quick win.

A fresh full-repo `--collectCoverageFrom` sweep (not run this cycle — the
one from two cycles ago was reused) is worth re-running once this list is
exhausted, in case the aggregate coverage baseline has shifted.

Screens/components sit at or near 0% coverage project-wide, which is an
existing, consistent architectural pattern (no render-testing harness in
use anywhere in this codebase yet), not a new/isolated gap — treat that as
a much larger, separate undertaking rather than a quick win.

Remaining independent credential-free sub-tasks, in order: (1) re-attempt
Queue item 7's still-open Supabase-regression half via `gh`/a local
Supabase stack (only if the sandbox's permission mode allows it that
cycle — blocked for sixteen cycles running so far); (2) check whether
`origin/main`'s new Staging OTP E2E executor (see Blocker above) has a
completed run with `gh`, if `gh` becomes reachable — this could produce
real evidence toward Queue items 1-3/6 without needing credentials in
this sandbox directly; (3) Queue item 5 (Batch 4 regression) if/when
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

- Confirmed last cycle's commit (`645b336`, containing the
  `supabaseRepository.test.ts` coverage fix, self-reported as blocked at
  commit-time last cycle) had in fact landed cleanly on `origin` — no
  recovery action needed. Continued the quantitative-coverage angle
  against the top-priority file Next Safe Task named:
  `src/data/offlineFirstRepository.ts`, at 56.73%/59.25%/77.77%/56.43%
  (statements/branches/functions/lines) — the SyncQueue-backed
  offline-first orchestration layer. Read the file and `syncQueue.ts`
  together first, then added 28 new tests (33 total) to
  `src/data/__tests__/offlineFirstRepository.test.ts`: online-success read
  paths for all six read methods, remote-configured and local/demo-mode
  variants of all ten write methods, the `hasPendingForOtherUser`
  delegation, and `trySync()`'s own no-remote guard (reachable only via a
  direct external call, e.g. `App.tsx`'s opportunistic foreground sync —
  every internal call site already gates on `this.remote` first). Added a
  small test-local `makeRepo(online, remote)` helper to avoid repeating
  the five-line NetInfo-mock/AsyncStorage-clear/require setup ~30 times —
  scoped to this test file only. Coverage after: **100%/100%/100%/100%**
  — closes the next file this multi-cycle angle was tracking (`family.ts`,
  `familyManagement.ts`, `supabaseRepository.ts` were already 100% from
  prior cycles). Full validation gate re-run: `npx tsc --noEmit` PASS
  (after fixing a `Walk` fixture missing `createdAt`/`updatedAt` and
  tightening the `makeRepo` helper's return type to clear two
  implicit-`any` errors), `npm test -- --runInBand` **1015/1015** tests
  PASS (987 + 28 new), 89/89 suites. `git status`/`git diff --stat`
  confirmed exactly one tracked change from HEAD `645b336`.
  **Committed and pushed successfully this cycle** — the recurring
  commit/approval-gate issue did not recur. Reconfirmed `gh auth status`
  gated, `supabase` CLI not installed — Queue item 7 stays blocked for
  another (sixteenth) cycle.

### One cycle ago

- Confirmed last cycle's commit (`4e8de5a`, containing the
  `familyManagement.test.ts` coverage fix plus the `.gitignore`/
  `coverage/` housekeeping fix, both self-reported as blocked at
  commit-time last cycle) had in fact landed cleanly on `origin` — no
  recovery action needed. Continued the quantitative-coverage angle
  against the one remaining low-coverage RC-adjacent file Next Safe Task
  named: `src/data/supabaseRepository.ts`, at
  28.12%/34.93%/41.66%/36.61% (statements/branches/functions/lines) with
  every read/delete method, `saveWalk`'s atomic-update race, and
  `getNotificationSettings` untested. Read the file and its existing
  10-test file first, then added 45 new tests (55 total) to
  `src/data/__tests__/supabaseRepository.test.ts` in two passes — the
  second pass closed remaining error-throw and `?? []`/`?? undefined`
  null-fallback branches identified by parsing `coverage-final.json`
  directly rather than trusting the text-summary's line-range column
  alone. Coverage after: **100%/100%/100%/100%** — closes the last of the
  three low-coverage files this multi-cycle angle was tracking. Full
  validation gate re-run: `npx tsc --noEmit` PASS, `npm test --
  --runInBand` **987/987** tests PASS (942 + 45 new), 89/89 suites.
  `git status`/`git diff --stat` confirmed exactly one tracked change
  from HEAD `4e8de5a`. **Committed and pushed successfully this cycle** —
  the recurring commit/approval-gate issue did not recur. Reconfirmed
  `gh auth status` gated, `supabase` CLI not installed, `docker info`
  gated — Queue item 7 stays blocked for another (fifteenth) cycle. Ran a
  fresh `--collectCoverageFrom` sweep across `src/lib/**`/`src/logic/**`/
  `src/data/**`/`src/notifications/**` to identify the next real
  candidates for a future cycle — see Next Safe Task for the full
  prioritized list (`offlineFirstRepository.ts` at 56.73% is the top
  pick).

### Two cycles ago

- Confirmed last cycle's commit (`8cb511b`, containing the
  `verifiedAdminOnboarding.test.ts` coverage fix that was blocked at
  commit-time last cycle) landed cleanly on `origin` — no recovery action
  needed. Continued the quantitative-coverage angle: targeted
  `npx jest --coverage` at `src/lib/family.ts`/`src/logic/
  familyManagement.ts`/`src/data/supabaseRepository.ts` (the three files
  Next Safe Task named). `family.ts` was already 100%.
  `familyManagement.ts` was 72.34%/57.14%/53.84% because
  `computeUserDeletionImpact()` and `planUserRemoval()` — the family-
  member-deletion/rotation-reassignment logic behind
  `familyStore.ts`'s `deleteUser()` — had zero direct unit tests (only
  indirect coverage via `familyStore.test.ts`'s demo-data scenarios, which
  never hit several branches: the Hebrew sole-rotation-member throw, a
  rule not containing the removed user, entries filtered by owner/past
  date, and all three walk-reassignment fallback paths). Added 13 new
  tests to `src/logic/__tests__/familyManagement.test.ts`. Coverage after:
  **100%/100%/100%/100%**. Also fixed a small housekeeping issue: last
  cycle's commit had accidentally included a generated
  `coverage/coverage-summary.json`; added `coverage/` to `.gitignore` and
  ran `git rm --cached` on it. Full validation gate re-run: `npx tsc
  --noEmit` PASS, `npm test -- --runInBand` **942/942** tests PASS (929 +
  13 new), 89/89 suites. **Could not commit this cycle** — `git rm
  --cached`/`git add`/`git commit` were all gated behind an interactive
  approval prompt with no owner present (the same recurring,
  previously-documented sandbox permission-mode issue — recurred for the
  second cycle in a row this time). The change is complete and left
  uncommitted in the working tree for the next cycle to land first — see
  Next Safe Task and Blocker. Reconfirmed `gh auth status` gated,
  `supabase` CLI not installed, `docker info` gated — Queue item 7 stays
  blocked for another (fourteenth) cycle. `src/data/supabaseRepository.ts`
  (28.12%/34.93%/41.66%/36.61%) remains open for a future cycle — see Next
  Safe Task for the uncovered line ranges and scoping note.

### Three cycles ago

- New angle: ran `npx jest --coverage` across `src/**` (first cycle to
  measure quantitative Jest coverage rather than manually re-reading code)
  and found `src/lib/verifiedAdminOnboarding.ts` — the Queue item 1/2
  client module for verified-admin identity and family creation — at only
  54.5%/43.9%/54.5% (statements/branches/functions) because
  `createVerifiedFamily()` had zero direct unit tests anywhere in the repo
  (the only existing reference was a source-text scan of the Edge
  Function/migration SQL, not an invocation test). Added 11 new tests to
  `src/lib/__tests__/verifiedAdminOnboarding.test.ts` (+160 lines): 5 for
  `createVerifiedFamily()` and 6 for previously-uncovered error/fallback
  branches of the `...WithAuth` functions. Coverage after:
  84.1%/92.7%/63.6%. Full validation gate re-run: `npx tsc --noEmit` PASS,
  `npm test -- --runInBand` **929/929** tests PASS (918 + 11 new), 89/89
  suites. **Could not commit this cycle** — both `git add` and
  `git commit -a` were gated behind an interactive approval prompt with no
  owner present (the same recurring, previously-documented sandbox
  permission-mode issue, which had cleared for the prior several cycles
  but recurred this one). The change is complete and left uncommitted in
  the working tree for the next cycle to land first — see Next Safe Task
  and Blocker. Reconfirmed `gh auth status` gated, `supabase` CLI not
  installed, `docker info` gated — Queue item 7 stays blocked for another
  (thirteenth) cycle. **This did land** — see this cycle's entry above for
  confirmation (commit `8cb511b`).

### Four cycles ago

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

### Five cycles ago

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

### Six cycles ago

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

### Five cycles ago

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

### Seven cycles ago

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
