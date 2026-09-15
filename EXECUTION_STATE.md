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

## ⚠️ Standing protocol note (read first, every cycle)

A "commit/`git add` requires approval" sandbox message has been wrong
15+ times in a row now across many prior cycles (see git history of this
file for the full run) — every one of those "could not commit"
self-reports turned out to be incorrect; the commit had already landed
and pushed by the time the next cycle checked. The pattern was reconfirmed
yet again at the start of this cycle (see Current Task below).

**New variant of the same drift confirmed this cycle**: it is not only
individual commits that land silently despite a "BLOCKED" self-report —
this file's own narrative can also simply fall behind by more than one
full cycle of real, already-pushed work. At this cycle's start, HEAD was
three commits past `327b74a` (the SHA this file's own prior narrative
described as current): `909c450` (the `TextInput`-accessibilityLabel
sweep this file's prior text described as uncommitted/blocked — it had in
fact landed), then **two entirely undocumented commits**, `f2d4366`
(108 new lines in `familyStore.test.ts`) and `31d00f8` (a real,
substantive fix: migrated four more UTC-anchored `toDateOnly()` call
sites in `demoData.ts`/`statistics.ts`/`familyStore.ts`/`scheduleStore.ts`
to the local-calendar `localDateOnly()` helper), neither of which this
file was ever updated to describe. The next cycle's **first action,
before trusting anything else in this file**, must still be: `git log
--oneline -5` + `git status` to see whether HEAD has moved past whatever
SHA this file currently names as HEAD, and if so, `git show --stat` on
**every** commit between the old and new HEAD (not just the newest one —
this cycle found two undocumented commits, not one) to confirm what
actually landed before doing anything else.

## Current Task

