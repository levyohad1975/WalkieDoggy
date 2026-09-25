import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { MascotFrameAnimation } from '../MascotFrameAnimation';

/**
 * MASCOT_SPEC.md's own rule: "MascotFrameAnimation plays only when it has
 * at least two frames and Reduced Motion is off; otherwise it renders the
 * fallback." This is the single most spec-critical file in the mascot
 * tree (every celebration/reminder moment routes through it) and had no
 * direct test coverage before this — engineering-only gap identified
 * during the mascot audit, fixed here without touching any art asset.
 */
describe('MascotFrameAnimation', () => {
  const FALLBACK = { uri: 'fallback.png' };
  const frame = (n: number) => ({ uri: `frame-${n}.png` });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function mockReducedMotion(enabled: boolean) {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(enabled);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
  }

  it('renders the fallback (never crashes) with zero frames', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotFrameAnimation frames={[]} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
  });

  it('renders the fallback with exactly one frame — MASCOT_SPEC requires at least two to animate', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotFrameAnimation frames={[frame(1)]} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
  });

  it('cycles through frames at the given fps and stops (clamped) on the last frame', async () => {
    mockReducedMotion(false);
    const frames = [frame(1), frame(2), frame(3)];
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    // Waits out the async isReduceMotionEnabled() resolution AND the
    // frame-playback effect it re-triggers (both must settle before
    // fake-timer advances are meaningful — a bare `isReduceMotionEnabled`
    // call-count check alone can still race the state update it causes).
    await waitFor(() => expect(screen.getByTestId('mascot').props.source).toBe(frames[0]));

    act(() => {
      jest.advanceTimersByTime(100); // one tick at 10fps (100ms/frame)
    });
    expect(screen.getByTestId('mascot').props.source).toBe(frames[1]);

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('mascot').props.source).toBe(frames[2]);

    // Past the last frame — clamped, never index out of range or wraps.
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('mascot').props.source).toBe(frames[2]);
  });

  it('shows the fallback (never plays frames) when Reduced Motion is on, even with enough frames', async () => {
    mockReducedMotion(true);
    const frames = [frame(1), frame(2), frame(3)];
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
  });

  it('restarts at frame 0 when a genuinely new frame set is passed in', async () => {
    mockReducedMotion(false);
    const framesA = [frame(1), frame(2)];
    const framesB = [frame(9), frame(8)];
    const screen = render(
      <MascotFrameAnimation frames={framesA} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(screen.getByTestId('mascot').props.source).toBe(framesA[0]));
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('mascot').props.source).toBe(framesA[1]);

    screen.rerender(
      <MascotFrameAnimation frames={framesB} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    expect(screen.getByTestId('mascot').props.source).toBe(framesB[0]);
  });

  it('cleans up its interval on unmount without throwing', async () => {
    mockReducedMotion(false);
    const frames = [frame(1), frame(2), frame(3)];
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    screen.unmount();
    expect(() => {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }).not.toThrow();
  });

  it('passes accessibilityLabel through to the underlying Image', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotFrameAnimation frames={[]} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="הקמע מגיב" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('mascot').props.accessibilityLabel).toBe('הקמע מגיב');
  });
});
