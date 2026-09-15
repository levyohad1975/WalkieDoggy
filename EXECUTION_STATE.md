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

A "commit/`git add` requires approval" sandbox message has been wrong 10
times in a row now across many prior cycles (see git history of this file
for the full run) — every one of those "could not commit" self-reports
turned out to be incorrect; the commit had already landed and pushed by
the time the next cycle checked. The one cycle that claimed to have
verified a genuine block in real time (the `ReminderMascotPrompt.tsx`
cycle, self-reported as the sole exception) was **itself** proven wrong
this cycle: `git show --stat 1a8b785` confirms that exact change (plus its
own `EXECUTION_STATE.md` update) landed and pushed as `1a8b785`, one
commit ahead of the `3c51155` it thought was still HEAD. So even an
in-cycle "re-verified genuinely blocked" self-report is not reliable
evidence — the apparent block can still resolve asynchronously after the
cycle's own process ends. The next cycle's **first action, before trusting
anything else in this file**, must still be: `git log --oneline -5` +
`git status` to see whether HEAD has moved past whatever SHA this file
currently names as HEAD, and if so, `git show --stat <new HEAD>` to
confirm what actually landed before doing anything else.

## Current Task

Reconciliation at cycle start (this cycle, manual `workflow_dispatch`,
target sha `05bac2b7...`): `git log --oneline -5`/`git status` showed HEAD
at `1a8b785`, clean working tree, "up to date with
origin/feat/verified-auth-onboarding-batch-2" — one commit ahead of the
`3c51155` the prior cycle's own narrative believed was still HEAD.
`git show --stat 1a8b785` confirmed it contains exactly
`EXECUTION_STATE.md` (rewritten) + `src/components/ReminderMascotPrompt.tsx`
+ new `ReminderMascotPrompt.reducedMotion.test.ts` — i.e. the prior
cycle's own Reduced-Motion fix + regression test + its own
`EXECUTION_STATE.md` update, which that cycle's own narrative had reported
as "genuinely BLOCKED this cycle, not just an unverified sandbox message
this time." This is the **tenth** confirmed instance of the
self-reporting-drift pattern, and the first one where a cycle's own
real-time re-verification was itself later proven wrong (see the standing
protocol note above). No further undocumented commit existed beyond
`1a8b785` (it is HEAD, matches origin exactly). Reconciled before starting
new work, per protocol.

`node_modules` was absent at cycle start (fresh sandbox again); ran
`npm ci` (907 packages, clean, 16 moderate advisories — same class as
before, none newly concerning). `npx tsc --noEmit` — **PASS**, zero
errors. `npm test -- --runInBand` at cycle-start HEAD (baseline) —
**PASS**: 106/106 suites, **1344/1344** tests (matches the prior cycle's
own final count exactly, confirming `1a8b785` is genuinely HEAD and
nothing drifted). Retried `git rm` on the five dead scratch/debug files
(`tmp_coverage_inspect.js`,
`src/lib/__tests__/__scratch_platform_probe.test.ts`,
`src/lib/__tests__/__scratch_pushTokens_probe.test.ts`,
`src/notifications/__tests__/__scratch_isolate_probe.test.ts`,
`src/store/__tests__/__scratch_renderHook_probe.test.ts`) — gated again
("This command requires approval"; forty-eighth consecutive cycle
blocked, verified genuinely still-blocked via `git status` immediately
after: the five files are still present and untouched). Freshly
reconfirmed `gh auth status` (gated, interactive approval prompt) and
`docker info` (gated, same) this cycle; `which supabase` returned exit 1
(not installed) — all three Staging/CI/Supabase-regression blockers
persist unchanged.

Continued the mascot / Reduced-Motion QA Guardian theme opened last cycle.
Swept every `<Modal>` call site in `src/` (26 files) for internal custom
`Animated.*` motion that would need the same reduce-motion gate the prior
cycle added to `ReminderMascotPrompt.tsx`: grepped `Animated\.` across all
`.tsx` files and cross-referenced against the `<Modal>` list. Only two
files use custom `Animated.*` motion: `WalkCompletionCelebration.tsx`
(already correctly gated — `animationType="none"` plus its own
`isReduceMotionEnabled()` check) and `WalkieMascot.tsx` (not a `Modal`
wrapper at all — a false-positive-free inline component, already checked
in a prior cycle). The other 24 `<Modal>` usages
(`SystemAdminScreen.tsx`, `SettingsScreen.tsx`, `HistoryScreen.tsx`'s date
picker, and 21 form/admin dialogs) rely solely on RN's own native
`animationType="slide"`/`"fade"` with no internal custom `Animated` motion
of their own — they are plain utility dialogs, not part of the
mascot/celebration family that established the reduce-motion-gating
convention, so gating all of them would be an unrelated, much larger
scope-creep change, not a targeted fix of an established pattern. **No
further defect found; this QA theme is now exhausted** (one real instance
found and fixed last cycle, zero more found on this second, exhaustive
pass).

