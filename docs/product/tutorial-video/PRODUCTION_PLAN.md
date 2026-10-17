# Walkie Doggy Link — Tutorial Video Production Plan

Status: **DRAFT — animatic and pipeline ready; genuine captures and narration still required.**
Source brief: *Tutorial Video Production Brief (DRAFT)*, owner, 2026-10-17. It supersedes the 45–75 s outline in `../FIRST_RUN_TUTORIAL.md` §4 for length and shot plan.

Classification: **Joint** — Creative owns story, brand, motion and QA; Engineering owns the capture environment safety, the build pipeline and the integration plan.

---

## 0. Verified starting point (2026-10-17)

| Item | Value |
| --- | --- |
| Branch / HEAD | `feat/walk-lifecycle-gps-v1-1` @ `ea3efe1` (remote = local, clean tree) |
| Canonical Staging | `staging.walkielink.co.il` → `dpl_6tidQmAtqYgcXmFMCwe5safACMcj` (SHA `ea3efe1`, Preview target) |
| CI on `ea3efe1` | CI, Batch 2 Supabase Rehearsal, Integration Full-Chain Rehearsal — all success |
| Tutorial video config | Not set (`EXPO_PUBLIC_TUTORIAL_*` absent) — video intentionally inactive |

## 1. Inventory

**Tutorial / Help UI (implemented, Staging):** first-run welcome overlay, reusable player and Help entries — `src/components/tutorial/*`, Settings → ❓ עזרה, Family → ❓ עזרה. The in-app player frame is **portrait 9:16**, so the in-app asset is the 9:16 cut.

**Approved brand assets used (unaltered):**

| Path | State | Verified |
| --- | --- | --- |
| `assets/branding/walkie-doggy-mascot-transparent.png` | `APPROVED` in-app derivative | 1254², RGBA, SHA-256 `8ab9b632…` (matches MASCOT_SPEC; the build refuses any other hash) |
| `assets/branding/walkie-doggy-mascot-clean.png` | `APPROVED` Clean Master (opaque) | SHA-256 `9c702a7a…` — not used in video (opaque panel) |
| `assets/walkie-doggy-link-wordmark-transparent.png` | No lifecycle state recorded | 608×220 RGBA. **Defect:** soft near-white matte (≈76 % semi-transparent pixels, faint grey band at top). Shown on a white surface card so the matte is invisible; a clean wordmark export is recommended. |
| `assets/images/walkie-default-park.jpg` | User-approved | SHA-256 `fbd7de06…` (available for B-roll; not used yet) |

**Existing recordings / video / audio / captions in the repository:** none.

Mascot motion in the video is limited to a gentle whole-card zoom (1.00 → 1.03) and fades. It is presentation motion, not character animation; no pose, frame or redraw is introduced (MASCOT_SPEC "Animation identity").

## 2. Narration review against the real product

Every sentence maps to shipped UI; nothing claims an unbuilt feature.

| Narration | Evidence in app | Note |
| --- | --- | --- |
| יצירת משפחה, פרטי הכלב, הזמנת בני משפחה | Family onboarding + setup wizard, `InviteShareModal` | ✓ |
| שעות הטיול ומי אחראי | Schedule rules, `RuleFormModal` | ✓ |
| הטיול הבא ומי אמור לצאת | Home next-walk card | ✓ |
| ״התחלת טיול״ / ״סיום טיול״ | Buttons read **״התחל טיול״ / ״סיים טיול״** (`NextWalkCard`) | Suggest matching the on-screen labels (owner decision). Requires Walk Lifecycle v1.1 active on Staging. |
| מסלול ומרחק במפה | Live GPS | **Gated** — shown only after real-iPhone GPS acceptance; sentence is conditional by wording. |
| בקשת החלפה / שינוי שעה, מעקב אחר הטיפול | `WalkRow` links, `RequestTimeChangeModal`, `RequestsInboxModal` approve/reject, request status line | ✓ swap = member↔member, time change = member→admin; needs a live connection. |
| לוח שבועי, היסטוריה, ״סטטיסטיקות״ | Schedule (today/tomorrow/week), History, Statistics | Tab label is **״נתונים״** (screen title ״סטטיסטיקה״). Both are visible to permitted members only. |
| מנהלי המשפחה מעדכנים בני משפחה, תפקידים ופרטי כלב | Family tab admin controls, `MemberDetailsModal`, `DogDetailsModal` | ✓ admin-only — show with an admin profile. |

