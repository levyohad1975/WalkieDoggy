# Dog Walk Family — Project Status

> Current/changeable state, as of this archaeology pass (2026-08-31). See
> `PROJECT_DNA.md` for the stable architectural reference this document
> assumes.

## 1. Current Baseline

- **App identity**: `package.json` `name: "dog-walk-family"`,
  `version: "1.0.0"`. `app.json`'s `expo.version` is also `"1.0.0"`. No
  separate internal "round"/"build" label was found anywhere in the repo
  beyond the informal "round N" / "Bug N fix" language used in code
  comments and `README.md` prose — there is no dedicated changelog file.
- **Expo SDK**: `~54.0.0` (`package.json`); confirmed by `README.md`
  ("Expo SDK 54").
- **Node expectation**: `README.md` states "Node.js 18+" as a prerequisite.
- **Highest migration file present**: `supabase/migrations/0009_family_invites_pgcrypto_fix.sql`
  (added after the Family Invite feature's Round 1-3 client/server work;
  0008 introduces the feature, 0009 is an additive runtime-compatibility fix
  for 0008 — see §3 and §4).
- **Typecheck / test status — local-machine verified baseline; not
  reproduced during this archaeology pass**: `npm run typecheck` => PASS;
  `npm test -- --runInBand` => Test Suites: **25 passed, 25 total**; Tests:
  **303 passed, 303 total**; Snapshots: 0 total. This was actually executed
  by the developer on their local Windows machine against this exact
  project baseline (not merely an unverified historical claim) — but it was
  run outside this archaeology pass's own sandbox, and this pass did not
  and could not re-run it (see below). Anywhere else in this document or in
  `PROJECT_DNA.md` that cites this 25/303/typecheck figure, the same
  distinction applies: **verified on the developer's local machine, not
  independently reproduced by this archaeology pass.**
- **Superseding checkpoint — Family Invite Round 3 baseline, automated
  verification**: after the Family Invite feature's Round 1-3 work (client
  invite service + admin invite creation/management UI, migrations 0008 and
  0009), the developer reports, on their real Windows machine: `npm run
  typecheck` => PASS; `npm test -- --runInBand` => Test Suites: **27
  passed, 27 total**; Tests: **373 passed, 373 total**. This is the
  **current** automated baseline, superseding the 25/303 figure above (kept
  for historical context only). As with the earlier figure, this was
  executed on the developer's own machine, not independently reproduced by
  any assistant session — the same "reported, not re-run here" distinction
  applies.
- **Family Invite Round 3 real-device QA — PASS, verified via Expo Go on a
  real iPhone against the live Supabase project**, separate and additional
  to the automated run above (that run does not itself exercise the real
  device, Expo Go, or the live backend). Confirmed on-device: an already-
  claimed member does not show the invite affordance; an unclaimed member
  (מאור) does; invite creation succeeds; the 72-hour expiry displays
  correctly; the one-time invite link is shown; Copy works; the native iOS
  Share Sheet works; the revoke confirmation and revoke itself both work;
  invite metadata refreshes immediately after revoke; "צור הזמנה חדשה"
  (regenerate) appears after revoke and succeeds, producing a fresh invite.
  One invite created for מאור during this pass was left active as a
  deliberate test fixture for Round 4 redemption-flow testing. **That
  invite has since been redeemed during Round 4 device QA (see below) — it
  is no longer pending.** This checkpoint itself still covers invite
  **creation and management** only; redemption is covered by the Round 4
  checkpoint immediately below.
- **Superseding checkpoint — Family Invite Round 4 baseline, automated
  verification**: after the Round 4 invited-user redemption work, the
  developer reports, on their real Windows machine: Test Suites: **28
  passed, 28 total**; Tests: **392 passed, 392 total**; Snapshots: **0
  total**. This is the **current** automated baseline, superseding the
  27/373 figure above (kept for historical context only). As with the
  earlier figures, this was executed on the developer's own machine, not
  independently reproduced by any assistant session. `npm run typecheck`'s
  result was not separately reported alongside this specific run, so it is
  deliberately not restated here as PASS for this checkpoint — the last
  explicitly reported typecheck PASS remains the one from the Round 3
  baseline above.