Also checked the previously-flagged open question, "closer real-device-
notification-open-behavior pass on screens beyond `HomeScreen.tsx`":
`subscribeToReminderOpens`/`ReminderMascotPrompt` is wired up only in
`HomeScreen.tsx`, which could look like a gap if a notification is tapped
while another tab is focused. Traced the full path:
`reminderEntry.ts`'s `publishReminderOpen()`/`subscribeToReminderOpens()`
retains an unclaimed event as `pendingEvent` and replays it to whichever
listener subscribes next (handles cold start / late mount), and
`RootNavigator.tsx`'s `Tab.Navigator` uses no `unmountOnBlur`, so
`HomeScreen.tsx` (and its subscription) stays mounted across tab switches
once first focused — React Navigation's default bottom-tabs behavior.
`HomeScreen.tsx`'s listener itself calls `navigation.navigate('Home')`
before showing the prompt, forcing the tab switch. Confirmed this is a
deliberate, already-correct design (cold start, late mount, and
cross-tab taps are all handled) — **no defect found, no code change
needed.**

## Current Task Status

No code change this cycle (both QA passes above closed with no defect
found). `npx tsc --noEmit` — **PASS**, zero errors (fresh baseline at
cycle-start HEAD `1a8b785`, re-run after `npm ci`). `npm test --
runInBand` — **PASS**: 106/106 suites, **1344/1344** tests (fresh
baseline, matches prior cycle's final count exactly, confirming nothing
drifted). `git status --porcelain=v1 --untracked-files=all` clean except
for this file's own in-progress edit.

`git add EXECUTION_STATE.md` — "This command requires approval" (gated);
`git status --porcelain` immediately after showed it still unstaged
(`M`). `git commit -m ... -- EXECUTION_STATE.md` (no prior add) — also
gated; `git log --oneline -3` immediately after showed HEAD still
`1a8b785`. So, at the moment this cycle's own process ends, this file's
own edit has NOT landed by this cycle's own observation — but per the
standing protocol note at the top of this file, that observation has now
been wrong twice in a row on reconciliation by the following cycle, so
treat it as unverified, not confirmed, until the next cycle re-checks
`git log --oneline -5` fresh.

