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
   * The core regression guard for this redesign: once the pose is showing,
   * its `source` must never change again for the rest of the animation —
   * no swap to any other image at any point, through the full ~2.2s
   * transform sequence. This is the one property that structurally rules
   * out the whole class of real-device bugs (black rectangle, restart
   * cascades) MascotFrameAnimation's swap-many-sources technique kept
   * hitting: there is no "next frame" to swap to.
   */
  it('never changes the visible Image source once the pose is showing, for the whole animation', async () => {
    mockReducedMotion(false);
    const screen = render(
      <MascotPoseCelebration pose={POSE} fallback={FALLBACK} size={84} accessibilityLabel="mascot" testID="mascot" />
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    const preloader = findPreloader(screen);
    act(() => { (preloader as any).props.onLoad(); });
    expect(screen.getByTestId('mascot').props.source).toBe(POSE);

    // Sample throughout the whole ~2.2s animation — source must stay POSE
    // at every point, never swapping to anything else or back to fallback.
    for (let elapsed = 0; elapsed < 2400; elapsed += 100) {
      act(() => { jest.advanceTimersByTime(100); });
      expect(screen.getByTestId('mascot').props.source).toBe(POSE);
    }

    // Preloader Image is gone once the pose is showing — only one Image
    // (the visible one) remains for the rest of the component's lifetime.
    expect(findPreloader(screen)).toBeUndefined();
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