- **Family Invite Round 4 real-device QA — PASS, verified via Expo Go on a
  real iPhone against the live Supabase project.** Since מאור's own
  physical device was unavailable, the same iPhone was reset to simulate a
  genuinely fresh device (Expo Go deleted and reinstalled) — a newly
  generated מאור invite link was saved externally beforehand for this
  purpose. Confirmed on-device: the fresh-device onboarding screen showed
  all three options (create a new family, join an existing family, "יש לי
  הזמנה"); pasting the full `dogwalkfamily://invite/...` link and tapping
  "בדיקת ההזמנה" correctly previewed family "לוי", target "מאור", and a
  valid status/expiry; "הצטרפות" succeeded and transitioned automatically
  into the app with מאור shown as the current/active profile — no manual
  navigation step needed. Final live-Supabase verification confirmed: מאור
  received a new `auth_user_id`; `users.auth_user_id` exactly matches
  `family_auth_members.auth_user_id`; `family_auth_members.role = 'member'`;
  the newest `family_invites` row for מאור has `status = 'redeemed'` with
  `redeemed_at` populated and `revoked_at` null; older מאור invitations
  were revoked (the auto-supersede behavior from 0008 working as designed).
  **Round 4's implemented redemption path (manual link/token paste) is PASS
  / VERIFIED ON REAL IPHONE + LIVE SUPABASE.** Scope actually verified is
  manual paste-and-redeem only — **automatic OS deep-link launch (tapping
  the link to open the app) and the QR invite flow remain NOT implemented
  and NOT verified**, and no Apple Developer / standalone-build deep-link
  work has been done; neither should be read as complete from this
  checkpoint.
- **Independent verification in this sandbox**: **not possible**. This
  environment has no `node_modules` directory and no npm registry access.
  `README.md`'s own "הערה חשובה" (important note) section states a similar
  constraint applied to whoever wrote this code at authoring time (code
  "written and reviewed in this environment [without registry access]"),
  but the 25/303/typecheck baseline above is distinct from that — it is a
  later, real, local-machine test run reported directly by the developer,
  not an unverified authoring-time claim. This archaeology pass only read
  source files; it did not attempt `npm install`/`typecheck`/`jest` (no
  registry access here either), so this pass cannot itself confirm the
  figure — it can only faithfully record that it was reported as locally
  executed and passing.
- **Final Family-screen compact-presence real-device visual QA: PASS —
  verified on a real iPhone**, on the current "Round 8 Fix 2" baseline. This
  is a separate, manual on-device checkpoint, distinct from the automated
  25/303/typecheck run above — it was **not** accompanied by a re-run of
  the automated test suite, only a visual inspection of the running app.
  Observed: the admin row renders "מנהל · פעיל עכשיו" fully; an inactive
  member row renders "בן משפחה · אתמול" fully; no ellipsis/truncation in
  any role + presence string; RTL/layout correct; the last-admin trash
  control remains visually disabled. See §4 and §5 for detail; this item
  no longer appears as a pending issue (§5) or as next-step #1 (§6).

## 2. Current Supabase State

**Derivable from the repository:**
- Seven migration files exist, `0001` through `0007` (see
  `PROJECT_DNA.md` §16 for the full map), each additive relative to the
  last and each explicitly documented (in its own header) as safe to run
  against a database that already has the prior migrations applied.
- `supabase/schema.sql` + `supabase/seed.sql` exist as a from-scratch
  bootstrap path for a brand-new project (per `README.md`).
- Migration headers *assert* (as of when they were written) that prior
  migrations were "already deployed to the live project" (0005's and
  0006's own header comments say this of 0001-0004 and 0001-0005
  respectively) — this is evidence of the authors' belief/intent, not
  proof of the current live state.

**Externally verified; not derivable from repository alone:**
- Migration 0006 deployed on the live Supabase project.
- Migration 0007 deployed on the live Supabase project.
- `set_member_role` RPC verified live (i.e. actually callable against the
  real project, not just present in a `.sql` file).
- Multi-admin promotion/demotion manually QA'd against a live project.
- Last-admin role protection manually QA'd against a live project.
- Migration 0008 (`create_family_invite`/`revoke_family_invite`/
  `list_family_invites`/`inspect_family_invite`/`redeem_family_invite`)
  deployed on the live Supabase project.
- Migration 0009 (pgcrypto schema-qualification fix for 0008 — see §4)
  deployed on the live Supabase project. Live QA finding: the initial live
  `create_family_invite()` call failed because the live project hosts
  pgcrypto's functions under the `extensions` schema, while 0008's
  SECURITY DEFINER invite RPCs run with `set search_path = public` — an
  unqualified `gen_random_bytes(...)`/`digest(...)` call could not resolve.
  0009 redefines only `create_family_invite`/`inspect_family_invite`/
  `redeem_family_invite` with explicit `extensions.gen_random_bytes(...)`/
  `extensions.digest(...)` qualification (no other change); 0008 itself was
  not modified. Live invite creation succeeding after deploying 0009 is the
  verification that this runtime fix works.
- Family Invite admin creation/management flow (invite creation, 72h
  expiry, copy, native Share Sheet, revoke, regenerate) manually QA'd on a
  real iPhone via Expo Go against the live project — see §1's Round 3
  real-device QA checkpoint.

None of the above five items can be confirmed by reading files in this
repository — a `.sql` migration file existing locally says nothing about
whether it has been run against any particular live Supabase project. Any
future session should treat live-deployment status as a fact to obtain from
the person operating the Supabase project, not from this repo.

## 3. Completed Features

Each verified against actual code in this pass (see `PROJECT_DNA.md` for
file references):

- Family membership: create/join via invite code, per-device profile
  claiming (`src/lib/supabase.ts`, migration 0002/0004).
- Schedule (recurring rules → generated entries): `src/logic/rotation.ts`,
  `scheduleStore.ts`.
- Multiple walks/day support: "one rule = one time slot" model, confirmed
  in `ScheduleRule`'s doc comment and `README.md`.
- Mark done (with pee/poop/note/duration toggle UI):
  `src/logic/walkActions.ts`'s `markWalkDone`, `CompleteWalkModal.tsx`.
- Ad-hoc/unplanned walks: `scheduleStore.addUnplannedWalk`,
  `AddUnplannedWalkModal.tsx`.
- Notes and post-completion editing: `editWalkDetails`,
  `EditDoneDetailsModal.tsx`.
- Swap requests (Member→Member): `walk_swap_requests` + RPCs (0005),
  `RequestsInboxModal.tsx`.
- Time-change requests (Member→Admin): `time_change_requests` + RPCs
  (0005), `RequestTimeChangeModal.tsx`.
- Request privacy (RLS-scoped visibility): confirmed in 0005's `SELECT`
  policies (see `PROJECT_DNA.md` §13/§17).
- Future-walk request support: confirmed by absence of any date
  restriction in `create_swap_request`/`create_time_change_request` —
  works identically for today's and future-dated pending walks.
- Native time picker: `RequestTimeChangeModal.tsx`'s use of
  `@react-native-community/datetimepicker` (replacing free-text entry,
  round-6 A5 fix).
- Local reminders: `src/notifications/notificationService.ts` +
  `src/logic/reminders.ts`, `expo-notifications`.
- Notification reconciliation fixes: deterministic ids, orphan cleanup
  (`cancelOrphanedWalkNotifications`), full reconciliation on load/
  foreground (see `PROJECT_DNA.md` §12).
- Offline sync: `OfflineFirstRepository` + `SyncQueue` (see §11 of the DNA
  doc) — confirmed extensive, including owner-tagging, conflict handling,
  and quarantine for untrusted replays.
- Real QA impersonation: migration 0006, `authStore.beginImpersonation`/
  `endImpersonation`.
- Multi-admin: migration 0007, `set_member_role`, `MemberDetailsModal.tsx`.
- Presence: `user_presence`/`touch_last_seen`/`admin_list_family_activity`
  (0005/0006), `src/logic/presence.ts`.
- Hebrew error localization: `src/lib/errorMessages.ts`.
- Image support: `expo-image-picker` + Supabase Storage `family-photos`
  bucket (migration 0001), `Avatar.tsx`/`DogPhoto.tsx`/`uploadImage.ts`.
- **Family Invite — admin creation/management (Round 1-3)**: member-specific
  invites (migration 0008, pgcrypto-fixed by 0009), client service layer
  (`src/lib/invites.ts`), pure eligibility/status/wording logic
  (`src/logic/familyInvites.ts`), admin UI inside `MemberDetailsModal.tsx`'s
  "הזמנה להצטרפות" section plus `InviteShareModal.tsx` for the one-time
  link/copy/share/revoke sheet, wired into `FamilyScreen.tsx`. Covers:
  showing the invite affordance only for an eligible (real-admin-viewed,
  active, unclaimed) member; creating an invite; displaying the one-time
  raw-token link with 72h expiry; copy (`expo-clipboard`) and native Share;
  revoke with confirmation; "צור הזמנה חדשה" regenerate; server-derived
  status labels via `listFamilyInvites()`. Real-device QA'd — see §1.
- **Family Invite — invited-user redemption (Round 4)**: manual invite
  link/token paste-and-redeem flow, added to `FamilyOnboardingScreen.tsx`'s
  "יש לי הזמנה" entry point (fresh-device-only, per its own design — see
  `PROJECT_DNA.md` §2). Client wiring in `src/store/authStore.ts`
  (`completeInviteRedemption`/`retryPendingInviteRedemptionVerification`,
  with fail-closed whoami() verification before any state is committed) and
  `src/logic/familyInvites.ts` (`parseInviteInput`). Covers: pasting a full
  `dogwalkfamily://invite/<token>` link or a bare token; inspecting it
  (`inspect_family_invite`) and previewing family/target/status/expiry;
  redeeming it (`redeem_family_invite`, 0008/0009) and landing automatically
  in the app as the claimed profile. Real-device QA'd on a real iPhone
  against live Supabase — **PASS / VERIFIED ON REAL IPHONE + LIVE
  SUPABASE** — see §1.
  **Explicitly NOT part of this feature yet**: automatic OS deep-link launch
  (tapping/scanning the link to open the app), QR code rendering, and
  app.json's URL scheme — none of these are implemented or verified; see
  §5/§6.

No feature claimed above was found to be missing or structured differently
from how the task brief described it, based on the files inspected in this
pass.

## 4. Recently Verified Fixes

Summarized from doc comments/code found in this pass (each is the author's
own record of prior-round reasoning, treated here as primary evidence per
the task instructions, not independently re-tested by this pass):

- **Next walk after completion**: `scheduleStore.markDone`'s A2 fix (only
  refetches from the server once `hasPendingSaveWalk` confirms the write is
  resolved) — doc comment in `scheduleStore.ts` lines ~338-379; protected by
  `src/store/__tests__/scheduleStore.markDoneConflict.test.ts`.
