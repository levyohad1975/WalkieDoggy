# Tutorial Video: iPhone Capture Guide and Shot List (genuine Staging footage)

Every app scene in the animatic is a **DRAFT slate** until an authentic iPhone recording of `staging.walkielink.co.il` replaces it. Simulated or reconstructed UI is never used.

**Before anything is recorded:** the hosted operations, the affected QA family, rollback and cleanup are set out in `CAPTURE_SESSION_AUTHORIZATION.md`. Nothing here runs until the owner authorizes it there.

## 1. What can be captured right now, read-only

| Scene | Read-only now? | Why |
| --- | --- | --- |
| S1 opening, S7 closing | **Done** | Rendered brand cards (approved mascot, hash-checked; clean wordmark, approved for continued production) |
| C01–C02 wizard | No | The wizard exists only inside a family being set up. Creating the QA family writes hosted data. |
| C02b, C06, C07 (Home, requests, schedule, history, נתונים, family admin) | No | They show family data. Opening the owner's real family on camera is forbidden. Entering or joining a QA family writes membership rows, and System Admin observer mode writes an observer session and shows admin chrome. |
| C03, C05 (start/finish walk) | No | Writes walks, and is blocked until Walk Lifecycle v1.1 is active on Staging |
| C04 GPS | No | Blocked until real-iPhone GPS acceptance |

Even opening Staging on a fresh device creates an anonymous sign-in, which is a hosted `auth.users` row. **No app scene can be captured with zero hosted writes.**

What *is* possible read-only today:
* The go/no-go SQL `supabase/manual_tests/tutorial_capture_session_readonly.sql`.
* The Staging build check (alias still serves `ea3efe1`, verified 2026-10-17).
* The device preparation in §2. It involves no app interaction.

## 2. iPhone preparation (both capture devices)

Device roles: **A** = owner's iPhone, the existing installed web app with the System Admin account. **B** = a second iPhone, the capture identity. See the authorization document §1.

| Setting | Where (iOS Settings) | Why |
| --- | --- | --- |
| iPhone Language: **עברית** | General → Language & Region | System sheets, time pickers and the keyboard appear in Hebrew RTL, matching what users see |
| Appearance: **Light** | Display & Brightness | Matches the brand palette and the cream video background |
| Display Zoom: **Default**; Text Size default; Bold Text off | Display & Brightness / Accessibility | Standard layout width, so labels wrap exactly as for most users |
| **Focus / Do Not Disturb** on; Notification previews off | Focus / Notifications | No banners from other apps over the footage |
| **Keyboard → Predictive off** for the session | General → Keyboard | The QuickType bar can suggest personal words (contacts, names) while typing |
| Low Power Mode **off**; battery > 50 %; Auto-Lock **Never** for the session | Battery / Display & Brightness | Smooth frame rate; no lock in the middle of a take |
| Night Shift off | Display & Brightness | What you see while recording matches the footage |
| Portrait Orientation Lock **on** | Control Center | Portrait recordings only |
| **Screen Recording** in Control Center, **microphone off** | Control Center: touch and hold Record → Microphone off | Silent recordings; no voices captured |

Apple's own steps for screen recording: swipe down from the top-right corner, tap Record, wait for the 3-second countdown, exit Control Center. Stop from the red indicator at the top of the screen or from Control Center. The file is saved to Photos.

**Web app (standalone, no Safari bars):**
* **Device B:** open `https://staging.walkielink.co.il` in Safari → Share → ״הוספה למסך הבית״ (keep **Open as Web App** on where iOS shows it) → launch from the Home Screen icon. B must show the sign-in/onboarding screen, never an existing family.
* **Device A:** use the already-installed Home Screen app. **Never delete or reinstall it, and never clear Safari website data on A.** Its local storage may hold data that exists only on that device.

## 3. Recording technique

* One file per row in §4. Start recording, then **hold still for 2 s** on a calm screen before the first tap. End with 2 s of stillness. This gives clean cut points.
* Deliberate, single taps; **pause about 1 s after every screen change**; scroll slowly; no fast swipes, no pulling down Notification Center.
* Mistakes are fine. Keep going, or redo the whole file; the editor cuts.
* Off-camera moments: if a **PIN pad, join code or QR, or a profile switch** is coming up, stop recording first. Continue in a new file with the next suffix (e.g. `C01-family-create-dog-2.mp4`); edit.json will reference it.
* Type the fictional names live (keyboard visible is fine): ״משפחת דוגמה״, ״בוני״, ״נועה״, ״איתי״, ״מיכל״.
* The iOS status bar (clock, battery, red recording pill) is cropped in the edit (`cropTop` ≈ 0.065). Nothing needs to be hidden there by hand.

## 4. Shot list (what must be on screen, and when)

Times are **seconds into the scene**. The narration line starts at that moment, so the matching UI must be visible by then. Each recording only needs to *contain* each beat; exact in/out points are set afterwards in `edit.json` → `captureEdit`.

