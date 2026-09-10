# Walkie Doggy Link — Product Context

## Purpose and evidence standard

This is persistent product knowledge for the **Walkie Doggy Link Creative Director**. It records current repository evidence so future UI, UX, brand, mascot, animation, responsive, onboarding, email, and visual decisions begin with the product that exists—not an assumed product.

Current implementation takes precedence over older documentation. Where the two differ, the discrepancy is called out below.

## Product identity

**Walkie Doggy Link** is a Hebrew-first, RTL family dog-walking coordination application. A family creates or joins a shared family space, selects a family-member profile on each device, and uses schedules, walk records, reminders, and requests to coordinate who takes their dog out and whether a walk was completed.

Repository evidence supports Expo/React Native delivery on iOS, Android, and web; iOS tablet support is enabled. The application is portrait-oriented in its current Expo configuration. It is not appropriate to infer broader marketing claims from the code.

## Critical terminology

### Family dog

Each family has its own dog. `dogName`/`Dog.name` is dynamic family data, shown in current screen copy and editable through the dog-details experience. “טופי” is a dog name used by one family/demo data and must never be hard-coded as the identity of the product mascot.

### Brand mascot

The illustrated dog character represents **Walkie Doggy Link** itself. It is the Walkie Doggy Link mascot, not “טופי”. UI copy, accessibility labels, animations, code comments, and design documentation must preserve this distinction.

### Other current terms

- **Family member/profile:** a `FamilyUser` record in a family; inactive/removed profiles remain resolvable for historical attribution but are excluded from new-assignment pickers.
- **Family role:** `admin` or `member`. Admin-only UI is a convenience; server-authoritative permission checks remain decisive.
- **Scheduled walk:** a concrete dated schedule occurrence generated from a recurring schedule rule.
- **Schedule rule:** a recurring time, optional label, selected weekdays, and member rotation.
- **Walk:** a record with `pending`, `done`, or `skipped` status. The responsible person and the actual completer may differ.
- **Unplanned/spontaneous walk:** a walk logged as already happened (`isUnplanned`), rather than generated from a schedule rule.
- **Overdue:** a still-pending walk whose local scheduled date/time has passed. **Requires attention** is a derived visual state at 30 minutes after scheduled time.
- **Swap request / time-change request:** live, approval-based request flows rather than ordinary offline schedule edits.
- **Demo/local mode:** the app can run without Supabase using local seeded data; some shared/server features are unavailable there.

## User and family model

A family is the shared coordination boundary. It has family members, one dog, recurring rules, dated entries, and walk history. In Supabase mode, creating a family makes the creator an admin; joining uses a family invite mechanism. The exact database authorization mechanics are intentionally omitted here except where they affect UX.

The device/auth/profile distinction matters:

- A device holds an anonymous Supabase authentication session when configured.
- The user-facing choice is a family-member profile; claiming it connects that device/session to that profile.
- A profile already claimed elsewhere can be reclaimed or selected on a shared device using its PIN flow. Switching to another profile on the same device also asks for the target profile PIN.
- A user without a selected profile sees the profile-selection login experience; a configured device with no family sees family onboarding first.
- Admin/member role, Test Mode, and real QA impersonation can alter which controls and data are visible. Visual design must not imply that hiding a control is the authorization boundary.

## Core user journeys

### Create or join a family

**Goal:** enter a shared family space. **Start:** configured Supabase mode with no family selected. **Steps:** onboarding offers family creation, joining through the current invite-code path, and the repository also contains invited-user redemption support. **Success:** the device has a family context and proceeds to select/claim its family-member profile. **Important states:** invalid/expired/revoked invite, connection failure, and invite-redemption verification recovery are handled as distinct states in implementation.

### Select or claim a profile

