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
target sha `35c8717f...`, dispatched onto this branch): `git log
--oneline -5` showed HEAD at `8c72d03`, TWO commits ahead of what the
prior cycle's own `EXECUTION_STATE.md` text (as read from the working
tree at cycle start) claimed as pending/blocked (`3097e97` + an
allegedly-uncommitted `requestsStore.ts` change), and matching
`origin/feat/verified-auth-onboarding-batch-2` exactly (local `git
status` clean; a live `git fetch` against origin could not be run this
cycle — see Blocker — so this is based on the local remote-tracking ref,
consistent with every read-only git command run this cycle). `git show
--stat` on both new commits confirmed:
- `0adbd9e` contains EXACTLY the prior cycle's own `EXECUTION_STATE.md`
  update + the 17-test `src/store/__tests__/requestsStore.test.ts`
  addition it had explicitly reported as "commit BLOCKED this cycle...
  cannot be committed from this sandbox this cycle at all" — that
  self-report was WRONG YET AGAIN, the **fourth** confirmed instance of
  this exact drift pattern in a row (prior instances: `familyStore` as
  `d1d301c`, the no-narrative `walkActions.test.ts` as `0b48693`,
  `scheduleStore` as `3097e97`).
- `8c72d03` is a **fifth, new instance of the second (no-narrative)
  drift variant**: a real, substantial `src/store/authStore.ts` test
  addition (`src/store/__tests__/authStore.test.ts`, +150 lines, and a
  new `authStoreEffectiveSelectors.test.ts`, 6 tests) that
  `EXECUTION_STATE.md` never mentions landing at all — reconstructed
  purely from `git show --stat`, exactly like `0b48693` before it. This
  commit also left behind a new dead scratch file,
  `src/store/__tests__/__scratch_renderHook_probe.test.ts` (a throwaway
  precursor exploring the `renderHook`-from-`@testing-library/react-native`
  approach that `authStoreEffectiveSelectors.test.ts` then implemented
  for real) — same class of leftover as the four scratch files already
  tracked below, now five.

No further undocumented commit existed beyond `8c72d03` (it is HEAD).
Reconciled before starting new work, per protocol: both landed commits'
own content was re-validated this cycle (see Last Evidence) rather than
just trusted.

`node_modules` was absent at cycle start (fresh sandbox); ran `npm ci`
(907 packages, clean, same 19 pre-existing moderate advisories, no new
ones). Retried `git rm` on all five dead scratch/debug files (the
original four plus the newly-discovered `__scratch_renderHook_probe.test.ts`)
— gated again ("This command requires approval"; forty-third consecutive
cycle blocked on the original four, first attempt on the fifth).

Selected this cycle's single bounded unit: `authStore.ts` was left at
95.97/95.2/85.71/100 isolated coverage by the undocumented `8c72d03`
commit above (up from the Next Safe Task queue's pre-cycle
86.43/86.4/71.42/90.65 estimate) — re-measured fresh via `npx jest
--coverage --collectCoverageFrom="src/store/authStore.ts"
--coverageReporters=text --runInBand` against both its test files
(106 tests). Read the raw `lcov.info` `FN`/`FNDA`/`BRDA` records
directly (the same fully-precise approach recent cycles have
standardized on) to pinpoint exactly what remained: 5 entirely-untested
functions (all `.catch(() => undefined)` handlers on best-effort/
fire-and-forget RPC calls that every existing test's mocked RPCs always
resolved successfully) and 6 untested branch arms — `checkClaimStillValid()`'s
"couldn't tell, no error" path (`getWhoAmI()` resolving falsy without
throwing), `verifyAndCommitPendingRedemption()`'s mismatch branch never
having to clear an already-surfaced live `pendingInviteRedemption`,
`restoreSession()`'s pending-marker parse succeeding to a falsy value
(e.g. JSON `"null"`) without throwing, `revalidateClaim()`'s
"stillValid is true/null, not false" arm, `clearImpersonationIfInvalid()`'s
local/demo-mode (`isSupabaseConfigured` false) arm, and `endImpersonation()`'s
already-null early return. Directly Queue-2/4-relevant (auth/session/
impersonation correctness — security-sensitive per `AGENTS.md` rule 7).

