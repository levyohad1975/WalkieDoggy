import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { WalkCompletionCelebration } from '../WalkCompletionCelebration';
import { CELEBRATION_LIBRARY } from '../../logic/walkCompletionCelebration';
import { MASCOT_FRAME_SETS, MASCOT_FRAME_FPS } from '../../mascot/celebrationAnimationManifest';

/**
 * Real-device QA fix — a solid BLACK rectangle appeared behind the mascot on
 * iPhone Safari/PWA for some celebrations. The sprite sheets themselves were
 * cleared (genuine per-pixel alpha, no ICC/gamma chunk — see
 * celebrationAnimationManifest.ts's own doc comments for the full RCA); the
 * actual cause was the sprite-sheet-cropping technique itself, which the old
 * `MascotSpriteAnimation` used: one absolutely positioned Image many times
 * larger than the visible cell, clipped by `overflow: hidden` — a known
 * WebKit/iOS Safari compositing defect class for mostly-clipped alpha
 * layers. This test guards the fix's actual wiring: WalkCompletionCelebration
 * must render its mascot moment through MascotFrameAnimation's discrete
 * per-frame technique (plain Image, swapped `source`, never oversized or
 * absolutely positioned) rather than through any single-sheet crop.
 */
describe('WalkCompletionCelebration — mascot renders via discrete frames, not a cropped sprite sheet', () => {
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

  it('starts on the celebration\'s first discrete frame — never the raw sprite sheet source', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);

    const expectedFrames = MASCOT_FRAME_SETS['high-five'];
    await waitFor(() => {
      expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedFrames[0]);
    });

    // Never the old cropped-sheet technique: no absolutely positioned image
    // many times larger than its visible container should exist anywhere —
    // that oversized/mostly-clipped layer is the real-device bug's cause.
    const oversizedAbsoluteLayers = screen.UNSAFE_getAllByType(require('react-native').Image).filter(
      (node: any) => node.props.style && node.props.style.position === 'absolute' && typeof node.props.style.width === 'number' && node.props.style.width > 200
    );
    expect(oversizedAbsoluteLayers).toHaveLength(0);
  });

  it('advances through the full 24-frame set and stops clamped on the last frame', async () => {
    const screen = render(<WalkCompletionCelebration celebration={celebration} onDismiss={jest.fn()} />);
    const expectedFrames = MASCOT_FRAME_SETS['high-five'];
    expect(expectedFrames).toHaveLength(24);

    await waitFor(() => {
      expect(screen.getByTestId('completion-mascot-animation').props.source).toBe(expectedFrames[0]);
    });

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
});