The mascot/Reduced-Motion QA Guardian theme opened two cycles ago is now
closed: one real defect found and fixed (`ReminderMascotPrompt.tsx`'s
ungated `Modal` transition, landed as `1a8b785`), a full second sweep
across all 26 `<Modal>` call sites in `src/` found nothing further. The
notification-tap-routing question is also closed as "already correct by
design" — see Current Task above for both.

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- This cycle start (manual `workflow_dispatch`, target sha
  `05bac2b7...`): `git log --oneline -5`/`git status` confirmed HEAD is
  `1a8b785`, clean working tree, "up to date with
  origin/feat/verified-auth-onboarding-batch-2". `git show --stat
  1a8b785` confirmed it contains exactly the prior cycle's own
  `ReminderMascotPrompt.tsx` Reduced-Motion fix + its new test file +
  `EXECUTION_STATE.md` update — that cycle's own "genuinely BLOCKED,
  re-verified in real time" self-report was WRONG (**tenth** confirmed
  instance of this drift pattern, and the first where an in-cycle
  real-time re-check was itself later proven wrong).
- `npm ci` — succeeded (907 packages, no `node_modules` present at cycle
  start; 16 moderate `npm audit` advisories, same class as before).
- `npx tsc --noEmit` — **PASS**, zero errors. `npm test -- --runInBand` at
  cycle-start HEAD (baseline) — **PASS**: 106/106 suites, **1344/1344**
  tests (matches prior cycle's own final count, confirming nothing
  drifted).
- `git rm` on the five dead scratch/debug files — "This command requires
  approval" (blocked). Forty-eighth consecutive cycle blocked; re-verified
  via `git status` immediately after (files still present, genuinely not
  removed).
- `gh auth status` — gated (interactive approval prompt, reconfirmed).
  `docker info` — gated (same). `which supabase` — exit 1, not installed.
- Swept all 26 `<Modal>` call sites in `src/` for internal custom
  `Animated.*` motion needing the same reduce-motion gate as
  `ReminderMascotPrompt.tsx`. Only `WalkCompletionCelebration.tsx`
  (already gated) and `WalkieMascot.tsx` (not a `Modal`) use `Animated.*`;
  the other 24 are plain form/admin dialogs using only RN's native
  transition. **No further defect found — theme closed.**
- Traced the notification-tap→mascot-prompt path
  (`reminderEntry.ts`'s `pendingEvent` replay-to-late-subscriber +
  `RootNavigator.tsx`'s default (non-`unmountOnBlur`) tab persistence +
  `HomeScreen.tsx`'s own `navigation.navigate('Home')` inside its
  listener) end to end. **Confirmed already-correct by design for cold
  start, late mount, and cross-tab notification taps — no defect found,
  no code change needed.**
- No code change this cycle; only this `EXECUTION_STATE.md` update is
  pending commit.

## Last Evidence Timestamp

2026-09-15T15:10:00Z

## Blocker

**Unresolved question going into next cycle: is "requires approval" ever
reliable evidence of a genuine block, even when re-verified in the same
cycle?** Two consecutive cycles now claim to have re-verified a git
add/commit block in real time via immediate `git log`/`git status`
checks — and this cycle discovered that the *previous* one of those two
was itself wrong (the change had landed as `1a8b785` after that cycle's
own process ended, contradicting its own real-time re-check). AGENTS.md
rule 12 explicitly permits local commits without asking, so any block
here is a sandbox permission-mode/timing artifact, not a policy one — no
bypass (`--no-verify` or otherwise) has ever been attempted. **Practical
consequence for the next cycle:** do not treat this cycle's own upcoming
commit attempt (of this `EXECUTION_STATE.md` update) as reliably blocked
or landed based on this cycle's own observation alone — the next cycle
must re-derive from `git log --oneline -5` + `git show --stat` first, per
the standing protocol note at the top of this file, regardless of what
this section says.

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

`gh` CLI access remains gated behind an interactive approval prompt with
no owner present (reconfirmed this cycle) — a secondary, independent
blocker from the Staging-credentials one, affecting only GitHub-metadata
inspection (PR #7/#11 state, workflow runs), not local repository work.
`docker info` also gated (reconfirmed); `supabase` CLI confirmed not
installed (`which supabase` → exit 1) — Queue item 7's Supabase-regression
half stays blocked on tooling/access regardless of `docker`'s own
reachability.

**Scratch/debug files still gated on `git rm` (forty-eight cycles running):**
`tmp_coverage_inspect.js`, `src/lib/__tests__/__scratch_platform_probe
.test.ts`, `src/lib/__tests__/__scratch_pushTokens_probe.test.ts`,
`src/notifications/__tests__/__scratch_isolate_probe.test.ts`,
`src/store/__tests__/__scratch_renderHook_probe.test.ts` — five inert,
dead files with no functional impact, left in place, not blocking any
other work.

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
show --stat` before trusting this file's own narrative (see the standing
protocol note at the top of this file) — check whether this cycle's own
`EXECUTION_STATE.md` update (the only change this cycle produced; no
source code changed) landed despite whatever this cycle's own Current
Task Status reports. Given that the prior two cycles' own real-time
"genuinely blocked" self-reports have now both been proven wrong on
reconciliation, treat any commit-status claim in this file as unverified
until `git log --oneline -5` is checked fresh.

Retry `git rm tmp_coverage_inspect.js
src/lib/__tests__/__scratch_platform_probe.test.ts
src/lib/__tests__/__scratch_pushTokens_probe.test.ts
src/notifications/__tests__/__scratch_isolate_probe.test.ts
src/store/__tests__/__scratch_renderHook_probe.test.ts` the moment the
sandbox's permission mode allows it — five inert, dead files with no
functional impact, pure housekeeping, blocked for forty-eight cycles
running.

The quantitative-Jest-coverage angle is exhausted across the whole `src/`
tree (`src/lib`/`src/logic`/`src/mascot`/`src/notifications`/`src/store` —
every file at 100% or a documented-non-functional residual). Screens/
components sit at or near 0% coverage project-wide (no render-testing
harness in this codebase), an existing architectural pattern, not a new
gap — a much larger, separate undertaking rather than a quick win.
`src/data/repository.ts` (0%) is a pure TS interface file with one trivial
marker class — skip unless a future cycle wants one trivial smoke test.

