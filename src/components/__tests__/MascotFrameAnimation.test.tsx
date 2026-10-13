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

  /**
   * Real-device QA round 3 — the actual failure mode. Each preload Image's
   * onLoad/onError used to be a fresh closure created inline inside the
   * frames.map() on every render of this component, so every re-render
   * (including the ones its own setLoadedCount(...) calls triggered)
   * handed every preload Image a BRAND NEW onLoad/onError reference.
   * react-native-web's real Image implementation keys its own internal
   * load-tracking effect on that exact callback identity (not just the
   * source URI) — see node_modules/react-native-web/src/exports/Image —
   * so a changing onLoad/onError prop made it abort whatever request was
   * in flight and start loading again from scratch. On a real device,
   * where each frame's fetch/decode genuinely spans multiple separate
   * event-loop turns (unlike this suite's single-batch completePreload
   * helper), that meant every single frame finishing retriggered a reload
   * of every OTHER still-pending frame too — a cascading restart loop that
   * could burn through the celebration's entire auto-dismiss window
   * before preloading ever finished, leaving the mascot stuck on the
   * static fallback. This test reproduces the real multi-tick shape (one
   * frame resolving per act(), not all of them batched in one act() like
   * completePreload) and is the precise, assertable regression check: the
   * callback identity handed to every still-pending preload Image must
   * never change across intermediate re-renders.
   */
  it('gives every preload Image a referentially stable onLoad/onError across intermediate re-renders (regression: an unstable callback caused react-native-web\'s Image to restart its load on every other frame finishing)', async () => {
    mockReducedMotion(false);
    const frames = [frame(1), frame(2), frame(3), frame(4)];
    const onReady = jest.fn();
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());

    let preloaders = screen.UNSAFE_getAllByType(RNImage).slice(1);
    expect(preloaders).toHaveLength(4);
    let onLoadRefs = preloaders.map((img: any) => img.props.onLoad);
    let onErrorRefs = preloaders.map((img: any) => img.props.onError);

    // Resolve one frame at a time, each in its own act() — this is what a
    // real device's independently-resolving network/decode cycles look
    // like (each one its own render), unlike completePreload's
    // single-batch resolution. After each single resolution, every
    // STILL-PENDING preload Image's onLoad/onError must be the exact same
    // function reference it had before — never replaced.
    for (let i = 0; i < frames.length - 1; i++) {
      act(() => { preloaders[i].props.onLoad(); });
      const stillPending = screen.UNSAFE_getAllByType(RNImage).slice(1);
      expect(stillPending).toHaveLength(frames.length);
      stillPending.forEach((img: any, index: number) => {
        expect(img.props.onLoad).toBe(onLoadRefs[index]);
        expect(img.props.onError).toBe(onErrorRefs[index]);
      });
      preloaders = stillPending;
      onLoadRefs = preloaders.map((img: any) => img.props.onLoad);
      onErrorRefs = preloaders.map((img: any) => img.props.onError);
    }

    expect(onReady).not.toHaveBeenCalled();
    act(() => { preloaders[frames.length - 1].props.onLoad(); });

    // Preloading finished cleanly after exactly one onLoad per frame — no
    // inflation/delay from spurious restarts — onReady fires exactly once
    // and playback begins at frame 0.
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mascot').props.source).toBe(frames[0]);
    expect(screen.UNSAFE_getAllByType(RNImage)).toHaveLength(1); // preload Images unmounted
  });

  /**
   * Real-device QA round 5 — a choreographed sequence (see
   * celebrationAnimationManifest.ts's HIGH_FIVE_CHOREOGRAPHED_FRAME_NUMBERS)
   * deliberately repeats the same few underlying frames many times over to
   * hold key poses for a natural duration. Before this fix, preloading
   * created one hidden Image PER ARRAY POSITION, so a sequence built from
   * only a handful of distinct files fired that many separate, fully
   * independent `ImageLoader.load()` calls all at once on mount — real,
   * unnecessary duplicate network/decode load on a real device that this
   * suite's instant mocked Image never surfaced. Preloading must track only
   * the DISTINCT underlying frames (by reference — the real choreography
   * array is built by indexing into the same stable MASCOT_FRAME_SETS
   * array, so repeated entries really are the same object).
   */
  it('preloads only the distinct underlying frames when the sequence repeats the same frame many times', async () => {
    mockReducedMotion(false);
    const a = frame(1);
    const b = frame(2);
    const c = frame(3);
    // 9 entries, only 3 distinct underlying frames — mirrors a
    // choreographed hold (e.g. a, b, b, b, b, c, c, c, c).
    const frames = [a, b, b, b, b, c, c, c, c];
    const onReady = jest.fn();
    const screen = render(
      <MascotFrameAnimation frames={frames} fallback={FALLBACK} fps={10} size={100} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());

    // Exactly 3 preload Images — one per DISTINCT frame, not one per array
    // position (which would be 9).
    const preloaders = screen.UNSAFE_getAllByType(RNImage).slice(1);
    expect(preloaders).toHaveLength(3);

    // Firing onLoad on all 3 distinct preloaders is enough to become ready
    // — no need for 9 separate load events for what is really 3 resources.
    act(() => {
      preloaders.forEach((img: any) => img.props.onLoad());
    });
    expect(onReady).toHaveBeenCalledTimes(1);

    // Playback still indexes into the FULL, repeated sequence correctly.
    expect(screen.getByTestId('mascot').props.source).toBe(a);
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.getByTestId('mascot').props.source).toBe(b);
    act(() => { jest.advanceTimersByTime(400); });
    expect(screen.getByTestId('mascot').props.source).toBe(c);
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
