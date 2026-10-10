import fs from 'fs';
import path from 'path';
import React from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  ReminderMascotPrompt,
  REMINDER_PROMPT_DISMISS_MS,
  REMINDER_PROMPT_SCREEN_READER_DISMISS_MS,
} from '../ReminderMascotPrompt';

/**
 * Real-iPhone QA regression — the notification-open mascot was a <Modal>
 * with a full-screen <Pressable>, which swallowed every touch while it was
 * up (even on its transparent areas): a tap on Start Walk, Add Walk or the
 * bottom navigation only dismissed the mascot.
 *
 * The prompt must be a non-modal, non-interactive, decorative overlay:
 * pointerEvents="none" on the whole subtree, no press handlers anywhere,
 * and it must still dismiss itself — also when a screen reader is on.
 */
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function mockAccessibility({ screenReader = false }: { screenReader?: boolean } = {}) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(screenReader);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
  return jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
}

function renderPrompt(props: Partial<React.ComponentProps<typeof ReminderMascotPrompt>> = {}, underlay?: React.ReactNode) {
  const onDismiss = jest.fn();
  const utils = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <View style={{ flex: 1 }}>
        {underlay}
        <ReminderMascotPrompt visible message="אוהד, הטיול עם הכלב רקסי מתחיל בעוד 15 דקות 🐾" stage="pre-walk" onDismiss={onDismiss} {...props} />
      </View>
    </SafeAreaProvider>
  );
  return { ...utils, onDismiss };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('ReminderMascotPrompt — non-modal, non-interactive overlay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders no Modal and no Pressable', async () => {
    mockAccessibility();
    const { UNSAFE_queryAllByType } = renderPrompt();
    await flush();
    expect(UNSAFE_queryAllByType(Modal)).toHaveLength(0);
    expect(UNSAFE_queryAllByType(Pressable)).toHaveLength(0);
  });

  it('the whole overlay, its lane and the mascot stage take no pointer events', async () => {
    mockAccessibility();
    const { getByTestId } = renderPrompt();
    await flush();
    expect(getByTestId('reminder-mascot-overlay').props.pointerEvents).toBe('none');
    expect(getByTestId('reminder-mascot-lane').props.pointerEvents).toBe('none');
    // MascotSafeZone's default "box-none" would re-enable its children on web.
    expect(getByTestId('reminder-mascot-safe-zone').props.pointerEvents).toBe('none');
  });

  it('nothing inside the overlay has a press or responder handler', async () => {
    mockAccessibility();
    const { getByTestId } = renderPrompt();
    await flush();
    const interactive = getByTestId('reminder-mascot-overlay').findAll(
      (node: { props: Record<string, any> }) =>
        typeof node.props.onPress === 'function' ||
        typeof node.props.onClick === 'function' ||
        typeof node.props.onStartShouldSetResponder === 'function'
    );
    expect(interactive).toHaveLength(0);
  });

  // Jest does no hit-testing, so this cannot prove the touch physically
  // reaches the control (the pointerEvents assertions above cover that);
  // it proves the overlay adds no handler that reacts to the press.
  it('pressing a control underneath runs that control and does not dismiss the mascot', async () => {
    mockAccessibility();
    const onStartWalk = jest.fn();
    const { getByTestId, onDismiss } = renderPrompt(
      {},
      <Pressable testID="start-walk" onPress={onStartWalk} />
    );
    await flush();
    expect(getByTestId('reminder-mascot-overlay')).toBeTruthy();
    fireEvent.press(getByTestId('start-walk'));
    expect(onStartWalk).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('renders nothing at all when not visible (no leftover overlay)', async () => {
    mockAccessibility();
    const { queryByTestId } = renderPrompt({ visible: false });
    await flush();
    expect(queryByTestId('reminder-mascot-overlay')).toBeNull();
  });

  it('keeps the announcement markup and shows the stage-specific Hebrew message', async () => {
    mockAccessibility();
    const { getByText, getByTestId } = renderPrompt();
    await flush();
    expect(getByText('אוהד, הטיול עם הכלב רקסי מתחיל בעוד 15 דקות 🐾')).toBeTruthy();
    expect(getByTestId('reminder-mascot-animation')).toBeTruthy();
    const alerts = getByTestId('reminder-mascot-overlay').findAll(
      (node: { props: Record<string, any> }) => node.props.accessibilityRole === 'alert' && node.props.accessibilityLiveRegion === 'polite'
    );
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('dismisses itself after the normal delay', async () => {
    mockAccessibility();
    const { onDismiss } = renderPrompt();
    await flush();
    act(() => {
      jest.advanceTimersByTime(REMINDER_PROMPT_DISMISS_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('with a screen reader on it stays longer but STILL dismisses itself — never a permanent overlay', async () => {
    mockAccessibility({ screenReader: true });
    const { onDismiss } = renderPrompt();
    await flush();
    act(() => {
      jest.advanceTimersByTime(REMINDER_PROMPT_DISMISS_MS + 500);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(REMINDER_PROMPT_SCREEN_READER_DISMISS_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('speaks the sentence explicitly on iOS, where there are no live regions', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const announce = mockAccessibility({ screenReader: true });
    renderPrompt({ message: 'הודעה לבדיקה' });
    await flush();
    expect(announce).toHaveBeenCalledWith('הודעה לבדיקה');
  });

  it('works for the request-notification prompt too (fixed animation, no stage)', async () => {
    mockAccessibility();
    const { getByTestId, getByText, onDismiss } = renderPrompt({ stage: undefined, animationId: 'high-five', message: 'הבקשה אושרה!' });
    await flush();
    expect(getByTestId('reminder-mascot-overlay').props.pointerEvents).toBe('none');
    expect(getByText('הבקשה אושרה!')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(REMINDER_PROMPT_DISMISS_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('ReminderMascotPrompt — source no longer uses a blocking Modal/Pressable (structural)', () => {
  const dir = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(dir, 'ReminderMascotPrompt.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const home = fs.readFileSync(path.resolve(dir, '..', 'screens', 'HomeScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('does not import or render Modal or Pressable', () => {
    const rnImport = source.match(/import \{([^}]*)\} from 'react-native';/)?.[1] ?? '';
    expect(rnImport).not.toMatch(/\bModal\b/);
    expect(rnImport).not.toMatch(/\bPressable\b/);
    expect(source).not.toMatch(/<Modal\b/);
    expect(source).not.toMatch(/<Pressable\b/);
    expect(source).not.toMatch(/onPress=/);
  });

  it('never uses box-none/auto inside the overlay', () => {
    expect(source).not.toContain('pointerEvents="box-none"');
    expect(source).not.toContain('pointerEvents="auto"');
    expect(source).toContain('<MascotSafeZone from="right" interactive={false}');
  });

  it('Home renders both prompts (reminder + request) directly in the screen, not wrapped in a Modal', () => {
    const reminder = home.indexOf('<ReminderMascotPrompt\n        visible={!!reminderPromptMessage}');
    const request = home.indexOf('<ReminderMascotPrompt\n        visible={!!requestPromptMessage}');
    expect(reminder).toBeGreaterThan(-1);
    expect(request).toBeGreaterThan(reminder);
    // Both sit at the screen root's indentation level (6 spaces), i.e. as
    // direct children of Home's root view.
    expect(home.slice(reminder - 7, reminder)).toBe('\n      ');
    expect(home.slice(request - 7, request)).toBe('\n      ');
  });
});