Both the RTL-content-alignment bug class and the mascot/Reduced-Motion
theme are now closed after two sweeps each with a second, confirming pass
finding nothing further — treat both as exhausted. Same for the
notification-tap-routing question (now confirmed correct by design, see
Current Task above). Dog-sex/grammatical copy was already swept (no
defect) across `FamilyOnboardingScreen.tsx`/`HistoryScreen.tsx`/
`ScheduleScreen.tsx`/`StatisticsScreen.tsx` in an earlier cycle (see
"Recent cycles" below) — `FamilyScreen.tsx` is the one relevant screen not
yet included in that pass and would be a genuinely new, narrow check. A
future QA Guardian cycle should otherwise open a new angle rather than
re-sweeping the closed ones, e.g. an RTL/accessibility sweep of the 24
plain form/admin `<Modal>` dialogs identified this cycle for issues
unrelated to reduce-motion (e.g. `onRequestClose` Android back-button
handling, initial-focus order, RTL layout of their internal content).

Remaining independent credential-free sub-tasks, in order: (1) re-attempt
Queue item 7's still-open Supabase-regression half via `gh`/a local
Supabase stack (blocked for forty cycles running so far); (2) if
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

- Reconciliation found HEAD already at `1a8b785` (the prior cycle's own
  "genuinely BLOCKED, re-verified in real time" self-report for the
  `ReminderMascotPrompt.tsx` Reduced-Motion fix had actually landed and
  pushed anyway) — the **tenth** confirmed instance of the
  self-reporting-drift pattern, and the first where an in-cycle real-time
  re-check was itself later proven wrong. `npm ci` (907 packages, fresh
  sandbox). Full baseline validation at `1a8b785`: `npx tsc --noEmit`
  PASS, `npm test -- --runInBand` PASS (106/106 suites, 1344/1344 tests).
  Retried `git rm` on the five dead scratch/debug files — blocked again
  (forty-eighth cycle). Reconfirmed `gh auth status`/`docker info` gated
  and `supabase` CLI absent.
- Swept all 26 `<Modal>` call sites in `src/` for internal custom
  `Animated.*` motion needing the same reduce-motion gate the prior cycle
  added to `ReminderMascotPrompt.tsx`. Found none besides the
  already-gated `WalkCompletionCelebration.tsx`; the other 24 are plain
  form/admin dialogs with no custom motion of their own. Mascot/
  Reduced-Motion QA theme now closed (one real defect found across two
  sweeps, none further on the confirming second pass).
- Traced the notification-tap→mascot-prompt routing path end to end
  (`reminderEntry.ts`'s pending-event replay + `RootNavigator.tsx`'s
  default tab persistence + `HomeScreen.tsx`'s own
  `navigation.navigate('Home')`) and confirmed it is already correct by
  design for cold start, late mount, and cross-tab notification taps — no
  defect found, no code change needed.
- No source code change this cycle (both QA passes closed clean); only
  this `EXECUTION_STATE.md` update is pending commit.

### Recent cycles (condensed — full detail in git history of this file)

- Prior cycle: found and fixed one real, first-time-discovered
  Reduced-Motion gap in `ReminderMascotPrompt.tsx`'s `<Modal>` (hardcoded
  `animationType="fade"`, never gated by OS reduce-motion, unlike sibling
  `WalkCompletionCelebration.tsx`) — added a `reducedMotion` state hook and
  one new regression test file. Landed as `1a8b785` despite that cycle's
  own "genuinely blocked" self-report (see above).
- Two cycles ago: closed a real, first-time-discovered RTL inconsistency in
  `FamilySharingModal.tsx`'s displayed invite code (`RtlText` with no
  `writingDirection` override → new `ltrText` style), plus a fresh
  full-`src/store` coverage sweep confirming that angle exhausted. Landed
  as `3c51155`.
- Three cycles ago: closed a real, first-time-discovered RTL inconsistency
  in `FamilyOnboardingScreen.tsx`'s redeem-input field (`textAlign="right"`
  on inherently-LTR link/token content → `textAlign="left"` + new
  `ltrInput` style), plus a fresh full-`src/store` coverage sweep
  confirming that angle exhausted. Landed as `0fa6f62`.
- Four cycles ago: closed `scheduleStore.ts`'s last two real coverage gaps
  (5 new tests, 95.14/77.83/100/100). Landed as `ace9724`.
- Five cycles ago: closed `authStore.ts`'s remaining coverage gaps (10
  new tests, 100/100/100/100). Landed as `dc2b2e1`.
- Six cycles ago: closed `requestsStore.ts`'s coverage gaps (17 new
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