| File | Device / profile | Beats, in order | Used for (cue → must be visible at) |
| --- | --- | --- | --- |
| `C01-family-create-dog.mp4` (one continuous take of the wizard, about 60–120 s) | **A** (System Admin; QA family just created) | 1. Step 1 ״המשפחה נוצרה״, hold 3 s → continue. 2. Step 2 ״הכירו את הכלב שלכם״: type ״בוני״, choose sex, **no photo** → continue. 3. Step 3 ״מי יוצא לטייל עם הכלב?״: add the admin profile ״נועה״, then ״איתי״ and ״מיכל״. Hold 3 s on the ״הזמנה בקישור או בקוד QR״ card, **do not tap** ״הצגת קישור וקוד QR״ → continue. 4. Step 4 ״מתי יוצאים לטיול?״: 07:30 responsible ״נועה״, 18:00 responsible ״איתי״ → continue. 5. Step 5 summary → ״בואו נתחיל!״ → **stop as soon as the wizard closes** (A's Home shows the admin-only button) | S2: cue-03 @ 1.0 (step 1 → 2), cue-04 @ 15.0 (invite card) · S3 segment 1: cue-05 @ 1.0 (step 4) |
| `C02b-home-next-walk.mp4` (10–15 s) | **B** as ״נועה״ | Home: hold on the next-walk card (time + responsible member), small slow scroll, hold | S3 segment 2: cue-06 @ 13.0 |
| `C06-swap-time-change.mp4` (20–30 s) | **B** as ״איתי״ | On one of איתי's walks: ״בקש החלפה״ → choose a family member → send → status line. Then ״בקש שינוי שעה״ → time picker → send → status ״ממתין לאישור״ | S5 segment 1: cue-10 @ 1.0 (the two buttons) |
| `C06b-approve-request.mp4` (10–15 s) | **B** as ״נועה״ | Requests inbox → open the pending request → approve → the updated status | S5 segment 2: cue-11 @ 12.0 (status/handling) |
| `C07-schedule-history-stats-admin.mp4` (30–40 s) | **B** as ״נועה״ | ״לוח השבוע״ (hold 4 s) → History (hold 4 s) → ״נתונים״ (hold 4 s) → Family tab: open ״איתי״ (details/role), then dog ״בוני״ details | S6: cue-12 @ 1.0, cue-13 @ 8.0, cue-14 @ 17.0 |
| `C03-dashboard-start-walk.mp4` (10–15 s) **later** | **B**, after v1.1 activation | Home next-walk card (hold 3 s) → tap ״התחל טיול״ → active-walk state (hold 5 s) | S4a: cue-07 @ 1.0; the tap should land 2–4 s in (a tap ring marks it) |
| `C05-finish-walk.mp4` (10–20 s) **later** | **B**, after v1.1 activation | Active walk → ״סיים טיול״ → completion sheet (duration/notes) → save → celebration → Home updated | S4c: cue-09 @ 1.0; the tap lands 1.5–3 s in |
| `C04-gps-live-map.mp4` **gated** | **B**, after real-iPhone GPS acceptance only | Location permission → first fix → live route + distance on a real outdoor walk in a public place | S4b: cue-08 @ 1.0 |

Profile switches on B (נועה ↔ איתי) and any PIN entry happen **with recording stopped**. With a third iPhone (decision D2), C plays ״איתי״ and no switching is needed.

## 5. Never on screen (stop conditions)

* Any real family, person, e-mail address, invite code, QR code or join link, PIN pad, OTP.
* The System Admin console, ״אבחון סנכרון״ / sync diagnostics, any error banner or sync warning.
* On device A, anything after the wizard closes (the admin-only ״חזרה למשפחה המקורית״ button).
* Home address or identifiable street names (C04).

If one appears, stop recording, tell the owner, and do not use that file. The full list is in the authorization document §10.

## 6. After recording

1. Transfer the **originals**: AirDrop to a Mac or ״שמירה בקבצים״ to a private drive. **Not** WhatsApp, Telegram or e-mail, which re-compress video. Name the files exactly as in §4.
2. Put them in `docs/product/tutorial-video/captures/` (git-ignored, never committed) or share them privately with the editor.
3. Intake check, which also writes a 9-frame contact sheet per file for the stop-condition review:
   ```
   python3 scripts/tutorial-video/check_captures.py docs/product/tutorial-video/captures
   ```
4. Set in/out points, `cropTop` and tap positions in `edit.json` → `captureEdit` from the contact sheets. Then build and validate:
   ```
   python3 scripts/tutorial-video/build_video.py --out <dir> --vertical --draft [--vo-dir <takes>] [--music <bed.wav>]
   python3 scripts/tutorial-video/validate_video.py <dir>
   ```
   A recording that is still missing keeps its labelled DRAFT slate. A scene without in/out points renders as a rough preview, and `validate_video.py --final` refuses it.

## 7. Acceptance per recording

- [ ] Staging, QA family ״משפחת דוגמה״, fictional names only; nothing from §5.
- [ ] Hebrew RTL renders correctly; no clipped labels at iPhone width.
- [ ] Shows only implemented behaviour, without errors.
- [ ] Portrait, original quality (`check_captures.py` 0 failures), no notification banners.
- [ ] Every beat in §4 for that file is present and held long enough to cut.
- [ ] C04 only: genuinely recorded outdoors on a real iPhone after GPS acceptance.