- **Cross-device refresh**: `App.tsx`'s `runForegroundSync()` — the
  "round-6 fix" doc comment describes the exact Device-A/Device-B scenario
  this fixes (Device B foregrounding and still showing a walk Device A
  already completed).
- **Cold-start sync ordering**: `App.tsx`'s "BUG 2 FIX (cold-start sync
  race)" — `performColdStart()` fully awaits `restoreSession()` before any
  sync/reload runs.
- **Stale conflict clearing**: `SyncQueue.flush()`'s "BUG 3 FIX" —
  `clearConflictForWalk()` removes a stale historical conflict the moment a
  later `saveWalk` for the same walk id succeeds.
- **Orphan notification cleanup**: `notificationService.ts`'s "BUG 4 FIX" —
  `cancelOrphanedWalkNotifications`.
- **Deterministic notification IDs**: `notificationService.ts`'s
  `notificationIdentifier()` doc comment — the actual root-cause fix for
  "notification shows wrong responsible person" (round 6, priority A3),
  replacing an in-memory `Map` that didn't survive app restarts.
- **Offline destructive-action restrictions**: `offlineFirstRepository.ts`'s
  "ROUND 7 FIX (Part 1E/4, Part 2, Part 3)" — `deleteFamilyMember` made
  server-authoritative online and offline-exempt, plus discarding legacy
  queued entries from pre-fix app versions.