Spoken length ≈ 110 words ≈ 50–55 s at a calm pace, inside a 2:35 timeline: each sentence lands on its scene and the remainder is clean screen action.

## 3. Privacy-safe capture plan (genuine Staging only)

### Environment

* **Staging only** (`staging.walkielink.co.il`, SHA verified on the day of capture). Never Production.
* **Test family only.** Preferred: a System Admin **test family** (QA family) entered from the System Admin screen. Alternative: a new family created through the real onboarding with a dedicated test email address. Never record a real family. No deletion of any family afterwards without separate approval.
* **Fictional data:** family “משפחת דוגמה”; members “נועה” (admin), “איתי”, “מיכל” (members); dog “בוני”. Never “טופי” (MASCOT_SPEC). No real faces; dog photo either omitted or a licensed/owned image.
* **Do not record** the email/OTP screen, invite codes/links, PINs, push tokens, or any System Admin console content. Pause recording or crop those moments.
* Leaves the 531 quarantined SyncQueue operations untouched (capture never opens Sync diagnostics).

### Device settings (iPhone)

Portrait · Safari Home-Screen PWA on Staging · iOS Screen Recording (Control Center) · Focus/Do Not Disturb **on** (no banners) · Light mode · default Text Size · Display Zoom “Default” · Hebrew UI · battery > 50 % · clean status bar. Deliver the original `.MOV` files (HEVC is fine; the build re-encodes).

### Required recordings

| ID | Scene | Steps (real UI) | Length | Prerequisite / gate |
| --- | --- | --- | --- | --- |
| C01 | Family + dog | Onboarding: create family → dog name/sex (photo optional) | 25–35 s | Test email or QA family; skip OTP screen |
| C02 | Members, roles, schedule | Add נועה/איתי/מיכל → show role → add weekly walk time + responsible → land on Home next-walk card | 25–35 s | Admin profile |
| C03 | Start walk | Home → ״התחל טיול״ | 10–15 s | **Walk Lifecycle v1.1 active on Staging** (currently pending System Admin confirmation per `EXECUTION_STATE.md`) |
| C04 | Live GPS | Permission prompt → first fix → live route/distance during a real outdoor walk | 20–30 s | **Gated:** real-iPhone GPS acceptance. Never simulated. |
| C05 | Finish walk | ״סיים טיול״ → completion sheet → celebration → Home updated | 10–15 s | C03 |
| C06 | Requests | Member: ״בקש החלפה״ and ״בקש שינוי שעה״ → status line; approver: requests inbox → approve | 25–35 s | Two test profiles (two devices, or PIN switch on one); live connection |
| C07 | Schedule, history, stats, admin | Schedule week view → History → נתונים → Family admin controls → dog details | 30–40 s | Some completed test walks (from C03/C05) |

## 4. Timestamped storyboard (edit decision list: `edit.json`)