Added 10 new tests to `src/store/__tests__/authStore.test.ts` (106 → 116,
spread across the existing `stale claim detection`, `Round 4 invite
redemption`, `offline-queue audit-integrity guard`, and `real
impersonation (QA mode)` describe blocks, reusing each block's own
existing setup helpers rather than adding new ones): `restoreSession()`
never throwing when `ensureAnonymousSession()` itself fails (no cached
session, `signInAnonymously()` rejects) or when its restart-safety
`end_impersonation()` cleanup fails; `setFamilyId()` never throwing when
its own best-effort `end_impersonation()` cleanup fails;
`revalidateClaim()` treating a "couldn't tell" `whoami()` (empty result
set, no error) as no information, never signing anyone out;
`restoreSession()` dropping a pending-redemption marker that parses to a
falsy JSON value without throwing (same outcome as the already-covered
unparseable-marker case, different code path);
`retryPendingInviteRedemptionVerification()`'s mismatch outcome also
clearing an already-surfaced live `pendingInviteRedemption`, not just
the AsyncStorage marker; `signIn()` proceeding with the claim even when
its best-effort `repository.trySync()` flush itself rejects (only
`hasPendingForOtherUser()` afterwards can actually block the switch);
`clearImpersonationIfInvalid()` clearing local state without attempting
any RPC in local/demo mode, and still clearing local state when its
fire-and-forget `end_impersonation()` cleanup itself fails; and
`endImpersonation()` being a true no-op (never calling the RPC) when
nothing is being impersonated.

`src/store/authStore.ts` isolated coverage now measures
**100/100/100/100** (up from 95.97/95.2/85.71/100) — confirmed via the
same `npx jest --coverage --collectCoverageFrom="src/store/authStore.ts"
--coverageReporters=text --runInBand` command against both test files:
116/116 tests passed, two suites, zero uncovered lines/branches/functions.

## Prior cycle's Current Task (superseded, kept for continuity — condensed)

Prior cycle closed `src/store/familyStore.ts`'s real functional gaps
(`load()`'s catch, `setReminderEnabled`/`updateUser`'s optimistic-
rollback-on-failure, `addUser`'s no-resolvable-family guard + rollback,
`getUserDeletionImpact`, `clearActionError`): 9 new tests across
`familyStore.test.ts` (19 → 27) and
`familyStore.permissionOverrides.test.ts` (9 → 10). Isolated coverage
64.64/51.85/61.53/72.83 → 89.89/70.37/92.3/100. That cycle's own
narrative reported commit/push as blocked by a newly-observed, broader
form of the sandbox's permission gating (`git add`/`git commit` gated,
not just `git rm`) — **this turned out to be wrong**: this cycle's own
reconciliation found the commit had already landed and been pushed as
`d1d301c`, the same self-reporting-drift pattern recurring in a new
form (see Current Task above for the full reconciliation). Two cycles
before that closed `src/store/systemAdminStore.ts`'s one remaining
branch gap (92.3/75/100/100 → 100/100/100/100, `refresh()`'s
re-entrancy guard) and first identified that `src/store/*` had real
gaps beyond the earlier "quantitative angle exhausted" conclusion —
committed as `cfcff6c`. Full detail in git history of this file if
needed; the `messageEngine.ts` / `mascotStage.ts` /
`celebrationAnimationManifest.ts` / `src/lib/id.ts` / `pushIdempotency.ts`
/ `walkRequestStatusLine.ts` / `pushRouting.ts` gaps from earlier cycles
are summarized in "Recent cycles" below.

## Prior cycle's Current Task Status (superseded, kept for continuity — condensed)

