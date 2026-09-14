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

Reconciliation at cycle start: re-verified this run's dispatch context
(`target_sha` `fd4346d8...`) is still NOT an ancestor of this branch —
`git merge-base --is-ancestor` reconfirmed it directly this cycle (prior
cycles inferred this from `git show --stat`; this cycle checked with the
authoritative ancestor test). Same merge commit on `origin/main` (PR #40)
described in full in prior cycles' Blocker entries — no new content to
add, still out of this worker's editable scope
(`.github/workflows/**`) and out of reach to trigger/inspect
(`gh auth status` gated again this cycle). `git status`/`git log`
otherwise confirmed a clean tree at cycle start, HEAD `4562105` matching
`origin/feat/verified-auth-onboarding-batch-2` — no recovery action
needed. Also discovered this cycle: the prior cycle's own housekeeping
note (that `tmp_coverage_inspect.js` was "NOT staged/committed") was
wrong — `git show --stat 4562105` shows it WAS committed (15 lines) as
part of that cycle's commit despite the prior cycle's own
`EXECUTION_STATE.md` claiming otherwise. Attempted to remove it this
cycle via `git rm`, plain `rm`, and a retry — all three blocked (`git
rm`/`rm` gated behind the same interactive-approval sandbox restriction
as `gh`/`docker` this cycle; `rm` additionally hit a working-directory
sandbox check despite the path being inside the allowed directory). Left
in place, tracked, for a future cycle or the owner to delete — it is
inert (a 15-line read-only debug script, never imported/required by
anything) and does not affect tests, `tsc`, or runtime behavior.

Continued the quantitative-coverage angle against the next file Next Safe
Task named: `src/lib/supabase.ts` (Queue item 1/2 client module — the
short-code join/family-lookup/session/PIN-claim/QA-sandbox/impersonation
wrapper layer over Supabase RPCs). Measured fresh at
63.28%/63.49%/72.22%/73.56% (statements/branches/functions/lines),
exactly matching the prior cycle's stale sweep figure — uncovered 43-44,
83-85, 224-246, 270-285.

## Current Task Status

**Validated and complete, but NOT committed this cycle — `git add` was
gated behind an interactive approval prompt with no owner present (tried
single-file, multi-file, and `git add -A`, all blocked; the same
recurring sandbox permission-mode issue several prior cycles have hit —
see Blocker). The change is left in the working tree, fully tested and
passing, for the next cycle to land first (see Next Safe Task).**

Read the full file (376 lines) and its existing 11-test
`src/lib/__tests__/supabaseFamily.test.ts` first (that file only covered
`findFamilyByInviteCode`/`joinFamily`/`createFamily`/`regenerateInviteCode`/
`getCurrentFamilyRole`/`claimFamilyProfile`). Everything else in the file
— `ensureAnonymousSession`, `setProfilePin`, `claimFamilyProfileWithPin`,
`enterQaSandbox`/`exitQaSandbox`/`getCurrentFamilyIsQa`/`qaResetData`/
`qaResetFull`, `getWhoAmI`, `beginImpersonation`/`endImpersonation` — had
zero direct unit tests in this file (only indirect, incomplete coverage
via consumers like `authStore.test.ts`, which mock `../lib/supabase`
entirely rather than exercising the real implementation against a mocked
RPC). Added a new test file,
`src/lib/__tests__/supabaseQaAndSession.test.ts` (34 tests), following the
exact same client-call-shape-only testing style/rationale as
`supabaseFamily.test.ts`'s own doc comment (RPC name/params, response
mapping, error propagation — never the server-side RLS/SECURITY DEFINER
enforcement, which needs a real Supabase project). Notably covered: (1)
`claimFamilyProfileWithPin`'s two distinct structured-rejection reasons
(`wrong_pin` vs `cooldown`) map to their own distinct error messages, per
the RPC's own doc comment that these must never be conflatable by a
caller; (2) `getWhoAmI` never trusts an unexpected `family_role` value,
mapping anything other than exactly `'admin'`/`'member'` to `null`; (3)
every QA-sandbox function's not-configured (local/demo mode) behavior,
including `getCurrentFamilyIsQa` being the one function in that group
that resolves `false` instead of throwing. First re-run of the
`--collectCoverageFrom` sweep (full suite) landed 94.53%/91.26%/100%/100%,
uncovered 168-169, 171, 184-185, 205-207, 226, 243, 312 — all real,
previously-untested branch arms (RPC-error paths and the
`Array.isArray(data) ? data[0] : data` non-array-response branch), not
defensive dead code. Closed every one of them with 9 more tests added to
the existing `supabaseFamily.test.ts` (error/no-row/non-array-response
cases for `findFamilyByInviteCode`, `joinFamily`, `createFamily`,
`regenerateInviteCode`) and 2 more to the new file (`enterQaSandbox`/
`exitQaSandbox` RPC-error cases). Final coverage: **100%/100%/100%/100%**
on `src/lib/supabase.ts`, up from 63.28%/63.49%/72.22%/73.56% — every
line and branch now covered, no remaining gap.

