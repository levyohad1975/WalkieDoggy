# Tutorial Narration Package — female Israeli-Hebrew voice

Status: **script v2 ready for owner approval · no audio recorded or generated in this environment.**
Pipeline (QA → integration) is built and tested with synthetic test tones; it accepts the real takes as soon as they exist.

## 1. Voice brief

* **Voice:** female, native Israeli Hebrew, warm, friendly and calm. A parent explaining an app to the family, not a commercial announcer.
* **Pace:** ~2.2–2.4 words/second; short natural pauses at commas. Smile in the voice on the first and last lines only.
* **Register:** everyday spoken Hebrew, standard Israeli pronunciation (ח/כ as a soft fricative, ר as uvular), no exaggerated stress.
* **Avoid:** English-accented or synthetic-sounding Hebrew, robotic construct-state stress, reading the ״ quote marks aloud, "radio" over-articulation.
* **Honesty rule (from the brief):** no voice is described as native Israeli Hebrew until a native speaker has listened and signed §5.

## 2. Script v2 — one take per cue

Files: `cue-NN.wav`. Limits are the hard maximum before the next line or scene; `audio_qa.py` enforces them.

| File | Text (read exactly) | Pronunciation notes | Max |
| --- | --- | --- | --- |
| cue-01 | ברוכים הבאים ל־Walkie Doggy Link! | *לְווֹקִי דוֹגִי לִינְק* — English brand name, Israeli accent; stress DOG-gy | 3.9 s |
| cue-02 | כאן כל המשפחה מתאמת את הטיולים עם הכלב, בקלות ובמקום אחד. | *מְתָאֶמֶת*; *בְּקַלּוּת* | 9.3 s |
| cue-03 | מתחילים ביצירת משפחה, מוסיפים את פרטי הכלב, | *בִּיצִירַת*; *פִּרְטֵי* | 13.8 s |
| cue-04 | ומזמינים את בני המשפחה להצטרף. | *וּמַזְמִינִים*; *לְהִצְטָרֵף* | 9.8 s |
| cue-05 | בשלב הבא מגדירים את שעות הטיול ואת מי שאחראי לכל טיול. | *שֶׁאַחְרָאִי* | 11.8 s |
| cue-06 | במסך הבית אפשר לראות מהו הטיול הבא, ומי אמור לצאת. | *מַהוּ* | 6.8 s |
| cue-07 | כשמגיע הזמן, לוחצים על ״התחל טיול״. | Button label: *הַתְחֵל טִיּוּל* (imperative, as on screen) | 10.8 s |
| cue-08 | כשמעקב המיקום זמין ומאושר, ניתן לראות את המסלול ואת המרחק במפה. | **GPS-gated** — record now, used only after real-iPhone GPS acceptance | 14.8 s |
| cue-09 | בסיום, לוחצים על ״סיים טיול״. | Button label: *סַיֵּים טִיּוּל* | 5.8 s |
| cue-10 | לא יכולים לצאת בזמן? אפשר לבקש החלפה או שינוי שעה, | Rising question intonation on *בַּזְּמַן* | 10.8 s |
| cue-11 | ולעקוב אחר הטיפול בבקשה. | *וְלַעֲקוֹב*; *בַּבַּקָּשָׁה* | 7.8 s |
| cue-12 | בלו״ז רואים את התכנון לשבוע הקרוב, | *בַּלּוּ״ז* (say “לוּז”) | 6.8 s |
| cue-13 | ובמסכי ההיסטוריה והנתונים אפשר לעיין בטיולים שכבר בוצעו. | *וּבְמָסְכֵי*; *לְעַיֵּן*; *בּוּצְּעוּ* | 8.8 s |
| cue-14 | מנהלי המשפחה יכולים לעדכן בני משפחה, תפקידים ופרטי כלב. | *מְנַהֲלֵי*; *לְעַדְכֵּן* | 7.8 s |
| cue-15 | זה הכול! | Warm, short | 1.9 s |
| cue-16 | עם Walkie Doggy Link, כולם יודעים מתי יוצאים, מי אחראי, ומה כבר בוצע. | **Tightest line** (~5.7 s natural vs 6.7 s max). Keep the three short beats crisp. If it runs over, shift cues 16–17 later in `edit.json` — never speed the audio up. | 6.7 s |
| cue-17 | טיולים נעימים! | Smile; let it ring | 5.0 s |

Changes from the owner's v1 draft are listed per cue in `edit.json` (`v1Text`, `alignedTo`).

## 3. Delivery spec

WAV, 48 kHz, 24-bit, mono, one file per cue, 0.2–0.5 s room tone head and tail, no music, no processing beyond gentle de-noise. Peak ≤ −3 dBFS; the build normalises loudness to −16 LUFS / −1 dBTP. Quiet room; consistent mic distance across takes; record all takes in one session.

## 4. Sources (owner chooses)

| Option | Notes |
| --- | --- |
| **A. Native Israeli voice artist (recommended)** | Most natural result. Ask for one pickup session for retakes. Licence: buyout for in-app and web use. |
| **B. Neural TTS with a `he-IL` female voice** | Use only a voice the owner has listened to and a native speaker approves. Check the provider's commercial licence for in-app use. Insert pronunciation hints (§2) via the provider's phoneme/alias features. Generate per-cue files with the names above. |

No voice has been generated, auditioned or rated here: this environment has no speech engine and no audio playback.

## 5. Human pronunciation QA (required sign-off)

Reviewer: a native Israeli-Hebrew speaker, listening on phone speakers **and** headphones.

| Cue | Natural Israeli accent | Brand name correct | Button/tab labels as on screen | Stress & construct forms | Pace & warmth | No artefacts (clicks, breaths, robotic glitches) | Retake? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cue-01 … cue-17 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

Reviewer name · date · decision (approve / retake list). Store the signed form with the takes.

## 6. Integration (already built and tested)

```
python3 scripts/tutorial-video/audio_qa.py <takes-dir>                     # technical gate
python3 scripts/tutorial-video/build_video.py --out <dir> --vertical \
        --vo-dir <takes-dir> --music <approved-bed.wav>                    # captions re-time to each take
python3 scripts/tutorial-video/validate_video.py <dir>
```

Verified with synthetic tones: an over-long take is refused with the exact time available; takes start within ±60 ms of their captions; captions follow the spoken length without overlapping; final mix −16.0 LUFS; music ducked ≈ 7 dB under speech; voice sits ≈ 21 LU above the bed.
