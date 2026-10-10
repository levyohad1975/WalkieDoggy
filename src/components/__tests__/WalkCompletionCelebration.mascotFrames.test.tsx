import React from 'react';
import { AccessibilityInfo, Image as RNImage } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { WalkCompletionCelebration } from '../WalkCompletionCelebration';
import { CELEBRATION_LIBRARY } from '../../logic/walkCompletionCelebration';
import { highFivePoseForCelebration } from '../../mascot/celebrationAnimationManifest';

const HIGH_FIVE_V2 = require('../../../assets/branding/walkie-high-five-v2-final.webp');
const HAPPY_JUMP_V2 = require('../../../assets/branding/walkie-happy-jump-v2-final.webp');
const THANK_YOU_HEART_V2 = require('../../../assets/branding/walkie-thank-you-heart-v2-final.webp');
const SLEEPY_GOOD_NIGHT_V2 = require('../../../assets/branding/walkie-sleepy-good-night-v2-final.webp');
const TROPHY_V2 = require('../../../assets/branding/walkie-trophy-v2-final.webp');

/**
 * Real-device QA round 1 fix — a solid BLACK rectangle appeared behind the
 * mascot on iPhone Safari/PWA for some celebrations. The sprite sheets
 * themselves were cleared (genuine per-pixel alpha, no ICC/gamma chunk —
 * see celebrationAnimationManifest.ts's own doc comments for the full
 * RCA); the single-oversized-layer sprite-sheet-crop technique the old
 * MascotSpriteAnimation used was replaced with MascotFrameAnimation's
 * discrete per-frame technique.
 *
 * Real-device QA rounds 2-5 — that technique (preload every frame, swap
 * `Image.source` on a timer between many separate PNG files) kept
 * reproducing real-device-only symptoms across four straight rounds that
 * never showed up in this suite's synchronous test mocks.
 *
 * Real-device QA round 6 — high-five/paw-party moved to MascotPoseCelebration
 * (one approved pose, animated via transforms). See
 * MascotPoseCelebration.test.tsx for that component's own coverage.
 *
 * Direct real-device QA fix (commits cce4a30/d842f52/a9362ad/fa1b338/454d8cc)
 * — high-five and paw-party now render a real uploaded animated asset
 * (walkie-high-five-v2-final.webp) directly through a single plain
 * <Image>, bypassing MascotPoseCelebration entirely for these two ids
 * (`usesHighFiveV2` in WalkCompletionCelebration.tsx takes priority over
 * `highFivePose`; `highFivePoseForCelebration` itself still resolves a
 * real frame — kept available as a fallback/legacy path — but is never
 * reached for these ids anymore). This file covers the current wiring:
 * the component renders the V2 asset (or the static fallback under
 * Reduced Motion), the mascot-ready gate is driven by that Image's own
 * onLoad, and the auto-dismiss window stretches to match the longer
 * animation.
 */