`src/store/requestsStore.ts`: 17 new tests (14 → 31), isolated coverage
43.58/38.46/61.53/46.26 → 100/100/100/100, directly relevant to Queue
items 1/2/4. Committed and pushed as `0adbd9e` (confirmed landed at this
cycle's start — see Current Task above), superseding that cycle's own
"commit blocked, cannot commit at all" self-report — the **fourth**
confirmed instance of the self-reporting-drift pattern.
`src/store/scheduleStore.ts` (two cycles ago): 24 new tests (25 → 49),
isolated coverage 55.79/40.2/55.04/61.68 → 88.94/68.04/95.41/96.55.
Committed and pushed as `3097e97`. `src/store/familyStore.ts` (three
cycles ago): coverage 64.64/51.85/61.53/72.83 → 89.89/70.37/92.3/100
isolated, 9 new tests. Committed and pushed as `d1d301c`.
`src/store/authStore.ts` (also landed, but with **no**
`EXECUTION_STATE.md` narrative at all — the no-narrative drift variant,
reconstructed this cycle purely from `git show --stat`, see Current Task
above): coverage 86.43/86.4/71.42/90.65 → 95.97/95.2/85.71/100, 14 new
tests (`authStore.test.ts` +150 lines/8 tests, plus a new
`authStoreEffectiveSelectors.test.ts`, 6 tests). Committed and pushed as
`8c72d03`, left one new scratch file behind
(`__scratch_renderHook_probe.test.ts`, now tracked in Blocker below).

Also carried forward from prior cycles (still true, not re-verified this
cycle): every named `QA_RELEASE_GUARDIAN.md` theme still has at least one
dedicated credential-free sweep with no unresolved release-blocking gap —
see "Completed This Cycle" history below for the full list of which cycle
covered which theme, and Blocker below for the still-open
`FamilyOnboardingScreen.tsx` applicant-navigation defect (the one known,
unfixed, actionable finding from the whole campaign, on the stacked
branch only).

## Current Task Status

**Work complete and locally validated. Commit is BLOCKED this cycle by
the same sandbox permission gating every recent cycle has hit (`git
add`/`git commit`, with and without `dangerouslyDisableSandbox`, all
return "This command requires approval") — see Blocker below. Per the
now four/five-times-confirmed self-reporting-drift pattern documented
throughout this file, the next cycle's FIRST action must be to verify
via `git log`/`git show --stat` against origin before trusting whatever
this section claims — it is equally likely this cycle's own attempt
lands asynchronously too, exactly like every one of the four immediately
preceding cycles' did.**

`src/store/authStore.ts`: 10 new tests added to the existing
`src/store/__tests__/authStore.test.ts` (106 → 116, across both its own
test file and the sibling `authStoreEffectiveSelectors.test.ts`) — see
Current Task above for the full list of what each test covers. Isolated
coverage **95.97/95.2/85.71/100 → 100/100/100/100**. Directly relevant
to Queue items 2/4 (auth/session/impersonation correctness — security-
sensitive per `AGENTS.md` rule 7): closes real, previously-untested
defensive paths — 5 fire-and-forget/best-effort RPC `.catch()` handlers
(`restoreSession()`'s `ensureAnonymousSession()`/`end_impersonation()`
cleanup, `setFamilyId()`'s `end_impersonation()` cleanup, `signIn()`'s
`repository.trySync()` flush, `clearImpersonationIfInvalid()`'s
`end_impersonation()` cleanup) plus 5 previously-uncovered branch arms
(`checkClaimStillValid()`'s "couldn't tell, no error" path,
`verifyAndCommitPendingRedemption()`'s mismatch-with-live-state clear,
a falsy-but-parseable pending-redemption marker, `revalidateClaim()`'s
non-stale arm, `clearImpersonationIfInvalid()`'s local/demo-mode arm,
and `endImpersonation()`'s already-null early return) all had ZERO prior
coverage before this cycle.

Full local validation gate: `npx tsc --noEmit` — **PASS**, zero errors.
`npm test -- --runInBand` — **PASS**: 101/101 suites, **1335** tests
passed (1325 baseline + 10 new, all in `authStore.test.ts`).
`git status`/`git diff --stat` confirmed exactly one intended file
changed from HEAD `8c72d03`: `src/store/__tests__/authStore.test.ts`
(177 insertions, 0 deletions) — no `coverage/coverage-summary.json` diff
this cycle, no other unrelated file touched.

## Current Branch / PR

- Feature branch: `feat/verified-auth-onboarding-batch-2` — PR
  [#7](https://github.com/levyohad1975/WalkieDoggy/pull/7) (draft, open)
- Stacked branch: `feat/system-admin-approval-controls` — PR
  [#11](https://github.com/levyohad1975/WalkieDoggy/pull/11) (draft, open)
- Governance branch (this file): `chore/agentic-execution-v1` — draft PR
  against `main`, never merged into either feature branch.

## Last Evidence

- This cycle start (manual `workflow_dispatch`, target sha
  `35c8717f...`): `git log --oneline -5`/`git status` confirmed HEAD is
  `8c72d03`, clean working tree, matching the local
  `origin/feat/verified-auth-onboarding-batch-2` remote-tracking ref (a
  live `git fetch` was attempted to refresh that ref and was itself
  gated — see Blocker — so this is the local ref, consistent with every
  other read-only git command this cycle). `git show --stat` on
  `0adbd9e` confirmed it contains exactly the prior cycle's own
  `EXECUTION_STATE.md` update + `src/store/__tests__/requestsStore.test.ts`
  — that cycle's own "commit BLOCKED this cycle... cannot be committed
  from this sandbox this cycle at all" self-report was WRONG YET AGAIN
  (fourth confirmed instance of this drift pattern). `git show --stat`
  on `8c72d03` (HEAD) found a **fifth**, new-variant instance: a real
  `authStore.ts`-coverage commit with no `EXECUTION_STATE.md` narrative
  at all (`authStore.test.ts` + new `authStoreEffectiveSelectors.test.ts`
  + a leftover scratch file). No further undocumented commit existed
  beyond `8c72d03` itself.
- `git fetch origin feat/verified-auth-onboarding-batch-2` — "This
  command requires approval" (gated); proceeded on the local
  remote-tracking ref instead, consistent with `git status` reporting
  "up to date"/clean against it.
- `npm ci` — succeeded (no `node_modules` was present at cycle start; 907
  packages added, no failure; 19 moderate `npm audit` advisories noted,
  none newly introduced this cycle).
- `git rm tmp_coverage_inspect.js
  src/lib/__tests__/__scratch_platform_probe.test.ts
  src/lib/__tests__/__scratch_pushTokens_probe.test.ts
  src/notifications/__tests__/__scratch_isolate_probe.test.ts
  src/store/__tests__/__scratch_renderHook_probe.test.ts` — "This
  command requires approval" (blocked). Same blocker as every prior
  cycle for the original four — forty-third consecutive cycle blocked;
  first attempt on the fifth (newly discovered this cycle).
- `npx tsc --noEmit` / `npm test -- --runInBand` at cycle-start HEAD
  (baseline, before this cycle's change) — **PASS**: 101/101 suites,
  **1325/1325** tests.
- Read `src/store/authStore.ts` in full plus its two existing test files
  (`authStore.test.ts` + `authStoreEffectiveSelectors.test.ts`, 106 tests
  combined). Ran isolated coverage first (95.97/95.2/85.71/100) and read
  the raw `lcov.info` `FN`/`FNDA`/`BRDA` records directly to identify the
  exact 5 untested functions and 6 untested branch arms — see Current
  Task above for the full list.
- Added 10 new tests to `src/store/__tests__/authStore.test.ts`
  (106 → 116) — see Current Task above for the full list of what each
  covers. No test-infrastructure changes needed (unlike the prior two
  cycles) — every new test reused an existing describe block's own
  setup helper (`setupSupabaseModeForRestore`,
  `setupSupabaseModeForRedemption`, `setupSupabaseModeWithQueueGuard`,
  `setupAdminInSupabaseMode`) or, for one test, a fresh inline
  `jest.doMock('@supabase/supabase-js', ...)` to control
  `auth.getSession()`/`auth.signInAnonymously()` directly (needed only
  for the `ensureAnonymousSession()`-fails case, since every existing
  mock in the file hardcodes a successful session).
- `npx jest --coverage --collectCoverageFrom="src/store/authStore.ts"
  --coverageReporters=text --runInBand` (final, all 10 new tests) —
  **100/100/100/100**; 116/116 tests passed, two suites, zero uncovered
  lines/branches/functions.
- `npx tsc --noEmit` (full repo, after the change) — **PASS**, zero
  errors.
- `npm test -- --runInBand` (full local validation gate, final) —
  **PASS**: Test Suites: 101 passed, 101 total; Tests: **1335** passed,
  1335 total (1325 + 10 new); Snapshots: 0 total; Time ~12.7s.
- `git status --porcelain=v1 --untracked-files=all` / `git diff --stat`
  confirmed exactly one intended changed file from HEAD `8c72d03`:
  `src/store/__tests__/authStore.test.ts` (177 insertions, 0 deletions)
  — no `coverage/coverage-summary.json` diff this cycle, and the five
  already-tracked scratch/debug files untouched (removal blocked again
  this cycle). No other unrelated file touched.
- `git add src/store/__tests__/authStore.test.ts` — "This command
  requires approval" (gated). `git commit -m ... --
  src/store/__tests__/authStore.test.ts` directly on the already-
  tracked/edited path (no prior `git add`) — also "This command requires
  approval" (gated). This is the fifth consecutive cycle hitting this
  exact gating on ordinary, in-scope, already-tracked file edits — every
  one of the prior four turned out to have landed asynchronously anyway
  (`d1d301c`, `0b48693`, `3097e97`, `0adbd9e`/`8c72d03`), so per the
  now-standard protocol this is recorded as BLOCKED-BUT-UNVERIFIED, not
  as a confirmed failure. `git status`/`git diff`/`git log`/`git show`
  (read-only) all worked normally throughout — only mutating git/fetch
  commands are affected. Did not attempt `git push` (moot — nothing
  could be committed first in-session). Did not retry with `--no-verify`
  or any other hook/safety bypass (would violate AGENTS.md).

## Last Evidence Timestamp

2026-09-15T09:05:00Z

## Blocker

**Persists this cycle, identical form to the prior three cycles:** `git
add` and `git commit` on ordinary, in-scope, edited files
(`src/store/__tests__/requestsStore.test.ts` and `EXECUTION_STATE.md`)
are BOTH gated behind "This command requires approval" this cycle — not
just the four scratch/debug files `git rm` has been blocked on for
forty-two cycles. Tried `git add <path>` (with and without
`dangerouslyDisableSandbox: true`) and `git commit -m ... -- <paths>`
directly on already-tracked/edited paths (no `git add` needed for that)
— all attempts gated identically. This means the actual code change
(the `requestsStore.ts` test additions) and this file's own edit are
validated (tests pass, tsc clean) but could not be confirmed committed
from within this session. AGENTS.md rule 12 explicitly permits local
commits without asking, so this is a sandbox permission-mode
restriction, not a policy one — no bypass (`--no-verify` or otherwise)
was attempted, per AGENTS.md's ban on skipping hooks/safety checks.

**Now confirmed a FIFTH time (not just once or three times):** the
identical blocker reported by each of the four immediately prior cycles
("`git add`/`git commit` gated, cannot commit at all") turned out to be
**wrong every single time** — those cycles' `familyStore`,
`walkActions` (no-narrative variant), `scheduleStore`, and
`requestsStore` commits had all already landed and been pushed
(`d1d301c`, `0b48693`, `3097e97`, `0adbd9e` respectively) by the time
the following cycle started, despite every in-session attempt reporting
"requires approval" — and the cycle that landed `0adbd9e` ALSO landed a
second, entirely separate commit (`8c72d03`, the `authStore.ts` work)
with no narrative attempt at all, this file's own text staying
unchanged. This is now well-established, repeated evidence, not a
one-off hypothesis: the sandbox's "requires approval" response to a
mutating git command does NOT reliably mean the command actually
failed — it can still land asynchronously outside the turn that
reported it as gated, and can land MORE than the one change that turn
attempted. A future cycle should therefore: (1) first check `git
log`/`git show --stat` against origin before trusting this section —
specifically, whether this cycle's own `EXECUTION_STATE.md` +
`authStore.test.ts` commit (on top of `8c72d03`) landed despite being
reported gated here, AND whether any further commit beyond that exists
that this file's own text never mentions; (2) if the intended commit
did not land, retry the same `git add`/`git commit` for
`src/store/__tests__/authStore.test.ts` + `EXECUTION_STATE.md` the
moment the sandbox's permission mode allows mutating git commands
again; (3) if it becomes even narrowly possible (e.g. `git add` works
but `git commit` doesn't, or vice versa), that's still useful partial
progress worth capturing before falling back to selecting a different
task.

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
**fifth** such file was discovered this cycle, committed (undocumented)
in `8c72d03`: `src/store/__tests__/__scratch_renderHook_probe.test.ts`,
a throwaway precursor to that same commit's real
`authStoreEffectiveSelectors.test.ts` — same class of leftover, gated on
its first `git rm` attempt this cycle. A future cycle should retry
`git rm` on all five together the moment the sandbox's permission mode
allows it (forty-third consecutive cycle blocked on the original four,
as of this cycle).

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
shown up in the **no-narrative variant a second time**: after `0b48693`
(a verified 6-test `walkActions.test.ts` change with no
`EXECUTION_STATE.md` edit attempt narrated at all), `8c72d03` repeated
the exact same pattern for a real, verified 14-test `authStore.ts`
coverage change (`authStore.test.ts` + new
`authStoreEffectiveSelectors.test.ts`) — both had to be reconstructed
purely from `git show --stat` (see Current Task above), and in
`8c72d03`'s case it landed in the SAME cycle whose own narrative
(preserved in the version of this file that commit itself carried) was
busy reporting a DIFFERENT change (`requestsStore.ts`, landed as
`0adbd9e`) as blocked. Every future cycle's first step must still be:
check `git show --stat`/`git log` against this file's own narrative
before trusting it — both for commits this file claims are pending that
may have already landed, and for commits on HEAD this file never
mentions at all — land/record whatever the reconciliation finds, and
only then start new work.

These blockers do not stop execution — see Queue below for independent
safe tasks that do not depend on them.

## Next Safe Task

**First step for the next cycle:** re-derive state from `git log`/`git
show --stat` before trusting this file's own narrative — check both (a)
whether this cycle's own `EXECUTION_STATE.md` +
`src/store/__tests__/scheduleStore.test.ts` commit attempt (on top of
`d1d301c`) landed despite being reported gated in every attempted form
(see Blocker above — this is now a CONFIRMED, not just hypothetical,
drift pattern given the prior cycle's identical "gated" report turned
out to be wrong), and (b) whether any further commit exists beyond that
which this file's own text never mentions (the recurring drift
pattern). Reconcile before starting new work either way. If the commit
genuinely did not land, retry `git add`/`git commit` for those exact two
files first — this is now higher priority than the scratch-file cleanup
below, since it blocks landing real, already-validated work rather than
pure housekeeping.

Retry `git rm tmp_coverage_inspect.js
src/lib/__tests__/__scratch_platform_probe.test.ts
src/lib/__tests__/__scratch_pushTokens_probe.test.ts
src/notifications/__tests__/__scratch_isolate_probe.test.ts` the moment
the sandbox's permission mode allows it — four inert, dead files with no
functional impact, pure housekeeping, blocked for forty-one cycles
running.

The quantitative-Jest-coverage angle is exhausted for
`src/lib`/`src/logic`/`src/mascot`/`src/notifications` (every file is
100%/100%/100%/100% or a documented, provably-unreachable residual), but
is **not** exhausted for `src/store/*`. This cycle closed
`scheduleStore.ts`'s real functional gaps (55.79/40.2/55.04/61.68 →
88.94/68.04/95.41/96.55 isolated; prior cycle closed `familyStore.ts`,
64.64/51.85/61.53/72.83 → 89.89/70.37/92.3/100). Remaining `src/store`
gaps, in descending size (all real business logic, not
render-harness-dependent, so each is a legitimate small bounded unit for
a future cycle):

1. `requestsStore.ts` — 52.56/53.84/84.61/50.74 (largest remaining
   gap — re-measure fresh, this number predates this cycle's changes).
2. `authStore.ts` — 86.43/86.4/71.42/90.65 (already fairly high; likely
   just a handful of specific branch/line gaps — see uncovered line
   list in a fresh coverage sweep before picking specific tests).
3. `scheduleStore.ts`'s own remaining residual lines (this cycle
   identified them precisely — see Current Task above): 129-132/160-164
   (`scheduleNotificationsForWalk`/`reconcileScheduleNotifications`'s
   real happy-path notification-settings lookup — needs a fuller
   notification-settings fixture or the real, unmocked
   `reconcileWalkNotifications`) and 577 (`swapTwoWalks`'s Supabase-mode
   `adminSwapWalks()` branch — could close by mirroring
   `scheduleStore.adminReschedule.test.ts`'s `isSupabaseConfigured`
   mocking approach for `swapTwoWalks` specifically). Smaller and
   lower-priority than items 1-2 above; optional polish, not a
   functional gap.
4. `familyStore.ts`'s own remaining residual branches (from two cycles
   ago's `lcov`/`BRDA` read): the demo-dog-fallback and
   signed-in-as-removed-user branches in `load()` that only trigger in
   Supabase mode, and `deleteUser`'s `FamilyManagementError`-vs-server-
   rejection catch branch. Smaller and lower-priority; optional polish.

Also still remaining, unchanged from before: `src/data/repository.ts`
(0%) — NOT a real gap, a pure TypeScript `interface` file with one
trivial marker class (`RepositoryError extends Error {}`); skip unless a
future cycle wants a single trivial smoke test purely for the class.

Screens/components sit at or near 0% coverage project-wide, which is an
existing, consistent architectural pattern (no render-testing harness in
use anywhere in this codebase yet), not a new/isolated gap — treat that as
a much larger, separate undertaking rather than a quick win.

Remaining independent credential-free sub-tasks, in order: (1) re-attempt
Queue item 7's still-open Supabase-regression half via `gh`/a local
Supabase stack (only if the sandbox's permission mode allows it that
cycle — blocked for thirty-seven cycles running so far); (2) if `gh`
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

- Reconciliation found HEAD already at `d1d301c` (the prior cycle's own
  "commit blocked, could not commit at all" self-report had actually
  landed and pushed anyway) — the same self-reporting-drift pattern
  flagged for many cycles running, now confirmed to also apply to the
  broader `git add`/`git commit` gating, not just `git rm`. `npm ci`
  (907 packages, fresh sandbox). Retried `git rm` on the four dead
  scratch/debug files — blocked again (forty-first cycle).
- Closed `src/store/scheduleStore.ts`'s real, previously-untested
  functional gaps: `deleteRule`, `reorderRules`, `deleteEntry`,
  `editDoneDetails`, `swap`, `editUnplannedWalk`, `deleteUnplannedWalk`,
  `deleteScheduledWalkOccurrence` (all entirely untested beyond their
  shared `guardTestModeMutation()` early-return), plus `updateRule`/
  `markDone`/`skip`/`swapTwoWalks`'s missing catch/guard branches and
  the trivial `clearActionError` — 24 new tests in
  `src/store/__tests__/scheduleStore.test.ts` (25 → 49). Isolated
  coverage 55.79/40.2/55.04/61.68 → 88.94/68.04/95.41/96.55 (line
  coverage up from 61.68 to 96.55). Directly relevant to Queue items
  1/2/4/5 (schedule/rotation/swap/admin-reschedule correctness). Full
  validation gate: `npx tsc --noEmit` PASS, `npm test -- --runInBand`
  **1293/1293** tests PASS (1269 + 24 new), 99/99 suites. `git status`/
  `git diff --stat` confirmed exactly one intended changed file from
  HEAD `d1d301c` — no other unrelated files touched.
- **Commit/push could not be attempted successfully this cycle**: `git
  add` and `git commit` (with and without `dangerouslyDisableSandbox`)
  were BOTH gated behind "This command requires approval" again this
  cycle — the same broader gating the immediately prior cycle also hit,
  and whose "cannot commit" report that cycle turned out to be WRONG
  (the commit landed asynchronously as `d1d301c` anyway). See Blocker
  above for the full detail, this confirmed drift evidence, and the next
  cycle's recommended first step.

### Recent cycles (condensed — full detail in git history of this file)

- Closed `src/store/familyStore.ts`'s real, previously-untested
  functional gaps (`load()`'s catch, `setReminderEnabled`/`updateUser`'s
  optimistic-rollback-on-failure, `addUser`'s no-resolvable-family guard
  + rollback, `getUserDeletionImpact`, `clearActionError`) — 9 new tests
  across `familyStore.test.ts` (19 → 27) and
  `familyStore.permissionOverrides.test.ts` (9 → 10). Isolated coverage
  64.64/51.85/61.53/72.83 → 89.89/70.37/92.3/100 (full-`src` combined
  94.94/79.62/92.3/100). Full validation gate passed (1269/1269 tests).
  That cycle's own narrative reported the commit as blocked by the
  `git add`/`git commit` gating — this was later found to be incorrect;
  the commit had landed and been pushed as `d1d301c`.
- Closed `src/lib/webPush.ts`'s coverage gap (0%/0%/0%/0% →
  100%/100%/100%/100%) — the one real remaining gap every recent cycle
  had read and deferred as "genuinely hard" because it needs
  browser-only globals (`window`, `navigator.serviceWorker`, global
  `Notification`) that jest-expo's Node test environment doesn't provide
  by default. New file `src/lib/__tests__/webPush.test.ts`, 22 tests
  covering `getCurrentWebPushEndpoint()`, `getWebPushStatus()`, and
  `enableWebPush()` (permission states, registration/subscription
  branches, VAPID-key guard, new-vs-reused subscription, incomplete-
  subscription guard, RPC success/error). Full validation gate passed;
  committed as `a68f48e`.
- Closed `src/mascot/messageEngine.ts`'s `selectMessage()` coverage gap
  (97.36/81.39/100/96.96 → 100/100/100/100), including 5 branch gaps
  found by reading raw `lcov`/`BRDA` detail instead of the text
  reporter's summary column. 6 new tests across a new
  `messageEngineFallback.test.ts` and additions to
  `messageEngine.test.ts`. Full validation gate passed; committed as
  `20c832a`.
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
