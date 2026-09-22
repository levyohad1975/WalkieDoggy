# Walkie Doggy Link — Phase 0 Gap Analysis

Source PRD: `Walkie_Doggy_Link_PRD_Final_2026-09-22` (owner-supplied, 2026-09-22).
Method: read `AGENTS.md`, `docs/engineering/PROJECT_ENGINEERING_BRAIN.md`,
`docs/design/PRODUCT_CONTEXT.md`, `docs/design/BRAND_BIBLE.md`,
`docs/design/MASCOT_SPEC.md`, `docs/design/CREATIVE_AGENT_CHARTER.md`, then
inspected current code directly (git HEAD `98a3233` on `main`, 2026-09-22).
Current repository evidence overrides older documents wherever they disagree.

Status legend: **Existing** (built and matches intent) · **Partial** (built but
incomplete/diverges from PRD) · **Missing** (not implemented) · every row
notes **Risk** where a change would touch shared/security-sensitive code.

---

## 1. Executive summary

The app is a solid, working, offline-first, RTL, security-conscious
foundation (42 migrations, 5 Edge Functions, strong accessibility test
coverage, ~80% design-token conversion already done, icon system already
replaced from emoji to SVG). Most of PRD §4–6, §14–18, §20–22 is
Existing or Partial.

**Four entire product domains are 100% missing, confirmed by targeted
search, not just undocumented:** GPS/location tracking (§7), Gamification/
achievements (§9), Health & Grooming (§10), and product Analytics events
(§24). None has a single line of code, a migration, a dependency, or a
screen anywhere in the repo.

**The single biggest structural blocker, touching multiple PRD sections at
once, is that the entire app is hard-wired to exactly one dog per family**
— not by a DB constraint, but by client state (`familyStore.ts`: `dog: Dog
| null`, singular) and every RPC (`... limit 1`). Migration `0042` even
restates this as the explicit product assumption in its own comment, while
*preventing client-side dog deletion* specifically because the cascading
FK deletes (schedule/walks) would otherwise wipe a family's history if a
dog were removed — a real safety mechanism that any multi-dog work must
preserve. Multi-dog (§11) is required by Statistics (§13, dog breakdown/
filter), Health & Grooming (§10, per-dog timeline), and Home (§5, dog
picker) — recommend treating multi-dog as its own foundational unit before
those three, not as a side effect of any one of them.

**Statistics (§13) needs the most rework of any *existing* screen**: it
currently uses pee/poop counts as a primary KPI card (exactly what the PRD
forbids), has no on-time/late metric, no trend chart, no distance/duration
aggregation, and is custom-bar-built with no chart library or accessible
chart semantics.

**One in-progress effort was already attempted and abandoned**: PR #109
("PWA recover family after Home Screen install") went green on CI and was
closed without merging on 2026-09-22, for reasons not recorded in the PR
itself. Re-attempting this (PRD §4, Phase 1) should start by checking why
it was dropped rather than starting cold.

**One live inconsistency worth an immediate, cheap fix**: the Settings
Audit Trail (`AdminAuditLogModal.tsx`) already renders human-readable
Hebrew action labels, but the System Admin screen's own separate audit
section (`SystemAdminScreen.tsx:328`) still renders raw action ids. Same
requirement (PRD §14), inconsistently applied.

---

## 2. Domain matrix

### §3 — Users, roles, permissions
**Existing.** Family Admin / Family Member / System Admin are distinct,
server-enforced (RLS + RPCs), confirmed via `PROJECT_ENGINEERING_BRAIN.md`
§5 and `SystemAdminScreen.tsx`/`src/lib/systemAdmin.ts`. No gap found.

### §4 — Onboarding, family creation/join, PWA recovery
- OTP → create/join family → add dog → invite → Home: **Existing**
  (`FamilyOnboardingScreen.tsx`, migrations 0032–0036, PR #7 merged
  2026-09-20).
- Code/link/QR invite, second-device join: **Existing**.
- Generic cold-start recovery (pending-status recheck, invite-redemption
  confirmation): **Existing** (`FamilyOnboardingScreen.tsx:85-104,
  244-275,286-309`).
- **PWA/Home-Screen-install-aware recovery: Missing.** No `standalone`/
  `display-mode`/`matchMedia` detection anywhere in `src/` or `App.tsx`;
  `App.tsx:232` routes purely on `familyId`/`currentUserId`, with no
  PWA-specific branch. **PR #109 attempted this, went CI-green, was
  closed unmerged same day — investigate why before restarting.**