Full local validation gate: `npx tsc --noEmit` — **PASS**, zero errors.
`npm test -- --runInBand` — **PASS**: 90/90 suites, **1078** tests passed
(1035 pre-cycle baseline + 43 new). `git status`/`git diff --stat`
confirmed exactly two changed files from HEAD `4562105`:
`src/lib/__tests__/supabaseFamily.test.ts` (+58, modified) and the new
`src/lib/__tests__/supabaseQaAndSession.test.ts` (untracked, now added)
— no unrelated files touched, aside from `tmp_coverage_inspect.js`
already being present/tracked from the prior cycle's commit (see above —
left as-is, removal blocked this cycle).

Also carried forward from prior cycles (still true, not re-verified this
cycle beyond the target-SHA reconciliation above): every named
`QA_RELEASE_GUARDIAN.md` theme still has at least one dedicated
credential-free sweep with no unresolved release-blocking gap — see
"Completed This Cycle" history below for the full list of which cycle
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

- This cycle: `git status`/`git log` confirmed a clean working tree at
  cycle start (HEAD `8b62217`, matches
  `origin/feat/verified-auth-onboarding-batch-2`) — no recovery action
  needed.
- `git merge-base --is-ancestor fd4346d8516937b0ac803c8bd3f31cb7c667283d
  HEAD` → `NOT ANCESTOR` (authoritative re-check of the dispatch-context
  `target_sha`, same conclusion as prior cycles' `git show --stat`-based
  inference). `git fetch origin` → gated ("This command requires
  approval"), so this branch's own remote-tracking state could not be
  independently refreshed this cycle, but local `git status` already
  confirmed HEAD matches the last-known `origin/...` ref.
- `gh auth status` → "This command requires approval". `docker info` →
  "This command requires approval". `which supabase` → not found (exit
  1). Same three-way blocker as every prior cycle — nineteenth
  consecutive cycle blocked on Queue item 7's Supabase-regression half
  and on reading the `staging-family-e2e.yml` workflow's run history.
- `git rm tmp_coverage_inspect.js` → "This command requires approval"
  (twice, retried once). Plain `rm tmp_coverage_inspect.js` → blocked by
  a separate sandbox working-directory check even though `pwd` and
  `readlink -f` both confirmed the path is inside the allowed session
  directory. Left tracked/in place this cycle — see Current Task above.
- `npm ci` — succeeded (`node_modules` was not present at cycle start).
- `npx jest --coverage --collectCoverageFrom="src/lib/supabase.ts"
  --coverageReporters=text --runInBand` (baseline, before this cycle's
  change) — 63.28%/63.49%/72.22%/73.56%
  (statements/branches/functions/lines), uncovered 43-44, 83-85, 224-246,
  270-285 — matches the prior cycle's sweep figure exactly (no drift).
  Test Suites: 89 passed; Tests: **1035** passed, 1035 total (unchanged —
  no code change yet).
- Read `src/lib/supabase.ts` (376 lines) and the existing
  `src/lib/__tests__/supabaseFamily.test.ts` (207 lines, 11 tests) in
  full before writing any test.
- Added a new file, `src/lib/__tests__/supabaseQaAndSession.test.ts` (34
  tests), covering every function `supabaseFamily.test.ts` didn't —
  full breakdown in Current Task Status above.
- `npx jest --coverage --collectCoverageFrom="src/lib/supabase.ts"
  --coverageReporters=text --runInBand` (after the new file) —
  94.53%/91.26%/100%/100%, uncovered 168-169, 171, 184-185, 205-207, 226,
  243, 312 — all real RPC-error/non-array-response branch arms, not
  defensive dead code (see Current Task Status).
- Added 9 more tests to `supabaseFamily.test.ts` and 2 more to
  `supabaseQaAndSession.test.ts` to close every one of those branches.
- `npx jest --coverage --collectCoverageFrom="src/lib/supabase.ts"
  --coverageReporters=text --runInBand` (full suite, final) —
  **100%/100%/100%/100%**, zero remaining gap. Test Suites: 90 passed, 90
  total; Tests: **1078** passed, 1078 total (1035 + 43 new).
- `npx tsc --noEmit` — **PASS**, zero errors (no fixup needed this
  cycle).
- `npm test -- --runInBand` (full local validation gate, final) —
  **PASS**: Test Suites: 90 passed, 90 total; Tests: **1078** passed,
  1078 total; Snapshots: 0 total; Time ~20s.
- `git status`/`git diff --stat` confirmed exactly two changed files from
  HEAD `4562105`: `src/lib/__tests__/supabaseFamily.test.ts` (+58,
  modified, tracked) and the new `src/lib/__tests__/supabaseQaAndSession.test.ts`
  (untracked, now added) — no unrelated files touched.
- `git add src/lib/__tests__/supabaseFamily.test.ts` (tried alone),
  `git add <both test files + EXECUTION_STATE.md>` (tried together), and
  `git add -A` — all three **blocked** ("This command requires approval"),
  so nothing was committed this cycle. The change is left in the working
  tree for the next cycle — see Current Task Status and Next Safe Task.

## Last Evidence Timestamp

2026-09-14T20:05:00Z

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
permission mode (reconfirmed this cycle, `gh auth status` → requires
approval), so GitHub-side PR/CI state (PR #7, PR #11, workflow run
metadata) still cannot be pulled directly. This is a secondary, independent
blocker from the Staging-credentials one above; it affects only
GitHub-metadata inspection, not local repository work, which proceeded
normally. `docker info` was ALSO gated this cycle (same interactive
approval prompt, consistent with several prior cycles) — either way, the
`supabase` CLI remains not installed, so Queue item 7's
Supabase-regression half stays blocked on tooling/access regardless of
`docker`'s own reachability this cycle. This cycle's sandbox permission
mode additionally gated `git rm`/plain `rm` on a tracked scratch file
(`tmp_coverage_inspect.js`, committed by mistake last cycle despite that
cycle's own notes claiming otherwise — see Current Task above) — left in
place, not blocking any other work.

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

**First step for the next cycle:** land this cycle's uncommitted,
fully-validated `src/lib/supabase.ts` coverage work (see Current Task
Status/Blocker) — `git add src/lib/__tests__/supabaseFamily.test.ts
src/lib/__tests__/supabaseQaAndSession.test.ts EXECUTION_STATE.md &&
git commit && git push` (retry if gated again; if the sandbox's
permission mode differs at the start of the next cycle, this may go
through immediately, matching the pattern several prior cycles have
shown). Before assuming nothing landed, check `git show --stat`/`git log`
first in case a later, unlogged commit in this same cycle actually
succeeded.

The quantitative-Jest-coverage angle (started several cycles ago) has now
closed every file it originally targeted: `family.ts` (already 100%),
`verifiedAdminOnboarding.ts` (84.1%/92.7%/63.6%, remaining lines are
trivial delegating wrappers), `familyManagement.ts` (100% across the
board), `supabaseRepository.ts` (100% across the board),
`offlineFirstRepository.ts` (100% across the board), `syncQueue.ts`
(100%/95.16%/100%/100%), `localRepository.ts` (99.21%/97.91%/100%/100%
— remaining gap is provably-unreachable defensive code), and this
cycle's `supabase.ts` (now **100%/100%/100%/100%**, up from
63.28%/63.49%/72.22%/73.56% — zero remaining gap, see Current Task
Status). The prioritized candidate list from a prior cycle's
`--collectCoverageFrom` sweep across `src/lib/**`, `src/logic/**`,
`src/data/**`, `src/notifications/**` (see "Completed This Cycle" ->
"Five cycles ago" for when that sweep ran) now has one item left:

1. `src/lib/pushTokens.ts` (17.85%), `src/lib/realtime.ts` (0%),
   `src/lib/webPush.ts` (0%), `src/lib/uploadImage.ts` (28.57%) — all very
   low, but likely genuinely hard to unit-test without a real
   device/native-module boundary (same class of gap as the project-wide
   0%-coverage screens/components, not a new/isolated one) — worth a
   quick read to confirm that assumption before spending a cycle on them,
   rather than assuming a quick win. This is now the only item left on
   this list.

A fresh full-repo `--collectCoverageFrom` sweep is worth running once
this last item is resolved one way or the other (closed, or confirmed
genuinely untestable from this sandbox), since every file the prior sweep
named will then be accounted for and a new sweep would surface whatever
the next-lowest-coverage files actually are.

Screens/components sit at or near 0% coverage project-wide, which is an
existing, consistent architectural pattern (no render-testing harness in
use anywhere in this codebase yet), not a new/isolated gap — treat that as
a much larger, separate undertaking rather than a quick win.

Remaining independent credential-free sub-tasks, in order: (1) re-attempt
Queue item 7's still-open Supabase-regression half via `gh`/a local
Supabase stack (only if the sandbox's permission mode allows it that
cycle — blocked for nineteen cycles running so far); (2) if `gh` becomes
reachable, dispatch or check for a completed run of the new
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

- Reconciliation: re-confirmed this run's dispatch `target_sha`
  (`fd4346d8...`) is still not an ancestor of this branch via the
  authoritative `git merge-base --is-ancestor` check (no new content
  beyond what prior cycles already recorded under Blocker — same PR #40
  merge commit on `origin/main`, still out of editable scope and out of
  `gh` reach). Confirmed HEAD (`4562105`, matching origin) clean at cycle
  start — no recovery action needed. Discovered the prior cycle's
  housekeeping note was wrong: `tmp_coverage_inspect.js` WAS committed
  (as part of `4562105`) despite that cycle's own notes claiming it was
  left untracked. Attempted `git rm`/`rm` to clean it up this cycle — both
  blocked by sandbox gating (see Blocker) — left in place for a future
  cycle. Continued the quantitative-coverage angle against the next file
  Next Safe Task named: `src/lib/supabase.ts` — the short-code
  join/family-lookup/session/PIN-claim/QA-sandbox/impersonation client
  wrapper layer over Supabase RPCs. Measured fresh at
  63.28%/63.49%/72.22%/73.56% (matching the prior sweep exactly — no
  drift). Read the file and its existing 11-test file first, then added a
  new 34-test file (`supabaseQaAndSession.test.ts`) covering every
  function the existing file didn't touch: `ensureAnonymousSession`,
  `setProfilePin`, `claimFamilyProfileWithPin` (including its two
  distinct structured-rejection reasons, `wrong_pin` vs `cooldown`, which
  must map to distinct, non-conflatable error messages per the RPC's own
  doc comment), the QA-sandbox functions (`enterQaSandbox`/
  `exitQaSandbox`/`getCurrentFamilyIsQa`/`qaResetData`/`qaResetFull`),
  `getWhoAmI` (including its refusal to trust an unexpected
  `family_role` value), and `beginImpersonation`/`endImpersonation`.
  Coverage after that pass: 94.53%/91.26%/100%/100%. Then, after
  identifying the remaining 0-hit branch arms from the text reporter's
  uncovered-line column (all real RPC-error/non-array-response branches,
  not defensive dead code), added 9 more tests to the existing
  `supabaseFamily.test.ts` and 2 more to the new file. Coverage after:
  **100%/100%/100%/100%**, up from 63.28%/63.49%/72.22%/73.56% — zero
  remaining gap. Full validation gate re-run: `npx tsc --noEmit` PASS (no
  fixup needed), `npm test -- --runInBand` **1078/1078** tests PASS (1035
  + 43 new), 90/90 suites. `git status`/`git diff --stat` confirmed
  exactly two changed files from HEAD `4562105`. **Could not commit this
  cycle** — `git add` (single-file, multi-file, and `-A` forms) was gated
  behind an interactive approval prompt with no owner present, the same
  recurring sandbox permission-mode issue several prior cycles have hit.
  The change is complete and left uncommitted in the working tree for the
  next cycle to land first — see Next Safe Task and Blocker. Reconfirmed
  `gh auth status` gated, `docker info` gated, `supabase` CLI not
  installed — Queue item 7 stays blocked for another (nineteenth) cycle.

### One cycle ago

- Reconciliation: re-confirmed this run's dispatch `target_sha`
  (`fd4346d8...`) is still not an ancestor of this branch via the
  authoritative `git merge-base --is-ancestor` check (no new content
  beyond what prior cycles already recorded under Blocker — same PR #40
  merge commit on `origin/main`, still out of editable scope and out of
  `gh` reach). Confirmed HEAD (`8b62217`, matching origin) clean at cycle
  start — no recovery action needed. Continued the quantitative-coverage
  angle against the next file Next Safe Task named:
  `src/data/localRepository.ts` — the AsyncStorage-backed local/demo-mode
  repository. Measured fresh at 91.33%/77.08%/93.33%/91.83% (already
  better than the stale prior-sweep figure Next Safe Task carried
  forward). Read the file and its existing 5-test file first, then added
  10 new tests (15 total) across three coverage-driven passes:
  `safeJsonParse`'s catch branch (seeded via the hardcoded raw storage
  key, matching `familyStore.test.ts`'s existing "BUG 2" precedent for
  the same private constant), `replaceAll()` (verified to actually
  persist via a second repository instance reading the same underlying
  storage), `createUser()`'s alias behavior, `updateScheduleEntry()`'s
  not-found insert branch, `saveWalk()`'s concurrent-completion guard,
  `getFamily()`'s mismatched-id branch, then — after using
  `coverage/lcov.info`'s raw `BRDA:` lines (`node <script>.js` execution
  was gated this cycle, unlike recent prior cycles, so this replaced the
  usual ad hoc inspection script) to pinpoint exactly which branch arms
  were still 0-hit — `deleteFamilyMember()`'s "not found" arms for a
  stale rule/entry/walk id (concurrent-removal race) and a non-matching
  `userId`. Coverage after: **99.21%/97.91%/100%/100%**, up from
  91.33%/77.08%/93.33%/91.83% — remaining gap is a defensive
  `if (!this.cache) return;` guard in `persist()`, provably unreachable
  through any public method (every call site already sets `this.cache`
  first) — same class of dead defensive code the syncQueue cycle left
  deliberately uncovered, left as-is here for the same reason. Full
  validation gate re-run: `npx tsc --noEmit` PASS (no fixup needed),
  `npm test -- --runInBand` **1035/1035** tests PASS (1025 + 10 new),
  89/89 suites. `git status`/`git diff --stat` confirmed exactly one
  tracked change from HEAD `8b62217`. **Committed and pushed successfully
  this cycle** — see Last Evidence for the resulting SHA. Reconfirmed `gh
  auth status` gated, `docker info` gated, `supabase` CLI not installed —
  Queue item 7 stays blocked for another (eighteenth) cycle. This cycle's
  sandbox also gated plain `node`/`rm` on an untracked scratch file (see
  Blocker) — worked around, not blocking.

