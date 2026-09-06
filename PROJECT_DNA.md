# Dog Walk Family — Project DNA

> Derived entirely from reading the repository at
> `/home/claude/project6/Project Archaeology` on 2026-08-31. Every claim below
> is traceable to a specific file/function; anywhere the code does not say
> something explicitly, this document says so rather than guessing.

## 1. Product Purpose

A Hebrew-first, RTL mobile app ("תורנות הכלב" / "טופי") for a household to
share responsibility for walking the family dog. It tracks who is on duty for
each scheduled walk, lets anyone mark a walk done (with pee/poop/notes),
supports swapping/rescheduling turns, keeps a history, and (when a Supabase
backend is configured) keeps every family member's phone in sync in near
real time. Source: `README.md` (Hebrew), `app.json`'s `expo.name`.

## 2. Product Concepts

- **Family** (`families` table / `Family` type, `src/types/index.ts`) — one
  household ("המשפחה שלנו"), identified by `familyId`.
- **Family Member** (`users` table / `FamilyUser`) — a person with a name,
  emoji avatar, optional real photo (`photoUrl`), color, and a
  `remindersEnabled` flag. Deletion is always a soft-delete (`removedAt`),
  never a row `DELETE` — see §9/§15.
- **Dog** (`dogs` table / `Dog`) — name, photo, `walksPerDay` (default 4),
  notes.
- **Schedule Rule** (`schedule_rules` / `ScheduleRule`, `src/types/index.ts`)
  — one recurring time slot ("07:00, rotation A→B→C→..."). One rule = one
  daily time slot; 4 walks/day = 4 active rules. Rotation is computed by
  `resolveResponsibleForDate` (`src/logic/rotation.ts`), counting active
  matching days between `rotationAnchorDate` and the target date.
- **Schedule Entry** (`schedule_entries` / `ScheduleEntry`) — a concrete
  generated slot (date + time + responsible user), independent of whether a
  `Walk` row exists yet. A single entry's time/responsible user can be
  edited without touching the rule (`updateScheduleEntry`).
- **Concrete Walk Occurrence** (`walks` / `Walk`) — the actual execution
  record: `status` (`pending|done|skipped`), `responsibleUserId` (who is/was
  officially on duty), `completedByUserId` (who actually did it — may
  differ), `completedAt`, `hadPee`/`hadPoop`/`note`/`durationMinutes`,
  `isUnplanned` (ad-hoc walk with no `scheduleEntryId`), and an optional
  `swap` record.
- **Walk lifecycle**: generated from a rule → `pending` → `done` (via
  `markWalkDone`) or `skipped` (via `markWalkSkipped`); a `done` walk's
  pee/poop/note/duration can still be edited (`editWalkDetails`); an
  `unplanned` walk is created already `done` (`addUnplannedWalk` in
  `scheduleStore.ts`), never generated from a rule.
- **Requests** — `walk_swap_requests` (Member→Member) and
  `time_change_requests` (Member→Admin), both introduced in migration 0005.
  See §13.
- **Admin/Member** — a per-device role (`family_auth_members.role`,
  migration 0003), extended to multi-admin in migration 0007. See §7.
- **Real QA Impersonation** — a server-tracked session letting a real Admin
  act, authoritatively, as another member for QA purposes. See §8.
- **Presence** — `user_presence.last_seen_at`, Admin-only. See §14.
- **Notifications** — local (on-device) scheduled reminders via
  `expo-notifications`. See §12.
- **Offline sync** — every write goes to `AsyncStorage` first, then is
  queued and replayed against Supabase when online. See §11.
- **Family Invite** (`family_invites` table, migration 0008, pgcrypto-fixed
  by 0009) — a member-specific, admin-issued, one-time invite bound to one
  specific existing unclaimed `users` row (not a family-wide join
  mechanism, and distinct from the pre-existing family invite *code*, §6).
  72h TTL; raw token generated server-side, returned once, never persisted.
  Client service layer: `src/lib/invites.ts`. As of this checkpoint, both
  admin creation/management (create, view link, copy, share, revoke,
  regenerate — Round 3) and invited-user redemption (manual invite
  link/token paste via `FamilyOnboardingScreen.tsx`'s "יש לי הזמנה" mode,
  with fail-closed whoami() verification in `authStore.ts` before any state
  is committed — Round 4) are implemented and real-device QA'd on a real
  iPhone against live Supabase. QR rendering and automatic deep-link
  opening (tapping/scanning the link to open the app) are still not built
  — see `PROJECT_STATUS.md` §5/§6.

## 3. Technology Stack

From `package.json` (exact pinned/range versions as declared):

| Layer | Package | Version |
|---|---|---|
| Framework | `expo` | `~54.0.0` |
| | `react` | `19.1.0` |
| | `react-native` | `0.81.5` |
| | `typescript` | `~5.9.2` (dev) |
| State | `zustand` | `^4.5.5` |
| Backend | `@supabase/supabase-js` | `^2.45.4` |
| Offline cache | `@react-native-async-storage/async-storage` | `2.2.0` |
| Connectivity | `@react-native-community/netinfo` | `11.4.1` |
| Notifications | `expo-notifications` | `~0.32.12` |
| Image picker | `expo-image-picker` | `~17.0.8` |
| Date/time picker | `@react-native-community/datetimepicker` | `8.4.4` |
| Navigation | `@react-navigation/native` `^7.1.13`, `@react-navigation/bottom-tabs` `^7.4.2` | |
| Testing | `jest` `^29.7.0`, `jest-expo` `~54.0.0`, `@testing-library/react-native` `^13.2.0` | |
| Other | `expo-clipboard`, `expo-status-bar`, `base64-arraybuffer`, `react-native-url-polyfill`, `react-native-safe-area-context`, `react-native-screens` | see package.json |

`README.md` corroborates "Expo SDK 54 (React Native 0.81.5, React 19.1) +
TypeScript". `app.json`'s `newArchEnabled: true`.

## 4. High-Level Architecture

