import React from 'react';
import { AccessibilityInfo, Image as RNImage } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { MascotPoseCelebration } from '../MascotPoseCelebration';

/**
 * Real-device QA round 6 — see MascotPoseCelebration.tsx's own doc comment
 * for the full history: MascotFrameAnimation's discrete-frame-swap
 * technique (source changing every tick between many separate PNG files)
 * produced a different real-device-only rendering symptom on each of three
 * straight attempts. This component retires that approach for the
 * High-Five celebration: ONE pose image, `source` set once and never
 * swapped again, animated purely via Animated transforms. These tests
 * guard the specific regression this is meant to fix — that the visible
 * Image's `source` prop is set exactly once and never changes across the
 * whole animation — plus the same onReady/Reduced-Motion contract
 * MascotFrameAnimation's callers already depend on.
 */
describe('MascotPoseCelebration', () => {
  const POSE = { uri: 'high-five-pose.png' };
  const FALLBACK = { uri: 'fallback.png' };

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

  /** The hidden hidden preloader Image, if still present (1x1, opacity 0). */
  function findPreloader(screen: ReturnType<typeof render>) {
    return screen.UNSAFE_getAllByType(RNImage).find((img: any) => img.props.style && img.props.style.width === 1 && img.props.style.height === 1);
  }

  it('shows the fallback until the pose has preloaded, then shows the pose', async () => {
    mockReducedMotion(false);
    const onReady = jest.fn();
    const screen = render(
      <MascotPoseCelebration pose={POSE} fallback={FALLBACK} size={84} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
    expect(onReady).not.toHaveBeenCalled();

    const preloader = findPreloader(screen);
    expect(preloader).toBeTruthy();
    act(() => { (preloader as any).props.onLoad(); });

    expect(screen.getByTestId('mascot').props.source).toBe(POSE);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('a failed pose load still counts toward readiness — never stuck on the fallback forever', async () => {
    mockReducedMotion(false);
    const onReady = jest.fn();
    const screen = render(
      <MascotPoseCelebration pose={POSE} fallback={FALLBACK} size={84} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    const preloader = findPreloader(screen);
    act(() => { (preloader as any).props.onError(); });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  /**
   * The core regression guard for this redesign: while the gesture is
   * actually playing, `source` must never swap to anything else — no
   * "next frame" to swap to, the one property that structurally rules out
   * the whole class of real-device bugs (black rectangle, restart
   * cascades) MascotFrameAnimation's swap-many-sources technique kept
   * hitting.
   *
   * Direct real-device QA fix (commit d7a25a2) — the raised-paw art is a
   * gesture, not a resting pose: once the ~2.24s transform choreography
   * finishes, the component now deliberately returns to the approved
   * neutral mascot (`fallback`) rather than freezing with one paw held in
   * the air forever. So the no-swap guarantee holds only through the
   * gesture itself; the one intentional swap back to `fallback` once it
   * completes is covered separately below.
   */
  it('shows the pose immediately once it preloads — no window where a not-yet-decoded frame could paint black', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotPoseCelebration pose={POSE} fallback={FALLBACK} size={84} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    const preloader = findPreloader(screen);
    act(() => { (preloader as any).props.onLoad(); });
    expect(screen.getByTestId('mascot').props.source).toBe(POSE);

    // Preloader Image is gone once the pose is showing — only one Image
    // (the visible one) remains for the rest of the component's lifetime.
    expect(findPreloader(screen)).toBeUndefined();
  });

  it('returns to the neutral resting pose once the gesture finishes, and stays there', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotPoseCelebration pose={POSE} fallback={FALLBACK} size={84} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    const preloader = findPreloader(screen);
    act(() => { (preloader as any).props.onLoad(); });
    expect(screen.getByTestId('mascot').props.source).toBe(POSE);

    await waitFor(() => expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK));

    // Never swaps back to the pose afterward — it's a one-shot gesture.
    act(() => { jest.advanceTimersByTime(2000); });
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
  });

  it('shows the static fallback (never attempts the pose) when Reduced Motion is on', async () => {
    mockReducedMotion(true);
    const onReady = jest.fn();
    const screen = render(
      <MascotPoseCelebration pose={POSE} fallback={FALLBACK} size={84} accessibilityLabel="mascot" testID="mascot" onReady={onReady} />
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
    act(() => { jest.advanceTimersByTime(3000); });
    expect(screen.getByTestId('mascot').props.source).toBe(FALLBACK);
    expect(findPreloader(screen)).toBeUndefined();
  });

  it('passes accessibilityLabel through to the underlying Image', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotPoseCelebration pose={POSE} fallback={FALLBACK} size={84} accessibilityLabel="הקמע מגיב" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(screen.getByTestId('mascot').props.accessibilityLabel).toBe('הקמע מגיב');
  });

  it('cleans up its animation on unmount without throwing', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotPoseCelebration pose={POSE} fallback={FALLBACK} size={84} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    const preloader = findPreloader(screen);
    act(() => { (preloader as any).props.onLoad(); });
    screen.unmount();
    expect(() => {
      act(() => { jest.advanceTimersByTime(3000); });
    }).not.toThrow();
  });
});