- Admin re-verifies email specifically *to recover* an existing family:
  **Missing** (current email-verify path is create-only,
  `verifiedAdminOnboarding.ts:63-121,190`).
- Onboarding mascot + short animation: **Existing** (recent merged PRs:
  "bring mascot to welcome hero", "add real mascot wink frames", "play
  open wink open mascot sequence").

### §5 — Home
- Real dog photo/name in the main card (not a separate "our dog" card):
  **Existing** (per `PRODUCT_CONTEXT.md`, mascot/dog separation is an
  enforced convention).
- Header layout (bell left / wordmark center / mascot right, no overlap):
  **Partial, and platform-inconsistent.** `HomeScreen.tsx:1019-1024`:
  wordmark centered ✓; bell is physical-**right** on native
  (`notificationButton: {right:0}`) but physical-**left** on web
  (`webNotificationButton`) — native contradicts the PRD target, web
  matches it. **No mascot in the header at all** (mascot lives inside
  `NextWalkCard.tsx:121` instead). System Admin entry is a floating
  circular button (`App.tsx:342-378`, absolute-positioned), not part of
  the header, so it doesn't overlap anything but also isn't "near" it.
- 4-state walk card — **no 4-state model exists at all**; `WalkStatus` is
  only `'pending'|'done'|'skipped'` (`types/index.ts:7`), overdue is
  derived, not stored:
  - Scheduled: **Partial** — pale blue (`statusCurrentBg #E9F0FF`), no
    turquoise, no ▶ button (only a "mark done" text button).
  - Overdue: **Partial** — whole card does tint red/salmon
    (`statusOverdueBg #FBEAE6` + red border, confirmed whole-card not
    icon-only), but it's pale, not the PRD's bold "all-red + start-now"
    treatment; button is "done/not done", not "start now".
  - In Progress (timer + GPS/distance + ■ finish): **Missing entirely** —
    no such status exists, no timer, no GPS/distance field anywhere.
  - Completed summary: **Partial** — time/duration/pee-poop/notes shown;
    no distance, no "stops" (no such data exists).
  - **Risk:** introducing a real "in progress" status is a `WalkStatus`
    enum change touching migrations, RLS, every consumer of `Walk` type,
    and the offline sync/audit logic — not a UI-only change.

### §6 — Scheduling and rotation
Flexible per-family walk count (not fixed at 4), weekly templates,
per-day exceptions, time change/swap requests with approval and audit,
ad-hoc walks, retroactive actual-time entry: **Existing**, per
`PROJECT_ENGINEERING_BRAIN.md` §4 and `PRODUCT_CONTEXT.md`'s "Manage the
schedule"/"Request a swap" journeys — no PRD-specific gap surfaced by
research; not independently re-verified line-by-line in this pass (lower
priority than the confirmed-missing domains).

### §7 — GPS and walk lifecycle
**Missing, confirmed by exhaustive search** (no `gps`/`location`/
`latitude`/`longitude`/`coordinates`/`route`(non-navigation) match in
`src/` or `supabase/`; no `expo-location` or maps dependency in
`package.json`; no location permission entry in `app.json`). Walk
start/end today is fully manual (`src/logic/walkActions.ts`). This is a
from-scratch domain: permissions UX, background capability per platform,
a tracking session data model, route/distance storage, a correction flow,
and a privacy/retention policy all need to be designed, not just coded.

### §8 — Reminders, Push, mascot animation on notification
Native/Expo/Web Push de-duplication, T-15/T+15/T+30-style scheduling:
**Existing** (`PROJECT_ENGINEERING_BRAIN.md` §7). Mascot reminder-open
prompt: **Existing** (`ReminderMascotPrompt.tsx`). Reduced Motion
respected consistently across all animation/mascot components
(`WalkCompletionCelebration.tsx:24`, `WalkieMascot.tsx:208`,
`ReminderMascotPrompt.tsx:22`, `MascotFrameAnimation.tsx:25` — 4/4, not
a one-off). **Final animation frame artwork: Missing** (architecture and
manifest exist per `MASCOT_SPEC.md`; zero files under
`assets/celebrations/`).

### §9 — Gamification
**Missing, confirmed by exhaustive search.** No achievements/streaks
table in any of 43 migrations, no store, no persisted counters. The only
hits are mascot celebration *animation* metadata (`'achievement'` as a
`CelebrationCategory` enum value, a `trophy-teaser` animation name) — a
visual concept, not a tracking system. This is a from-scratch domain:
needs a data model (event → achievement rule → unlock record), not just UI.

### §10 — Health & Grooming
**Missing, confirmed by exhaustive search.** No screen, no migration, no
type, zero matches for health/grooming/vaccination/medication/vet
anywhere. From-scratch domain, and per-dog by nature — **blocked on the
multi-dog decision below** only in the sense that today's single-dog
assumption makes "per dog" trivial (there's only ever one), so it *could*
ship before multi-dog and just needs a `dogId` foreign key that's
currently always the same value.

### §11 — Multi-dog
**Missing** — this is the cross-cutting structural gap; see §1. Schema
has no `UNIQUE`/`CHECK` blocking multiple `dogs` rows per family, but
every RPC (`... limit 1`) and the client store
(`familyStore.ts`: `dog: Dog | null`) assume exactly one. `0042` is a
*security* fix (blocks client-side dog deletion because cascading FK
deletes would silently wipe schedule/walk history) that incidentally
documents the one-dog assumption in its own comment — it is not itself a
multi-dog blocker, but any multi-dog work must preserve its no-delete
protection per dog row.

### §12 — Profile/dog photos, crop/zoom editor
Upload exists (`expo-image-picker`, `DogDetailsModal`/`Avatar`/
`DogPhoto` components). **Crop/zoom/pan editing UX: Missing** — no
image-crop/editor dependency in `package.json`, no such component found.

### §13 — Statistics redesign
See §1 for the summary. Detail, all confirmed against
`StatisticsScreen.tsx`/`src/logic/statistics.ts`:
- Pee/poop as a primary KPI card: **present, contradicts the PRD**
  (`StatisticsScreen.tsx:310-336`, `computePeePoopStats`) — isolated to
  ~27 lines + one `useMemo`, cheap to remove/demote.
- Walk-count KPIs: **Existing.** On-time %: **Missing** (no
  scheduled-vs-actual concept anywhere). Duration: **Partial**
  (`durationMinutes` exists on `Walk` but is never aggregated here).
  Distance: **Missing** (no field exists at all — depends on §7 GPS or a
  manual-entry alternative).
- Trend chart: **Missing** (period toggle re-filters snapshot totals;
  no time series).
- By family member: **Existing.** By dog: **Missing**, and blocked on §11.
- On-time vs Late: **Missing.** Planned vs Ad-hoc: **Existing.**
- Achievements/streaks card: **Missing**, blocked on §9.
- Short textual insights: **Missing** (numbers/bars only).
- Filters: **Partial** — only a fixed 7d/30d/all period chip exists; no
  custom range, no dog filter, no member filter, no type/status filter.
- Charting: **custom-built** (`Bar` = a plain `View` with a width-percent
  fill, explicitly commented "no chart library needed"); no
  Victory/Recharts/d3 dependency. A real trend chart needs either a new
  dependency or a bespoke SVG chart — decide before Phase 6.
- RTL: text is RTL-correct throughout (`RtlText`, bidi-pinned numerals);
  the `Bar` element itself has no RTL-aware fill direction (irrelevant
  today since it's a single filled bar, but relevant for a future axis
  chart).
- Design tokens: **Existing** (already imports `theme/tokens`).
- Accessibility: **Partial** — header/chips/spinner have proper
  `accessibilityRole`/`Label`; the `Bar` chart elements themselves have
  none, so a screen reader gets nothing from the current bars beyond the
  adjacent number.
- **Risk:** the screen sits behind a two-stage permission gate
  (`canAccessStatisticsScreen`, its own test file) that any redesign
  must preserve; `hadPee`/`hadPoop` fields themselves are written by
  other flows (walk completion) and used elsewhere, so removing the
  *fields* would be invasive — removing this *screen's KPI card* is not.

### §14 — History, Notes, Audit
- History filter/search, planned-vs-actual, responsible-person
  attribution: **Existing** (`HistoryScreen.tsx`, `EditDoneDetailsModal`).
- Distance/route on a history entry: **Missing** (blocked on §7).
- Audit Trail Hebrew phrasing: **Partial/inconsistent** — `Settings →
  AdminAuditLogModal.tsx` already has a full ~25-entry `ACTION_LABEL`
  Hebrew map (`:14-44`) and uses it. **`SystemAdminScreen.tsx:328`'s own,
  separate audit section still renders the raw `a.action` id** — same
  requirement, same repo, not applied consistently. Cheap, low-risk fix:
  reuse `AdminAuditLogModal`'s label map in `SystemAdminScreen`.

### §15 — Requests/Inbox
**Partial.** `RequestsInboxModal.tsx` unifies swap requests and
time-change requests only (two sections), each with clear status/
approver-gated actions. **"Important reminders" and "system updates" as
inbox item types: Missing** — the modal's data model
(`swapRequests`/`timeChangeRequests` props only) has no room for them
without a new item-type abstraction. Bell badge unread count: not
verified in this pass (lives in a parent nav component not inspected) —
flag as unconfirmed, check directly before Phase 2.

### §16 — Settings and family management
Per-file evidence from `SettingsScreen.tsx`/`FamilyScreen.tsx`:
- Family member add/remove/edit: **Existing, but relocated** — deliberately
  moved out of Settings into `FamilyScreen.tsx` (comment at
  `SettingsScreen.tsx:69-77`); soft-delete confirmed
  (`removedAt`-filtered lists, not hard delete).
- Dogs: **Existing** (dog card + `DogDetailsModal`).
- Reminders: **Existing** (`RemindersModal`).
- Schedule rules: lives in `ScheduleScreen`, not Settings — **Existing
  elsewhere**, not a gap.
- Health/grooming settings: **Missing** (blocked on §10).
- Push/Web Push settings surface: **Missing** — no "push" match anywhere
  in `SettingsScreen.tsx` (push exists at the OS/system level per §8, but
  has no in-app settings UI).
- Privacy/GPS settings: **Missing** (blocked on §7).
- Accessibility/Reduced-Motion *setting* (as opposed to the app already
  *respecting* the OS setting, which is Existing): **Missing** — no
  in-app toggle/explanation screen.
- Support channel entry: **Missing** — no "תמיכה" match in
  `SettingsScreen.tsx`.
- Explicit sign-out action: **Missing** — only "switch user" exists
  (`handleSwitchUser`), which is a profile switch, not a sign-out.

### §17 — System Admin
- Separate role, works without needing a family persona (code never
  touches `familyId`/`currentUserId` by design): **Existing.**
- Family list/status/audit view, approve/reject with policy: **Existing**
  (`setSystemAdminFamilyApproval`, already on `main` — no separate open
  PR found, this shipped with PR #7's batch).
- "Disable" a family / no-auto-deletion-without-policy: **Partial/unclear**
  — only active/pending/rejected states exist; no explicit disable action
  or retention-policy code found. Matches the PRD's own framing (§17,
  §30) that this needs a product/retention decision before any
  automatic behavior — correctly left undecided, not a bug.
- Audit Trail Hebrew phrasing here specifically: **Missing** — see §14.

### §18 — Design system, RTL, responsive
- Token system (`theme/tokens.ts`) exists and covers spacing/radii/
  typography; brand colors (turquoise/cream) live in a separate
  `theme/colors.ts`, not yet merged into `tokens.ts`.
- Adoption: **Partial, ~80%** — a real, git-verified sweep (21+ commits,
  "21/21 modal token sweep" checkpoint) converted all modals plus most
  screens; 38/48 (`components`+`screens`) files import tokens today.
  Remaining ~20% is real but bounded work, not a redesign.
- Icon system: **Existing** — bottom-tab emoji already replaced with
  hand-built `react-native-svg` glyphs (`RootNavigator.tsx:7,36-54`),
  fulfilling the "coherent production-quality visual language" ask via a
  different concrete choice than `@expo/vector-icons` (both were
  pre-approved options; this is not a gap).
- Desktop-aware (not stretched-mobile) layout: not independently
  re-verified this pass — lower priority than the confirmed-missing
  domains; check directly during Phase 6/7 responsive QA.

### §19 — Mascot and animation system
Identity governance (Clean Master, immutable traits, lifecycle states):
**Existing and strict** (`MASCOT_SPEC.md`, `CREATIVE_AGENT_CHARTER.md`).
Runtime states: **Existing but named differently than the PRD** — current
`WalkieMascot` states are `idle/excited/ready/waiting/concerned/success`
(6 states); PRD asks for `idle/happy/reminder/overdue-concerned/
walk-start/walking/walk-complete/achievement/long-walk/special-surprise`
(10, several tied to §7/§9 domains that don't exist yet) — needs explicit
reconciliation, not a rename. **Final frame artwork: Missing** for both
sets (architecture/manifest only, zero files under `assets/celebrations/`,
confirmed by both `MASCOT_SPEC.md` itself and direct repo search).

### §20 — Offline, Sync
**Existing, confirmed directly.** `OfflineFirstRepository`/`SyncQueue`
exist and are wired into `src/data/index.ts`/`repository.ts` exactly as
`PROJECT_ENGINEERING_BRAIN.md` §6 describes. No gap found.

### §21 — Security & Privacy
Family-as-tenant-boundary, RLS/RPC/`SECURITY DEFINER` enforcement:
**Existing** (per `PROJECT_ENGINEERING_BRAIN.md` §5, and directly
observed in every migration reviewed this pass, e.g. `0042`'s own
delete-cascade protection reasoning). GPS-specific privacy/retention
policy: **Missing**, blocked on §7 (correctly listed as a pre-Production
decision in the PRD's own §30, not a coding gap).

### §22 — Accessibility
**Existing, substantial, well-evidenced.** 16+ dedicated a11y test files;
`accessibilityRole` (180), `accessibilityLabel` (173),
`accessibilityHint` (39) occurrences across 59 source files; Reduced
Motion checked consistently in all 4 animation-bearing components with
its own structural test. **Missing:** a written accessibility/WCAG
checklist document (`docs/design/VISUAL_QA_CHECKLIST.md` doesn't exist,
though the *behavior* it would document mostly already does) — one
Statistics-screen-specific gap noted in §13 (chart bars have no a11y
semantics).

### §23 — Email
Welcome/system-owner email, delivery observability
(`email_delivery_log`), Resend webhook, branded Send Email Hook for
Auth's own OTP/magic-link/etc. emails: **Existing** (PR #7, merged). Not
yet independently re-verified whether the Send Email Hook is *enabled* in
the live Supabase project (that's a dashboard action, out of repo scope,
already flagged in the rollout doc).

### §24 — Product analytics
**Missing, confirmed by exhaustive search.** No analytics
dependency, no `trackEvent`/`logEvent` call, anywhere in the repo.
From-scratch domain.

### §25 — Required system states
Most individual states (loading, empty, offline, sync-pending/conflict,
permission-denied states, invalid/expired invite, OTP error, pending
approval) exist scattered across the flows they belong to per
`PRODUCT_CONTEXT.md`'s own inventory — **not independently re-audited
state-by-state in this pass**; the states tied to missing domains
(GPS-unavailable, no-health-tasks) are trivially Missing since their
parent domain is. Recommend a dedicated pass once Phase 1–3 land new
domains, rather than auditing states for screens that don't exist yet.

### §26 — Acceptance criteria
A composite of the sections above; no new information — see the relevant
section for each criterion's status.

---

## 3. Recommended sequencing — cross-check against the PRD's own Phase 1–8

The PRD's own phase order (§27) already matches this evidence well: it
correctly sequences Stabilize (Phase 1, including PWA recovery and the
Home lifecycle/header work found Partial/Missing above) before Core
completeness (Phase 2, flexible schedule/requests — already mostly
Existing, so this phase should be lighter than the PRD assumes) before
Health & Grooming (Phase 3) before GPS (Phase 4) before Engagement/
gamification (Phase 5) before Statistics redesign (Phase 6). One
adjustment worth flagging to the owner: **multi-dog (§11) isn't its own
PRD phase** — it's referenced only inside Statistics (§13) and implied by
Health & Grooming (§10) and Home (§5). Recommend deciding explicitly
*when* multi-dog lands (e.g., as part of Phase 3 before Health & Grooming,
since per-dog health data is far more natural to build once multi-dog
exists than to retrofit) rather than letting it default to "whichever
phase needs it first."

---

## 4. Open questions for the owner (not decidable from repository evidence)

1. Why was PR #109 (PWA recovery) closed unmerged after going CI-green?
   Worth checking before Phase 1 re-attempts the same problem.
2. Multi-dog: confirm this should be built as real multi-dog support
   (arbitrary N dogs) vs. some smaller near-term shape — it's a
   cross-cutting decision, not a per-screen one.
3. Statistics distance/duration and Home "In Progress" timer both assume
   GPS-adjacent data collection (§7) — confirm whether Phase 6
   (Statistics) should ship distance metrics before Phase 4 (GPS) lands,
   or omit distance until then.
4. Mascot state-name reconciliation (§19): confirm whether to rename/
   extend the existing 6 `WalkieMascot` states to the PRD's 10, or treat
   the PRD's list as illustrative rather than literal.