**Goal:** act as the correct family member on this device. **Start:** login/profile picker. **Steps:** choose an active profile; when a normal claim conflicts or a user switches identity, enter the appropriate PIN. **Success:** the profile, role, and family context are refreshed and the tabbed app opens. **Important states:** no active profiles, removed profile, invalid PIN, a claim held on another device, and pending queued writes belonging to a different profile.

### Understand and resolve the next walk

**Goal:** know what requires action now. **Start:** Home. **Steps:** review the primary next-walk card, responsible person, timing, and status; eligible people can complete or mark an overdue walk not completed. **Success:** the walk resolves as `done` or `skipped`, and the home priority advances. **Important rule:** the earliest unresolved overdue walk outranks a later future walk and must not be silently replaced by it.

### Complete or log a walk

**Goal:** accurately record a completed walk. **Start:** Home or Schedule for an eligible current/overdue assignment, or the add-unplanned flow. **Steps:** completion modal captures completion data; existing implementation includes duration, notes, and pee/poop toggles. A spontaneous walk is explicitly created as already completed. **Success:** a walk becomes `done`, retains actual completer/completion time, and Home can show a celebration. **Important states:** a competing completion or sync conflict must not be presented as confirmed remote success.

### Manage the schedule

**Goal:** review today, tomorrow, or this week and maintain recurring responsibilities. **Start:** Schedule tab. **Steps:** view grouped dated walks; an admin can add, edit, or delete recurring rules and edit/cancel pending occurrences. A member can request eligible future changes rather than directly changing the schedule. **Success:** future responsibility/time is updated, or a request awaits its approver. **Important states:** no walks in range, no recurring times, removed people unavailable for new assignments, loading/error, and overdue resolution.

### Request a swap or a time change

**Goal:** ask for a future assignment to change. **Start:** an eligible future pending walk in Home or Schedule. **Steps:** choose a compatible counterpart for a swap, or propose a time change. Swap requests are member-to-member; time changes are member-to-admin. **Success:** the approver accepts or rejects, then the relevant schedule reloads and request status is reflected on the walk. **Important states:** pending, approved, rejected, and expired requests; request actions require a live Supabase connection and are unavailable in demo/local mode.

### Review history and statistics

**Goal:** see completed/resolved walk records and aggregate information. **Start:** their tabs, when the effective profile’s verified permission allows access. **Success:** historic walk details retain person attribution even after a member is removed. **Important state:** access is fail-closed while per-member permission overrides are unknown or fail to load.

### Manage family, dog, and settings

**Goal:** maintain household details. **Start:** Family and Settings. **Steps:** admins add/edit/remove members, manage roles/permission overrides, and can access activity/invite-related experiences; users can edit eligible profile details, change dog details/photo, configure reminders, share the family, and switch profile. **Important states:** the last active admin cannot be removed/demoted; some management, audit, invite, presence, and role information is admin-only; local/demo mode omits server-dependent features.

## Walk model and daily experience

Recurring rules generate schedule entries and pending walk occurrences. Walks have a date, scheduled time, responsible member, status, and may retain swap history. A resolved walk can record who actually completed it, completion time, duration, pee/poop details, and a note. `done` and `skipped` are distinct resolved outcomes.

Spontaneous/ad-hoc walks are supported as already-completed, unplanned records; they are not generated from a schedule rule. Pending overdue walks receive special urgency treatment; current code derives both overdue and the stronger 30-minute “requires attention” presentation state rather than storing them as separate statuses.

Home focuses first on the single actionable next walk, then supplementary context such as the most recent resolved walk and upcoming work. Schedule supports a broader chronological view. Design must retain the distinction between a planned responsibility and who ultimately completed it.

## Home experience

Home is the action-oriented daily surface. It loads family and schedule data, prioritizes the next unresolved task, supports pull-to-refresh, and hosts the main walk-related overlays: completion, spontaneous-walk entry, schedule editing/pickers for eligible actions, requests inbox, and confirmation/error surfaces.

