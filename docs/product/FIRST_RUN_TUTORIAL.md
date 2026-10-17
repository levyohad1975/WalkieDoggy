# First-Run Video Tutorial & Help — UX Flow, Integration and Storyboard

Status: **Infrastructure implemented · Storyboard `DRAFT` — awaiting owner approval · No final video produced.**

Classification (AGENTS.md routing): **Joint** — Creative defines flow, copy and storyboard; Engineering implements gating, persistence and the player without touching authentication, onboarding persistence or SyncQueue semantics.

---

## 1. Product rules (from the brief)

| Rule | How it is met |
| --- | --- |
| Never interrupt email verification (OTP / future Magic Link) | The invitation can only render inside the authenticated, profile-claimed branch of `App.tsx` (`currentUserId` set). Verification lives in `FamilyOnboardingScreen` / `LoginScreen`, which are separate branches. |
| Never required before onboarding completes | The invitation is never shown while `FamilySetupWizard` is visible, and "דלג והתחל" is always available. |
| Shown after onboarding + successful profile entry, before the first Dashboard experience | Rendered as an overlay above `RootNavigator` (Home loads underneath), on the first eligible entry. |
| Creators/managers and joining members | Role-aware video source (`admin` / `member` cut) and role-aware storyboard. |
| Permanently accessible | "▶ סרטון הדרכה" row in **Settings → ❓ עזרה**, and in **Family → ❓ עזרה** (Settings is permission-gated for members, Family is always visible). |
| Never autoplay with sound | Nothing autoplays. Playback begins only after "▶ צפה בהדרכה" / the play control. If the browser refuses the start, the player waits on its poster with a play button. |
| Never block normal usage if the video is unavailable | Missing config, load error, playback error or offline all fall back to a poster with text highlights and a close action. No auto-offer is made when no video source is configured. |

---

## 2. UX flow

```
Email verification / family onboarding / profile entry      (unchanged)
          │
          ▼
Profile claimed → RootNavigator mounts (Home loads)
          │
          ▼
First-run gate (per family + profile)
  ├─ not eligible ──────────────────────────────► Home (no overlay)
  └─ eligible → Welcome overlay
        ├─ "דלג והתחל"  → record DISMISSED → Home
        ├─ close ✕ / Android back → record DISMISSED → Home
        └─ "▶ צפה בהדרכה" → Player
              ├─ ended            → "יאללה, מתחילים!" → record COMPLETED → Home
              ├─ close ✕          → record DISMISSED → Home
              └─ error / offline  → fallback (poster + highlights) → close → DISMISSED

Settings / Family → ❓ עזרה → "▶ סרטון הדרכה" → Player directly (no welcome)
   ended → "יאללה, מתחילים!" → record COMPLETED (never resets a prior record)
```

### Eligibility for the automatic invitation

All must hold (see `src/logic/tutorialGate.ts`):

1. A tutorial video source is configured for the viewer's role.
2. A real profile is claimed (`currentUserId`), the family and its member list are loaded, and the profile belongs to that family.
3. Not System-Admin observer mode, not impersonation, not Test Mode.
4. The family setup wizard is not visible and the iOS "add to Home Screen" prompt is not showing (they never stack).
5. No stored decision (`completed` / `dismissed`) for this **family + profile**, and fewer than 3 prior unanswered presentations.
6. The stored record could be read. A storage read failure is treated as "unknown" → **no auto-offer** (prevents repeated nagging); the Help entry still works.
7. The device appears online (offline → deferred, not counted).
8. Optional rollout cutoff: when `EXPO_PUBLIC_TUTORIAL_AUTO_OFFER_SINCE` is set, only profiles created on/after that instant are auto-offered — existing users are not interrupted by a launch.

### Lifecycle edge cases

| Situation | Behaviour |
| --- | --- |
| Logout / profile switch / join another family | The overlay closes immediately when the `(familyId, profileId)` context changes; the new context is evaluated on its own record. |
| Same person, second family | Separate record — offered once in the new family. |
| App killed while invitation is showing | No decision recorded → offered again next entry, at most 3 presentations total. |
| Storage write fails | The decision is kept in memory for the session so the overlay does not reappear; next cold start may offer again (bounded by rule 5). |
| Reduced Motion | Mascot is static; no overlay entrance animation; the video itself is never auto-started. |
| Screen reader | All controls have Hebrew labels/roles; captions available; ended state announced. |

