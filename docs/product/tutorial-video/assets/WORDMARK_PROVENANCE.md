# Clean transparent wordmark — DRAFT candidate

Lifecycle: **DRAFT** — not used by the app; not used by the video build unless passed explicitly with `--wordmark`. Needs owner approval before promotion to `assets/`.

| | |
| --- | --- |
| File | `walkie-doggy-link-wordmark-clean.DRAFT.png` — 582×184 RGBA, SHA-256 `d7b6151cb0fa5dfa257de2997c2dc92c6944a153afb4334187de6d3ecd61375b` (method v2) |
| Source | `assets/walkie-doggy-link-wordmark.png` (opaque, 608×220), SHA-256 `aab02d84ca64599145f4a6435a6bb348e7185a33d7901e281260d3214d7f3c3e` — unchanged |
| Replaces? | Nothing. `assets/walkie-doggy-link-wordmark-transparent.png` is untouched. |
| Mascot | Not involved. No mascot file was read or written. |

## Why
The existing `walkie-doggy-link-wordmark-transparent.png` carries a poor matte: a dark halo around every glyph, a grey band across the top and a light fringe (≈76 % of its pixels are semi-transparent). It is visible on cream, turquoise and dark backgrounds (`wordmark-clean-qa-sheet.jpg`, left column).

## Method v2 (deterministic editing, no generation)
1. Ink mask: min(R,G,B) < 215, dilated by 4 px (glyphs and their anti-aliased edges).
2. **2-D background model** by normalised convolution: a Gaussian (σ = 4 px) average of non-ink pixels only, evaluated at every pixel. The source's soft grey shadow band covers only the middle of the top rows, so a per-row model (v1) read it as faint ink and left a visible stroke above the lettering in video QA. v2 removes it.
3. Alpha = clamp((B − min(R,G,B) − 6) / (B − 70 − 6)); stray alpha ≤ 16/255 outside the ink mask set to 0.
4. Colour un-premultiplied: F = (P − (1 − α)·B) / α. Cropped to content with a 6 px margin; the band rows fall outside the crop.

Verification: compositing back over the modelled background reproduces the source on ink pixels within a mean of **0.26** levels (max 12.2 at isolated edge pixels); **0** stray pixels outside the glyphs; top rows fully transparent. QA on cream, dark, turquoise and white: no halo, band, stroke or fringe (`wordmark-clean-qa-sheet.jpg`).

## Limits
* Resolution is that of the source (608 px wide). For large display, a vector or high-resolution master of the wordmark is still the right long-term asset.
* Navy/teal ink is designed for light surfaces; on dark or turquoise backgrounds it is low-contrast by design, not by defect.
