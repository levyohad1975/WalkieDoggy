import React from 'react';
import { AccessibilityInfo, Image as RNImage } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { WalkCompletionCelebration } from '../WalkCompletionCelebration';
import { CELEBRATION_LIBRARY } from '../../logic/walkCompletionCelebration';
import { highFivePoseForCelebration } from '../../mascot/celebrationAnimationManifest';

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
 * reproducing real-device-only symptoms across four straight rounds (a
 * black rectangle during loading, too-fast/"frantic" pacing, a stable
 * preload callback, deduped preload requests) that never showed up in
 * this suite's synchronous test mocks.
 *
 * Real-device QA round 6 — rather than attempt a fifth variant of the
 * same swap-many-sources approach, `high-five` (and `paw-party`, which
 * shares the same sprite via CELEBRATION_SPRITE_MAP) now renders through
 * MascotPoseCelebration instead: ONE already-approved pose image, `source`
 * set once and never swapped again, animated purely via Animated
 * transforms — the exact technique this app already ships everywhere
 * else (WalkieMascot.tsx). See celebrationAnimationManifest.ts's own doc
 * comment above HIGH_FIVE_POSE, and MascotPoseCelebration.tsx's own doc
 * comment, for the full history. MascotPoseCelebration has its own
 * dedicated, thorough test file (MascotPoseCelebration.test.tsx); this
 * file covers only the WIRING — that WalkCompletionCelebration actually
 * renders the pose-based component for high-five/paw-party, and that the
 * bubble/dismiss/fallback contracts around it still hold.
 */
describe('WalkCompletionCelebration — high-five/paw-party render via MascotPoseCelebration; bubble waits for onReady', () => {
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

  function findPreloader(screen: ReturnType<typeof render>) {
    return screen.UNSAFE_getAllByType(RNImage).find((img: any) => img.props.style && img.props.style.width === 1 && img.props.style.height === 1);
  }

  function completeMascotPreload(screen: ReturnType<typeof render>) {
    act(() => {
      const preloader = findPreloader(screen);
      expect(preloader).toBeTruthy();
      (preloader as any).props.onLoad();
    });
  }

  it('resolves a real pose for high-five and paw-party, both from the same approved frame', () => {
    expect(expectedPose).toBeTruthy();
    expect(highFivePoseForCelebration('paw-party')).toBe(expectedPose);
  });

  it('shows the static fallback (never the pose before it has preloaded)', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);

    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('completion-mascot-animation').props.source).not.toBe(expectedPose);

    completeMascotPreload(screen);
    expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedPose);
  });

  it('never swaps the visible Image source again once the pose is showing — no "next frame" to swap to', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    completeMascotPreload(screen);
    expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedPose);

    // Advance through the full celebration window (auto-dismiss is 2600ms)
    // — the mascot's own source must stay the single pose throughout.
    for (let elapsed = 0; elapsed < 2600; elapsed += 100) {
      act(() => { jest.advanceTimersByTime(100); });
      expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedPose);
    }

    // Never the old cropped-sheet technique either: no absolutely
    // positioned image many times larger than its visible container.
    const oversizedAbsoluteLayers = screen.UNSAFE_getAllByType(RNImage).filter(
      (node: any) => node.props.style && node.props.style.position === 'absolute' && typeof node.props.style.width === 'number' && node.props.style.width > 200
    );
    expect(oversizedAbsoluteLayers).toHaveLength(0);
  });

  it('falls back to the static approved mascot when Reduced Motion is on, never attempting the pose', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);

    await waitFor(() => {
      const source = screen.getByTestId('completion-mascot-animation').props.source;
      expect(source).not.toBe(expectedPose);
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
    // being ready. completeMascotPreload only makes the mascot ready;
    // the final waitFor below is what confirms the bubble still appears
    // once BOTH conditions are eventually true (the entrance arrives on
    // its own shortly after, driven by MascotSafeZone's own async
    // Reduced-Motion check — see MascotSafeZone.test.tsx for that
    // contract in isolation).
    completeMascotPreload(screen);
    await waitFor(() => expect(screen.getByText(celebration.title)).toBeTruthy());
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