### Persistence

* Implemented now: per **family + profile** record in AsyncStorage (`walkie-tutorial:v1:<familyId>:<profileId>`) — same storage family as `familySetupProgress`, so a different profile or family on the same device never inherits a decision.
* Cross-device sync ("not just per device") needs a server table. A remote-adapter seam exists (`setTutorialRemoteAdapter`) and the proposed schema is in `docs/engineering/tutorial-progress-server-sync.DRAFT.sql`. **It is not a migration and has not been applied** — it requires explicit approval (AGENTS.md rules 8–9).

---

## 3. Integration points

| Area | File | Change |
| --- | --- | --- |
| Config | `src/lib/tutorialConfig.ts` | Reads `EXPO_PUBLIC_TUTORIAL_*`; no URL is hard-coded. |
| Persistence | `src/lib/tutorialProgress.ts` | Per family+profile record; fail-safe read/write; remote-adapter seam. |
| Decision logic | `src/logic/tutorialGate.ts`, `src/logic/tutorialPlayerState.ts` | Pure, unit-tested. |
| State | `src/store/tutorialStore.ts` | Overlay visibility/mode, context-change reset, session memory. |
| UI | `src/components/tutorial/TutorialVideoPlayer.tsx` | Reusable responsive player (web `<video>`; native fallback). |
| UI | `src/components/tutorial/TutorialOverlay.tsx` | Welcome → player → "יאללה, מתחילים!". |
| App shell | `App.tsx` | Mounts the overlay beside `RootNavigator`; evaluates the gate. |
| Help entry | `SettingsScreen.tsx`, `FamilyScreen.tsx` | "❓ עזרה" section with "▶ סרטון הדרכה". |

Not touched: authentication, OTP, `authStore` persistence, family onboarding persistence, SyncQueue, Supabase migrations, notifications.

### Configuration (`.env` / Vercel env, Staging first)

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_TUTORIAL_VIDEO_URL` | Default video (used for both roles if role-specific ones are blank). |
| `EXPO_PUBLIC_TUTORIAL_VIDEO_URL_ADMIN` / `_MEMBER` | Optional role-specific cuts. |
| `EXPO_PUBLIC_TUTORIAL_CAPTIONS_URL` (+ `_ADMIN` / `_MEMBER`) | WebVTT Hebrew captions (`srclang="he"`). |
| `EXPO_PUBLIC_TUTORIAL_POSTER_URL` | Poster frame; the approved mascot is used when blank. |
| `EXPO_PUBLIC_TUTORIAL_AUTO_OFFER_SINCE` | ISO date-time rollout cutoff for the automatic invitation. |

Accepted URL forms: `https://…` or a same-origin path beginning with `/`. Anything else is ignored (treated as not configured).

### Platform behaviour

* **iPhone Safari / Home-Screen PWA:** `<video playsinline>` (no forced fullscreen), `preload="metadata"`, playback only from a tap; if `play()` is rejected (`NotAllowedError`) the player shows its poster + play button. Captions use a native `<track>` toggled by our own CC control.
* **Android Chrome:** same element; `controlsList="nodownload"`; same fallback rules.
* **Native iOS/Android builds:** no video dependency is added in this round (no `expo-video`/`expo-av` in `package.json`). The player renders the poster + highlights fallback. Adding native playback is a separate, approvable dependency change.

---

## 4. Storyboard & Hebrew narration — `DRAFT` for approval

Visual system: warm cream background `#FBF8F3`, white rounded cards, turquoise `#20A7B5` used only for the active highlight ring/pointer, system Hebrew font, RTL. Calm pacing, one idea per scene, no fast zooms. Authentic Staging screens recorded on a 390 × 844 iPhone viewport with a demo family whose dog is **not** presented as the mascot. The mascot appears only in the intro and outro and uses the approved transparent derivative `assets/branding/walkie-doggy-mascot-transparent.png` (static, or an already-approved pose — no new mascot generation).

Two cuts share scenes 1–7. Target length: **member ≈ 58 s**, **admin ≈ 66 s** (both inside 45–75 s). Narration budget ≈ 2.2 Hebrew words/second.