The confirmed priority algorithm is: select the earliest pending overdue walk if any; otherwise select the earliest future pending walk. Therefore, an unresolved overdue/pending walk remains the primary action instead of being replaced by the next future walk. Delight, history, and mascot presentation must remain secondary to resolving that task.

## Mascot experience

Current mascot use cases are:

- A reusable stateful mascot in the Home experience, derived from walk timing (`idle`, `excited`, `ready`, `waiting`, `concerned`, `success`).
- A completion celebration overlay with a speech bubble, optional restrained confetti, a continuation action, and a curated celebration selection.
- A notification-open reminder prompt with a speech bubble; it dismisses automatically or on tap.

Reduced Motion is checked through the OS accessibility setting. Frame playback stays static when Reduced Motion is on or there are fewer than two frames. The general mascot component also defaults to static until the OS preference is known.

The architecture supports local frame sequences with a static fallback. However, final frame packs and the approved clean mascot master are explicitly pending. Current celebration/reminder frame arrays resolve to the existing mascot fallback, and the stateful mascot’s whole-image transforms are documented in code as a **temporary fallback**, not final character animation. Do not describe final internal character artwork, alternate poses, or real frame animation as delivered.

## Notifications

The product contains separate notification paths:

- **Native/local:** `expo-notifications` schedules pre-walk and overdue reminders on supported native platforms, subject to OS permission and per-member reminder settings. Scheduling is reconciled from fresh persisted pending-walk data and cancelled for resolved walks.
- **Remote push:** registered device tokens and server-side request-push/reminder infrastructure exist for configured Supabase use. Recipient routing and message content are server-determined. A known active remote reminder channel prevents redundant local reminder scheduling.
- **Web:** local native notification APIs are deliberately not loaded on web; web push is treated as a separate path.
- **Notification-open presentation:** a validated native walk-reminder tap can trigger the in-app mascot reminder prompt; this is optional presentation context, not a substitute for loading current walk state.

No secrets, tokens, endpoints, or environment values belong in design artifacts.

## Offline and sync UX

The app is offline-first for ordinary repository-backed data. Reads can resolve from local storage; many ordinary edits save locally first, queue, and attempt background synchronization when connection is available. Foregrounding also attempts sync then reloads fresh schedule/request data.

UX consequences:

- Local changes may be visible before remote confirmation; do not label them as shared/remote success prematurely.
- A queued operation can later conflict or permanently fail; the queue preserves conflict/quarantine information rather than silently replaying unknown-author writes.
- A profile switch is guarded when pending writes belong to another profile, preventing misattribution.
- Server-authoritative operations are deliberately not blindly queued: family-member deletion, role/permission changes, and swap/time-change request actions require a live connection and should show a clear failure state rather than optimistic completion.
- Failed refreshes intentionally retain the last loaded data in some areas; the UI must distinguish stale/pending/error context when it matters.

## Screen and overlay inventory

### Entry and top-level screens

| Experience | Current purpose |
| --- | --- |
| Loading gate | Restores device session and shows a loading state before routing. |
| Family onboarding | Creates, joins, or redeems entry into a family before profile selection. |
| Login | Selects/claims a family profile. |
| Home | Daily primary walk action, upcoming/recent context, requests, and walk overlays. |
| Schedule | Today/tomorrow/week walk list and recurring schedule-rule management. |
| Family | Members, member details, roles, presence, invites, and family administration. |
| History | Resolved walk history, subject to effective permission. |
| Statistics | Aggregate walking statistics, subject to effective permission. |
| Settings | Dog details, reminders, sharing, profile switching, and admin management entry. |
| System Admin | Separate platform-level admin overlay, available only to verified system administrators. |

The bottom navigation currently contains Home, Schedule, Family, History, Statistics, and Settings. Its physical RTL order is intentionally controlled, and History/Statistics are conditionally visible and screen-gated by verified effective permission.

### Major modals and overlays