| Time | Scene | Visual | Narration (exact draft) |
| --- | --- | --- | --- |
| 0:00–0:15 | S1 open | Approved mascot + wordmark on white card, gentle zoom | ברוכים הבאים ל־Walkie Doggy Link! כאן כל המשפחה מתאמת את הטיולים עם הכלב, בקלות ובמקום אחד. |
| 0:15–0:40 | S2 C01 | Phone-framed capture, chapter “יצירת משפחה והכלב” | מתחילים ביצירת משפחה, מוסיפים את פרטי הכלב, ומזמינים את בני המשפחה להצטרף. |
| 0:40–1:00 | S3 C02 | Chapter “בני משפחה ולו״ז”, tap highlights | בשלב הבא מגדירים את שעות הטיול ואת מי שאחראי לכל טיול. במסך הבית אפשר לראות מהו הטיול הבא, ומי אמור לצאת. |
| 1:00–1:12 | S4a C03 | “יוצאים לטיול” | כשהגיע הזמן, פותחים את הטיול ולוחצים על התחלת טיול. |
| 1:12–1:28 | S4b C04 | “מעקב מיקום” — **gated** | כשמעקב המיקום זמין ומאושר, ניתן לראות את המסלול ואת המרחק במפה. |
| 1:28–1:35 | S4c C05 | “סיום טיול” | בסיום, לוחצים על סיום טיול. |
| 1:35–1:55 | S5 C06 | “החלפה ושינוי שעה” | לא יכולים לצאת בזמן? אפשר לבקש החלפה או שינוי שעה, ולעקוב אחר הטיפול בבקשה. |
| 1:55–2:20 | S6 C07 | “לו״ז, היסטוריה ונתונים” | בלוח השבועי רואים את התכנון קדימה, ובהיסטוריה ובסטטיסטיקות אפשר לעיין בטיולים שכבר בוצעו. מנהלי המשפחה יכולים לעדכן בני משפחה, תפקידים ופרטי כלב. |
| 2:20–2:35 | S7 close | Mascot, “טיולים נעימים!”, Help reminder | זה הכול! עם Walkie Doggy Link, כולם יודעים מתי יוצאים, מי אחראי, ומה כבר בוצע. טיולים נעימים! |

Without the GPS scene (default until acceptance) the cut is **2:19** and the GPS sentence and its caption are removed automatically.

## 5. Motion and transitions

* Cream background `#FBF8F3`; chapter titles top-right in `primaryDark` `#0B5C75`; turquoise `#20A7B5` only for tap rings/accents.
* Captures sit in a rounded phone frame (radius ≈ 11 % of width), centred, with no device chrome or invented UI.
* Scene transitions: 0.4 s fade through the brand cream. No whip pans, no zooms on UI, no confetti outside the app's own celebration.
* Tap highlights: 0.6 s turquoise ring at the real tap point (added per capture once footage exists).
* Reduced-motion-friendly by construction: no flashing, no parallax; total motion amplitude ≤ 3 % zoom.

## 6. Voiceover

**Requirement:** female, natural Israeli Hebrew, warm and professional. I could not produce or evaluate a voice in this environment (no speech engine, no audio playback), and I make no claim about any voice's accent.

**Options for the owner:** (a) a native Israeli voice artist; or (b) a Hebrew-native neural TTS voice selected by the owner, e.g. a `he-IL` female voice — **must be listened to and approved by a native speaker** before use.

**Pronunciation guide:** “Walkie Doggy Link” = *ווֹקִי דוֹגִי לִינְק*; “ל־Walkie” = *לְווֹקִי*; “מתאמת” = *מְתָאֶמֶת*; “לו״ז” = *לוּ״ז*; “סטטיסטיקות” = *סְטָטִיסְטִיקוֹת*.

**Delivery spec:** WAV 48 kHz / 24-bit, mono, one continuous take or one file per caption cue (IDs in `edit.json`), room tone 0.5 s head/tail, loudness −16 LUFS integrated, true peak ≤ −1 dBTP, no music under the take (a licensed bed, if any, is mixed separately at −24 LUFS).

**Review checklist:** native-speaker accent check · every brand name and button label pronounced as on screen · no robotic stress on construct-state nouns · pace ≤ 2.4 words/s · consistent mic distance · caption cue times re-synced to the final take (edit `cues` in `edit.json`, rebuild).

## 7. Captions

`tutorial.he.vtt` / `.srt` / `.ass` are generated from `edit.json`: ≤ 42 characters per line, ≤ 2 lines, balanced breaks, each line wrapped in an explicit right-to-left embedding (U+202B…U+202C). This was verified visually: without it, libass reversed mixed lines such as “עם Walkie Doggy Link, …” and moved edge punctuation to the wrong side. The master MP4 carries a soft Hebrew `mov_text` track; the app uses the VTT through `<track>` (captions on by default, toggleable). The burned-in copy is for review only.

