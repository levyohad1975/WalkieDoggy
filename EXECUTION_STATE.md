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
12+ times in a row now across many prior cycles (see git history of this
file for the full run) — every one of those "could not commit"
self-reports turned out to be incorrect; the commit had already landed
and pushed by the time the next cycle checked. **This cycle reconfirmed
the pattern again**: the prior cycle's own file narrative recorded its
`DogDetailsModal.tsx` fix + `EXECUTION_STATE.md` update commit as
`BLOCKED`/"genuinely blocked this cycle, not yet reconciled as landed" —
but `git log --oneline -5` at this cycle's start showed HEAD already at
`9180c3a`, one commit past the `e2c281d` the prior file narrative
referenced, and `git show --stat 9180c3a` confirmed it contains exactly
that fix (`EXECUTION_STATE.md`, `src/components/DogDetailsModal.tsx`, and
the new `DogDetailsModal.keyboardAvoidance.test.ts`, 339
insertions/273 deletions across 3 files) — i.e. it *had* landed and
pushed, despite the prior cycle's own confirmed-by-`git-status` "BLOCKED"
observation. The next cycle's **first action, before trusting anything
else in this file**, must still be: `git log --oneline -5` + `git status`
to see whether HEAD has moved past whatever SHA this file currently names
as HEAD, and if so, `git show --stat <new HEAD>` to confirm what actually
landed before doing anything else.

## Current Task

Reconciliation at cycle start (this cycle, manual `workflow_dispatch`,
target sha `f174a053eefb5594c385e1378a74ac0143414af4`): `git log --oneline
-10`/`git status` showed HEAD at `f1fcb13`, clean working tree, "up to
date with origin/feat/verified-auth-onboarding-batch-2" — one commit past
the `9180c3a` the prior cycle's own file narrative described as HEAD.
`git show --stat f1fcb13` / `git diff --stat 9180c3a..f1fcb13` confirmed
the prior cycle's own accessibility-label fixes (`ScheduleScreen.tsx`,
`AddUnplannedWalkModal.tsx`, `UserFormModal.tsx`, three new test files,
this file's own update) had in fact landed and pushed — despite that
cycle recording its own commit step as `BLOCKED`. **This is the same
recurring self-reporting-drift pattern documented in the standing
protocol note above, now confirmed a 13th+ time.** Reconciled before
starting new work, per protocol.

`node_modules` was absent at cycle start (fresh sandbox again). Ran
`npm ci` (907 packages, clean, 16 moderate advisories — same class as
before). `npx tsc --noEmit` at `f1fcb13` — **PASS**, zero errors. `npm
test -- --runInBand` at `f1fcb13` — **PASS**: **110/110** suites,
**1353/1353** tests (matches the prior cycle's own post-fix count
exactly, confirming `f1fcb13` is genuinely HEAD and the fix is present).

Retried `git rm` on all sixteen known dead scratch/backup files (the
seven scratch/debug files + eight `.before-*` files + one
`.encoding-backup` file) in a single combined attempt — gated again
("This command requires approval"; the block persists this cycle, same
general file-deletion permission gate documented in prior cycles;
confirmed via immediate `git status --porcelain=v1` that nothing was
staged). Noted this cycle: the `gh` binary is now present at `/usr/bin/gh`
(new — prior cycles reported it entirely absent or unchecked at the
binary level), but `gh auth status` itself is still gated ("This command
requires approval") — so this is a cosmetic change (binary installed) not
a substantive unblock (no usable credentialed access). `docker info` still
gated. `which supabase` still exit 1 (not installed; `command -v supabase`
is gated for some reason even though `which supabase` runs cleanly — an
inconsistency in the sandbox's command-approval matching, not a new
finding worth chasing).

New QA Guardian follow-up this cycle: fixed the one secondary,
lower-priority finding the prior cycle recorded but did not fix —
`MemberDetailsModal.tsx`'s role-toggle chips. See Current Task Status.

## Current Task Status

Prior cycle's accessibility-label QA sweep (`ScheduleScreen.tsx`,
`AddUnplannedWalkModal.tsx`, `UserFormModal.tsx` + three new test files)
is confirmed landed at `f1fcb13` (see standing protocol note above and
Current Task above) — closed, `DONE`.