Confirmed by reading the actual files (not just the README's diagram):

```
UI (screens/, components/)
   -> Zustand stores (src/store/*: authStore, familyStore, scheduleStore, requestsStore)
   -> Repository interface (src/data/repository.ts)
   -> OfflineFirstRepository (src/data/offlineFirstRepository.ts)
        -> LocalRepository (src/data/localRepository.ts, AsyncStorage)
        -> SupabaseRepository (src/data/supabaseRepository.ts, Postgres via supabase-js)
        -> SyncQueue (src/data/syncQueue.ts) — persisted FIFO of queued writes
```

Verified: `src/data/index.ts` constructs the single `repository` instance
used everywhere (`OfflineFirstRepository` wrapping a `SupabaseRepository`
when `isSupabaseConfigured`, otherwise local-only). Stores never import
`localRepository`/`supabaseRepository`/`syncQueue` directly — they only call
`repository.*`. Two categories of logic deliberately bypass this stack
entirely and talk straight to Supabase RPCs (`src/lib/requests.ts`,
`src/lib/family.ts`'s `setMemberRole`) — see §11 and §13 for why (they are
approval-sensitive/business-rule-sensitive server operations that must never
be queued as "already applied" offline).

## 5. Source-of-Truth Rules

- **Persisted walk occurrence is authoritative for notification content** —
  documented explicitly as "A3's authoritative rule" throughout
  `App.tsx`, `scheduleStore.ts`, `notificationService.ts`: notification
  text is always derived from the *current* `Walk` row, never a stale
  snapshot or recomputed from the rule/rotation.
- **Recurring rule vs. generated occurrence**: a `ScheduleRule` only
  describes the recurring pattern; `ScheduleEntry`/`Walk` are concrete,
  independently-editable materializations. `scheduleStore.load()`
  self-heals by backfilling missing entries for any active rule with no
  upcoming entries (14-day horizon, `GENERATE_DAYS_AHEAD`).
- **`responsibleUserId` vs. `completedByUserId`**: `markWalkDone`
  (`src/logic/walkActions.ts`) explicitly allows these to differ — "whoever
  actually walked the dog isn't always who was scheduled."
- **`markDone` behavior**: `scheduleStore.markDone` optimistically updates
  local state, persists via `repository.saveWalk`, cancels local
  notifications, then — critically — only re-syncs from the server once
  `repository.hasPendingSaveWalk` confirms the write is no longer queued
  (A2 fix, see doc comment); if a permanent conflict is recorded
  (`getConflictForWalk`), it reverts the optimistic state and surfaces a
  Hebrew error rather than silently showing false success.
- **`nextWalk` calculation**: `computeNextWalk` (`src/logic/nextWalk.ts`)
  picks the earliest still-`pending` walk by `date`+`scheduledTime`,
  including an overdue one if nothing is strictly in the future — nothing
  pending silently disappears.
- **Stale server/local conflict**: handled via `SyncQueue`'s
  `SyncConflict`/`isPermanentError` (Postgres SQLSTATE class `23`)
  distinction — permanent failures are dropped and recorded as a conflict
  (never block the rest of the queue forever); retryable ones stay queued.
- **Foreground reload semantics**: `App.tsx`'s `runForegroundSync()` runs a
  strict, documented order — (1) `repository.trySync()`, (2)
  `useScheduleStore.load(familyId)`, (3) `useRequestsStore.load()`
  (regardless of step 2's outcome), (4) `reconcileNotificationsNow()` (only
  if step 2 succeeded), (5) `touchLastSeen()` + `revalidateClaim()`. A
  shared-promise guard (`foregroundSyncPromise`) de-duplicates concurrent
  invocations.
- **Notification reconciliation**: `reconcileWalkNotifications`
  (`src/notifications/notificationService.ts`) reschedules every pending
  walk from its current data using deterministic ids, cancels non-pending
  walks' notifications, and additionally cancels any OS-scheduled
  notification whose walk id is absent from the current walk set entirely
  (`cancelOrphanedWalkNotifications` — "bug 4 fix", covers a walk deleted on
  another device).

## 6. Authentication and Family Membership

- Every device authenticates via **Supabase Anonymous Auth**
  (`ensureAnonymousSession`, `src/lib/supabase.ts`), required before any
  RLS-protected read/write.
- **Family membership** is established explicitly via `create_family` /
  `join_family` (invite code, migration 0002), recorded in
  `family_auth_members` keyed by `auth_user_id` ↔ `family_id`, *before* any
  specific profile is picked (solves the "chicken-and-egg" problem the
  original 0001 schema had).
- **Profile claiming**: `claimFamilyProfile` (SECURITY DEFINER RPC
  `claim_family_profile`, migration 0004) links a `users` row's
  `auth_user_id` to the current device's anon session — self-or-unclaimed
  only. `authStore.signIn()` also does a **post-claim verification**
  (`getWhoAmI()` must confirm `realProfileId === userId`) before persisting
  anything locally.
- **`currentUserId`** (which family member this device is) is stored
  device-local in `AsyncStorage` and never shared between devices;
  **`familyId`** (which family this device belongs to) is the thing every
  device of the same family agrees on.
- **`restoreSession()`** (`src/store/authStore.ts`) on every cold start: (a)
  ensures the anon session, (b) unconditionally best-effort ends any stale
  server-side impersonation session, (c) validates the cached
  `currentUserId` is a UUID, (d) calls `checkClaimStillValid` against the
  server's `whoami()` RPC and clears the local claim if it has drifted
  (`staleClaimRecovered`), (e) resolves `familyRole`.
- **`familyRole`**: `'admin' | 'member' | null`, resolved from
  `current_family_role()` RPC (Supabase mode) or hardcoded `'admin'` in
  local/demo mode (a single device fully controls its own demo family).
- **Device identity / `auth_user_id`**: the device's own Supabase anon
  `auth.uid()`; server functions like `current_family_id()`,
  `current_profile_id()`, `is_family_admin()` all derive from it, never from
  anything the client asserts.
- **Sign-out semantics**: `signOut()` best-effort ends any active
  impersonation server-side (ordering fixed — see the "ORDERING FIX (round 3
  security review)" comment), clears local `currentUserId`/test-mode/
  impersonation state, but deliberately **does not** clear `familyId` (a
  signed-out device on an already-joined family goes back to "pick your
  profile", not onboarding).

## 7. Roles and Permissions

- **Admin-only** (per `README.md`'s "הרשאות Admin / Member" section and
  migrations 0003/0004/0007): add/delete family members; manage the
  recurring schedule (`schedule_rules` add/edit/delete/reorder, rotation
  changes); regenerate the invite code; promote/demote roles
  (`set_member_role`, 0007).
- **Every member (incl. Member)**: view schedule/family/history, mark a
  walk done, request swaps/time-changes, and — explicitly — **add a
  spontaneous walk** ("טיול שבוצע") — treated as ordinary daily activity,
  not family configuration, so it stays open to everyone.
- **Multi-admin**: migration 0007 (`set_member_role`) allows more than one
  Admin per family. Promotion/demotion is Admin-only, target must be an
  active member of the same family, and a change that would leave the
  family with **zero** admins is rejected server-side (counts active admins
  excluding the target row).
- **Last-admin protection**: enforced in `set_member_role` (0007, demotion)
  and `admin_delete_family_member` (0004, extended by 0007 for deletion —
  "cannot remove the last admin of this family"). Client-side mirror:
  `isLastActiveAdminMember` / `handleLastAdminGuardedPress`
  (`src/logic/familyManagement.ts`) — explicitly documented as "Pure UX
  guard only — never the security boundary" and fails OPEN (does not block)
  if activity data hasn't loaded, leaving the server as the real backstop.
- **Client vs. server authorization**: repeatedly and explicitly documented
  throughout the codebase (`repository.ts`'s `deleteFamilyMember` doc
  comment, `familyStore.deleteUser`, `authStore.beginImpersonation`,
  `lib/family.ts`) that **client-side role/permission checks are a UX
  convenience only** — every sensitive mutation (`admin_delete_family_member`,
  `set_member_role`, `claim_family_profile`, the request-approval RPCs) is a
  SECURITY DEFINER Postgres function that independently re-derives the
  caller's identity/role from `auth.uid()` and rejects unauthorized callers
  regardless of what the client believes about itself.

## 8. Real QA Impersonation

Full design lives in `supabase/migrations/0006_qa_impersonation.sql`, client
side in `src/lib/supabase.ts` (`beginImpersonation`/`endImpersonation`/
`getWhoAmI`) and `src/store/authStore.ts`.

- **Purpose**: lets a real Admin verify end-to-end behavior (RLS visibility,
  RPC authorization, request creation) *as* another member, without
  physically signing in as them — something the earlier, purely
  client-side "Admin Test Mode" (`testModeUserId`) cannot do, since Test
  Mode never reaches the server.
- **`begin_impersonation(p_target_user_id)`**: SECURITY DEFINER RPC; only a
  real family admin (`is_real_family_admin()`) may call it, only for an
  active member of the caller's own family. Tracked in a new
  `impersonation_sessions` table keyed to the admin's own `auth.uid()`.
- **`end_impersonation()`**: safe no-op when nothing is active; called
  unconditionally/best-effort by `restoreSession()` on every cold start, by
  `signOut()`, and by `setFamilyId()` — so a killed/restarted app, a
  sign-out, or a family switch can never leave a server session dangling
  with no client-visible banner.
- **`current_profile_id()` / `is_family_admin()`**: redefined in 0006 to
  resolve as the impersonated member (via `active_impersonation_target()`)
  for the duration of a session — every existing RLS policy and RPC that was
  already calling these (all of 0002-0005) is affected automatically,
  without editing those files.
- **`real_current_profile_id()` / `is_real_family_admin()`**: new functions
  that always resolve the *actual* signed-in admin, independent of any
  active impersonation — used for admin-only management actions that must
  remain available to the real admin even mid-simulation (role management,
  audit log, starting/ending impersonation itself).
- **`isRealFamilyAdmin(familyRole, impersonatingUserId)`**
  (`src/store/authStore.ts`) — the client-side mirror of this distinction:
  `familyRole === 'admin' && impersonatingUserId === null`. Explicitly used
  to gate role-management UI so a member being impersonated never sees admin
  controls just because the underlying device is admin-owned.
- **Audit attribution**: `log_audit_event()` was redefined in 0006 (see
  `audit_log.impersonated_by_admin_user_id` column) so actions taken while
  impersonating are attributed to the effective (impersonated) actor **and**
  record which real admin was impersonating at the time — never silently
  merged into ordinary member activity.
- **Effective vs. real identity**: `useEffectiveUserId()`/
  `useEffectiveFamilyRole()` (`src/store/authStore.ts`) resolve to the
  impersonated member during a session (both for display and — unlike
  `testModeUserId` — for values that flow into actual mutations, since the
  server independently re-derives and validates them anyway).
- **Security invariant (explicitly documented, verified against code)**:
  real Admin powers must never leak while impersonating a Member —
  `is_family_admin()` itself resolves false during impersonation (0006),
  and `isRealFamilyAdmin()` client-side additionally hides role-management
  UI during a session, so both the server authorization and the client UI
  agree.
- **Mutual exclusivity with Admin Test Mode**: `enterTestMode`/
  `beginImpersonation` each explicitly refuse to start while the other is
  active or starting (`impersonationStarting` flag closes a round-5 race
  window documented in `authStore.ts`).

## 9. Walk Lifecycle

`ScheduleRule` → `generateRotationSchedule` (`src/logic/rotation.ts`)
produces `ScheduleEntry` rows for a date range → `scheduleStore`'s
`walkFromEntry` creates a matching `pending` `Walk`. From there:

- **Change/swap**: `swapWalk` (one-directional hand-off) or
  `swapWalksMutual` (two-way exchange) in `src/logic/walkActions.ts`,
  preserving the *original* responsible user in `walk.swap.originalUserId`
  across any number of swaps (`isCurrentlySwapped` correctly reports "not
  swapped" if a walk returns to its original assignee).
- **Done**: `markWalkDone` sets `status: 'done'`, `completedAt`,
  `completedByUserId`, and the pee/poop/note/duration fields; idempotent
  against a double-tap race (throws if already done).
- **Cancelled/skipped**: `markWalkSkipped` — only from `pending`.
- **History**: nothing is ever deleted for a `done` walk; `undoMarkDone`
  exists to revert a done walk back to pending.
- **Ad-hoc walks**: `addUnplannedWalk` (`scheduleStore.ts`) creates a `Walk`
  with `isUnplanned: true` and no `scheduleEntryId`, already `status: 'done'`
  — never touches the rotation/schedule.
- Fields carried per walk: `scheduledTime`, `date`, `responsibleUserId`,
  `completedByUserId`, `completedAt`, `note`, `hadPee`/`hadPoop`,
  `durationMinutes`.

## 10. Next Walk Logic

- `computeNextWalk(walks, now)` (`src/logic/nextWalk.ts`): filters to
  `status === 'pending'`, sorts by `walkDateTime` ascending, returns the
  earliest — including an overdue one if nothing is strictly future, per
  its own doc comment.
- The persisted `Walk` occurrence is authoritative — nothing recomputes
  "next walk" from the schedule rule; it always reads the actual `walks`
  array.
- After `markDone`, the just-completed walk drops out of `pending` (state
  update happens optimistically inside `scheduleStore.markDone`), so the
  next call to `computeNextWalk` naturally advances.
- Regression tests: `src/logic/__tests__/nextWalk.test.ts`,
  `src/store/__tests__/scheduleStore.test.ts`,
  `src/store/__tests__/scheduleStore.markDoneConflict.test.ts` — the latter
  specifically protects the A2 fix (not reverting an optimistic completion
  on a still-queued write).

## 11. Offline / Sync Architecture

- **`OfflineFirstRepository`** (`src/data/offlineFirstRepository.ts`): reads
  try the remote repository first when online (falling back to local cache
  on failure or offline); writes always go to `LocalRepository` first, then
  enqueue to `SyncQueue` and opportunistically `trySync()`.
- **`SyncQueue`** (`src/data/syncQueue.ts`): persistent FIFO in
  `AsyncStorage` (`dog-walk-family:sync-queue:v4`), with a one-time v3→v4
  migration. Each queued item is tagged with `claimedByUserId` — **owner
  protection**: `hasPendingForOtherUser()` blocks `authStore.signIn()` from
  letting a device re-claim a different profile while another member's
  queued writes are unflushed (prevents audit misattribution); `flush()`
  itself only ever replays items owned by whoever is *currently* claimed,
  skipping (not discarding) items owned by someone else, and **quarantining**
  (never auto-replaying) untagged/legacy items (`getQuarantined()`).
- **Retryable vs. permanent failures**: `isPermanentError()` treats
  Postgres SQLSTATE class `23` (integrity constraint violations) as
  permanent — dropped and recorded in `SyncConflict[]`, flush continues past
  it; anything else (network/timeout/5xx) is retryable and stops the flush
  there, preserved for the next attempt.
- **Conflicts**: `getConflictForWalk`/`clearConflictForWalk` — a later
  successful `saveWalk` for the same walk id clears any earlier stale
  conflict record (bug 3 fix), so `scheduleStore.markDone` never wrongly
  reverts a since-succeeded completion.
- **Cold-start ordering**: `App.tsx`'s `performColdStart()` fully awaits
  `restoreSession()` before ever calling `runForegroundSync()` (bug 2 fix —
  previously `trySync()` could run before `currentUserId` was restored,
  silently skipping queued writes with no retry until the next foreground).
- **Foreground sync ordering**: see §5 — `runForegroundSync()`'s 5-step
  order, de-duplicated via `foregroundSyncPromise`.
- **Operations allowed offline**: everything routed through `Repository`
  (`upsertUser`, `saveWalk`, `upsertScheduleRule`, etc.) is queued and
  replayed later.
- **Operations deliberately NOT allowed offline / not queued**:
  `deleteFamilyMember` (see below), and everything in `lib/requests.ts`
  (swap/time-change create+approve+reject) and `lib/family.ts`'s
  `setMemberRole` — these bypass `Repository`/`SyncQueue` entirely and talk
  directly to Supabase RPCs, throwing immediately if offline, specifically
  because they are approval-sensitive/business-rule-sensitive server
  operations where a queued "already applied" write could show a false
  success.
- **`deleteFamilyMember` server-authoritative behavior** (Round 7 fix,
  documented at length in `offlineFirstRepository.ts`): online, the remote
  RPC is called directly and awaited *before* touching the local cache, so
  a server rejection (e.g. last-admin) propagates to the caller instead of
  being silently swallowed by `SyncQueue.flush()`'s internal
  catch-and-record behavior. Offline, it throws immediately with **no**
  local mutation and **no** enqueue at all (mapped to a friendly Hebrew
  "no connection" message in `errorMessages.ts`). A legacy queued
  `deleteFamilyMember` from a pre-fix app version is discarded (not
  replayed) the first time `SyncQueue.load()` runs post-update
  (`discardLegacyDeleteFamilyMember`), and recorded as quarantined rather
  than silently vanishing.

## 12. Notifications

- **Local reminder types**: `pre_walk_reminder` (default 15 min before) and
  `overdue_reminder` (default 10 min after), computed by
  `planWalkNotifications` (`src/logic/reminders.ts`).
- **Deterministic notification IDs**: `notif:{walkId}:{kind}`
  (`notificationIdentifier`, `src/notifications/notificationService.ts`) —
  the fix for "notification shows wrong responsible person" (round 6,
  priority A3): scheduling with the same identifier replaces the OS
  notification in place, so nothing depends on lost in-memory bookkeeping
  surviving an app restart.
- **Reassignment handling**: `scheduleWalkNotifications` reschedules from
  the walk's *current* data every time it's called; it does not blanket
  cancel-then-reschedule (would create false "orphaned" signals), only
  cancels kinds that are no longer applicable.
- **Orphan cleanup**: `cancelOrphanedWalkNotifications` (bug 4 fix) enumerates
  everything actually scheduled on the OS and cancels any app-owned
  walk-reminder whose walk id is absent from the current walk set entirely
  (covers a walk deleted on another device).
- **Notification reconciliation**: `reconcileWalkNotifications`/
  `reconcileScheduleNotifications` — run on app startup, foreground,
  schedule reload, and after approved swap/time-change requests.
- **Source of responsible-user name**: always the *current* family member
  record at reconciliation time (`usersById.get(userId)?.name` in
  `scheduleStore.reconcileScheduleNotifications`), not a value baked in when
  the walk was first created.
- **App foreground/start reconciliation**: `App.tsx`'s
  `reconcileNotificationsNow()`, gated to run only after a fresh
  (non-stale) schedule reload — see §5.
- **Current limitations**: only **local**, on-device scheduled notifications
  exist (`expo-notifications` local API). No remote/push notification
  implementation is present anywhere in `src/notifications/` or the
  Supabase migrations — confirmed by absence, and by `app.json`'s
  `UIBackgroundModes: ["remote-notification"]` being declared but nothing
  in the code sending or receiving a push payload. This matches
  `PROJECT_STATUS.md`'s known-limitations list.

## 13. Requests

- **Swap requests** (`walk_swap_requests`, migration 0005): Member→Member.
  Created by `create_swap_request`, approved/rejected only by the named
  `target_user_id` (**not** the Admin — "Admin is deliberately NOT a party
  to this workflow", per the migration's own comment). Snapshots
  `expected_responsible_user_id`/`expected_status`/`expected_scheduled_time`
  to detect staleness at approval time.
- **Time-change requests** (`time_change_requests`, migration 0005):
  Member→Admin. Created by `create_time_change_request` (validates
  `HH:mm` format, walk still pending, requester is currently responsible, no
  existing pending request for that walk), approved only by an Admin
  (`approve_time_change_request`), which re-validates the walk hasn't
  materially changed since request creation (time, status, *and*
  responsible user — "Round 4 gap fix").
- **Who may create**: the walk's current `responsibleUserId` only (both
  request types).
- **Who may approve**: swap → the named target member; time-change → any
  family Admin.
- **Who can see which request**: RLS policy `"select relevant swap
  requests"` — visible to the requester, the target, or any family Admin
  (auditing) — Admin cannot approve/reject a swap but can see it exists.
  Time-change requests' listing (`listTimeChangeRequests`,
  `src/lib/requests.ts`) is described as "ones it created, or (admin) any in
  the family" — i.e. non-admin members only see their own time-change
  requests, unlike swap requests which both parties see.
- **RLS/RPC behavior**: no direct `INSERT`/`UPDATE`/`DELETE` policy on
  either request table — every write goes through a SECURITY DEFINER
  function, so authorization and staleness checks are always server-side.
- **Future-walk request support**: neither `create_swap_request` nor
  `create_time_change_request` restricts by date — only by `status =
  'pending'` and requester-is-responsible — so requests work identically for
  today's walks and any future-dated pending walk. No explicit "future
  walk" special-casing was found in the code; this is simply a consequence
  of walks being addressed by id, not by date.
- **Time-picker UX**: `RequestTimeChangeModal.tsx` uses the native
  `@react-native-community/datetimepicker` (replacing an earlier free-text
  `HH:MM` entry — documented as an "A5 (round 6)" fix), with a before/after
  preview.
- **User-facing Hebrew errors**: every raw RPC rejection is mapped through
  `friendlyErrorMessage`/`SHARED_ERROR_RULES` (`src/lib/errorMessages.ts`) —
  a centralized substring-match table covering request conflicts, staleness,
  ownership, last-admin, impersonation, and generic network failures — so no
  raw Postgres/English error reaches the user.

## 14. Presence

- **`touch_last_seen()`** (migration 0005, updated for impersonation in
  0006): writes `user_presence.last_seen_at` for the caller's own resolved
  profile; called from `App.tsx`'s `runForegroundSync()` (step 5, cheap
  housekeeping, deliberately last).
- **`last_seen_at`** surfaced only via `admin_list_family_activity()`
  (0005) — Admin-only RPC (raises for a non-admin caller).
- **Active-now threshold**: 5 minutes (`PRESENCE_FRESH_MINUTES`,
  `src/logic/presence.ts`) — chosen to match `AdminActivityModal`'s own
  freshness label.
- **Admin-only visibility**: confirmed current design — `presence.ts`'s own
  doc comment states presence display "stays Admin-only this round rather
  than being broadened."
- **Compact vs. detailed formatter**: `describePresence()` (full, used in
  `MemberDetailsModal`) vs. `describePresenceCompact()` (shorter, used in
  the Family screen row subtitle — "role · presence"). The compact variant
  was introduced because real-device QA found the Family row truncating
  ("Round 8, Fix 2"), and a documented follow-up further shortened the
  same-day/yesterday cases by dropping a leftover "נראה" prefix. The code
  and its doc comments explain *why* each change was made and record that
  the *automated* test suite passed afterward — they are not, by
  themselves, evidence that the resulting UI was subsequently rendered and
  inspected on a device. **Final real-device visual QA of the latest
  compact-formatter follow-up has not yet been confirmed** — see
  `PROJECT_STATUS.md` §5 for the full chronology and current pending
  status. Do not infer QA completion from source-code comments alone.
- **Behavior under impersonation**: `touch_last_seen()` was updated in 0006
  to resolve the correct effective profile during an impersonation session
  (per the migration's own note); not independently re-verified beyond the
  migration's stated intent.
- **Refresh behavior**: presence data is only as fresh as the last
  successful `admin_list_family_activity()` call — no background polling; a
  foreground-only heartbeat means "active now" can never show stale for
  long (per `presence.ts`'s own reasoning).

## 15. Family Management

- **Add/edit member**: `familyStore.addUser`/`updateUser` — plain
  `repository.upsertUser`, no special RPC.
- **Remove member**: `familyStore.deleteUser` — computes
  `planUserRemoval` (`src/logic/familyManagement.ts`, pure/client-side) to
  reassign future rotation turns/entries/pending walks (to a replacement or
  by dropping from the rotation if someone else remains), then calls
  `repository.deleteFamilyMember`, which in Supabase mode is one atomic
  SECURITY DEFINER RPC (`admin_delete_family_member`, 0004/0007) — never a
  raw `DELETE`; always a soft-delete (`removed_at`). Completed walks
  (`status = 'done'`) are never touched.
- **Role editing / multi-admin UI**: `MemberDetailsModal` (role controls),
  gated by `isRealFamilyAdmin()`; backed by `setMemberRole`
  (`src/lib/family.ts`) → `set_member_role` RPC (0007).
- **Last-admin delete guard**: client UX guard
  `isLastActiveAdminMember`/`handleLastAdminGuardedPress`
  (`src/logic/familyManagement.ts`, "Round 8, Fix 1" — also fixed a
  real-device touch-propagation bug where a disabled inner `Pressable`
  still let a tap reach the row's outer `onPress`). Server backstop:
  `admin_delete_family_member`'s 0007 extension.
- **Walk reassignment during deletion**: `planUserRemoval` only reassigns
  **future, still-pending** rotation entries/walks (`date >= today`,
  `status === 'pending'`); throws `FamilyManagementError` if a rule would be
  left with zero rotation members and no replacement was given.
- **Offline deletion rules**: `deleteFamilyMember` is offline-exempt — see
  §11 — never silently applied locally while offline.

## 16. Database / Supabase — Migration Map

All files under `supabase/migrations/`, in order. **Deployment status of
any given migration on the actual live Supabase project is NOT derivable
from the repository alone** — several migrations' own header comments
*assert* that prior migrations are "already deployed to the live project"
(0005's and 0006's headers both say this of 0001-0004 / 0001-0005
respectively), which is evidence of developer intent/belief at the time
those files were written, not proof of current deployment state. Treat
actual deployment as **externally tracked** unless a future migration file
says otherwise.

| # | File | Purpose | Key tables/functions | Redefines earlier functions? |
|---|---|---|---|---|
| 0001 | `0001_family_management_and_walk_details.sql` | Photo storage, walk detail fields, initial "any authenticated caller" RLS bootstrap for a single-family deployment. | `users.photo_url`, `schedule_rules.label/sort_order`, `walks.had_pee/had_poop/note/duration_minutes/is_unplanned`, `family-photos` Storage bucket. | — |
| 0002 | `0002_invite_codes_and_family_membership.sql` | Real per-device family membership via invite codes; narrows 0001's "any device" RLS to "your own family only". | `families.invite_code`, `family_auth_members`, `generate_invite_code()`, `find_family_by_invite_code()`, `create_family()`, `join_family()`, `regenerate_invite_code()`, `current_family_id()`. | Yes — redefines `current_family_id()` from 0001 to read `family_auth_members` instead of `users.auth_user_id`. |
| 0003 | `0003_family_admin_roles.sql` | Device-level Admin/Member roles. | `family_auth_members.role`, `current_family_role()`, `is_family_admin()`. | — |
| 0004 | `0004_admin_permissions_and_member_deletion.sql` | Admin-only `schedule_rules` writes; atomic, soft-delete member removal. | `admin_delete_family_member()`, `claim_family_profile()`. Explicitly notes an earlier hard-delete draft was caught and fixed before ever shipping. | — |
| 0005 | `0005_requests_audit_presence.sql` (largest, 1328 lines) | Swap/time-change requests, audit log, presence, write-authorization triggers on `walks`/`schedule_entries`, search_path hardening. | `current_profile_id()`, `enforce_walk_write_authorization()`, `enforce_schedule_entry_write_authorization()`, `audit_log`, `log_audit_event()`, `walk_swap_requests` + RPCs, `time_change_requests` + RPCs, `user_presence`, `touch_last_seen()`, `admin_list_family_activity()`, `admin_list_audit_log()`, audit triggers. | Yes — re-defines `admin_delete_family_member()`/`regenerate_invite_code()` "identically to their deployed 0004 versions" plus an added audit-log call each. |
| 0006 | `0006_qa_impersonation.sql` | Real QA impersonation. | `impersonation_sessions`, `real_current_profile_id()`, `is_real_family_admin()`, `active_impersonation_target()`, `begin_impersonation()`, `end_impersonation()`, `whoami()`. | Yes — redefines `current_profile_id()`, `is_family_admin()`, `log_audit_event()`, `admin_list_audit_log()`, `create_swap_request()`/`approve_swap_request()`/`reject_swap_request()`, `create_time_change_request()`/`approve_time_change_request()`/`reject_time_change_request()`, `touch_last_seen()` — all to make them impersonation-aware. Explicitly leaves `current_family_role()` unchanged (see its own section-3 comment). |
| 0007 | `0007_multi_admin_roles.sql` | Multi-admin promotion/demotion with last-admin protection. | `set_member_role()`. Uses a per-family `pg_advisory_xact_lock` to prevent a concurrent double-demotion race. | Extends `admin_delete_family_member()`'s last-admin check per its own header (not re-verified line-by-line in this pass — see `PROJECT_STATUS.md`). |
| 0008 | `0008_family_invites.sql` | Family Invite feature (member-specific invites, Model B): admin creates a one-time invite for one specific unclaimed `users` row; 72h TTL; raw token generated in Postgres, returned once, never persisted (only its sha-256 hash). | `family_invites` table (RLS enabled, zero client policies), `create_family_invite()`, `revoke_family_invite()`, `list_family_invites()`, `inspect_family_invite()`, `redeem_family_invite()`. | — (five new functions; no existing function redefined). |
| 0009 | `0009_family_invites_pgcrypto_fix.sql` | Additive runtime-compatibility fix for 0008 — **not** a behavior change. Live Supabase QA found `create_family_invite()` failing because the live project hosts pgcrypto's `gen_random_bytes`/`digest` under the `extensions` schema, unreachable from 0008's `set search_path = public` SECURITY DEFINER functions when called unqualified. | Redefines only `create_family_invite()`, `inspect_family_invite()`, `redeem_family_invite()` — each with `gen_random_bytes(...)`/`digest(...)` calls schema-qualified to `extensions.gen_random_bytes(...)`/`extensions.digest(...)`. `search_path` itself is left as `public` (explicit qualification preferred over widening what a SECURITY DEFINER function implicitly trusts). | Yes — redefines the three 0008 functions above identically except for pgcrypto qualification; `revoke_family_invite()`/`list_family_invites()` untouched (neither calls pgcrypto). Deployed and verified live (see `PROJECT_STATUS.md` §2). |

`supabase/schema.sql` is described in `README.md` as the from-scratch DDL
for a brand-new project (superseding 0001 for a fresh install); `seed.sql`
seeds the "our family" demo data.

## 17. RLS / RPC Security Model

- **SECURITY DEFINER functions** are the *only* way to perform every
  sensitive mutation: `claim_family_profile`, `create_family`/`join_family`/
  `regenerate_invite_code`, `admin_delete_family_member`, `set_member_role`,
  the swap/time-change request lifecycle, `begin_impersonation`/
  `end_impersonation`, `log_audit_event` (its own EXECUTE is revoked from
  `PUBLIC`/`anon`/`authenticated` — only callable *from inside* another
  SECURITY DEFINER function, per its owner's implicit execute rights).
- **`current_family_id()`**, **`current_profile_id()`**,
  **`is_family_admin()`** are the shared primitives every RLS policy and RPC
  is built on; all three are derived from `auth.uid()` (never a
  client-supplied value), and 0006 redefines the latter two to be
  impersonation-aware.
- **`isRealFamilyAdmin`** — client-side only (§7/§8); not a security
  boundary.
- **Request visibility**: see §13 — RLS `SELECT` policies scoped by
  requester/target/admin; no direct write policies on request tables.
- **Role-management security**: `set_member_role` re-checks admin status
  fresh every call, rejects a target who isn't an active member of the same
  family, and uses an advisory lock to make the last-admin count check race-
  safe under concurrent calls.
- **Last-admin invariant**: enforced in two places server-side —
  `set_member_role` (demotion) and `admin_delete_family_member`'s 0007
  extension (deletion) — both counting active admins excluding the target.
- **Cross-family protections**: every lookup RPC re-checks
  `family_id = current_family_id()` (or resolves via the caller's own
  family) before acting; `find_family_by_invite_code` deliberately returns
  only `id`/`name`/`dog_name`, nothing else, and cannot be used to enumerate
  families.
- **Audit logging**: see §18.
- **Impersonation safeguards**: see §8 — restart-safety
  (`end_impersonation()` called unconditionally on `restoreSession`/
  `signOut`/`setFamilyId`), re-entrancy guard (`impersonationStarting`),
  mutual exclusivity with Test Mode, server-side re-validation on every call
  via `active_impersonation_target()` regardless of client state.

## 18. Audit Logging

- **`log_audit_event(family_id, actor_user_id, action, target_type,
  target_id, metadata)`** (0005, redefined in 0006 for impersonation
  attribution) — the single insertion point for `audit_log`.
- **`admin_list_audit_log(limit, offset)`** (0005, redefined in 0006) —
  Admin-only read RPC; client wrapper `adminListAuditLog`
  (`src/lib/requests.ts`).
- **`actor_user_id`**: always server-resolved, never client-supplied.
- **Impersonation attribution**: `audit_log.impersonated_by_admin_user_id`
  (added in 0006) records which real admin was impersonating at the time of
  an audited action, alongside the effective (impersonated) `actor_user_id`.
- **Role-change audit events**: `set_member_role` (0007) calls
  `log_audit_event` on every successful change — "no new audit mechanism
  invented," per its own header comment.
- **Request audit events**: `time_change_request_created`/`_approved`/
  `_rejected` and their swap-request equivalents are logged via
  `log_audit_event` at each RPC's success path.
- **Other tracked events**: server-authored triggers on `walks`/
  `schedule_rules`/`users` (`audit_walk_change`, `audit_schedule_rule_change`,
  `audit_user_profile_change`, all in 0005) — the migration's own comment
  explains an earlier, client-callable "please log this" RPC was removed
  before ever shipping, in favor of these triggers deriving the actor from
  the actual row change itself, which "can never be logged without the
  change really happening."

## 19. UI / UX Principles

Established conventions actually found in code (not aspirational):

- **Hebrew-first, RTL**: all user-facing strings across screens/components/
  error messages are Hebrew; `README.md` documents `SafeAreaView` from
  `react-native-safe-area-context`, `start`/`end` instead of `left`/`right`,
  `textAlign: 'right'` for titles/labels, `numberOfLines` to prevent
  overflow.
- **Friendly Hebrew user-facing errors, never raw Postgres/English text**:
  centralized in `src/lib/errorMessages.ts`'s `friendlyErrorMessage` /
  `SHARED_ERROR_RULES`, used by `requestsStore`, `familyStore.deleteUser`,
  `LoginScreen`'s `claimErrorMessage`, and others.
- **Compact mobile layout / native pickers over free text**: e.g.
  `RequestTimeChangeModal`'s switch from manual `HH:MM` text entry to the
  native `DateTimePicker` (round-6 A5 fix), explicitly citing UX quality
  (invalid input possible until submit, worse numeric-keyboard typing
  experience).
- **Admin-only controls hidden but never solely client-enforced**: every
  Admin-only screen affordance is paired with a server-side check (see §7).
- **Family row behavior / role & presence display**: Family screen row
  subtitle format is "role · presence" using the compact presence formatter
  (§14); presence itself is Admin-only.
- **Modal patterns**: `KeyboardAvoidingView` wraps request-style modals even
  when the current modal has no text field, deliberately kept "shared by
  other request modals in this codebase with a notes/reason field" (per
  `RequestTimeChangeModal.tsx`'s own comment) — i.e. consistency across the
  modal family is treated as a real UX principle, not accidental leftover
  code.
- **Toggle-button data entry over typing**: pee/poop/notes are entered via
  "large toggle buttons," per `README.md`, not free-text keyboard entry.

This section intentionally does not extend beyond what the above evidence
supports — no aspirational UI conventions are listed.

## 20. Security Invariants — NEVER BREAK

Each verified against the actual code cited:

1. **Never trust client role for authorization.** Every admin-only mutation
   (`admin_delete_family_member`, `set_member_role`, schedule-rule writes)
   is re-checked server-side via `is_family_admin()`/`is_real_family_admin()`
   derived from `auth.uid()` — confirmed in 0004/0005/0007 and explicitly
   documented in `repository.ts`, `familyStore.ts`, `authStore.ts`.
2. **Never leave a family with zero admins.** `set_member_role` (0007) and
   `admin_delete_family_member`'s 0007 extension both count active admins
   excluding the target and reject a change that would zero it out, guarded
   by a per-family advisory lock against a concurrent-demotion race.
3. **Never expose unrelated member requests.** RLS `SELECT` policies on
   `walk_swap_requests`/`time_change_requests` scope to requester/target/
   admin only (§13/§17).
4. **Never allow real-admin permissions during impersonation.**
   `is_family_admin()` resolves false during an active impersonation
   session (0006); `isRealFamilyAdmin()` additionally hides role-management
   UI client-side (§8).
5. **Never replay another user's queued writes.** `SyncQueue`'s
   `claimedByUserId` tagging + `hasPendingForOtherUser`/`flush()`'s
   owner-matching logic (§11) — untagged/legacy items are quarantined, never
   auto-replayed under a guessed owner.
6. **Never treat stale local data as newer than authoritative server
   state.** `scheduleStore.load()` returns a boolean success signal so
   callers (notably `App.tsx`'s notification reconciliation) can tell fresh
   data from stale leftovers and skip acting on stale data (§5/§11).
7. **Never silently accept server-sensitive destructive actions offline.**
   `deleteFamilyMember`, and everything in `lib/requests.ts`/
   `lib/family.ts`'s `setMemberRole`, throw immediately when offline rather
   than queuing an optimistic local mutation (§11/§13).
8. **Never modify deployed migrations in place.** Every migration file's own
   header comment states this convention explicitly (e.g. 0004's "if you
   already ran the earlier draft against a real database, do NOT re-run this
   file as-is"; 0005/0006's "does NOT touch any of those files" regarding
   prior migrations) — a repository-wide, self-documented practice, not
   merely an external instruction.

## 21. Testing Architecture

- **Jest setup**: `package.json`'s `jest` config uses preset `jest-expo`,
  `setupFiles: ["./jest.setup.js"]`, and a `transformIgnorePatterns`
  allow-list for RN/Expo packages.
- **Test locations** (24 files found under `__tests__/` directories):
  - `__tests__/App.test.ts` — app orchestration (cold-start sync race,
    foreground sync ordering).
  - `src/data/__tests__/` — `localRepository.test.ts`,
    `offlineFirstRepository.test.ts`, `supabaseRepository.test.ts`,
    `syncQueue.test.ts`.
  - `src/logic/__tests__/` — `dateFormat.test.ts`,
    `familyManagement.test.ts`, `nextWalk.test.ts`, `presence.test.ts`,
    `reminders.test.ts`, `rotation.test.ts`, `walkActions.test.ts`.
  - `src/lib/__tests__/` — `errorMessages.test.ts`, `family.test.ts`,
    `requests.test.ts`, `supabaseFamily.test.ts`, `uploadImage.test.ts`.
  - `src/notifications/__tests__/notificationService.test.ts`.
  - `src/store/__tests__/` — `authStore.test.ts`, `familyStore.test.ts`,
    `requestsStore.test.ts`, `scheduleStore.test.ts`,
    `scheduleStore.loadResult.test.ts`, `scheduleStore.markDoneConflict.test.ts`,
    `testModeGuard.test.ts`.
  - Manual SQL tests: `supabase/manual_tests/` —
    `0004_claim_race_test.sh`, `0004_profile_edit_acl.sql`,
    `0005_requests_audit_presence_acl.sql`,
    `0006_qa_impersonation_acl.sql`, `0007_multi_admin_acl.sql`,
    `idan_claim_diagnostic.sql`, `0008_family_invites_acl.sql`.
- **Categories**: store tests (orchestration/mutation logic), repository
  tests (offline/sync behavior), logic tests (pure business rules), a
  notification test, and one app-level orchestration test.
- **Family Invite feature test additions (Rounds 2-4, post-dates the 24-file
  count above)**: `src/lib/__tests__/invites.test.ts` (call-shape,
  error-mapping, and token-safety coverage for `src/lib/invites.ts`),
  `src/logic/__tests__/familyInvites.test.ts` (pure eligibility/status/
  wording/parse logic for the admin invite UI and, since Round 4, the
  manual redemption paste flow's `parseInviteInput`), extensions to the
  existing `src/lib/__tests__/errorMessages.test.ts`, extensions to
  `src/store/__tests__/authStore.test.ts` (Round 4 — the pending-redemption
  commit/recovery state machine: `completeInviteRedemption`,
  `retryPendingInviteRedemptionVerification`, and `restoreSession`'s
  restart recovery), and the new `src/screens/__tests__/
  FamilyOnboardingScreen.tokenSafety.test.ts` (Round 4 — structural
  source-text guard, in the same style as `invites.test.ts`'s own
  "no forbidden imports" check, confirming the redemption screen never
  imports `AsyncStorage` directly and never references `SyncQueue`/
  `LocalRepository`/`OfflineFirstRepository`).
- **Local-machine verified baseline; not reproduced during this archaeology
  pass**: `npm run typecheck` => PASS; `npm test -- --runInBand` => Test
  Suites: 25 passed, 25 total; Tests: 303 passed, 303 total; Snapshots: 0
  total. This was actually executed by the developer on their local
  machine against this project baseline — it is a real, reported test run,
  not merely an unverified historical claim. **This archaeology pass could
  not reproduce it**: this sandbox has no `npm`/registry access (no
  `node_modules` present). `README.md`'s "הערה חשובה" section separately
  notes that the code was originally *authored* without registry access
  and verified by reading alone at that time — that is a distinct, earlier
  fact from the 25/303/typecheck run above, which came later and was
  genuinely executed. Consistently throughout this document and
  `PROJECT_STATUS.md`, treat the 25/303/typecheck figures as **verified on
  the developer's local machine, not independently reproduced by this
  archaeology pass**.
- **Superseding baseline — after Family Invite Rounds 1-3 (automated,
  local-machine reported, not reproduced in any assistant sandbox)**:
  `npm run typecheck` => PASS; `npm test -- --runInBand` => Test Suites:
  **27 passed, 27 total**; Tests: **373 passed, 373 total**. Retained here
  only as historical context — see the Round 4 figure below for the
  current number.
- **Current baseline — after Family Invite Round 4 (automated,
  local-machine reported, not reproduced in any assistant sandbox)**:
  `npm test -- --runInBand` => Test Suites: **28 passed, 28 total**; Tests:
  **392 passed, 392 total**; Snapshots: **0 total**. This is the **current**
  automated baseline; the 25/303 and 27/373 figures above are retained only
  as historical context. `npm run typecheck`'s result was not separately
  reported alongside this specific run, so it is not restated as PASS for
  this checkpoint — the last explicitly reported typecheck PASS remains the
  one accompanying the 27/373 figure above. Separately, both the admin
  invite creation/management flow (Round 3) and the invited-user manual
  paste-and-redeem flow (Round 4) were verified on a real iPhone via Expo
  Go against the live Supabase project — see `PROJECT_STATUS.md` §1/§3 for
  that real-device QA checkpoint, which is additional to, not a substitute
  for, this automated run.

## 22. Development Rules for Humans and AI

1. Read `PROJECT_DNA.md` (this file) before making any architectural
   assumption.
2. Read `PROJECT_STATUS.md` for current baseline, known issues, and planned
   work before starting new work.
3. Inspect the current code (the actual file, not memory of a prior round)
   before editing anything — this codebase has been through many
   documented rounds of fixes; assume nothing about "how it used to work."
4. Do not rewrite a deployed migration in place — add a new migration file
   instead (see §20, invariant 8, and every migration's own header comment).
5. Preserve every invariant in §20 — treat them as hard constraints, not
   suggestions.
6. Add a regression test for any bug fix, in the same style/location as the
   existing test that would have caught it (see §21's category map).
7. Run `npm run typecheck` before considering a change complete.
8. Run `npm test` (Jest) before considering a change complete.
9. Never claim tests passed, or a typecheck succeeded, unless you actually
   executed the command and observed the result in this session — this
   document itself deliberately avoids claiming the reported 25/25/303/303
   baseline was reproduced, because it was not.
10. Do not infer server-authoritative behavior from UI alone — where a
    SECURITY DEFINER RPC or RLS policy exists, that is the actual
    authorization boundary; the UI is, at most, a convenience layered on
    top (see §7/§17).
