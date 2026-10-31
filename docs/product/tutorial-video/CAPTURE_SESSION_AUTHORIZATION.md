# Tutorial Capture Session: Authorization Request (Staging)

**Status: REQUEST. Nothing in this document has been executed against hosted Staging.**
Owner authorization is needed before Phase A starts. Phase C (C03/C05) and the final cleanup (§7.3) each need separate authorization later.

* Environment: **Staging only** (`staging.walkielink.co.il`, Supabase project `czbxhsoxyawprqehkfit`). Never Production.
* Affected family: **one new, isolated QA family, “משפחת דוגמה”** (`families.is_qa = true`, approval `active`).
* Owner's real family: **no family data is written.** During Phase A only, three rows that hold the owner's device context are switched and then restored exactly (§4, verified in §8).
* Not touched: Production, `main`, migrations, Vercel deployments and environment variables, tutorial-video activation, and the 531 quarantined SyncQueue operations (§6).

## 1. Why the session is split across two identities

A System Admin session inside a QA family renders an **admin-only** button, ״חזרה למשפחה המקורית״:

* In the setup-wizard header (`FamilySetupWizard.tsx`, header row above the progress bar).
* Floating at the top-right of every other screen (`App.tsx`, `qaReturnButton`, `position: absolute; top: 8; right: 12`).

Real users never see this button, so footage of the main app recorded from the System Admin session would not show the real UI. The session therefore uses two identities:

| Identity | Device | Used for | Admin-only button visible? |
| --- | --- | --- | --- |
| **A**: owner's System Admin | Owner's iPhone, existing Home Screen web app | Create the QA family and run the real setup wizard (C01, C02 part 1). Then return to the real family. | Yes, wizard header only (see decision D3) |
| **B**: capture identity | A **second iPhone**, a fresh Home Screen web app, never signed in as System Admin | Everything else: Home, requests, schedule, history, נתונים, family admin; later C03/C05/C04 | **No.** B is an ordinary family member with no System Admin rights. |

