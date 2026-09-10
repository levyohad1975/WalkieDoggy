# Walkie Doggy Link Mascot Specification

## Authority and identity

The illustrated dog character is the **Walkie Doggy Link brand mascot**. It represents the product and brand across application UI, reminders, celebrations, onboarding, icons, email graphics, future animation packs, and future marketing artwork.

It is **not** a family’s dog. It must never be called “טופי” or inherit a family-specific `dogName`. The family dog is dynamic application data; the mascot is a stable brand identity.

## Reference master and current assets

### Historical branded-wordmark reference

The historical branded-wordmark reference is:

`assets/branding/walkie-doggy-mascot.png`

Verified properties: PNG, 1024 × 1024 px, 32-bit ARGB, 1,113,374 bytes. It shows the character in a turquoise rounded-square treatment with the embedded “Walkie Doggy Link” wordmark. The transparent alpha channel is present in the file; the turquoise background treatment remains part of its visible composition.

Related inspected assets are:

- `assets/branding/walkie-doggy-link-icon-source.jpg` — 1254 × 1254 px, JPEG; a source-style icon composition without the embedded wordmark.
- `assets/branding/walkie-doggy-link-logo-source.jpg` — 816 × 941 px, JPEG; related logo source.
- `assets/icon.png`, `assets/adaptive-icon.png`, and `assets/favicon.png` — each 1024 × 1024 px PNG and current application-icon outputs.
- `assets/walkie-doggy-link-wordmark.png` and `assets/walkie-doggy-link-wordmark-transparent.png` — 608 × 220 px PNG wordmark assets.

### Approved Clean Master

The approved Clean Master for in-app mascot identity is:

`assets/branding/walkie-doggy-mascot-clean.png`

Lifecycle: `APPROVED` Clean Master. It is a 1254 × 1254 opaque RGB PNG, 1,284,984 bytes (SHA-256 `9C702A7ABC909618B5A968BBA3CD9A43AFEF08ED650F39517F7EAE1887A78256`), with the turquoise rounded-square composition and no embedded wordmark. It is not transparent.

Provenance: this is the original pre-wordmark PNG recovered from the original ChatGPT Library branding asset. It is not a reconstructed edit of the later 1024 × 1024 branded-wordmark reference and supersedes the previously approved WhatsApp-derived copy.

Current in-app mascot consumers reference this same approved path. This restored source does not change runtime code, icons, or animation assets.

### Transparent in-app derivative

`assets/branding/walkie-doggy-mascot-transparent.png` is an `APPROVED` 1254 × 1254 RGBA PNG character cutout derived deterministically from the Clean Master. It has genuine alpha, no wordmark, no decorative rays, and no rounded-square panel. SHA-256: `8AB9B6320261234D45062FF16B2DBDE8B11857902C7BB1343E707C4A3D51F6D6`. Runtime integration remains a separate change.

The embedded words “Walkie Doggy Link” are not mascot identity. They are a wordmark rendered in the Reference Master’s current composition.

## Immutable identity traits

Without explicit user approval, preserve the following traits observed in the Reference Master:

- Large, rounded, friendly head and face relative to the upper-body crop.
- One large glossy open eye and one curved winking eye, with their established placement and expressive asymmetry.
- Low, long, floppy brown ears placed behind the head on both sides.
- White face/body areas with warm orange-brown facial/head and body markings.
- A centered, dark rounded nose and a broad open, smiling mouth with visible pink tongue.
- Soft, polished, dimensional stylized illustration treatment—not a photographic or furry rendering.
- The current upper-body/sitting composition and proportions when the full reference framing is used.
- The saturated turquoise/teal collar.
- The prominent white-edged, interlocking double-ring/link emblem at the collar center.
- The core turquoise, white/cream, orange-brown, dark facial-feature, and pink-tongue palette, plus the warm, upbeat visual personality.

## Collar and link emblem — critical feature

The turquoise collar and interlocking double-ring/link emblem are distinctive brand features. They must remain clearly recognizable and correctly placed across derivatives and animation frames.