This cycle's own follow-up — fixing the one secondary, lower-priority
finding that cycle recorded but did not fix — is **DONE**:
`src/components/MemberDetailsModal.tsx`'s role-toggle chips ("בן משפחה"/
"מנהל", the two `Pressable`s around lines 320/338 driven by
`setPendingRole('member'|'admin')`) behaved like a radio group (mutually
exclusive selection, visual active state via `styles.roleOptionActive`)
but carried no `accessibilityRole`/`accessibilityState`, unlike the
identical single-select-chip pattern already handled correctly in
`DeleteUserModal.tsx`/`EditDoneDetailsModal.tsx`
(`accessibilityRole="radio"` + `accessibilityState={{ selected }}`).
**Fixed**: added `accessibilityRole="radio"` +
`` accessibilityState={{ selected: role === 'member' }} ``/
`` accessibilityState={{ selected: role === 'admin' }} `` to each chip,
mirroring `DeleteUserModal.tsx`'s pattern exactly. Unlike the four gaps
fixed last cycle, this one already had visible Hebrew text (not
emoji/swatch-only), so it was a role/state consistency gap rather than a
fully silent screen-reader element — still a real, if lower-severity,
accessibility miss versus the established sibling pattern.

One new regression test file added, following this repo's established
source-scan-via-`fs.readFileSync` convention:
`src/components/__tests__/MemberDetailsModal.roleToggleAccessibility.test.ts`
(2 tests).

