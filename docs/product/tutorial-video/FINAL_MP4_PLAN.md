# Final Tutorial MP4 — Completion Plan

Goal: a final, approved Hebrew tutorial with genuine Staging footage, a female Israeli-Hebrew narration, synchronised RTL captions and a subtle licensed bed. Delivered as a 16:9 master and a 9:16 in-app cut, **ready to host but not activated**.

Everything in the pipeline is built and verified (§6). What remains is real inputs and approvals.

## 1. Phases, owners and gates

| # | Phase | Owner | Inputs | Gate to exit |
| --- | --- | --- | --- | --- |
| P1 | **Approve the plan** | Owner | Script v2 (`NARRATION_PACKAGE.md` §2), clean wordmark DRAFT, music bed (audition), capture workflow | Written approval of: script v2, wordmark, music licence (or a replacement licensed track), go-ahead for a Staging capture session |
| P2 | **Capture C01, C02, C06, C07** | Owner on iPhone | Disposable System Admin test family (`CAPTURE_CHECKLIST.md`) | Each recording passes the per-recording acceptance check; no private data |
| P3 | **Capture C03, C05** | Owner | **Walk Lifecycle v1.1 active on Staging** | Same check; start/finish shown without errors |
| P4 | **Narration** | Voice artist or owner-chosen TTS | Script v2, delivery spec | `audio_qa.py` 0 failures **and** signed native-speaker pronunciation form |
| P5 | **Assemble DRAFT v1** | Claude | P2–P4 outputs | `validate_video.py` 0 failures; frame review; tap highlights added on real tap points |
| P6 | **Owner review** | Owner | DRAFT v1 on a real iPhone + Android | Change list resolved (≤ 2 revision rounds) |
| P7 | **Final master** | Claude | Approved DRAFT | Re-render without `--draft` (all assets approved); validation 0 failures; checksums recorded |
| P8 | **GPS scene (optional, later)** | Owner + Claude | Real-iPhone GPS acceptance → C04 | Rebuild with `--include-gps`; validation passes; owner approval |
| P9 | **Hosting & activation** | Separate approval | Final files | Separate approvals for upload (Staging first), env vars, redeploy and re-alias. **Not part of this plan's authority.** |

P2/P3 write hosted Staging data inside the test family, and therefore need explicit authorisation before they start.

## 2. Commands (final assembly)

```
# narration gate
python3 scripts/tutorial-video/audio_qa.py takes/

# final render (no --draft: refuses any PENDING asset or licence)
python3 scripts/tutorial-video/build_video.py --out out/ --vertical \
    --captures docs/product/tutorial-video/captures \
    --vo-dir takes/ --music music/approved-bed.wav \
    [--wordmark assets/<approved clean wordmark>.png] [--include-gps]

# technical gate
python3 scripts/tutorial-video/validate_video.py out/ [--include-gps]
```

## 3. Deliverables

| File | Use |
| --- | --- |
| `tutorial_9x16.mp4` (1080×1920) + in-app transcode ≤ 12 MB at 720×1280 | App tutorial player (portrait). Soft captions via VTT. |
| `tutorial_16x9.mp4` (1920×1080, soft `heb` subtitles) | Web, sharing, support |
| `tutorial.he.vtt` / `.srt` | Captions (default on in the app) |
| Poster PNG (approved mascot card) | Player poster / fallback |
| `checksums.txt`, licence records, signed pronunciation form | Provenance |

## 4. Acceptance criteria (final)

* **Authenticity:** every app scene is a genuine Staging recording of a test family. No DRAFT slates remain, except an excluded GPS scene, which is simply absent.
* **Brand:** approved mascot (hash-checked by the build); approved wordmark; cream/turquoise system.
* **Voice:** female, natural Israeli Hebrew, signed off by a native speaker; brand and button labels pronounced as on screen.
* **Captions:** ≤ 2 × 42 characters, RTL-embedded lines, synchronised to the takes (automatic re-timing), verified on device.
* **Audio:** −16 LUFS integrated, true peak ≤ −1 dBTP, music ≈ 7 dB ducked under speech and inaudible as a distraction (owner listen).
* **Technical:** H.264 High, yuv420p, 30 fps, AAC 48 kHz, faststart; duration equals the edited timeline; plays inline on iPhone Safari and Android Chrome without autoplay.
* **Claims:** narration matches the shown UI; no GPS content without real-iPhone acceptance.
* **Privacy:** no real names, emails, OTPs, PINs, invite codes, addresses or System Admin screens.

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Walk Lifecycle v1.1 still inactive on Staging | Capture P2 first; C03/C05 wait. Optionally ship v1 without the walk scenes — this needs a script change and owner approval. |
| TTS sounds non-native | Prefer a voice artist; the native-speaker gate is mandatory either way. |
| cue-16 too long for its slot | Shift cues 16–17 in `edit.json` (the closing card has slack); never time-stretch speech. |
| Recordings contain private data | Stop conditions in the capture workflow; frame review before assembly. |
| Wordmark resolution (608 px source) | Acceptable at current sizes; request a vector master for future large formats. |
| Bed taste | The original bed is optional; any licensed track works if it comes with a licence record. |

## 6. Already verified

* Draft animatic, 16:9 + 9:16: `validate_video.py` 0 failures (codec/profile/faststart/duration, 16 cues in-scene, RTL-embedded, GPS narration absent).
* Narration intake with synthetic tones: refusal of over-long takes, ±60 ms placement, caption re-timing without overlap.
* Music: licence gate (missing record, hash mismatch, PENDING without `--draft` — refused before rendering); two-pass loudness −16.0 LUFS; ducking ≈ 6.8 dB; voice ≈ 21 LU over the bed.
* Capture framing with a test pattern: rounded phone mask, holds the last frame, clear of the caption band in both formats.
* Clean wordmark candidate: round-trip error mean 0.66 levels; no halo, band or fringe on four backgrounds.