| Experience | Current purpose |
| --- | --- |
| CompleteWalkModal / EditDoneDetailsModal | Record or amend completion details. |
| AddUnplannedWalkModal | Log an already-completed spontaneous walk. |
| EditWalkModal / RuleFormModal | Admin schedule-occurrence and recurring-rule editing. |
| SwapWalkPickerModal / RequestTimeChangeModal / RequestsInboxModal | Create and act on server-backed change requests. |
| WalkCompletionCelebration / ReminderMascotPrompt | Completion delight and notification-open mascot reminder. |
| UserPickerModal / UserFormModal / MemberDetailsModal / DeleteUserModal | Profile selection and family-member management. |
| PinEntryModal / PinSetupModal | Profile claim, reclaim, and switching protection. |
| DogDetailsModal | Edit family-dog information and photo. |
| RemindersModal / FamilySharingModal / InviteShareModal | Reminder preferences and sharing/invite flows. |
| ConfirmModal / AdminAuditLogModal / AdminActivityModal / ImpersonationBanner | Confirmations and admin/QA context. |

## Product states design must handle

- First use before family membership; join/create/redeem entry paths.
- Profile selection, claimed-profile conflict, PIN entry, and profile switching.
- Empty active-member, dog, rule, walk-range, and no-upcoming-walk states.
- Loading, retryable error, stale retained data, offline, queued sync, sync conflict, and server-required-offline failure.
- Pending future walk, overdue unresolved walk, 30-minute attention state, completed walk, skipped walk, and successful completion celebration.
- Request pending/approved/rejected/expired states and requests awaiting the viewer’s action.
- Admin/member permissions, permission-override loading failure, removed-member historical attribution, Test Mode, and impersonation context.
- OS notification permission/channel availability, per-member reminders, and Reduced Motion.
- Intentional phone/tablet/web layout behavior rather than stretched mobile assumptions.

## Implemented versus future or unverified

### Implemented / currently present

The repository contains the screens, models, offline queue, profile claim/PIN flows, recurring scheduling, completed/skipped/unplanned walk recording, request workflows, native local reminders, remote-push integration, web-specific notification separation, RTL navigation, permission gating, mascot state architecture, completion/reminder overlays, and Reduced Motion fallbacks described above.

### Planned / not yet verified or complete

- The clean approved mascot master file and final internally animated mascot artwork/frame packs are pending; existing production lists and manifests are requirements, not supplied finished artwork.
- Supabase Storage references for future celebration assets are described as future integration, not current delivered media.
- The SyncQueue exposes quarantined-item information, but current code comments state that no UI consumes it yet.
- Repository code alone does not verify actual production deployment, current user adoption, notification delivery on every device/browser, or the completeness of any future email design experience. Treat those as unknown unless separately validated.

## Documentation discrepancies and caution

Older README/project material uses “טופי” heavily as the family dog and describes an earlier screen/tab shape. Current code uses dynamic family-dog data in relevant screen copy, separates the product mascot from that dog, and has six current tabs including Settings and Statistics. The current navigation, types, stores, and screens are the source of truth.

Some documentation contains historical test/deployment statements. They do not prove the current runtime state and should not be used as visual or product evidence without current validation.

## Design implications

- Hebrew RTL is first-class: verify alignment, reading order, icon direction, dates/times, numbers, and mixed-language strings.
- The family dog identity is dynamic; never use “טופי” as a generic product label.
- Mascot identity is separate from every family dog identity and is governed by approved brand sources.
- Pending and overdue user actions must remain obvious; a later upcoming walk must not conceal an unresolved earlier one.
- Mobile is central, but tablet and web/desktop need intentional layouts, not simple stretching.
- Offline, queued, stale, conflict, and server-required failure states must be understandable and must not imply remote confirmation prematurely.
- Mascot delight and celebrations must not obscure the primary walk action or override Reduced Motion.
- Design must reflect actual permissions and roles; hiding a control does not replace a real authorization boundary.
