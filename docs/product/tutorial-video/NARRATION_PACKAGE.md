# Tutorial Narration Package: female Israeli-Hebrew voice (FINAL script v2)

Status:
* **Script v2 approved by the owner (2026-10-17)**, with its verified on-screen labels.
* **Voice: a professional female Israeli-Hebrew narrator** (owner decision). Not yet cast or recorded.
* The integration pipeline is built and tested with synthetic test tones (§7). It accepts the real takes as soon as they exist.

## 1. Voice brief (send to the narrator / agency)

* **Voice:** female, native Israeli Hebrew, warm, friendly and calm. A parent explaining an app to the family, not a commercial announcer.
* **Pace:** about 2.2–2.4 words per second, with short natural pauses at commas. Smile in the voice on the first and last lines only.
* **Register:** everyday spoken Hebrew, standard Israeli pronunciation (ח/כ as a soft fricative, ר uvular), no exaggerated stress.
* **Avoid:** English-accented or synthetic-sounding Hebrew; construct-state stress errors; reading the ״ quote marks aloud; "radio" over-articulation.
* **Honesty rule:** no recording is described as native Israeli Hebrew until a native speaker has listened and signed `PRONUNCIATION_QA_FORM.md`.

## 2. Final script and timing (16 cues, GPS scene excluded)

Generated from `edit.json` by `scripts/tutorial-video/narration_timing.py`, which is also the CSV cue sheet for the studio (`--csv cue-sheet.csv`).

* **Target** is the natural length at the brief's pace; aim for it.
* **Hard max** is the longest take that can fit before the next line or scene end. `audio_qa.py` and the build enforce it.
* **Starts at** is the position in the 139-second video. Each line is anchored to the on-screen moment in `CAPTURE_CHECKLIST.md` §4.

| File | Text (read exactly) | Pronunciation notes | Target | Hard max | Starts at |
| --- | --- | --- | --- | --- | --- |
| cue-01 | ברוכים הבאים ל־Walkie Doggy Link! | *לְ־ווֹקִי דוֹגִי לִינְק*: English brand name, Israeli accent, stress DOG-gy | 2.1–2.3 s | 3.9 s | 1.5 s |
| cue-02 | כאן כל המשפחה מתאמת את הטיולים עם הכלב, בקלות ובמקום אחד. | *מְתָאֶמֶת*; *בְּקַלּוּת* | 4.8–5.2 s | 9.4 s | 5.5 s |
| cue-03 | מתחילים ביצירת משפחה, מוסיפים את פרטי הכלב, | *בִּיצִירַת*; *פִּרְטֵי*; continuing intonation (the sentence goes on in cue-04) | 3.2–3.4 s | 13.9 s | 16.0 s |
| cue-04 | ומזמינים את בני המשפחה להצטרף. | *וּמַזְמִינִים*; *לְהִצְטָרֵף* | 2.1–2.3 s | 9.9 s | 30.0 s |
| cue-05 | בשלב הבא מגדירים את שעות הטיול ואת מי שאחראי לכל טיול. | *שֶׁאַחְרַאי* | 4.6–5.0 s | 11.9 s | 41.0 s |
| cue-06 | במסך הבית אפשר לראות מהו הטיול הבא, ומי אמור לצאת. | *מַהוּ* | 4.4–4.8 s | 6.9 s | 53.0 s |
| cue-07 | כשמגיע הזמן, לוחצים על ״התחל טיול״. | Button label *הַתְחֵל טִיּוּל* (imperative, as on screen) | 2.8–3.0 s | 10.9 s | 61.0 s |
| cue-09 | בסיום, לוחצים על ״סיים טיול״. | Button label *סַיֵּים טִיּוּל* | 2.3–2.5 s | 5.9 s | 73.0 s* |
| cue-10 | לא יכולים לצאת בזמן? אפשר לבקש החלפה או שינוי שעה, | Rising question intonation on *בַּזְּמַן* | 4.4–4.8 s | 10.9 s | 80.0 s* |
| cue-11 | ולעקוב אחר הטיפול בבקשה. | *וְלַעֲקוֹב*; *בַּבַּקָּשָׁה* | 1.7–1.8 s | 7.9 s | 91.0 s* |
| cue-12 | בלו״ז רואים את התכנון לשבוע הקרוב, | *בַּלּוּ״ז* (say "luz") | 2.5–2.7 s | 6.9 s | 100.0 s* |
| cue-13 | ובמסכי ההיסטוריה והנתונים אפשר לעיין בטיולים שכבר בוצעו. | *וּבְמָסְכֵי*; *לְעַיֵּן*; *בּוּצְּעוּ* | 3.3–3.6 s | 8.9 s | 107.0 s* |
| cue-14 | מנהלי המשפחה יכולים לעדכן בני משפחה, תפקידים ופרטי כלב. | *מְנַהֲלֵי*; *לְעַדְכֵּן* | 4.0–4.3 s | 7.9 s | 116.0 s* |
| cue-15 | זה הכול! | Warm, short | 0.8–0.9 s | 1.9 s | 125.0 s* |
| cue-16 | עם Walkie Doggy Link, כולם יודעים מתי יוצאים, מי אחראי, ומה כבר בוצע. | Densest line: keep the three short beats crisp; do **not** rush | 6.2–6.7 s | **7.5 s** | 127.0 s* |
| cue-17 | טיולים נעימים! | Smile; let it ring | 0.8–0.9 s | 4.3 s | 134.6 s* |
| *cue-08 (optional)* | כשמעקב המיקום זמין ומאושר, ניתן לראות את המסלול ואת המרחק במפה. | **GPS-gated.** Record in the same session so no rebooking is needed; used only after real-iPhone GPS acceptance | 4.8–5.2 s | 14.9 s | — |