describe('WalkCompletionCelebration — High-Five V2 single animated asset; bubble waits for onReady', () => {
  const highFive = CELEBRATION_LIBRARY.find((item) => item.id === 'high-five')!;
  const celebration = { ...highFive, reaction: 'כל הכבוד!' };
  const expectedPose = highFivePoseForCelebration('high-five')!;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function loadV2(screen: ReturnType<typeof render>) {
    act(() => {
      screen.getByTestId('completion-mascot-animation').props.onLoad();
    });
  }

  it('keeps the legacy pose manifest available but renders High-Five V2 instead', async () => {
    expect(expectedPose).toBeTruthy();
    expect(highFivePoseForCelebration('paw-party')).toBe(expectedPose);
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(HIGH_FIVE_V2);
  });

  it.each([
    ['happy-jump', HAPPY_JUMP_V2],
    ['thank-you-heart', THANK_YOU_HEART_V2],
    ['sleepy-good-night', SLEEPY_GOOD_NIGHT_V2],
    ['trophy-teaser', TROPHY_V2],
  ])('renders %s through the V2 single-asset path', async (id, expectedSource) => {
    const item = { ...CELEBRATION_LIBRARY.find((candidate) => candidate.id === id)!, reaction: 'כל הכבוד!' };
    const screen = render(<WalkCompletionCelebration celebration={item} onDismiss={jest.fn()} />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedSource);
    expect(screen.UNSAFE_getAllByType(RNImage).filter((node: any) => node.props.testID === 'completion-mascot-animation')).toHaveLength(1);
  });

  it('uses one stable animated source for the entire High-Five V2 gesture', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    const mascot = screen.getByTestId('completion-mascot-animation');
    expect(mascot.props.source).toBe(HIGH_FIVE_V2);
    loadV2(screen);
    act(() => { jest.advanceTimersByTime(4000); });
    expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(HIGH_FIVE_V2);
    expect(screen.UNSAFE_getAllByType(RNImage).filter((node: any) => node.props.testID === 'completion-mascot-animation')).toHaveLength(1);
  });

  it('falls back to the static approved mascot when Reduced Motion is on, never attempting the pose', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);

    await waitFor(() => {
      const source = screen.getByTestId('completion-mascot-animation').props.source;
      expect(source).not.toBe(expectedPose);
      expect(source).not.toBe(HIGH_FIVE_V2);
    });
  });

  it('never shows the speech bubble before the mascot has preloaded and started animating', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);

    // The bubble used to appear on a fixed 360ms timer regardless of the
    // mascot's own state — prove that timer window alone is no longer
    // enough to reveal it.
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.queryByText(celebration.title)).toBeNull();

    // Real-device QA round 8 — it now also needs MascotSafeZone's own
    // entrance slide to have actually arrived, not just the mascot itself
    // being ready (the entrance arrives on its own shortly after, driven
    // by MascotSafeZone's own async Reduced-Motion check — see
    // MascotSafeZone.test.tsx for that contract in isolation). Calling
    // loadV2 inside the waitFor's own retry loop, rather than once up
    // front, deterministically survives this component's own
    // Reduced-Motion check resolving late relative to the asset's onLoad
    // in this fake-timer test environment — a resolution race that isn't
    // realistic on a real device, where the native accessibility check
    // settles long before any image finishes loading, but that this
    // harness's fake timers + React's effect flushing can otherwise hit:
    // re-firing onLoad on every retry is harmless once it does land.
    await waitFor(() => {
      loadV2(screen);
      expect(screen.getByText(celebration.title)).toBeTruthy();
    });
  });

  it('shows the speech bubble immediately when Reduced Motion is on (nothing to wait for)', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);

    await waitFor(() => expect(screen.getByText(celebration.title)).toBeTruthy());
  });

  it('shows the speech bubble immediately for a celebration with no mascot sprite mapping (nothing to wait for)', async () => {
    const noSprite = CELEBRATION_LIBRARY.find((item) => item.id === 'thank-you-heart')!;
    // thank-you-heart does have a mapping today; use a synthetic id with none.
    const celebrationWithNoSprite = { ...noSprite, id: 'not-a-mapped-celebration-id', reaction: 'תודה!' };
    const screen = render(<WalkCompletionCelebration celebration={celebrationWithNoSprite} onDismiss={jest.fn()} />);

    await waitFor(() => expect(screen.getByText(celebrationWithNoSprite.title)).toBeTruthy());
  });

  it('does not dismiss within the standard 2.6s window used by other celebrations', async () => {
    const onDismiss = jest.fn();
    render(<WalkCompletionCelebration celebration={celebration} onDismiss={onDismiss} />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());

    await expect(waitFor(() => expect(onDismiss).toHaveBeenCalled(), { timeout: 2600 })).rejects.toThrow();
  });

  it('dismisses once the longer V2 animation window (~5.1s) elapses', async () => {
    const onDismiss = jest.fn();
    render(<WalkCompletionCelebration celebration={celebration} onDismiss={onDismiss} />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1), { timeout: 8000 });
  });
});