- **Last-admin protection**: migration 0007's advisory-lock-guarded count
  check (server), plus `familyManagement.ts`'s "Round 8, Fix 1"
  (`isLastActiveAdminMember`) client UX guard and its own real-device
  touch-propagation bug fix (a disabled inner `Pressable` still letting a
  tap through to the row's outer `onPress`).
- **Self-role refresh**: `authStore.ts`'s "Round 7, Part 2" —
  `refreshOwnRoleAfterChange()`, with a `roleRefreshNotice` fallback for
  when the post-change refresh itself fails.
- **Stale activity clearing**: `familyManagement.ts`'s
  `shouldReloadActivityAfterRoleChange()` — "Round 7, Part 3 (bug A/B fix)".
- **Last-admin trash/delete UI behavior**: covered by the same "Round 8,
  Fix 1" work above (`handleLastAdminGuardedPress`).
- **Presence compact formatter**: `src/logic/presence.ts`'s
  `describePresenceCompact()` — explicitly documented as "Round 8, Fix 2"
  (real-device QA found the full-length label truncating on a real iPhone)
  **plus a follow-up fix** removing a leftover "נראה" prefix that still
  truncated. The code fix is implemented, the automated test suite passed
  locally afterward, and **final real-device visual QA of this follow-up
  has now PASSED** on a real iPhone (admin row "מנהל · פעיל עכשיו" and an
  inactive-member row "בן משפחה · אתמול" both render fully, no
  ellipsis/truncation, RTL/layout correct) — see §1 for the full
  checkpoint detail. This item is closed; it no longer appears in §5's
  known-issues list or as a pending item in §6.
- **Family Invite pgcrypto runtime fix (0009)**: live QA on the Supabase
  project found `create_family_invite()` failing at runtime because that
  project hosts pgcrypto's `gen_random_bytes`/`digest` under the
  `extensions` schema, unreachable from 0008's `set search_path = public`
  SECURITY DEFINER functions with an unqualified call. Fixed via the
  additive migration `0009_family_invites_pgcrypto_fix.sql`, which
  redefines only `create_family_invite`/`inspect_family_invite`/
  `redeem_family_invite` with explicit `extensions.gen_random_bytes(...)`/
  `extensions.digest(...)` qualification — no other logic, signature,
  error string, or security clause changed; 0008 itself untouched. Deployed
  and verified live: invite creation now succeeds. See §2.

## 5. Current Known Issues / Limitations

- **Remote/push notifications: not implemented.** Only local, on-device
  `expo-notifications` scheduling exists (confirmed by inspecting all of
  `src/notifications/`); `app.json` declares
  `UIBackgroundModes: ["remote-notification"]` but no push token
  registration, push-sending code, or push-related Supabase function was
  found anywhere in the repo.
- **Family Invite — admin creation/management (Round 3) and manual-paste
  redemption (Round 4) are both implemented and real-device QA'd (see
  §1/§3); QR rendering and automatic deep-link opening are NOT.** The
  original blanket "not implemented" note below described the pre-Round-1
  state and is now out of date; the remaining gap is narrower:
  - **QR code rendering: still PENDING, not implemented.** Round 3
    deliberately did not add a QR-rendering dependency (sandbox couldn't
    install/verify one against Expo SDK 54/React 19.1/`newArchEnabled`) —
    the invite link is shown as plain text with Copy/Share only, and Round
    4's redemption entry point is manual paste, not a scanner. Do not treat
    this as complete.
  - **Automatic deep-link opening: not implemented, not verified.** The
    `dogwalkfamily://invite/<token>` link shown by `InviteShareModal.tsx`
    is display/copy/share text only — nothing registers the `dogwalkfamily`
    scheme in `app.json`, no `Linking` listener exists, and no code opens
    or parses that URL automatically. Tapping or scanning the link/QR does
    not open the app; Round 4's "יש לי הזמנה" manual-paste flow is the
    verified substitute (see §1/§3), not a step toward this. No Apple
    Developer / standalone-build deep-link work has been done.
  - ~~Redemption/onboarding flow: not implemented.~~ **DONE as of Round
    4** — see §1/§3. `redeem_family_invite` (0008/0009) is now called from
    `FamilyOnboardingScreen.tsx`'s "יש לי הזמנה" mode, verified end-to-end
    on a real iPhone against live Supabase.