Admin authorization in this app is persona-based (`is_family_admin()` uses the claimed profile's role, 0038/0044). So B, after claiming the admin profile ״נועה״, sees the real family-admin UI without any System Admin chrome.

**Device A must never remove or reinstall its Home Screen web app, or clear Safari website data.** The app's local storage may hold data that exists only on that device, possibly including quarantined SyncQueue operations. B must be a different iPhone; an iPad would produce the wrong aspect ratio for the phone frame.

## 2. Preconditions (go / no-go, all read-only)

| # | Check | How | Go if |
| --- | --- | --- | --- |
| G1 | Hosted RPCs and schema present | `supabase/manual_tests/tutorial_capture_session_readonly.sql` T1, T2 | All `system_admin_*test_family*`, `join_family`, `claim_family_profile*` and `set_member_role` are present and SECURITY DEFINER; `families.is_qa` and `family_membership_snapshots` exist |
| G2 | No open test session | Same script, T3 and T7 (owner e-mail filled in locally) | T3 = 0 for the owner; T7 `current_family_is_qa = false`, `has_snapshot = false` |
| G3 | Name not in use | T4 `name_check` | 0 QA and 0 real families named ״משפחת דוגמה״. If a QA one exists, re-enter it via ״פתיחה״ (`system_admin_switch_test_family`) instead; the operations in §4 are otherwise identical |
| G4 | Staging build | Vercel alias check (read-only) on the day | Alias serves the expected build (currently `ea3efe1`, deployment `dpl_6tidQmAtqYgcXmFMCwe5safACMcj`) |
| G5 | Device A has nothing waiting to sync | Device A online, app open for a minute. The app itself enforces this: entering a test family is refused while any operation is pending | Entering succeeds without a ״נותרו … פעולות שממתינות לסנכרון״ message |
| G6 | Device B | Second iPhone, current iOS, Hebrew UI | Staging opened in Safari shows the sign-in/onboarding screen, not an existing family |

If any check fails, stop and report. Do not work around it.

## 3. Fictional data used everywhere

Family ״משפחת דוגמה״. Profiles: **נועה** (admin, A's profile in the wizard, later claimed by B), **איתי** (member), **מיכל** (member). Dog **בוני** (no photo; the app shows the official mascot instead). Walk times **07:30** (נועה) and **18:00** (איתי).

## 4. Exact hosted operations

All rows below are in the QA family unless marked **REAL**.

### Phase A: Device A (System Admin), about 15 minutes

| Step | Owner action | Server call | Rows written | Reversal |
| --- | --- | --- | --- | --- |
| A0 | Open ״🛡️ ניהול מערכת״ (not recorded) | read-only RPCs (`system_admin_list_test_families`, …) | none | — |
| A1 | ״צור משפחת בדיקה״ with the name ״משפחת דוגמה״ | Client first drains the device's normal sync queue (`trySync`). By G5 this sends nothing, and quarantined items are never sent. Then `system_admin_enter_test_family('משפחת דוגמה')` | **insert** `family_membership_snapshots` ×1 (owner → real family, role, claimed profile) · **insert** `families` ×1 (`is_qa=true`, new invite code) · **REAL, delete** `profile_auth_sessions` ×1 (owner's real-family session) · **REAL, update** `users` ×1 (owner's real profile: `auth_user_id → null`) · **REAL, update** `family_auth_members` ×1 (owner: family → QA, role → admin) · **insert** `system_audit_log` ×1 (`family.test_created`) · best-effort `end_impersonation` (no-op) | A6 restores all three REAL rows |
| A2 | Wizard step 2: dog ״בוני״, sex; **no photo** | dog save via the offline-first repository | **insert** `dogs` ×1 | Final cleanup |
| A3 | Wizard step 3: ״קודם נוסיף את פרופיל המנהל/ת״ → ״נועה״; add ״איתי״ and ״מיכל״. Show the ״הזמנה בקישור או בקוד QR״ card but **do not open** ״הצגת קישור וקוד QR״ on camera | user inserts; profile claim for נועה | **insert** `users` ×3 · **insert** `profile_auth_sessions` ×1 (owner ↔ נועה, QA) · `users.auth_user_id` on נועה | A6 releases the נועה claim; final cleanup |
| A3b | Off camera, if decision D2 = single capture device: set PINs for ״נועה״ and ״איתי״ | `set_profile_pin` ×2 | PIN hashes on 2 QA `users` rows | Final cleanup |
| A4 | Wizard step 4: add 07:30 (נועה) and 18:00 (איתי); step 5 ״בואו נתחיל!״ | rule saves; schedule generation | **insert** `schedule_rules` ×2 · generated `schedule_entries` / `walks` (count set by the app's horizon) | Final cleanup |
| A5 | Off camera: open the family join code on A and pass it to B (type it; never record or photograph it) | read-only | none | — |
| A6 | **Wait until A has nothing pending to sync**, then tap ״חזרה למשפחה המקורית״ | `system_admin_exit_test_family()` | **REAL, update** `family_auth_members` ×1 (back to the real family and original role) · **REAL, insert** `profile_auth_sessions` ×1 (original profile) · **REAL, update** `users` ×1 (`auth_user_id` = owner again) · QA: `users.auth_user_id → null` on נועה (frees it for B), **delete** owner's QA session row · **delete** snapshot ×1 · **insert** `system_audit_log` ×1 (`family.test_exited`) | — (this *is* the rollback) |
| A7 | Confirm the real family is back on A; run read-only T3/T7 | read-only | none | — |

### Phase B: Device B (capture identity), recordings C02b, C06, C06b, C07

| Step | Action | Server call | Rows written |
| --- | --- | --- | --- |
| B1 | Open Staging, ״הוספה למסך הבית״, open from the Home Screen | anonymous sign-in | **insert** `auth.users` ×1 (anonymous; no e-mail) |
| B2 | Join with the family code (off camera) | `join_family(code)` | **insert** `family_auth_members` ×1 (B → QA, `member`) |
| B3 | Choose profile ״נועה״ (PIN pad off camera if D2 = single device) | `claim_family_profile` / `claim_family_profile_with_pin` | **insert** `profile_auth_sessions` ×1 · `users.auth_user_id` on נועה · PIN-attempt audit rows if a PIN is used |
| B4 | Record Home, ״לוח השבוע״, היסטוריה, נתונים, family admin (C02b, C07) | reads | none |
| B5 | Switch to ״איתי״ (off camera) and record ״בקש החלפה״ / ״בקש שינוי שעה״; switch back to ״נועה״ and approve (C06) | request and approval RPCs | **insert** `walk_swap_requests` ×1, `time_change_requests` ×1 · status updates on approval · approved swap/time change updates the affected QA walk(s) · request push/notification event rows if notifications are enabled |
| B6 | Keep B's web app for later scenes (C03/C05/C04) | — | — |

Device C option (D2 = two capture devices): instead of the PIN switch in B5, a third iPhone joins the family the same way as B1–B3 and claims ״איתי״. That adds one more anonymous `auth.users` row, one `family_auth_members` row and one `profile_auth_sessions` row, and no PINs are needed.

### Phase C: later, separate authorization (needs Walk Lifecycle v1.1 active on Staging)

C03 ״התחל טיול״ and C05 ״סיים טיול״ from Device B: walk-lifecycle rows for one QA walk (start/finish operations, events and completion details). Gate: read-only T5 shows `20261015100100` and `20261015100200` recorded. C04 (GPS) stays excluded until real-iPhone GPS acceptance and needs its own approval.

## 5. Recordings this produces

| File | Identity | Content |
| --- | --- | --- |
| `C01-family-create-dog.mp4` | A | One continuous take of wizard steps 1–5 (family created → dog ״בוני״ → profiles + the unopened invite card → walk times with responsible member → ״בואו נתחיל!״); cut into S2 and S3 |
| `C02b-home-next-walk.mp4` | B | Home next-walk card (time and responsible member) |
| `C06-swap-time-change.mp4` | B as ״איתי״ (or C) | ״בקש החלפה״ / ״בקש שינוי שעה״ and their status |
| `C06b-approve-request.mp4` | B as ״נועה״ | The request approved from the requests inbox |
| `C07-schedule-history-stats-admin.mp4` | B | ״לוח השבוע״ → היסטוריה → נתונים → family admin (members, roles, dog details) |

Recording rules and the per-cue shot list are in `CAPTURE_CHECKLIST.md`.

## 6. What this session cannot change

* **Owner's real family:** only the three context rows in A1/A6, restored exactly. No dogs, walks, schedules, requests or profiles in the real family are created, edited or deleted.
* **531 quarantined SyncQueue operations:** these are device-local (`dog-walk-family:sync-quarantine:v1`, `src/data/syncQueue.ts`). They are never sent: flush sends only the pending queue, and quarantine is read-only. Switching families does not clear or read that key (`authStore.setFamilyId`). G5 guarantees the pending queue is empty, so the pre-switch drain sends nothing and moves nothing into quarantine. A6 waits for A to finish syncing first, so no QA-family write is left queued on A to fail later.
* **No deployment**, environment-variable change, migration, `main` merge or tutorial-video activation. Device B only uses the already-deployed Staging build.

## 7. Rollback and cleanup

### 7.1 Immediate rollback of the owner's context

״חזרה למשפחה המקורית״ (A6) is available throughout Phase A: in the wizard header, and floating once the wizard ends.

* It is **idempotent**: a retry after a lost response returns the real family and changes nothing (fix migration `20261011180000`, re-verified in §8).
* If it fails, retry once while online. If the message is ״no original family snapshot״ or the wrong family appears: **stop**. Do not re-enter a test family or reinstall the app. Run T7 read-only and report, so engineering can diagnose.

### 7.2 Failure handling inside the QA family

Any wizard or join error leaves only QA rows. Stop, note the screen (off camera), and report. Do not retry with the join code visible on camera.

### 7.3 Final cleanup (separate authorization, after the final MP4 is approved)

* The QA family is **kept** until then so scenes can be reshot without repeating Phase A.
* Cleanup path: Device A → ״🛡️ ניהול מערכת״ → test family ״משפחת דוגמה״ → delete, with the confirmation phrase `DELETE TEST FAMILY` (`system_admin_delete_test_family`; refuses non-QA families and refuses while the caller is inside the family).
  * No photos are planned. If any exist, they are removed first through the Storage API list RPC.
  * The cleanup deletes every QA row (requests, walks, schedule, profiles, the family). B's (and C's) membership and session rows cascade.
  * If T6 shows the newer permanent-family-deletion migrations are applied, that audited flow may be used instead.
* What remains: B's anonymous `auth.users` row, with no family or profile. Optional removal from the Supabase dashboard needs its own approval.
* On Device B: delete the Home Screen web app. This affects only B's own local data.

## 8. Local rehearsal evidence (no hosted access used)

The **real migration SQL** (`20261011104342`, `20261011104913`, `20261011180000`) was applied to a throwaway local PostgreSQL 16, with stubs for `auth.users`, `auth.uid()` and the helper functions. A fictional "real" family and an owner with a claimed profile were then run through enter → wizard writes → exit → B joins → delete:

* While inside the QA family, exactly three real-context rows differ from before (`family_auth_members`, `profile_auth_sessions`, the owner's `users.auth_user_id`). No other real-family row changes.
* **After exit, the real-family state diff is empty.** The snapshot count goes back to 0, and the QA claim on ״נועה״ is released so B can claim it.
* A retried enter returns the same QA family (no duplicate). A retried exit is a no-op (empty diff).
* Deleting while still inside the QA family is refused. Deleting a non-QA family is refused.
* After deletion: 0 QA families, 0 rows left for B, 0 QA profiles, and the real-family diff is still empty. Audit trail: `family.test_created`, `family.test_exited`, `family.test_deleted`.
* `tutorial_capture_session_readonly.sql` runs cleanly before, during and after a session (T3 = 0 → 1 → 0; T7 flips QA → real). A write attempted inside its read-only wrapper is rejected (`cannot execute INSERT in a read-only transaction`).

Limits: the stubs do not reproduce Staging's RLS, triggers or the full schema. Hosted behaviour is confirmed by G1–G3 on the day, and by the first steps of the session itself under the stop conditions below.

## 9. Decisions for the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Authorize Phases A and B exactly as in §4 | — |
| D2 | One capture device with PIN profile switching (A3b) **or** two capture devices (B + C, no PINs) | Two devices if available (no PIN entry near the camera); otherwise one device |
| D3 | Wizard footage (C01) from A shows the admin-only header button. **Crop** that strip in the edit (disclosed in `build_report.json` and the provenance; nothing painted in) **or** leave it visible | Crop: `captureEdit.cropTop` ≈ 0.12 removes the status bar plus that one button row (about 40 pt). The progress bar and step title below it stay; the exact value is measured on the contact sheet. |
| D4 | Keep ״משפחת דוגמה״ until the final MP4 is approved | Keep |

## 10. Stop conditions (any one → stop recording, report)

* A real family name, real person, e-mail, invite code/QR/link, PIN pad, OTP or System Admin console appears on screen.
* Any error banner, sync warning or ״לא הצלחנו…״ message.
* A6 does not restore the real family on the first or second attempt.
* Staging alias differs from G4.
* Device B shows anything from the owner's real family.

## 11. Authorization text (copy, edit and send)

> I authorize the Staging tutorial capture session in `CAPTURE_SESSION_AUTHORIZATION.md` §4 Phases A and B, as written: one QA family ״משפחת דוגמה״, the reversible context switch of my System Admin device (A1/A6), and capture identities B [and C] joining that QA family. Decisions: D2 = [one device / two devices], D3 = [crop / leave visible], D4 = keep. Phase C and the final cleanup are **not** included.