`npx tsc --noEmit` after the change — **PASS**, zero errors. `npm test --
--runInBand` after the change — **PASS**: **111/111** suites,
**1355/1355** tests (up from the 110/110 · 1353/1353 baseline at
`f1fcb13` — exactly the +1 suite/+2 tests this new test file adds, no
other suite's count changed). `git status --porcelain=v1
--untracked-files=all` confirmed the changeset is scoped to exactly
`src/components/MemberDetailsModal.tsx`, the one new test file, and this
`EXECUTION_STATE.md` update — no unrelated file touched, no user work at
risk.

**Commit status — genuinely blocked this cycle** (`git add` naming the
three intended files explicitly returned "This command requires
approval"; `git status --porcelain=v1` re-checked immediately after
confirmed nothing staged) — recorded as `BLOCKED` on the commit step
only, per "no evidence = not completed." See Blocker below for full
detail, including the standing caveat that this self-report has been
wrong before. The code work itself is complete and validated regardless
of commit status.

Also retried this cycle (no code change, pure evidence-gathering):
`git rm` on all sixteen now-known dead backup/scratch files in one
combined attempt — gated again, same permission gate as every prior
cycle (see Current Task above); `gh` binary now present but
`gh auth status` still gated; `docker info` still gated; `supabase` CLI
still not installed.

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
  -10`/`git status` confirmed HEAD is `f1fcb13`, clean working tree, "up
  to date with origin/feat/verified-auth-onboarding-batch-2" — one commit
  past what the prior cycle's own file narrative described as HEAD
  (`9180c3a`). `git show --stat f1fcb13` confirmed the prior cycle's
  accessibility-label fixes (`ScheduleScreen.tsx`, `AddUnplannedWalkModal.tsx`,
  `UserFormModal.tsx`, three test files) + this file's own update had in
  fact landed and pushed, despite the prior cycle recording its commit
  step as `BLOCKED` — see standing protocol note above (13th+ confirmed
  instance of this pattern).
- `npm ci` — succeeded (907 packages, no `node_modules` present at cycle
  start; 16 moderate `npm audit` advisories, same class as before).
- `npx tsc --noEmit` at `f1fcb13` — **PASS**, zero errors.
- `npm test -- --runInBand` at `f1fcb13` — **PASS**: **110/110** suites,
  **1353/1353** tests (matches the prior cycle's own post-fix count
  exactly).
- `git rm` on all sixteen known dead scratch/backup/`.before-*` files
  (combined single attempt) — "This command requires approval" (blocked
  again, same general file-deletion permission gate documented in prior
  cycles; confirmed via immediate `git status --porcelain=v1` that
  nothing was staged). `gh` binary now present at `/usr/bin/gh` (new
  this cycle) but `gh auth status` itself — still gated. `docker info` —
  still gated. `which supabase` — still exit 1, not installed
  (`command -v supabase` gated inconsistently, `which supabase` runs
  clean — sandbox command-matching quirk, not a new finding).
- **Code changes this cycle:** added `accessibilityRole="radio"` +
  `accessibilityState={{ selected }}` to `MemberDetailsModal.tsx`'s two
  role-toggle chips — the one secondary, lower-priority finding the
  prior cycle recorded but did not fix, mirroring
  `DeleteUserModal.tsx`'s/`EditDoneDetailsModal.tsx`'s already-correct
  radio-chip pattern (see Current Task Status for full detail). One new
  regression test file added (2 tests).
- `npx tsc --noEmit` after the change — **PASS**, zero errors.
- `npm test -- --runInBand` after the change — **PASS**: **111/111**
  suites, **1355/1355** tests (110→111 suites, 1353→1355 tests — exactly
  this cycle's one new test file / two new tests, no other suite
  affected).
- `git status --porcelain=v1 --untracked-files=all` confirmed the
  changeset is scoped to exactly the one fixed source file, the one new
  test file, and this `EXECUTION_STATE.md` update — no unrelated file
  touched, no user work at risk.

## Last Evidence Timestamp

2026-09-15T17:35:00Z

## Blocker

**This cycle's own `git add` was blocked** ("This command requires
approval") for the `MemberDetailsModal.tsx` fix + new test file + this
`EXECUTION_STATE.md` update — tried once naming the three intended files
explicitly, and this cycle explicitly ran `git status --porcelain=v1`
immediately after and confirmed nothing was staged, i.e. genuinely not
staged, not merely an unresolved self-report. The working-tree change is
real and validated (`tsc`/`npm test` both PASS, 111/111 suites,
1355/1355 tests) and left in place uncommitted per "never discard
uncommitted work." Per the standing protocol note and the 13th+ confirmed
instance of the self-reporting-drift pattern (this cycle's own
reconciliation found `f1fcb13` already landed the *prior* cycle's
"BLOCKED"-recorded commit despite an identical-looking block), this
cycle's own observation that its commit did not land is not reliable
evidence either way — the next cycle's first action must still be
`git log --oneline -5` + `git show --stat` to re-derive ground truth
before trusting this section's narrative, regardless of what this
section says.

**Standing question, still open:** is "requires approval" ever reliable
evidence of a genuine block? Thirteen-plus prior confirmed instances show
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
approval prompt with no owner present — the `gh` binary itself is now
present at `/usr/bin/gh` (new this cycle, previously entirely absent or
unchecked at the binary level), but `gh auth status` is still gated, so
this is not a substantive unblock. A secondary, independent blocker from
the Staging-credentials one, affecting only GitHub-metadata inspection
(PR #7/#11 state, workflow runs), not local repository work. `docker info`
also gated (reconfirmed); `supabase` CLI confirmed not installed
(`which supabase` → exit 1) — Queue item 7's Supabase-regression half
stays blocked on tooling/access regardless of `docker`'s own reachability.

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
cycle's own commit (`MemberDetailsModal.tsx` role-toggle accessibility
fix + new test file + this `EXECUTION_STATE.md` update) landed. The
recurring self-reporting-drift pattern documented in prior cycles means a
cycle's own uncertain end-of-cycle commit status is not reliable evidence
either way — always re-check `git log --oneline -5` fresh before trusting
this file's narrative.

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
`Button`-`loading`-prop guard check, the keyboard-avoidance-coverage
sweep, and the accessibility-label-on-non-`Button`-`Pressable` sweep
(including this cycle's `MemberDetailsModal.tsx` follow-up) are now all
closed exhausted — each found at most one or a handful of real defects
(already fixed) and a confirming closing pass found nothing further of
the same shape. A future QA Guardian cycle should open a genuinely new
angle rather than re-sweeping any of these, e.g.: the tap-outside-to-
dismiss backdrop Pressables noted in a prior cycle as a different,
lower-priority concern (`accessibilityElementsHidden`/
`importantForAccessibility` rather than a missing label/role), or
numeric/date formatting edge cases in `src/lib`.

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

- Reconciliation found HEAD had actually moved to `f1fcb13`, one commit
  past the `9180c3a` the prior cycle's own file narrative described as
  HEAD — `git show --stat f1fcb13` confirmed the prior cycle's
  accessibility-label fixes (`ScheduleScreen.tsx`, `AddUnplannedWalkModal.tsx`,
  `UserFormModal.tsx` + three test files), recorded by that cycle as
  `BLOCKED` on the commit step, had in fact landed and pushed (standing
  pattern, now 13+ times). `npm ci` (907 packages, fresh sandbox). Full
  baseline validation at `f1fcb13`: `npx tsc --noEmit` PASS, `npm test --
  --runInBand` PASS (110/110 suites, 1353/1353 tests). Retried `git rm` on
  all sixteen known dead scratch/backup files in one combined attempt —
  blocked again (same general file-deletion permission gate; confirmed
  via immediate `git status`). `gh` binary now present at `/usr/bin/gh`
  (new) but `gh auth status`/`docker info` still gated; `supabase` CLI
  reconfirmed absent.
- **QA Guardian follow-up, real defect fixed:** `MemberDetailsModal.tsx`'s
  role-toggle chips ("בן משפחה"/"מנהל") behaved like a radio group but
  carried no `accessibilityRole`/`accessibilityState`, unlike the
  identical single-select-chip pattern in `DeleteUserModal.tsx`/
  `EditDoneDetailsModal.tsx` — the one secondary, lower-priority finding
  the prior cycle recorded but did not fix. Added
  `accessibilityRole="radio"` + `accessibilityState={{ selected }}` to
  both chips, mirroring the sibling pattern exactly. Added one new
  regression test file (2 tests) following this repo's established
  source-scan convention. `npx tsc --noEmit` PASS and `npm test --
  --runInBand` PASS (**111/111** suites, **1355/1355** tests) after the
  change. `git status`/diff scoped to exactly the one fixed file + one
  new test file + this `EXECUTION_STATE.md` update.

### Recent cycles (condensed — full detail in git history of this file)

- Prior cycle: found and fixed four real, first-time-discovered
  accessibility-label gaps (`ScheduleScreen.tsx`, `AddUnplannedWalkModal.tsx`,
  `UserFormModal.tsx`), each mirroring an already-correct sibling
  pattern. Added three new regression test files (6 tests). Landed as
  `f1fcb13` despite that cycle's own "genuinely blocked" commit
  self-report.
- Two cycles ago: found and fixed a real, first-time-discovered keyboard-
  avoidance gap in `DogDetailsModal.tsx` (bottom sheet with text fields
  near the bottom, unlike every sibling modal, was missing
  `KeyboardAvoidingView`). Added a 3-test regression file. Landed as
  `9180c3a` despite that cycle's own "genuinely blocked" commit
  self-report.
- Three cycles ago: reconciliation-only, no drift, no code change (HEAD
  landed at `e2c281d` — this file's own prior rewrite).
- Three cycles ago: an Android hardware-back-button (`onRequestClose`)
  sweep of all 26 `<Modal>` call sites (all correctly wired, no defect)
  plus a dog-sex/grammatical-copy check of `FamilyScreen.tsx` (the last
  screen of that class, already correct). No code change; landed as
  `b8774da`.
- Four cycles ago: continued the mascot/Reduced-Motion QA theme with a
  second, confirming sweep of all 26 `<Modal>` call sites (found nothing
  further) and traced the notification-tap→mascot-prompt routing path end
  to end (confirmed already-correct by design). No code change; landed as
  `9adde84`.
- Five cycles ago: found and fixed one real, first-time-discovered
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