## 8. Build (editable source project)

```
python3 scripts/tutorial-video/build_video.py --out <dir> \
    [--vo narration.wav] [--captures docs/product/tutorial-video/captures] \
    [--include-gps] [--vertical]
```

Inputs: `edit.json` (timeline, chapters, cues), approved assets, recordings named `C01…C07` in `captures/`, narration. Missing recordings render as clearly-labelled **DRAFT** slates (dashed frame, “טיוטה · DRAFT”, file name) — never as mock UI. Requires ffmpeg (libx264, libass, fribidi, harfbuzz) and Pillow with raqm.

Outputs: `tutorial_16x9.mp4` (master, soft subs), `tutorial_16x9_review.mp4` (burned captions), `tutorial_9x16.mp4` (in-app cut, burned captions for review; the in-app build should use soft captions via VTT), `tutorial.he.{vtt,srt,ass}`, `review/*.png`. Encoding: H.264 High@4.1, yuv420p, 30 fps, CRF 20, AAC 160 kbps 48 kHz, `+faststart` (progressive playback on iPhone Safari / Android Chrome).

## 9. Integration plan (not implemented — needs separate approval)

1. Host the approved **9:16** MP4, VTT and a poster on Staging first: Supabase Storage public bucket on the Staging project, or Vercel Blob — HTTPS, `Content-Type: video/mp4` / `text/vtt`, long cache with a versioned file name. If captions and video are on another origin, enable CORS (the player sets `crossOrigin="anonymous"` for https captions). Alternative: same-origin `/tutorial/…` in `public/` (simplest CORS story, but adds ~10–20 MB to the repo).
2. Set `EXPO_PUBLIC_TUTORIAL_VIDEO_URL`, `…_CAPTIONS_URL`, `…_POSTER_URL` (and `…_AUTO_OFFER_SINCE`) **on the branch-scoped Preview env only**, redeploy, re-alias Staging — each step separately approved.
3. Behaviour already implemented and tested: no autoplay; playback only after a tap; inline on iOS; blocked-start → poster + play; load/playback error → fallback + retry; offline → fallback; captions on by default; close always available; Help replay.
4. Size target for the in-app 9:16: ≤ 12 MB at 720×1280 (~0.6 Mbps for UI capture) — produce from the master with the same script once footage is final.

## 10. QA performed on the draft

Visual frame inspection at 16:9 and 9:16 (brand open/close, slates, every caption style): RTL order and punctuation, mixed Hebrew/Latin lines, line length, caption/content collisions, mascot identity unchanged (approved file, hash-checked), cream/turquoise usage. Defects found and fixed during QA: wordmark matte on cream, caption/subtitle collision, sentence-final punctuation on the wrong side, reversed mixed-direction captions, vertical subtitle overflow, slate/caption overlap. Technical checks: `ffprobe` stream/profile/faststart verification and cue timing (see the delivery report).

## 11. Open dependencies (updated)

Companion documents: `CAPTURE_CHECKLIST.md` (safe test-family workflow, C01–C07), `NARRATION_PACKAGE.md` (script v2, voice brief, pronunciation sign-off), `FINAL_MP4_PLAN.md` (phases, gates, acceptance), `assets/WORDMARK_PROVENANCE.md`.

1. Genuine recordings C01–C07: owner on iPhone, in a System Admin test family. Needs authorisation for hosted Staging writes inside the test family.
2. Narration: voice artist or owner-chosen TTS, plus a signed native-speaker pronunciation form.
3. Walk Lifecycle v1.1 active on Staging (C03/C05); real-iPhone GPS acceptance (C04).
4. Owner approvals: script v2 (four label alignments); clean wordmark DRAFT; music, either the original generated bed (licence record PENDING, needs a listen) or a licensed library track with a licence record.
5. Separate approvals for hosting, env configuration and activation on Staging.
