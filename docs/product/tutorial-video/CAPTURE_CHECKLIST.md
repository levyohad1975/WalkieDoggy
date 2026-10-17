# Tutorial Video — Capture Checklist (genuine Staging footage)

Companion to `PRODUCTION_PLAN.md` §3. Every scene below is currently a **DRAFT slate** in the animatic. A slate is replaced only by an authentic recording of `staging.walkielink.co.il`, never by simulated or reconstructed UI.

## Before any capture session

- [ ] Staging SHA verified on the day (`staging.walkielink.co.il` → expected build); note it in the file name or a log.
- [ ] **Test family only** (System Admin test/QA family, or a new family created for this purpose). No real family is opened while recording.
- [ ] Fictional names ready: family “משפחת דוגמה”; נועה (admin), איתי, מיכל (members); dog “בוני”. Never “טופי”.
- [ ] Dog photo: none, or a licensed/owned image. No real faces anywhere.
- [ ] iPhone: Focus/Do Not Disturb on · Light mode · default Text Size · Display Zoom Default · Hebrew UI · battery > 50 % · Safari Home-Screen PWA.
- [ ] Recording: Control Center → Screen Recording, microphone **off**, portrait.
- [ ] Never on screen: email address, OTP code, invite link/code, PIN entry, push/notification tokens, System Admin console, Sync diagnostics.
- [ ] After recording: trim nothing on the phone (deliver originals); name files exactly as below; place them in `docs/product/tutorial-video/captures/` (git-ignored) or share them privately.

## Per-scene checklist

| File | Scene / chapter | Must show (real UI, in order) | Must NOT show | Target | Hosted-data writes | Can it be captured automatically now? |
| --- | --- | --- | --- | --- | --- | --- |
| `C01-family-create-dog.mp4` | יצירת משפחה והכלב | Create family → family name → dog name + sex → (optional photo) → continue | Email/OTP screen, invite code | 25–35 s | **Yes** (new test family, dog) | **No.** OTP sign-in needs the test inbox, and creating a family writes hosted data, which is not authorised in this round. |
| `C02-members-roles-schedule.mp4` | בני משפחה ולו״ז | Add נועה/איתי/מיכל → role visible → add weekly walk time with responsible member → Home next-walk card | PIN setup digits | 25–35 s | **Yes** (members, schedule rule) | **No** — hosted writes. |
| `C03-dashboard-start-walk.mp4` | יוצאים לטיול | Home next-walk card (time + responsible) → tap ״התחל טיול״ → active-walk state | — | 10–15 s | **Yes** (walk start) | **No** — hosted writes; also **blocked** until Walk Lifecycle v1.1 is active on Staging. |
| `C04-gps-live-map.mp4` | מעקב מיקום (**gated**) | Location permission prompt → first fix → live route + distance during a real outdoor walk | Home address / identifiable street names (pan away or choose a public park) | 20–30 s | **Yes** (GPS route) | **Never** — real iPhone, real GPS, real walk. **Blocked** until real-iPhone GPS acceptance. |
| `C05-finish-walk.mp4` | סיום טיול | ״סיים טיול״ → completion sheet (duration/notes/toggles) → celebration → Home updated | — | 10–15 s | **Yes** | **No** — hosted writes; needs C03. |
| `C06-swap-time-change.mp4` | החלפה ושינוי שעה | As איתי: ״בקש החלפה״ → pick counterpart → status line; ״בקש שינוי שעה״ → time picker → status. As approver: requests inbox → approve | PIN entry when switching profiles | 25–35 s | **Yes** (requests, approval) | **No** — hosted writes; needs two profiles (two devices or PIN switch) and a live connection. |
| `C07-schedule-history-stats-admin.mp4` | לו״ז, היסטוריה ונתונים | Schedule (היום / מחר / השבוע) → History → נתונים → Family tab admin controls (member details, role) → dog details | Removed-member names from real data | 30–40 s | **No** (read-only), provided C02–C05 test data exists | **Partially, with approval:** read-only screens of an existing test family could be captured as stills in a signed-in browser session on the owner's computer. That needs the owner to sign in, produces stills rather than motion, and a desktop browser is not the iPhone PWA. iPhone screen recording is still preferred. |

**Already produced automatically (no capture needed):** S1 opening and S7 closing brand cards, rendered only from the approved, hash-checked mascot and wordmark.

**Net result:** under this round's rules (no hosted-data changes), **no app scene can be captured automatically**. C07 is the only candidate for assisted, read-only capture, and only after the test data exists and the owner signs in.

## Acceptance check per recording (before it enters the edit)

- [ ] Staging, test family, fictional names only; nothing from the “Must NOT show” column.
- [ ] Hebrew RTL renders correctly; no clipped labels at iPhone width.
- [ ] Shows only implemented behaviour; no error banners unless intended.
- [ ] Mascot appearances are the app's own (approved asset).
- [ ] Stable 30/60 fps, no notification banners, no recording-indicator overlap with key UI.
- [ ] For C04: genuinely recorded outdoors on a real iPhone after GPS acceptance.

## Hand-off

Put the files in `captures/` and run:

```
python3 scripts/tutorial-video/build_video.py --out <dir> --vertical [--vo-dir <takes>] [--include-gps]
python3 scripts/tutorial-video/validate_video.py <dir> [--include-gps]
```

Each present recording replaces its slate automatically; any still-missing scene stays a labelled DRAFT slate.
