# Clean transparent wordmark — DRAFT candidate

Lifecycle: **DRAFT** — not used by the app; not used by the video build unless passed explicitly with `--wordmark`. Needs owner approval before promotion to `assets/`.

| | |
| --- | --- |
| File | `walkie-doggy-link-wordmark-clean.DRAFT.png` — 582×205 RGBA, SHA-256 `858eaf54bd5793433c5f5c910a85aabe0afc3641d0ab0c9c86d50813282c007f` |
| Source | `assets/walkie-doggy-link-wordmark.png` (opaque, 608×220), SHA-256 `aab02d84ca64599145f4a6435a6bb348e7185a33d7901e281260d3214d7f3c3e` — unchanged |
| Replaces? | Nothing. `assets/walkie-doggy-link-wordmark-transparent.png` is untouched. |
| Mascot | Not involved. No mascot file was read or written. |

## Why
The existing `walkie-doggy-link-wordmark-transparent.png` carries a poor matte: a dark halo around every glyph, a grey band across the top and a light fringe (≈76 % of its pixels are semi-transparent). It is visible on cream, turquoise and dark backgrounds (`wordmark-clean-qa-sheet.jpg`, left column).

## Method (deterministic editing, no generation)
1. Background modelled per row as the 90th percentile of each row's min-channel — the source has a soft grey shadow band in its top ~12 rows (240→250) that a single background colour would leave behind.
2. Alpha = clamp((B − min(R,G,B) − 6) / (B − 70 − 6)): noise floor 6 levels, ink at min-channel ≤ 70 fully opaque.
3. Colour un-premultiplied: F = (P − (1 − α)·B) / α.
4. Cropped to content with a 6 px margin.

Verification: compositing the result back over the original background reproduces the source on ink pixels within a mean of 0.66 and max of 5.9 levels (8-bit). Pixels: 68 % fully transparent, 18 % fully opaque, 15 % partial (anti-aliasing).

## Limits
* Resolution is that of the source (608 px wide). For large display, a vector or high-resolution master of the wordmark is still the right long-term asset.
* Navy/teal ink is designed for light surfaces; on dark or turquoise backgrounds it is low-contrast by design, not by defect.