\* From cue-09 onward the "Starts at" times are 16 s earlier than in `edit.json`, because the GPS scene is excluded. The build applies this shift automatically.

Timing change made while finalizing: cue-17 moved from 149.8 s to 150.6 s on the full timeline. This gives cue-16 a hard max of 7.5 s instead of 6.7 s, so its natural read (≈ 6.2–6.7 s) no longer has to be rushed. No text changed. The sheet now reports **no tight cues**: every line has ≥ 0.8 s headroom at the slow pace, and caption reading speed is ≤ 14 characters per second.

Original v1 wording for the four aligned lines (cue-07, 09, 12, 13) is kept in `edit.json` (`v1Text`, `alignedTo`).

## 3. Delivery spec

* WAV, 48 kHz, 24-bit, mono, **one file per cue** named exactly `cue-NN.wav`.
* 0.2–0.5 s of room tone at the head and tail. No music, no processing beyond gentle de-noise.
* Peak ≤ −3 dBFS; the build normalises loudness to −16 LUFS / −1 dBTP.
* Quiet room, consistent mic distance, all takes in one session.
* Deliver the chosen take per cue, plus one alternate for cue-01, cue-16 and cue-17.

## 4. Casting and licence (owner)

* **Source:** a professional native Israeli voice artist, booked directly or through an agency. Ask for a 2–3 line audition (cue-01, cue-10, cue-16) before booking.
* **Licence to obtain in writing:** buyout, perpetual, worldwide, for in-app playback, the website and social media, with no attribution requirement. Include one free pickup session for retakes after the pronunciation review.
* **Session:** send this file and the CSV cue sheet. Optionally run a remote-directed session so the owner can confirm the brand name on the first takes.
* The artist's name and licence go into `narration.approval.json` (§6). Nothing else about the artist is stored in the repository.

## 5. Human pronunciation QA (required)

`PRONUNCIATION_QA_FORM.md`: a native Israeli-Hebrew speaker (not the narrator) listens on phone speakers **and** headphones, ticks every cue and signs. Retakes go to the pickup session; the form is repeated for the replaced cues.

## 6. Approval record (machine-checked)

After `audio_qa.py` passes, it writes `narration.approval.json` next to the takes. That file records the SHA-256 of every take, with PENDING fields for the voice licence, the native-speaker review and the owner's approval.

* `build_video.py` refuses a final (non `--draft`) render until all three are filled in **and** the take hashes still match. A replaced take therefore cannot slip in after the review.
* `validate_video.py --final` checks the same approval through `build_report.json`.

## 7. Integration (built and tested)

```
python3 scripts/tutorial-video/narration_timing.py --csv cue-sheet.csv          # studio cue sheet
python3 scripts/tutorial-video/audio_qa.py takes/ --write-approval-template      # technical gate + approval record
python3 scripts/tutorial-video/build_video.py --out out/ --vertical --vo-dir takes/ \
        --music <bed.wav> --wordmark docs/product/tutorial-video/assets/walkie-doggy-link-wordmark-clean.DRAFT.png [--draft]
python3 scripts/tutorial-video/validate_video.py out/ [--final]
```

* Each take starts at its cue time, and the caption follows the spoken length (+0.4 s, never past the next line).
* Over-long takes are refused with the exact time available.
* The final mix is −16 LUFS / −1 dBTP, with the music ducked about 7 dB under speech.
* All of this is verified with synthetic tones; `scripts/tutorial-video/selftest.py` covers the gates.
