import React from 'react';
import { AccessibilityInfo, Image as RNImage } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { MascotFrameAnimation, MascotSpriteAnimation } from '../MascotFrameAnimation';

/**
 * MASCOT_SPEC.md's own rule: "MascotFrameAnimation plays only when it has
 * at least two frames and Reduced Motion is off; otherwise it renders the
 * fallback." This is the single most spec-critical file in the mascot
 * tree (every celebration/reminder moment routes through it) and had no
 * direct test coverage before this — engineering-only gap identified
 * during the mascot audit, fixed here without touching any art asset.
 *
 * Real-device QA round 2 — playback is now gated on every frame actually
 * finishing its own load first (see the component's own doc comment for
 * why: on web each frame is a separate network request, and swapping to
 * one that had not loaded yet left a real window for a black paint). These
 * tests simulate that by firing `onLoad` on each hidden preloader Image —
 * see `completePreload` below — before asserting playback has started.
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

  /** Fires onLoad on every hidden preloader Image (all Images after the first, visible one). */
  function completePreload(screen: ReturnType<typeof render>, frameCount: number) {
    act(() => {
      const images = screen.UNSAFE_getAllByType(RNImage);
      const preloaders = images.slice(1); // index 0 is always the visible, testID'd Image
      expect(preloaders).toHaveLength(frameCount);
      preloaders.forEach((img: any) => img.props.onLoad());
    });
  }

  it('renders the fallback (never crashes) with zero frames', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotFrameAnimation frames={[]} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
  });

  it('fires onReady immediately (nothing to preload) with zero frames', async () => {
    mockReducedMotion(false);
    const onReady = jest.fn();
    render(
      <MascotFrameAnimation frames={[]} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it('fires onReady immediately (nothing to preload) when Reduced Motion is on, even with enough frames', async () => {
    mockReducedMotion(true);
    const onReady = jest.fn();
    render(
      <MascotFrameAnimation frames={[frame(1), frame(2)]} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
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

  it('shows the fallback while frames are still preloading, never an unloaded frame', async () => {
    mockReducedMotion(false);
    const frames = [frame(1), frame(2), frame(3)];
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    // Still the fallback — no preloader has fired onLoad yet, so playback
    // must not have started regardless of how much time passes.
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
  });

  it('fires onReady exactly once, the moment every frame has finished preloading', async () => {
    mockReducedMotion(false);
    const frames = [frame(1), frame(2), frame(3)];
    const onReady = jest.fn();
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(onReady).not.toHaveBeenCalled();
    completePreload(screen, 3);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('a failed frame load still counts toward readiness — one broken frame never blocks playback forever', async () => {
    mockReducedMotion(false);
    const frames = [frame(1), frame(2), frame(3)];
    const onReady = jest.fn();
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    act(() => {
      const preloaders = screen.UNSAFE_getAllByType(RNImage).slice(1);
      preloaders[0].props.onError();
      preloaders[1].props.onLoad();
      preloaders[2].props.onLoad();
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mascot').props.source).toBe(frames[0]);
  });

  it('cycles through frames at the given fps and stops (clamped) on the last frame', async () => {
    mockReducedMotion(false);
    const frames = [frame(1), frame(2), frame(3)];
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    completePreload(screen, 3);
    expect(screen.getByTestId('mascot').props.source).toBe(frames[0]);

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
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    completePreload(screen, 2);
    expect(screen.getByTestId('mascot').props.source).toBe(framesA[0]);
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('mascot').props.source).toBe(framesA[1]);

    screen.rerender(
      <MascotFrameAnimation frames={framesB} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" />
    );
    // The new frame set has not preloaded yet — fallback until it does.
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
    completePreload(screen, 2);
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


describe('MascotSpriteAnimation', () => {
  const FALLBACK = { uri: 'fallback.png' };
  const SHEET = { uri: 'sheet.png' };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('clips each sprite frame with absolute left/top offsets', async () => {
    const screen = render(
      <MascotSpriteAnimation source={SHEET} columns={6} rows={4} frameSize={256} frameCount={24} fps={10} size={100} fallback={FALLBACK} accessibilityLabel="sprite" testID="sprite" />
    );
    await waitFor(() => {
      const sheet = screen.UNSAFE_getAllByType(require('react-native').Image)[0];
      expect(sheet.props.source).toBe(SHEET);
    });
    act(() => { jest.advanceTimersByTime(700); });
    const sheet = screen.UNSAFE_getAllByType(require('react-native').Image)[0];
    expect(sheet.props.style).toEqual(expect.objectContaining({
      position: 'absolute',
      width: 600,
      height: 400,
      left: -100,
      top: -100,
    }));
  });

  it('uses the static fallback when Reduced Motion is enabled', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const screen = render(
      <MascotSpriteAnimation source={SHEET} columns={6} rows={4} frameSize={256} frameCount={24} fps={12} size={100} fallback={FALLBACK} accessibilityLabel="sprite" testID="sprite" />
    );
    await waitFor(() => expect(screen.getByTestId('sprite').props.source).toBe(FALLBACK));
  });
});
