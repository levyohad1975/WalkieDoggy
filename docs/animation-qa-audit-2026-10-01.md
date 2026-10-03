# Animation QA audit — 2026-10-01

Scope: mascot and event animation surfaces on iOS, Android and Web. This audit is deliberately evidence-based: source/test findings are separated from device visual QA.

## Runtime surfaces
- `WalkieMascot`: shared state animation API (idle, excited, ready, waiting, concerned, success, runIn). Most states still use whole-image procedural transforms.
- `MascotFrameAnimation`: bounded frame playback with Reduced Motion fallback.
- `MascotSpriteAnimation`: 6x4 curated sprite playback, bounded on the last frame.
- `MascotSafeZone`: entrance stage used by reminder/completion overlays.
- `ReminderMascotPrompt`: leash-ready reminder sprite + Hebrew speech bubble.
- `WalkCompletionCelebration`: curated completion sprite + Hebrew speech bubble.
- `OnboardingMascotWink`: five-frame open/open/wink/open/open sequence.

## Findings fixed in this pass
1. Completion accessibility: the celebration auto-dismissed after 2.4s even when VoiceOver/TalkBack was reading it. It now suspends auto-dismiss while a screen reader is enabled and retains explicit dismissal.
2. Responsive safe zone: `MascotSafeZone` read `Dimensions.get()` only at render. It now uses `useWindowDimensions()`, so rotation/resizing updates the off-screen travel distance and avoids stale clipping geometry.

## Existing safeguards verified in source
- Reduced Motion defaults fail-safe to static content before the OS preference resolves.
- Frame and sprite timers are cleaned up on effect cleanup.
- Frame playback clamps at the final frame rather than wrapping indefinitely.
- Reminder and completion overlays expose polite live-region semantics.
- Runtime sprite mapping is centralized in `celebrationAnimationManifest.ts`.

## Known gaps — NOT READY until visually verified
- Curated sprite PNG alpha/transparency must be inspected on real iPhone Safari/native, Android, and Web. Historical black/flattened backgrounds mean source declarations alone are not proof.
- The approved mascot raster still has historical cutout/alpha concerns around light forehead fur; this requires asset-level visual QA, not a React Native style fix.
- Most `WalkieMascot` states are procedural transforms of one flattened image, not final character animation. `MASCOT_ANIMATION_STATUS` correctly records this limitation.
- Onboarding wink uses embedded JPEG frames and must be checked for frame-to-frame crop/brightness mismatch and visible flash.
- Device QA must cover compact/tall phones, portrait/landscape where supported, RTL bubbles, navigation overlap, app background/foreground, repeated trigger, Reduced Motion, VoiceOver/TalkBack, and slow-device frame pacing.

## Device acceptance matrix
For every animation surface on iOS, Android and Web:
1. No black/opaque rectangle or halo around mascot.
2. Full head, ears, paws and tail stay inside intended safe zone; no crop.
3. No first-frame flash, layout jump or background flicker.
4. Speech bubble is RTL-correct, readable and never covers primary controls.
5. Trigger occurs once per event; repeated navigation does not duplicate timers/overlays.
6. Reduced Motion shows a stable static fallback.
7. VoiceOver/TalkBack can finish reading meaningful content before dismissal.
8. Background/foreground and orientation/viewport changes do not restart into a broken position.
9. Animation settles to a stable final frame/state.
10. No regression in walk completion/reminder behavior when animation fails.

## Release gate
Animation work is not considered READY from TypeScript/Jest alone. Required evidence is: green automated checks plus visual evidence for iPhone, Android and Web/Desktop. Any platform not physically/emulator-tested remains explicitly unverified.