Reject a replacement collar feature such as a paw tag, generic dog tag, medal, single ring, unrelated pendant, or substantially redesigned collar unless the user explicitly approves that identity change. Removing or obscuring the double-link emblem is identity drift, not harmless simplification.

## Allowed variation

The following may vary for an approved new state or animation while preserving unmistakable identity:

- Body pose and camera framing appropriate to the use case.
- Head angle, paw position, and ear motion.
- Blinks and eye expressions that retain the recognizable open-eye/wink character.
- Facial expression within the established friendly stylized treatment.
- Temporary props and event elements, including hearts, a small trophy, tasteful confetti, sleep/yawn treatment, and celebratory movement.
- Short actions such as a jump, high-five, presenting a prop, or settling to sleep.

Variation must still read immediately as the same Walkie Doggy Link mascot before color alone is considered.

## Prohibited identity drift

Reject, unless explicitly approved, a result that:

- Changes breed or overall dog appearance.
- Materially changes face/head or core body proportions.
- Changes/open eyes in a way that loses the signature wink/open-eye configuration.
- Replaces, removes, or materially redesigns the collar or double-link emblem.
- Changes the orange-brown/white marking scheme.
- Switches to a substantially different illustration style, including a more photorealistic or furry character.
- Adds permanent accessories not in the Reference Master.
- Treats a newly generated dog as equivalent merely because its colors are similar.

“Close enough” is not an acceptance criterion for identity-sensitive work.

## Clean Master requirements

The approved Clean Master preserves the character without the embedded “Walkie Doggy Link” text: facial identity, proportions, markings, collar, and double-link emblem remain unchanged. Its original pre-wordmark provenance is approved above; future clean-up is deterministic image editing, not permission to redraw or regenerate the mascot.

Current code metadata records the approved opaque clean master for mascot, celebration-resolver, and reminder fallbacks; animation-frame metadata separately expects 512 × 512 transparent frame assets. App icons remain separate assets.

This approved Clean Master is intentionally opaque and preserves the turquoise rounded-square treatment. A transparent-character derivative remains a separate future deliverable and requires explicit approval; do not imply that this asset has transparency.

If available tools cannot remove text without identity drift, stop and request a deterministic editing/restoration workflow. Do not substitute a generated dog.

## Wordmark separation and icon use

**Mascot** means character identity. **Wordmark** means the textual “Walkie Doggy Link” brand identity. They may appear together in an approved composition but must remain independently manageable assets.

The approved Clean Master is the preferred source for future in-app mascot moments rather than a character image with embedded text. Runtime consumers are not changed by this approval. Mobile and web icons should prioritize immediate mascot readability; they must not depend on tiny embedded wordmark text to identify the product.

## Current and intended use cases

### Current

- **Home:** a reusable `WalkieMascot` component supports six timing/lifecycle states: `idle`, `excited`, `ready`, `waiting`, `concerned`, and `success`.
- **Walk completion:** `WalkCompletionCelebration` presents a modal speech bubble, mascot visual, optional confetti, and continuation action.
- **Reminder open:** `ReminderMascotPrompt` presents a short speech-bubble reminder after a validated native reminder notification response.
- **Icons:** Expo configuration uses `assets/icon.png`, `assets/adaptive-icon.png`, and `assets/favicon.png` for native/web icon contexts.

### Intended or not yet verified as complete

- Any future replacement icon outputs and a separately approved transparent-character derivative.
- True character-frame animation packs for celebrations and stateful mascot behavior.
- Email/welcome graphics and future marketing artwork; no repository evidence establishes a completed email design system.
- New mascot poses/states produced against this specification.

## Animation identity and production rules

Animate the character, not merely a static image container. Whole-image movement on the current flat raster is explicitly a temporary fallback in the codebase, not proof of finished internal character animation.

For real frame production:

- Preserve the face, open-eye/wink identity, ears, markings, collar, and double-link emblem in every frame.
- Use a consistent canvas, scale, anchor, and alignment to prevent character jitter.
- Use transparent frame handling where the manifest requires it.
- Keep moments short and bounded; current manifest entries are finite 10 or 12 fps sequences with approximate durations of 1.8 s, or 2.2 s for `sleepy-good-night`.
- Supply a static Reduced Motion fallback; runtime animation must stop when the OS requests Reduced Motion.
- Do not require runtime AI generation.

The current animation manifest defines local directories as `assets/celebrations/<id>/`, names frames `frame-01.png` onward, expects 14 frames per variant except 18 for `sleepy-good-night`, and declares 512 × 512 transparent output. `MascotFrameAnimation` plays only when it has at least two frames and Reduced Motion is off; otherwise it renders the fallback.

## Celebration variants

The current manifest and celebration library define these planned visual concepts:

- `thank-you-heart` — presents a heart.
- `happy-jump` — crouch, jump, and land.
- `high-five` — raised-paw high five.
- `confetti` — joyful response with confetti.
- `paw-party` — playful paw/body movement.
- `trophy-teaser` — presents a trophy.
- `sleepy-good-night` — yawn/blink with lowered head.
- `long-walk` — proud energetic response.
- `special-surprise` — a distinctive restrained surprise, such as a double jump.

These identifiers, metadata, and fallback architecture exist. Final frame artwork does not: no `assets/celebrations/` frame files are present, and current resolver output uses the bundled Reference Master as an explicit placeholder and Reduced Motion fallback.

## Asset lifecycle and promotion

| State | Mascot-specific rule |
| --- | --- |
| `MASTER` | Canonical approved identity source. Replacing the Mascot Master always requires explicit user approval. |
| `APPROVED` | A user-approved derivative/pose/frame set that visually passed comparison with the Reference Master. |
| `DRAFT` | Work for review only; clearly labelled and never treated as a production source. |
| `PLACEHOLDER` | Temporary fallback, including current celebration fallbacks; never silently promoted. |

No generated experiment becomes `APPROVED` or `MASTER` automatically. Before a new mascot asset can become `APPROVED`, compare it visually against the Reference Master, run the checklist below, record its lifecycle state, and obtain explicit user approval when identity is affected.

## Mascot visual QA checklist

Evaluate in this order:

1. Same recognizable character?
2. Face/head proportions preserved?
3. Signature eye/wink identity preserved?
4. Ears preserved?
5. Orange-brown/white markings preserved?
6. Collar preserved?
7. Interlocking double-ring/link symbol preserved?
8. Core colors preserved?
9. Illustration style preserved?
10. Body proportions appropriate?
11. Background/transparency technically correct?
12. No unintended embedded text?
13. Frame alignment consistent, if animation?
14. Readable at actual mobile size?
15. Reduced Motion fallback available, if relevant?

Failure of a critical identity item means **REJECT**, not “close enough.”

## Tool-selection rule

Use deterministic editing for text removal, cleanup, transparency fixes, resizing/canvas normalization, and other non-creative technical corrections. Use creative/generative workflows only when a genuinely new pose, state, or artwork is required—and then use the Reference/Master as the binding identity constraint.

If generation produces identity drift, reject the result. Do not adapt the brand to fit a generated image.

## Current repository status and risks

- **Historical branded-wordmark reference:** `assets/branding/walkie-doggy-mascot.png`; embedded text is present.
- **Approved Clean Master:** `assets/branding/walkie-doggy-mascot-clean.png`; opaque 1254 × 1254 RGB PNG with no embedded wordmark.
- **Runtime integration:** current in-app mascot consumers reference the approved Clean Master path.
- **Final animation frame artwork exists:** no; no celebration frame directory/files are currently present.
- **Current placeholders/fallbacks:** celebration and reminder presentation resolve to the approved Clean Master; the stateful mascot uses temporary whole-image transforms with a static Reduced Motion fallback.
- **Key risks/inconsistencies:** the approved Clean Master is intentionally opaque and preserves the turquoise background treatment; a transparent derivative would require separate approval.

No repository asset is changed by this specification.