- **Original short-text invite-code path (families' invite codes,
  `findFamilyByInviteCode`/`joinFamily`, migration 0002) still has no QR/
  deep-link support either** — unchanged by the Family Invite feature above,
  which is a separate, member-specific invite mechanism (0008/0009), not a
  replacement for the family-wide invite code.
- **Full Settings redesign: not evidenced as done or in progress.** No
  in-code markers (TODO, doc comment, or partial implementation) referencing
  a Settings redesign were found; `SettingsScreen.tsx` exists in its current
  form with no indication of a pending overhaul.
- **Full Family redesign: not evidenced as done or in progress.** Same as
  above for `FamilyScreen.tsx`.
- **History/Analytics redesign: not evidenced as done or in progress.**
  `HistoryScreen.tsx` exists with filters (member/date/planned-unplanned)
  and daily summaries per `README.md`; no redesign markers found.
- **Remote push testing on iPhone blocked by lack of an Apple Developer
  Program / development build**: this is an operational/infrastructure fact
  about the developer's environment, not something derivable from repository
  content — included here only because the task brief asserts it; this pass
  found no code-level evidence either confirming or contradicting it (there
  is no push implementation to test in the first place, per the bullet
  above).
- **Expo tunnel/ngrok intermittent failures** ("Cannot read properties of
  undefined (reading 'body')"): a known intermittent tunnel-tooling error,
  **not an application-code failure** — nothing in `src/` or `App.tsx` is
  implicated. `@expo/ngrok` `^4.1.3` is declared as a devDependency in
  `package.json`, but operationally, freshly-extracted copies of this
  project have repeatedly shown `npm list @expo/ngrok` returning empty
  (the package absent from `node_modules` despite being declared), and
  `@expo/ngrok@4.1.3` has had to be installed locally before `--tunnel`
  would work at all. This pass found no code-level explanation for why
  different extracted copies/install states have differed — that
  discrepancy is not invented here, only reported as observed. Before
  using Expo tunnel, run `npm list @expo/ngrok` first; if it comes back
  empty, install the project's expected ngrok package/version before
  starting the tunnel, rather than assuming the declared devDependency is
  already present and working.
- **LAN testing possibly restricted by a managed-work-computer firewall/
  network policy**: same caveat — an environment fact, not something the
  repository encodes.

> Note: the compact inactive-presence Family-row strings (previously listed
> here as pending final real-device visual QA) are **no longer a known
> issue** — real-device QA passed; see §1 and §4 for the checkpoint detail.

## 6. Planned Next Work

In priority order:

1. ~~Complete final real-device visual QA of the latest compact inactive
   Family-row presence strings~~ — **DONE.** Verified PASS on a real
   iPhone; see §1 and §4. No longer a next step.
2. **Project Archaeology documentation: accepted/finalized as v1.**
   `PROJECT_DNA.md`/`PROJECT_STATUS.md` reviewed and corrected against the
   team's own knowledge; this checkpoint closes the documentation pass.
3. ~~Family Invite — client invite service (Round 2) and admin invite
   creation/management UI (Round 3)~~ — **DONE**, real-device QA'd; see §1
   and §3.
4. ~~Family Invite — Round 4: invited-user redemption flow (manual invite
   link/token paste)~~ — **DONE**, real-device QA'd on a real iPhone
   against live Supabase; see §1 and §3. The מאור test invite left active
   after Round 3 device QA has now been redeemed as part of this
   verification — it is no longer pending, and no replacement fixture is
   currently reserved.
5. **Family Invite — QR rendering and automatic deep-link handling.**
   Explicitly not started (§5): a QR-rendering dependency, `app.json`'s
   `dogwalkfamily://` URL scheme, a `Linking` listener, and deep-link
   parsing/navigation are all still to build — none of this depends on an
   Apple Developer account by itself, but a standalone/TestFlight build
   would be needed to verify a real custom-scheme app launch or a universal
   link end-to-end (see item 9 below).
6. Push notification architecture (not present in code — see §5).
7. Settings screen redesign (no in-code redesign markers found).
8. Family screen redesign (no in-code redesign markers found).
9. Development/TestFlight build once an Apple Developer Program account
   exists (operational prerequisite, not a code task) — needed for real
   deep-link/universal-link verification (item 5).
10. History + analytics enhancements (no in-code redesign markers found).

## 7. Current Manual QA Checklist

High-value manual tests, derived from the manual SQL test files present
(`supabase/manual_tests/*.sql`/`.sh`) and the security-sensitive flows
documented in code:

- **Admin promotion** — `set_member_role(userId, 'admin')` by an existing
  admin; verify `audit_log` entry (0007_multi_admin_acl.sql covers RLS/RPC
  angles).
- **Admin demotion** — same RPC, `'member'`; verify the demoted device's
  `familyRole` refreshes correctly (`authStore.refreshOwnRoleAfterChange`).
- **Last-admin demotion block** — attempt to demote the sole admin; expect
  server rejection ("cannot demote the last admin of this family") and its
  mapped Hebrew message.
- **Last-admin delete block** — attempt `admin_delete_family_member` on the
  sole admin; expect rejection and Hebrew mapping.
- **Presence** — foreground the app as a member, confirm
  `admin_list_family_activity()` shows "פעיל עכשיו" within 5 minutes on an
  admin's device, and that the label ages correctly per
  `describePresence`/`describePresenceCompact`.
- **Real impersonation** — begin/end a session as admin, confirm
  RLS/RPC-visible effects match the impersonated member (not the real
  admin), confirm role-management UI is hidden during the session, confirm
  `end_impersonation()` fires on app restart/sign-out even without
  explicit exit.
- **markDone** — mark a walk done on one device, confirm it disappears from
  "next walk" and appears correctly attributed on another device after
  foreground sync.
- **Multi-device refresh** — background/foreground a second device after a
  change on the first; confirm schedule, requests, and notifications all
  reconcile per `runForegroundSync()`'s documented order.
- **Request visibility** — confirm a swap request is visible to requester +
  target + any admin, but a time-change request is visible only to its
  requester + admins (per the RLS policies in migration 0005).
- **Notification responsible person** — reassign a walk (swap/time-change
  approval/direct edit) and confirm the pre-walk reminder shows the newly
  responsible person's name, including after an app restart.
- **Time-change picker** — confirm the native time picker
  (`RequestTimeChangeModal.tsx`) rejects proposing the walk's current time
  and shows the before/after preview correctly.

Manual SQL test files present for reference: `0004_claim_race_test.sh`,
`0004_profile_edit_acl.sql`, `0005_requests_audit_presence_acl.sql`,
`0006_qa_impersonation_acl.sql`, `0007_multi_admin_acl.sql`,
`idan_claim_diagnostic.sql`.

## 8. Environment Notes

- **Windows development**: no repository evidence found either way (no
  `.bat`/PowerShell scripts, no Windows-specific path handling); not
  claimed here.
- **Expo SDK version**: `~54.0.0` (see §1).
- **iPhone testing via Expo Go**: `README.md` documents scanning a QR code
  with Expo Go (Android) or the camera app (iOS) via `npx expo start
  --tunnel`, and states the installed Expo Go version must match SDK 54.
- **`.env` required locally**: `.env.example` documents two variables —
  `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (names only; no values present in this repo — confirmed by reading the
  file). Both blank/omitted → local "demo mode" (no backend).
- **`node_modules` should be regenerated with `npm install`, not copied**:
  consistent with this repo shipping no `node_modules` and
  `README.md`'s own note that the code was authored without registry
  access and must be `npm install`ed for real use.
- **`@expo/ngrok` note**: declared as a devDependency (`^4.1.3`) in
  `package.json`, supporting `expo start --tunnel`. Operationally, this has
  not reliably meant it's actually installed and ready — see §5 for the
  repeated `npm list @expo/ngrok` → empty observation and the recommended
  preflight check, plus the known intermittent tunnel failure.
- **Current Supabase env variable NAMES** (no values, per instructions):
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — both
  read via `process.env` in `src/lib/supabase.ts`, both must be prefixed
  `EXPO_PUBLIC_` per Expo's env-variable exposure rules.

## 9. Files That Must Not Be Shared

- `.env` (git-ignored per `.gitignore`; not present in this repo, only
  `.env.example` with empty values) — would hold the project's Supabase URL
  and anon/publishable key.
- No service-role key, Apple credentials, or other secret material was
  found referenced anywhere in this repository (checked `.env.example`,
  `app.json`, all `src/lib/*` files, and all migration files) — the anon
  publishable key is explicitly documented in `.env.example` as safe to
  ship client-side ("Row Level Security policies — not this key — are what
  actually restrict access"). Still treat any populated `.env`, any local
  Supabase service-role key used for admin scripting, and any Apple
  Developer credentials (once they exist) as must-not-share, consistent
  with standard practice even though none are present in this repo today.
- `.expo/` directory contents (device pairing info) — present locally
  (`./.expo/devices.json`, `./.expo/settings.json`) but not inspected for
  content in this pass beyond confirming their existence; treat as
  local-machine-specific and not for sharing.

## 10. Handoff Checklist

1. Confirm the exact baseline with the team: the "25/25 suites, 303/303
   tests, typecheck PASS" figure was actually executed on the developer's
   local machine (see §1) — confirm it is still current before building on
   it, since this archaeology pass could not itself re-run it (no registry
   access in this sandbox).
2. Verify `.env` is present locally with real Supabase project values (or
   confirm intentional demo-mode operation).
3. Run `npm install`.
4. Run `npm run typecheck`.
5. Run `npm test -- --runInBand`.
6. Inspect the latest migrations (`0006`, `0007`) against the actual live
   Supabase project's schema/functions to confirm they match what's in
   `supabase/migrations/` — do not assume the repo and the live project
   agree.
7. Confirm live deployment status separately (§2's "externally verified"
   list) — this cannot be done by reading the repository.
8. Only after 1-7 are confirmed, begin new feature work — and when doing
   so, follow `PROJECT_DNA.md` §22's development rules (read both
   documents first, never rewrite a deployed migration in place, preserve
   every §20 security invariant, add regression tests, and never claim a
   test/typecheck result without actually having run it).