| # | Time | Screen / visual | On-screen highlight | Hebrew voiceover | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:05 | Cream background, mascot centred, wordmark below | — | "היי! ברוכים הבאים ל־Walkie Doggy — המקום שבו כל המשפחה מתאמת את הטיולים עם הכלב." | Mascot = brand, never named. |
| 2 | 0:05–0:13 | Real **בית** tab, next-walk card | Turquoise ring on next-walk card | "במסך הבית רואים מיד מה הטיול הבא, באיזו שעה, ומי אחראי עליו." | Overdue walk stays first — do not show a later walk replacing it. |
| 3 | 0:13–0:20 | Home upcoming list | Ring on member avatar/name | "ליד כל טיול מופיע בן המשפחה שאחראי עליו — כך כולם יודעים של מי התור." | |
| 4 | 0:20–0:31 | Next-walk card → **התחל טיול** → **סיים טיול** → completion sheet | Tap ripple on each button | "יוצאים? לוחצים ״התחל טיול״. חזרתם? ״סיים טיול״ — ואפשר להוסיף משך, הערה, פיפי וקקי." | **Conditional:** record only after Walk Lifecycle v1.1 is activated and verified on Staging (currently `WAITING_APPROVAL`). |
| 5 | 0:31–0:37 | Live route view | Ring on live map/route | "כשמעקב ה־GPS פעיל, אפשר לראות את מסלול הטיול בזמן אמת." | **Conditional / cuttable (−6 s).** Include only after real-iPhone GPS acceptance. Caption: "כשהמעקב זמין". |
| 6 | 0:37–0:45 | Walk row → **בקש החלפה** / **בקש שינוי שעה** | Ring on each link | "לא מסתדר? מבקשים החלפה עם בן משפחה אחר, או שינוי שעה מאחד המנהלים." | Swap = member↔member; time change = member→admin; needs connection. |
| 7 | 0:45–0:53 | **לו״ז** tab (היום / מחר / השבוע) → **היסטוריה** → **נתונים** | Ring on tab bar items | "בלו״ז רואים את היום, מחר והשבוע; בהיסטוריה ובנתונים — את כל מה שכבר נעשה." | Caption: "היסטוריה ונתונים — לפי ההרשאות במשפחה". |
| 8A | 0:53–1:02 | **משפחה** tab (admin) → add member → role; **הגדרות** → dog details | Ring on "+ הוספת בן משפחה" and dog card | "כמנהלי המשפחה, אתם מוסיפים בני משפחה, קובעים תפקידים והרשאות, בונים את הלו״ז ומעדכנים את פרטי הכלב." | **Admin cut only.** Badge on screen: "למנהלים בלבד". |
| 8M | 0:53–0:58 | **משפחה** tab (member view) | — | "את בני המשפחה ואת הלו״ז מגדירים מנהלי המשפחה — ואתם תמיד יכולים לבקש שינוי." | **Member cut only.** |
| 9 | last 5–6 s | Cream background, mascot, button "יאללה, מתחילים!" | — | "זהו! אפשר לצפות שוב בכל רגע דרך ״סרטון הדרכה״. יאללה, מתחילים!" | Ends on the same copy as the in-app end card. |

Total: admin ≈ 1:02 + outro ≈ **1:08**; member ≈ 0:58 + outro ≈ **1:04**. Without scene 5: −6 s each (still ≥ 45 s).

### Captions

Produce `tutorial-admin.he.vtt` and `tutorial-member.he.vtt` from the final narration (one cue per sentence, ≤ 2 lines, ≤ 42 chars/line, RTL Hebrew). Burned-in captions are **not** used — the CC control toggles the `<track>`.

### Production checklist before any final video

- [ ] Owner approves this storyboard and narration (including whether scenes 4–5 are recorded now or after GPS acceptance).
- [ ] Choose voice (human recording vs. approved TTS) and approve a 10-second sample.
- [ ] Record authentic Staging screens with a demo family (no personal data, no real names/photos).
- [ ] Mascot usage checked against `MASCOT_SPEC.md` QA checklist.
- [ ] Hosting location chosen (Staging first), then the env variables above are set — **no URL is invented in code**.
- [ ] Captions reviewed by a Hebrew reader; contrast of any on-screen labels checked.
