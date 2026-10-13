## Current Task

**This cycle's reconciliation, done fresh via direct `git log`/`git
show`/`git status`, not trusted from this file's own prior narrative:**
HEAD was `6392d6f` ("chore(agentic): checkpoint RC execution"), one commit
past `76b5091`. `git show --stat 6392d6f` confirmed it contains exactly
the prior cycle's own `expected_*`/`expected_target_*` staleness re-check
fix to `computeRequestLifecycle()` (`src/lib/requests.ts`,
`src/logic/requestLifecycle.ts`, `src/logic/walkRequestStatusLine.ts`,
plus their two test files) that the prior cycle's own file narrative had
described as code-complete but hedged as possibly-not-committed under
Blocker — the standing self-reporting-drift pattern (see note at top of
file) reconfirmed yet again (73rd+ time running): the commit had already
landed AND was already pushed (`git status` showed "Your branch is up to
date with 'origin/feat/verified-auth-onboarding-batch-2'", clean tree).
`node_modules/typescript` was again missing at cycle start; `npm ci`
restored it (906 packages, matching baseline). `npx tsc --noEmit` at
reconciled HEAD `6392d6f` — **PASS**, zero errors. Full `npm test --
runInBand` at reconciled HEAD — **PASS: 137/137 suites, 1617/1617 tests**
(the expected new baseline per the prior cycle's own narrative, matching
exactly), confirming a healthy baseline before starting new work.

**This cycle's own task — the prior cycle's own "suggested next angle,"
`src/components/UserPickerModal.tsx`/`SwapWalkPickerModal.tsx`'s
target-walk options and the three `onRequestSwap`/`onRequestTimeChange`
button-wiring call sites (`HomeScreen.tsx`'s top card + upcoming list,
`ScheduleScreen.tsx`'s list), cross-checked against
`create_swap_request()`/`create_time_change_request()`'s own pending-
conflict guards (migrations 0018/0006):** confirmed a real,
first-time-discovered client/server mismatch. `create_swap_request()`
rejects naming either walk (`p_walk_id` OR `p_target_walk_id`) on either
side of a NEW request whenever it already appears on either side of any
existing PENDING row in `walk_swap_requests`
(`r.walk_id in (p_walk_id, p_target_walk_id) or r.target_walk_id in
(p_walk_id, p_target_walk_id)`); `create_time_change_request()`
separately rejects a second pending row for the same `walk_id` in
`time_change_requests`. Neither client gate re-checked this: `WalkRow`'s
"בקש החלפה"/"בקש שינוי שעה" links stayed clickable on a walk that already
had its OWN active pending swap/time-change request outstanding (shown
side-by-side with the `requestStatusLine` "ממתין לאישור" text, or with no
status line at all on Home's "upcoming" list, which never passes one) —
tapping through the picker again always hit the RPC rejection. Separately,
`SwapWalkPickerModal`'s target-walk `options` list (built inline in both
screens) never excluded a candidate target walk that already carried an
active pending swap request against it (as source OR target) — the same
"looks selectable, always rejected" gap, one level deeper in the flow.

**Fixed by adding two new pure helpers to `requestLifecycle.ts`,
`walkHasActiveSwapRequest()`/`walkHasActiveTimeChangeRequest()`, each
built on the existing `computeRequestLifecycle()`/`isRequestActive()`
primitives (so they inherit the same expired/resolved handling, no new
state machine), and wiring them into all five gaps at once:** HomeScreen's
top-card `onRequestSwap`/`onRequestTimeChange`, HomeScreen's upcoming-list
`onRequestSwap`/`onRequestTimeChange`, HomeScreen's `SwapWalkPickerModal`
`options` filter, ScheduleScreen's list `onRequestSwap`/
`onRequestTimeChange` (split its single `canRequestForWalk` predicate into
`canRequestSwapForWalk`/`canRequestTimeChangeForWalk`, each ANDing the
existing eligibility rule with the matching new active-request check), and
ScheduleScreen's own `SwapWalkPickerModal` `options` filter. Not a security
gap (the server already correctly rejects the stale/duplicate attempt) —
the same reachable false-affordance UI class this round has repeatedly
found and fixed elsewhere (client offers an action the server always
rejects), just in the swap/time-change request-creation flow rather than
the approval flow.

`npx tsc --noEmit` after this cycle's own change — **PASS**, zero errors.
Targeted `npx jest src/logic/__tests__/requestLifecycle.test.ts
--runInBand` — **PASS: 42/42 tests** (up from 33/33 before the change — 8
new tests: 4 for `walkHasActiveSwapRequest` [source-side match,
target-side match, no match, false once resolved/expired/gone], 4 for
`walkHasActiveTimeChangeRequest` [match, no match, false once resolved,
default-`now`]). Full `npm test -- --runInBand` after this cycle's own
change — **PASS: 137/137 suites, 1625/1625 tests** (up from 137/137 ·
1617/1617 immediately before the change, same HEAD — same suite count,
exactly 8 new tests; every other suite's count unchanged). `git status
--porcelain=v1 --untracked-files=all` confirmed the changeset is scoped to
exactly `src/logic/requestLifecycle.ts`,
`src/logic/__tests__/requestLifecycle.test.ts`, `src/screens/HomeScreen.tsx`,
`src/screens/ScheduleScreen.tsx` (all modified) — plus this
`EXECUTION_STATE.md` update — no unrelated file touched, no user work at
risk. No dedicated screen-level component test exists for either screen's
JSX button wiring in this repo (both screens are covered only via their
extracted pure-logic helpers, per the existing pattern) — the new
`requestLifecycle.ts` unit tests are the durable regression coverage for
this fix's actual decision logic; the screen wiring itself was manually
traced against both RPCs' exact guard conditions, not merely inferred.

Full detail for every earlier cycle's own task (the `walkRequestStatusLine.ts`
lifecycle-tier-aware winner-selection fix landed as `76b5091`, the
`computeRequestLifecycle()` `expected_*` staleness re-check landed as
`6392d6f`, and the long prior chain of accessibility/keyboard-avoidance/
RTL/coverage fixes before that) is preserved in git history of this file
rather than repeated here — see the "Completed This Cycle" and "Recent
cycles" sections below for the condensed form of that same history.

