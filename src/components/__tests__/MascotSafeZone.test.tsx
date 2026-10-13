import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { MascotSafeZone } from '../MascotSafeZone';

/**
 * Real-device QA round 8 — the entrance travel distance used to be capped
 * at a fraction of the (small, ~100-150px) ANCHOR's own width, so an
 * anchored celebration (every WalkCompletionCelebration call) started only
 * a little off its resting spot rather than fully off the physical screen
 * edge, despite this component's own doc comment claiming otherwise. The
 * fix computes `travel` from the real, measured viewport width instead.
 *
 * This file guards the externally-observable contract that change (and the
 * new `onEntranceComplete` prop) depends on: the callback fires exactly
 * once, and only once the REAL (resolved) Reduced Motion answer has been
 * used to either run the entrance animation or skip it — never under the
 * `reducedMotion` state's own fail-safe-default-true value, which would
 * otherwise fire it immediately on mount, before the real entrance (or the
 * real "skip it" decision) has even happened. A caller like
 * WalkCompletionCelebration's speech-bubble gate relies on this to mean
 * "the character has truly arrived."
 */
describe('MascotSafeZone — entrance completion contract', () => {
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

  it('fires onEntranceComplete immediately once Reduced Motion resolves on — nothing to animate', async () => {
    mockReducedMotion(true);
    const onEntranceComplete = jest.fn();
    render(
      <MascotSafeZone from="left" anchor={{ x: 10, y: 20, width: 100, height: 80 }} onEntranceComplete={onEntranceComplete}>
        <Text>child</Text>
      </MascotSafeZone>
    );
    // Not yet — the real async check has not resolved at all.
    expect(onEntranceComplete).not.toHaveBeenCalled();
    await waitFor(() => expect(onEntranceComplete).toHaveBeenCalledTimes(1));
  });

  it('never fires under the fail-safe-default reducedMotion=true value — only once the real check resolves (false, anchored)', async () => {
    mockReducedMotion(false);
    const onEntranceComplete = jest.fn();
    render(
      <MascotSafeZone from="left" anchor={{ x: 10, y: 20, width: 100, height: 80 }} onEntranceComplete={onEntranceComplete}>
        <Text>child</Text>
      </MascotSafeZone>
    );
    // Synchronously after mount, the real check has not resolved yet (it is
    // a Promise). If the component fired on the stale default instead of
    // waiting for the real answer, it would already have been called here.
    expect(onEntranceComplete).not.toHaveBeenCalled();

    await waitFor(() => expect(onEntranceComplete).toHaveBeenCalledTimes(1));

    // And exactly once — further time passing must not fire it again.
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onEntranceComplete).toHaveBeenCalledTimes(1);
  });

  it('fires exactly once when unanchored too (e.g. ReminderMascotPrompt, from the right)', async () => {
    mockReducedMotion(false);
    const onEntranceComplete = jest.fn();
    render(
      <MascotSafeZone from="right" onEntranceComplete={onEntranceComplete}>
        <Text>child</Text>
      </MascotSafeZone>
    );
    expect(onEntranceComplete).not.toHaveBeenCalled();
    await waitFor(() => expect(onEntranceComplete).toHaveBeenCalledTimes(1));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onEntranceComplete).toHaveBeenCalledTimes(1);
  });

  it('renders and settles without an onEntranceComplete callback at all (optional prop)', async () => {
    mockReducedMotion(false);
    expect(() => {
      render(
        <MascotSafeZone from="left" anchor={{ x: 0, y: 0, width: 50, height: 50 }}>
          <Text>child</Text>
        </MascotSafeZone>
      );
    }).not.toThrow();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
  });
});