Reconciliation at cycle start (this cycle, manual `workflow_dispatch`,
target sha `f174a053eefb5594c385e1378a74ac0143414af4`): `git log --oneline
-5`/`git status` showed HEAD at `31d00f8`, clean working tree, "up to
date with origin/feat/verified-auth-onboarding-batch-2" — **three**
commits past the `327b74a` this file's own prior narrative described as
HEAD. `git show --stat` on each of the three (`909c450`, `f2d4366`,
`31d00f8`) confirmed: (1) `909c450` is the prior cycle's own
`TextInput`-accessibilityLabel sweep (10 files + 1 new test file + this
file's own update) it had recorded as commit-`BLOCKED` — it had in fact
landed; (2) `f2d4366` and (3) `31d00f8` are **two further, entirely
undocumented commits** — `f2d4366` adds 108 lines of new tests to
`src/store/__tests__/familyStore.test.ts`; `31d00f8` is a real fix
migrating four more UTC-anchored `rotation.ts#toDateOnly()` call sites
(`src/data/demoData.ts`, `src/logic/statistics.ts`,
`src/store/familyStore.ts`, `src/store/scheduleStore.ts`) to the
already-established viewer-facing `src/logic/dateFormat.ts#localDateOnly()`
helper (introduced by an earlier, already-landed cycle for
`ScheduleScreen.tsx`/`presence.ts`). Neither `f2d4366` nor `31d00f8` was
ever reflected in this file — **a new variant of the standing
self-reporting-drift pattern**: not just a single commit landing despite
a "blocked" self-report, but this file's own narrative falling two full
cycles behind actual HEAD. See the standing protocol note above (updated
this cycle) for the generalized lesson. Reconciled before starting new
work, per protocol.

`node_modules` was again stale/incomplete at cycle start (same
`TS2688`/path-resolution symptom as every prior cycle). Ran `npm ci` (907
packages, clean, 16 moderate advisories — same class as before), which
fixed it. `npx tsc --noEmit` at `31d00f8` post-`npm ci` — **PASS**, zero
errors. `npm test -- --runInBand` at `31d00f8` — **PASS**: **115/115**
suites, **1391/1391** tests (1388 + the 3 new tests `f2d4366` added to
`familyStore.test.ts`, confirming `31d00f8` is genuinely HEAD and both
undocumented commits' work is present and passing).

Read `31d00f8`'s `toDateOnly()` → `localDateOnly()` migration in full and
grepped every remaining `toDateOnly` call site in `src/` to check whether
the migration was complete. It was not: three more call sites use
`rotation.ts#toDateOnly()` (UTC-anchored, correct only for internal
rotation-arithmetic per that file's own doc comment) for what is clearly
the same viewer-facing "today" concept the migration is fixing elsewhere
— `src/logic/history.ts#isWalkEligibleForHistory()` (decides whether a
resolved walk's calendar day has "arrived" from the viewer's perspective),
`src/components/AddUnplannedWalkModal.tsx` (defaults the "date" field to
"today" when logging a walk that already happened), and
`src/screens/HistoryScreen.tsx` (six call sites: the weekly-summary cutoff,
the today/7d/30d range-filter cutoffs, and the custom-date-picker
defaults/selection). All three are the identical off-by-one bug class the
existing `dateFormat.ts` doc comment describes: for a viewer in a timezone
ahead of UTC (e.g. Israel), a few hours after local midnight is still
"yesterday" in UTC, which would wrongly compute "today"/date-range
boundaries one day off.

**Fixed**: migrated all three files' viewer-facing `toDateOnly()` calls to
`localDateOnly()` (importing from `../logic/dateFormat` instead of
`../logic/rotation`/`./rotation`), completing the pattern `31d00f8` left
half-finished. No behavior change other than the timezone-correctness fix
itself — no visible-copy, layout, or unrelated logic change.
`rotation.ts#toDateOnly()` itself is untouched (still correct/in-use for
its documented internal-arithmetic purpose, e.g. `familyStore.ts`'s
`rotationAnchorDate`).

`npx tsc --noEmit` after the change — **PASS**, zero errors. `npm test --
--runInBand` after the change — **PASS**: **115/115** suites,
**1391/1391** tests (unchanged from the pre-change count — no test
depended on the old UTC-anchored values in a way that broke under
`TZ=UTC`, which is this sandbox's and CI's process timezone, confirmed via
`date`). `git status --porcelain=v1 --untracked-files=all` confirmed the
changeset is scoped to exactly the 3 fixed files
(`src/logic/history.ts`, `src/components/AddUnplannedWalkModal.tsx`,
`src/screens/HistoryScreen.tsx`) plus this `EXECUTION_STATE.md` update —
no unrelated file touched, no user work at risk.

No new regression test file was added for this specific fix: a TZ-divergent
scenario (the only way to observably distinguish `localDateOnly()` from
`toDateOnly()` in a test) requires forcing the process timezone away from
this sandbox's/CI's `TZ=UTC`, and an attempt to spot-check that
(`TZ=Pacific/Kiritimati node -e ...`) was itself gated
("This command requires approval") — not retried per the "don't retry a
gated command in a loop" guidance. `localDateOnly()`'s own correctness is
already covered by `src/logic/__tests__/dateFormat.test.ts`'s existing
suite; this fix is a mechanical substitution of that already-tested
helper for the same bug class two prior cycles already fixed and tested
elsewhere (`ScheduleScreen.tsx`/`FamilyOnboardingScreen.tsx`'s RTL-input
date fixes, `31d00f8`'s four-file migration). A future cycle with a
sandbox permission mode that allows `TZ=...` invocations should add a
TZ-forcing regression test to `history.test.ts` for
`isWalkEligibleForHistory()` (the one file in this fix with existing pure-
logic unit tests) to close this gap.

## Current Task Status

Prior cycle's `TextInput`-accessibilityLabel sweep (`909c450`) and the two
previously-undocumented commits (`f2d4366`'s `familyStore.test.ts` tests,
`31d00f8`'s partial `toDateOnly`→`localDateOnly` migration) are all
confirmed landed and pushed — closed, `DONE`.

This cycle's own task — completing the `toDateOnly()` → `localDateOnly()`
migration for the three remaining viewer-facing call sites
(`history.ts`, `AddUnplannedWalkModal.tsx`, `HistoryScreen.tsx`) — is
**DONE**, code-complete and validated (`tsc` PASS, `npm test` PASS
115/115 · 1391/1391). **Commit attempted this cycle** — see Blocker/Last
Evidence below for outcome, subject to the standing caveat that a cycle's
own "could not commit" self-report has been wrong 16+ times before; the
next cycle's first action must still be `git log --oneline -5` + `git
show --stat` on every commit past whatever SHA this file names, to
re-derive ground truth before trusting this narrative.

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- This cycle start (manual `workflow_dispatch`, target sha
  `f174a053eefb5594c385e1378a74ac0143414af4`): `git log --oneline
  -5`/`git status` confirmed HEAD is `31d00f8`, clean working tree, "up
  to date with origin/feat/verified-auth-onboarding-batch-2" — **three**
  commits past `327b74a`, what this file's own prior narrative described
  as HEAD. `git show --stat` on `909c450`/`f2d4366`/`31d00f8` (see
  Current Task above for full detail) confirmed all three had landed and
  pushed, including two (`f2d4366`, `31d00f8`) this file was never
  updated to describe — see standing protocol note above (new variant of
  the drift pattern, confirmed this cycle).
- `node_modules` present but stale/incomplete at cycle start (`tsc`
  failed with `TS2688`/path-resolution errors); `npm ci` — succeeded (907
  packages, 16 moderate `npm audit` advisories, same class as before),
  which fixed it.
- `npx tsc --noEmit` at `31d00f8` post-`npm ci` — **PASS**, zero errors.
- `npm test -- --runInBand` at `31d00f8` — **PASS**: **115/115** suites,
  **1391/1391** tests.
- Grepped every `toDateOnly` call site in `src/` against `31d00f8`'s
  partial migration and found three files where the same viewer-facing
  "today" bug class was still present: `src/logic/history.ts`,
  `src/components/AddUnplannedWalkModal.tsx`,
  `src/screens/HistoryScreen.tsx` (six call sites). Confirmed via reading
  `rotation.ts#toDateOnly()`'s and `dateFormat.ts#localDateOnly()`'s own
  doc comments, and `familyStore.test.ts`'s existing
  `rotationAnchorDate` usage, that `toDateOnly()` remains correct/in-use
  for internal rotation-arithmetic elsewhere — only these three files'
  viewer-facing usages needed migrating.
- **Code changes this cycle:** migrated all `toDateOnly()` call sites in
  `src/logic/history.ts` (`isWalkEligibleForHistory`),
  `src/components/AddUnplannedWalkModal.tsx` (date-field default, 2
  sites), and `src/screens/HistoryScreen.tsx` (weekly cutoff,
  today/7d/30d range cutoffs, custom-date-picker default/selection, 6
  sites) to `localDateOnly()` from `../logic/dateFormat`. No behavior
  change beyond the timezone-correctness fix; no unrelated files touched.
- `npx tsc --noEmit` after the change — **PASS**, zero errors.
- `npm test -- --runInBand` after the change — **PASS**: **115/115**
  suites, **1391/1391** tests (unchanged — no existing test depended on
  the old UTC-anchored values in a way sensitive to this change under
  this sandbox's/CI's `TZ=UTC`).
- `git status --porcelain=v1 --untracked-files=all` confirmed the
  changeset is scoped to exactly the 3 fixed files
  (`src/logic/history.ts`, `src/components/AddUnplannedWalkModal.tsx`,
  `src/screens/HistoryScreen.tsx`) plus this `EXECUTION_STATE.md` update
  — no unrelated file touched, no user work at risk.
- A spot-check attempt to force a TZ-divergent value for a regression
  test (`TZ=Pacific/Kiritimati node -e ...`) was gated ("This command
  requires approval") — not retried; see Current Task above and Next Safe
  Task below.
- **Commit attempt this cycle:** see Blocker below for outcome, subject
  to the standing caveat that a cycle's own "could not commit" self-report
  has been wrong 16+ times before.

## Last Evidence Timestamp

2026-09-15T18:30:00Z

## Blocker

**This cycle's own `git add` was blocked** ("This command requires
approval") for the 3-file `toDateOnly`→`localDateOnly` completion fix
(`src/logic/history.ts`, `src/components/AddUnplannedWalkModal.tsx`,
`src/screens/HistoryScreen.tsx`) + this `EXECUTION_STATE.md` update —
tried once, standalone (not retried in a loop per the "don't retry a
gated command repeatedly" guidance; this exact pattern has already been
retried with multiple invocation shapes across 16+ prior cycles with no
change in outcome). The working-tree change is real and validated
(`tsc`/`npm test` both PASS, 115/115 suites, 1391/1391 tests) and left in
place uncommitted per "never discard uncommitted work." Per the standing
protocol note above and the now-confirmed pattern that this file's own
narrative can fall multiple cycles behind actual HEAD (this cycle's own
reconciliation found *two* undocumented commits past what the file
described, not just one), this cycle's own observation that its commit
did not land is not reliable evidence either way — the next cycle's
first action must still be `git log --oneline -5` + `git show --stat` on
every commit past whatever SHA this file names, to re-derive ground truth
before trusting this section's narrative, regardless of what this
section says.

**Standing question, still open:** is "requires approval" ever reliable
evidence of a genuine block? Sixteen-plus prior confirmed instances show
a cycle's own "not yet landed by my own observation" self-report about
its own `EXECUTION_STATE.md` commit being resolved as wrong-in-substance
by the very next cycle's reconciliation — i.e. the commit apparently
landed via some mechanism outside this turn's own visibility, despite the
approval-gate message (this cycle's own reconciliation at start
reconfirmed exactly that pattern for the *prior* cycle's commit — see
standing protocol note above). AGENTS.md rule 12 explicitly permits local
commits without asking, so any block here is a sandbox
permission-mode/timing artifact, not a policy one — no bypass
(`--no-verify` or otherwise) has ever been attempted.

Live Staging E2E (family creation persistence, invite/join code/link/QR,
second-member join, real OTP/email delivery, System Admin live approve/
reject) requires a real non-Production Supabase project and a Resend
account with a verified sending domain. Neither is available in this
sandbox: no `.env`, no linked Supabase project, no Resend/Supabase
account-level tool, no `supabase` CLI (confirmed absent again this cycle),
no privileged Docker confirmed for a local stack (gated again this
cycle). Two unblock options remain posted on PR #7: (A) the owner runs the
non-Production deployment/config steps and shares evidence to verify, or
(B) the owner grants this session the credentials directly. Unanswered as
of the last check.

`origin/main` (separate lineage, out of this cycle's editable scope) has
the **Staging Family E2E** workflow
(`.github/workflows/staging-family-e2e.yml`) and harness
(`scripts/staging-family-e2e.mjs`, merged via PR #40) that is the
credentialed half of Queue item 1 — a `workflow_dispatch` job that
requests a real OTP, reads it from a dedicated Gmail test inbox, creates a
verified family, verifies persistence, invite-code lookup from a second
session, and (when `AUTO_APPROVE_NEW_FAMILIES` is effectively true)
second-device `join_family()`. It takes a `target_branch` input
(defaulting to this branch) and needs GitHub Environment `staging`
secrets this worker never sees. `gh auth status` remains gated
(reconfirmed this cycle), so neither triggering nor reading a run of this
workflow is possible from here. This workflow file/script are NOT edited
or copied onto this branch (`.github/workflows/**` is off-limits to this
worker regardless of branch). Owner/a future cycle with `gh`/environment
access should: (1) confirm the `staging` GitHub Environment has all six
secrets, (2) dispatch `staging-family-e2e.yml` with
`target_branch=feat/verified-auth-onboarding-batch-2`, (3) read the run's
summary for `STAGING_FAMILY_E2E_OK`/`STAGING_FAMILY_E2E_PENDING_OK`.

The older, narrower **Staging OTP E2E executor**
(`docs/engineering/STAGING_OTP_E2E.md`, PRs #30/#35/#37, OTP-round-trip
only) also still lives on `main`, superseded by the workflow above for
Queue item 1's purposes; both remain equally unreachable from this
sandbox.

`gh` CLI access remains gated for authenticated use behind an interactive
approval prompt with no owner present — the `gh` binary itself is present
at `/usr/bin/gh`, but `gh auth status` is still gated (reconfirmed this
cycle as a standalone command), so this is not a substantive unblock. A
secondary, independent blocker from the Staging-credentials one,
affecting only GitHub-metadata inspection (PR #7/#11 state, workflow
runs), not local repository work. `supabase` CLI confirmed not installed
again this cycle (`which supabase` → exit 1) — Queue item 7's
Supabase-regression half stays blocked on tooling/access regardless of
`docker`'s own reachability (not re-tested this cycle).

**Sixteen scratch/debug/backup files still gated on deletion (many
cycles running, confirmed a general file-deletion permission gate, not
`git`-specific):** the seven original scratch/debug files
(`tmp_coverage_inspect.js`, `src/lib/__tests__/__scratch_platform_probe
.test.ts`, `src/lib/__tests__/__scratch_pushTokens_probe.test.ts`,
`src/notifications/__tests__/__scratch_isolate_probe.test.ts`,
`src/store/__tests__/__scratch_renderHook_probe.test.ts`,
`src/notifications/__tests__/debugExpoConstants.test.ts`,
`src/notifications/__tests__/debugExpoNotifications.test.ts`), the eight
tracked `.before-*` backup files, and one `.encoding-backup` file (see
Next Safe Task for the full sixteen-file list) — all inert, dead, with no
functional impact, left in place, not blocking any other work.

**Still-open, independent of this branch:** the applicant-side navigation
bug in `src/screens/FamilyOnboardingScreen.tsx`'s
`refreshOnboardingStatus()`/`AppState` effect (unconditional
`setMode('create')` on foreground can hijack a user out of `join`/`redeem`
mode) only exists on stacked branch `feat/system-admin-approval-controls`
(PR #11) — this run's own `TARGET_BRANCH`'s `FamilyOnboardingScreen.tsx`
contains neither `refreshOnboardingStatus` nor `AppState` (reconfirmed
prior cycles), so the buggy code path genuinely does not exist here.
Needs either (A) a future cycle dispatched with
`TARGET_BRANCH=feat/system-admin-approval-controls`, or (B) the owner/a
reviewer applying the fix directly on PR #11 (suggested direction: only
call `setMode('create')` when `mode` is already `'choose'`/`'create'`).
Full detail in git history of this file.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

**First step for the next cycle:** re-derive state from `git log`/`git
show`/`git diff` before trusting this file's own narrative (see the
standing protocol note at the top of this file) — check whether this
cycle's own commit (the 3-file `toDateOnly`→`localDateOnly` completion
fix + this `EXECUTION_STATE.md` update) landed, **and** check every commit
between whatever SHA this file names and actual HEAD, not just the
newest one — this cycle found two previously-undocumented commits behind
a single stale SHA, not one.

If a future cycle's sandbox permission mode allows a `TZ=...`-prefixed
command, add a TZ-forcing regression test to
`src/logic/__tests__/history.test.ts` for `isWalkEligibleForHistory()`
proving it uses local-calendar semantics (matching this cycle's
`localDateOnly()` migration) rather than UTC — this cycle's own attempt
(`TZ=Pacific/Kiritimati node -e ...`) was gated. Worth also grepping
`src/` fresh for any other `rotation.ts#toDateOnly()` call site that
looks viewer-facing (e.g. a future new date-picker default) rather than
internal-rotation-arithmetic, in case one was missed — this cycle's own
grep found and fixed all it could find (`history.ts`,
`AddUnplannedWalkModal.tsx`, `HistoryScreen.tsx`), but a fresh confirming
pass is cheap.

Retry deletion of the sixteen now-confirmed dead scratch/backup files
(full list in the Blocker section above) the moment the sandbox's
permission mode allows it — pure housekeeping, blocked for many cycles
running (a general file-deletion gate, not `git`-specific — a future
cycle with a different permission mode, or the owner running `git rm`
directly, is the only known unblock path).

The quantitative-Jest-coverage angle is exhausted across the whole `src/`
tree (`src/lib`/`src/logic`/`src/mascot`/`src/notifications`/`src/store` —
every file at 100% or a documented-non-functional residual). Screens/
components sit at or near 0% coverage project-wide (no render-testing
harness in this codebase), an existing architectural pattern, not a new
gap — a much larger, separate undertaking rather than a quick win.
`src/data/repository.ts` (0%) is a pure TS interface file with one trivial
marker class — skip unless a future cycle wants one trivial smoke test.

The RTL-content-alignment bug class, the mascot/Reduced-Motion theme, the
notification-tap-routing question, the dog-sex/grammatical-copy sweep, the
Android `onRequestClose`/hardware-back-button sweep, the modal-internal
`textAlign`/`writingDirection` content sweep, the double-submit/
`Button`-`loading`-prop guard check, the accessibility-label-on-non-
`Button`-`Pressable` sweep, the modal-backdrop-Pressable
accessibility-role/label sweep (17 files fixed), the
`accessibilityElementsHidden`/background-content-while-modal-open angle,
and the keyboard-avoidance-coverage sweep (closed this cycle for real —
every modal/screen `TextInput` now wraps in `KeyboardAvoidingView`,
including the `SystemAdminScreen.tsx` search box confirmed this cycle to
not need it) are all closed exhausted — each found at most one or a
handful of real defects (already fixed) and a confirming closing pass
found nothing further of the same shape.

This cycle closed a new angle: **every `TextInput` now has an
`accessibilityLabel`** (19 call sites across 10 files fixed). A future
cycle should do one confirming pass (grep for `<TextInput` across
`src/`, diff against the file list in `textInputAccessibilityLabel.test.ts`)
before treating this angle as fully exhausted, in case a new `TextInput`
is added to the codebase without one going forward. A future QA Guardian
cycle should otherwise open a genuinely new angle rather than re-sweeping
any of these — candidate ideas not yet tried: numeric/date formatting
edge cases in `src/lib`, `accessibilityHint` coverage on destructive
actions, or dynamic-type/font-scaling behavior on fixed-height cards.

Remaining independent credential-free sub-tasks, in order: (1) re-attempt
Queue item 7's still-open Supabase-regression half via `gh`/a local
Supabase stack (blocked for many cycles running so far); (2) if
`gh` becomes reachable, dispatch or check for a completed run of
`staging-family-e2e.yml` on `main` (see Blocker above) with
`target_branch=feat/verified-auth-onboarding-batch-2` — the single most
direct, concrete unblock path found so far for Queue item 1's credentialed
half; (3) Queue item 5 (Batch 4 regression) if/when independent,
credential-free repository evidence for it exists — no `batch-4`-named
branch or work exists in this repository yet. A future cycle with
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

- Reconciliation found HEAD had actually moved to `31d00f8`, **three**
  commits past the `327b74a` the prior cycle's own file narrative
  described as HEAD — `git show --stat` on `909c450`/`f2d4366`/`31d00f8`
  confirmed all three had landed and pushed, including two (`f2d4366`'s
  `familyStore.test.ts` tests, `31d00f8`'s partial
  `toDateOnly`→`localDateOnly` migration) this file was never updated to
  describe — a new variant of the standing self-reporting-drift pattern
  (see standing protocol note above, updated this cycle). `node_modules`
  was stale (`tsc` failed with `TS2688`); `npm ci` (907 packages) fixed
  it. Full baseline validation at `31d00f8`: `npx tsc --noEmit` PASS,
  `npm test -- --runInBand` PASS (115/115 suites, 1391/1391 tests).
- **Real defect fixed, completing a prior cycle's half-finished
  migration:** `31d00f8` (undocumented, this cycle's own reconciliation
  found it) migrated four UTC-anchored `rotation.ts#toDateOnly()` call
  sites to the viewer-facing `dateFormat.ts#localDateOnly()` helper but
  left three more of the same bug class unmigrated. Grepped all remaining
  `toDateOnly` call sites in `src/` and found/fixed: `src/logic/history.ts`
  (`isWalkEligibleForHistory`'s history-day-arrived check),
  `src/components/AddUnplannedWalkModal.tsx` (date-field default, 2
  sites), and `src/screens/HistoryScreen.tsx` (weekly-summary cutoff,
  today/7d/30d range cutoffs, custom-date-picker default/selection, 6
  sites) — 9 call sites across 3 files, all switched to `localDateOnly()`.
  No behavior change beyond the timezone-correctness fix. `npx tsc
  --noEmit` PASS and `npm test -- --runInBand` PASS (115/115 suites,
  1391/1391 tests, unchanged) after the change. `git status`/diff scoped
  to exactly the 3 fixed files + this `EXECUTION_STATE.md` update. A
  TZ-forcing regression-test attempt was gated (see Next Safe Task).
  **Commit attempt blocked** (`git add`, "This command requires
  approval"; confirmed via immediate `git status`/`git log` that nothing
  landed) — see Blocker above.

### Recent cycles (condensed — full detail in git history of this file)

- Prior cycle: audited `SystemAdminScreen.tsx`'s search `TextInput` for
  the keyboard-avoidance defect class (not a real gap, closing that angle
  for real) and found+fixed a first-time-discovered `accessibilityLabel`
  gap across all 19 `TextInput` call sites in 10 files (none had one
  before; Android TalkBack doesn't reliably read `placeholder` as the
  accessible name). Added a 10-sub-test regression file. Landed as
  `909c450` despite that cycle's own "genuinely blocked" commit
  self-report. Also landed, undocumented by that cycle's own narrative:
  `f2d4366` (108 new lines in `familyStore.test.ts`) and `31d00f8` (a
  real fix migrating four `toDateOnly()`→`localDateOnly()` call sites in
  `demoData.ts`/`statistics.ts`/`familyStore.ts`/`scheduleStore.ts`).
- Two cycles ago: fixed one real, first-time-discovered keyboard-avoidance
  gap in `PinEntryModal.tsx`/`PinSetupModal.tsx` (centered-card `Modal`s
  with number-pad `TextInput`s, no `KeyboardAvoidingView`, unlike every
  sibling modal). Landed as `327b74a` despite that cycle's own
  "genuinely blocked" commit self-report.
- Two cycles ago: fixed one real, first-time-discovered accessibility gap
  in all 17 sheet-style modals' tap-outside-to-dismiss backdrop
  `Pressable`s (missing `accessibilityRole`/`accessibilityLabel`).
  Landed as `a70a8f4` despite that cycle's own "genuinely blocked" commit
  self-report.
- Three cycles ago: fixed one real, first-time-discovered accessibility gap
  in `MemberDetailsModal.tsx`'s role-toggle chips (missing
  `accessibilityRole="radio"`/`accessibilityState`). Landed as `09758ec`
  despite that cycle's own "genuinely blocked" commit self-report.
- Three cycles ago: found and fixed four real, first-time-discovered
  accessibility-label gaps (`ScheduleScreen.tsx`, `AddUnplannedWalkModal.tsx`,
  `UserFormModal.tsx`), each mirroring an already-correct sibling
  pattern. Added three new regression test files (6 tests). Landed as
  `f1fcb13` despite that cycle's own "genuinely blocked" commit
  self-report.
- Three cycles ago: found and fixed a real, first-time-discovered keyboard-
  avoidance gap in `DogDetailsModal.tsx` (bottom sheet with text fields
  near the bottom, unlike every sibling modal, was missing
  `KeyboardAvoidingView`). Added a 3-test regression file. Landed as
  `9180c3a` despite that cycle's own "genuinely blocked" commit
  self-report.
- Four cycles ago: reconciliation-only, no drift, no code change (HEAD
  landed at `e2c281d` — this file's own prior rewrite).
- Four cycles ago: an Android hardware-back-button (`onRequestClose`)
  sweep of all 26 `<Modal>` call sites (all correctly wired, no defect)
  plus a dog-sex/grammatical-copy check of `FamilyScreen.tsx` (the last
  screen of that class, already correct). No code change; landed as
  `b8774da`.
- Five cycles ago: continued the mascot/Reduced-Motion QA theme with a
  second, confirming sweep of all 26 `<Modal>` call sites (found nothing
  further) and traced the notification-tap→mascot-prompt routing path end
  to end (confirmed already-correct by design). No code change; landed as
  `9adde84`.
- Six cycles ago: found and fixed one real, first-time-discovered
  Reduced-Motion gap in `ReminderMascotPrompt.tsx`'s `<Modal>` (hardcoded
  `animationType="fade"`, never gated by OS reduce-motion, unlike sibling
  `WalkCompletionCelebration.tsx`) — added a `reducedMotion` state hook and
  one new regression test file. Landed as `1a8b785` despite that cycle's
  own "genuinely blocked" self-report.
- Six cycles ago: closed a real, first-time-discovered RTL inconsistency
  in `FamilySharingModal.tsx`'s displayed invite code (`RtlText` with no
  `writingDirection` override → new `ltrText` style), plus a fresh
  full-`src/store` coverage sweep confirming that angle exhausted. Landed
  as `3c51155`.
- Earlier: closed a real, first-time-discovered RTL inconsistency
  in `FamilyOnboardingScreen.tsx`'s redeem-input field (`textAlign="right"`
  on inherently-LTR link/token content → `textAlign="left"` + new
  `ltrInput` style), plus a fresh full-`src/store` coverage sweep
  confirming that angle exhausted. Landed as `0fa6f62`.
- Earlier: closed `scheduleStore.ts`'s last two real coverage gaps
  (5 new tests, 95.14/77.83/100/100). Landed as `ace9724`.
- Earlier: closed `authStore.ts`'s remaining coverage gaps (10
  new tests, 100/100/100/100). Landed as `dc2b2e1`.
- Earlier: closed `requestsStore.ts`'s coverage gaps (17 new
  tests, 100/100/100/100). Landed as `0adbd9e`.

The multi-cycle quantitative-Jest-coverage angle closed every targeted
file across `src/lib`, `src/logic`, `src/mascot`, `src/notifications`, and
`src/store` to 100%/100%/100%/100% (or provably-maximal reachable
coverage for genuinely unreachable defensive code). Each cycle's entry
followed the same shape: measure fresh coverage, read the file plus its
existing test file, add the missing tests, re-run the full local
validation gate, confirm scope via `git status`/`git diff --stat`, then
commit/push (subject to the recurring self-reporting-drift pattern
documented above, which affected roughly half of these cycles' own
end-of-cycle narrative but never the underlying work). `gh auth status`
and `docker info` were gated throughout this entire span, so Queue item
7's Supabase-regression half stayed blocked for every one of these
cycles. Full per-file detail (`errorMessages.ts` through
`familyManagement.ts`, ~25 files) is preserved in git history of this file
rather than repeated here.

Several credential-free QA sweeps (no code change needed) found **no
defect**: the Settings/Roles backend-authorization model, the
`send-email` Edge Function's webhook signature-verification wiring, dog-
sex copy across `FamilyOnboardingScreen.tsx`/`HistoryScreen.tsx`/
`ScheduleScreen.tsx`/`StatisticsScreen.tsx` (all use correct inclusive
"/ה"/"/ת" fallback copy, no gendered-verb dog-action text found), and the
System Admin approve/reject feature's RTL/mascot/production-sensitivity
surface. Two sweeps found and fixed real defects: a timing-side-channel
gap in the Resend webhook signature check (`timingSafeBase64Equal()`,
committed as `e52c7ae`), and a notification-tap→mascot-prompt coverage gap
(`notificationService.ts`, committed as `16d4a17`).

### Earlier cycles (for continuity)

- Queue item 2/4 sub-task — found (not fixed on this branch; file doesn't
  exist here) the applicant-status-recovery `AppState`/`setMode('create')`
  defect on stacked branch `feat/system-admin-approval-controls` (PR
  #11) — see Blocker above for current status and suggested fix.
- Queue item 6 sub-task — fixed a real notification-tap→mascot-prompt
  coverage gap (extended `jest.setup.js`'s `expo-notifications` mock,
  added `__resetReminderEntryForTests()`, 6 new tests). Committed as
  `16d4a17`.
- Queue item 3 sub-task — fixed the Resend webhook signature-check timing
  side channel (`timingSafeBase64Equal()`). Committed as `e52c7ae`.
- Queue item 8 sub-task — System Admin approve/reject RTL/mascot/
  production-sensitivity sweep, plus Settings/Roles pass. No
  release-blocking gap found. Committed as `d03e6da`.

## Explicitly Out of Scope

- GPS / automatic walk detection
- Inactive-family lifecycle / deletion
- Expanded admin audit/analytics/reports
- Support / help desk
- Cosmetic email branding
- Any other backlog feature not in the Queue above
