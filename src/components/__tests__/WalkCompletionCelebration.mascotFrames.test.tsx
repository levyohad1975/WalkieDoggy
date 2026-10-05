import React from 'react';
import { AccessibilityInfo, Image as RNImage } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { WalkCompletionCelebration } from '../WalkCompletionCelebration';
import { CELEBRATION_LIBRARY } from '../../logic/walkCompletionCelebration';
import { MASCOT_FRAME_SETS, MASCOT_FRAME_FPS } from '../../mascot/celebrationAnimationManifest';

/**
 * Real-device QA round 1 fix — a solid BLACK rectangle appeared behind the
 * mascot on iPhone Safari/PWA for some celebrations. The sprite sheets
 * themselves were cleared (genuine per-pixel alpha, no ICC/gamma chunk —
 * see celebrationAnimationManifest.ts's own doc comments for the full
 * RCA); the single-oversized-layer sprite-sheet-crop technique the old
 * MascotSpriteAnimation used was replaced with MascotFrameAnimation's
 * discrete per-frame technique.
 *
 * Real-device QA round 2 — that alone was not sufficient: the black
 * rectangle persisted, the speech bubble could appear before the mascot
 * was visibly animating, and the character visibly drifted toward the
 * add-walk card below. Root causes (see MascotFrameAnimation.tsx's and
 * celebrationAnimationManifest.ts's own doc comments): each of the 24
 * frames is now a separate network-loaded asset, and swapping to one that
 * had not finished loading left a real window for a black paint; the
 * bubble appeared on an arbitrary 360ms timer that raced the mascot's
 * real paint; and the raw sprite sheets had real frame-to-frame
 * bounding-box drift (preprocessing-level, now corrected at the asset
 * level, not tested here). This file's tests cover the two code-level
 * fixes: every frame is preloaded before playback ever starts, and the
 * bubble is gated on MascotFrameAnimation's onReady callback instead of a
 * timer.
 */
describe('WalkCompletionCelebration — mascot renders via discrete, preloaded frames; bubble waits for onReady', () => {
  const highFive = CELEBRATION_LIBRARY.find((item) => item.id === 'high-five')!;
  const celebration = { ...highFive, reaction: 'כל הכבוד!' };

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

  /** Fires onLoad on every hidden MascotFrameAnimation preloader Image for the mascot's 24 frames. */
  function completeMascotPreload(renderedScreen: ReturnType<typeof render>, frameCount = 24) {
    act(() => {
      const images = renderedScreen.UNSAFE_getAllByType(RNImage);
      // The visible mascot Image (testID set) is always first among the
      // mascot's own Images; everything after it with no testID of its
      // own and a 1x1 hidden preloader style is one of its preloaders.
      const preloaders = images.filter((img: any) => img.props.style && img.props.style.width === 1 && img.props.style.height === 1);
      expect(preloaders.length).toBeGreaterThanOrEqual(frameCount);
      preloaders.forEach((img: any) => img.props.onLoad());
    });
  }

  it('shows the static fallback (never an unloaded frame) until every frame has preloaded', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);
    const expectedFrames = MASCOT_FRAME_SETS['high-five'];

    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    // Not yet preloaded — must never show a frame that has not finished loading.
    expect(screen.getByTestId('completion-mascot-animation').props.source).not.toBe(expectedFrames[0]);

    completeMascotPreload(screen);
    expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedFrames[0]);
  });

  it('advances through the full 24-frame set and stops clamped on the last frame', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);
    const expectedFrames = MASCOT_FRAME_SETS['high-five'];
    expect(expectedFrames).toHaveLength(24);

    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    completeMascotPreload(screen);
    expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedFrames[0]);

    // Never the old cropped-sheet technique: no absolutely positioned image
    // many times larger than its visible container should exist anywhere —
    // that oversized/mostly-clipped layer was round 1's real-device bug cause.
    const oversizedAbsoluteLayers = screen.UNSAFE_getAllByType(RNImage).filter(
      (node: any) => node.props.style && node.props.style.position === 'absolute' && typeof node.props.style.width === 'number' && node.props.style.width > 200
    );
    expect(oversizedAbsoluteLayers).toHaveLength(0);

    // Advance well past the full sequence at MASCOT_FRAME_FPS.
    act(() => {
      jest.advanceTimersByTime(Math.ceil(24 * (1000 / MASCOT_FRAME_FPS)) + 500);
    });

    expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedFrames[23]);
  });

  it('falls back to the static approved mascot when Reduced Motion is on, never attempting frame playback', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);

    await waitFor(() => {
      const source = screen.getByTestId('completion-mascot-animation').props.source;
      expect(MASCOT_FRAME_SETS['high-five']).not.toContain(source);
    });
  });

  it('never shows the speech bubble before the mascot has preloaded and started animating', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);

    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    // The bubble used to appear on a fixed 360ms timer regardless of the
    // mascot's own state — prove that timer window alone is no longer
    // enough to reveal it.
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.queryByText(celebration.title)).toBeNull();

    completeMascotPreload(screen);
    expect(screen.getByText(celebration.title)).toBeTruthy();
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
});