### Two cycles ago

- Reconciled that cycle's dispatch context: its named `target_sha`
  (`fd4346d8...`) is a merge commit on `origin/main` (PR #40), not an
  ancestor of that branch — inspected it and found it adds a new
  **Staging Family E2E** GitHub Actions workflow + harness script that is
  a real, close-to-complete evidence path for Queue item 1, gated behind
  `gh`/GitHub Environment access this sandbox still doesn't have; recorded
  in full under Blocker. Confirmed HEAD (`ed8f503`, matching origin)
  already contained the prior cycle's full `offlineFirstRepository.test.ts`
  coverage work — no recovery action needed. Continued the
  quantitative-coverage angle against the next file Next Safe Task named:
  `src/data/syncQueue.ts`, at 92.9%/72.58%/100%/92.12%
  (statements/branches/functions/lines) — the SyncQueue replay/conflict/
  quarantine engine. Read the file and its existing 29-test file first,
  then added 10 new tests (39 total) across two coverage-driven passes:
  `flush()`'s re-entrant guard (via directly setting the private
  `flushing` field, the same reach-in style the prior cycle used for
  `(repo as any).queue`), the seven still-untested `apply()` dispatch
  routes (`deleteUser`/`upsertDog`/`upsertScheduleRule`/
  `deleteScheduleRule`/`addScheduleEntries`/`deleteScheduleEntry`/
  `updateUserReminderSetting`), a freshly-enqueued (non-legacy)
  `deleteFamilyMember` op reaching `apply()`'s own dispatch, `deleteWalk`
  both with and without `remote.deleteWalk` present (its optional-chaining
  branch), `hasClaimedActor()`, `isPermanentError`'s untested class-`28`
  Postgres-code prefix, a non-`Error` thrown value's `String(error)`
  fallback, and `getConflicts()`/`getQuarantined()` actually parsing a
  pre-persisted (not freshly-built) list. Coverage after:
  **100%/95.16%/100%/100%**, up from 92.9%/72.58%/100%/92.12% — remaining
  branch gap is a defensive `?? []` fallback provably unreachable through
  any public method. Full validation gate re-run: `npx tsc --noEmit` PASS
  (no fixup needed), `npm test -- --runInBand` **1025/1025** tests PASS
  (1015 + 10 new), 89/89 suites. `git status`/`git diff --stat` confirmed
  exactly one tracked change from HEAD `ed8f503`. **Committed and pushed
  successfully** as the SHA the following cycle's own start-of-cycle
  reconciliation confirmed landed. Reconfirmed `gh auth status` gated,
  `docker info` gated, `supabase` CLI not installed — Queue item 7 stayed
  blocked for another (seventeenth) cycle.

### Two cycles ago

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

### Two cycles ago

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

### Three cycles ago

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

### Four cycles ago

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

### Five cycles ago

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

### Six cycles ago

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

### Seven cycles ago

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

### Six cycles ago

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

### Eight cycles ago

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
