import React from 'react';
import { AccessibilityInfo, Image as RNImage } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { WalkCompletionCelebration } from '../WalkCompletionCelebration';
import { CELEBRATION_LIBRARY } from '../../logic/walkCompletionCelebration';
import { highFivePoseForCelebration } from '../../mascot/celebrationAnimationManifest';

const HIGH_FIVE_V2 = require('../../../assets/branding/walkie-high-five-v2-final.webp');

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
    loadV2(screen);
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
