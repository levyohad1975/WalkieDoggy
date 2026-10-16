import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { HealthGroomingModal } from '../HealthGroomingModal';
import type { Dog, FamilyUser, HealthTask } from '../../types';

jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));

/**
 * Real-iPhone P0 (Safari / Home Screen PWA): opening an existing calendar
 * entry (תספורת · 20.10.2026 · 15:00 · באחריות אבי) showed the form, but
 *  A) "מחיקת משימה" sat below the visible screen, and
 *  B) tapping it did nothing — Alert.alert is a no-op on react-native-web.
 *
 * These tests render the real modal on the web platform with a mocked
 * browser confirm/alert and verify the fixed layout and delete flow.
 */
// Loosely typed on purpose: the DOM lib types window/confirm/alert as required.
type Host = {
  confirm?: jest.Mock;
  alert?: jest.Mock;
  window?: unknown;
};
const host = globalThis as unknown as Host;

/** jest-expo runs in Node: give the hooks a minimal iPhone SE browser window (layout viewport 667px). */
type FakeWindow = { innerHeight: number; visualViewport?: unknown; scrollY: number; scrollTo: jest.Mock };
let fakeWindow: FakeWindow;

const FIXED = '2026-10-01T00:00:00.000Z';
const dog = { id: 'dog-1', familyId: 'family-1', name: 'רקסי' } as unknown as Dog;
const users = [
  { id: 'user-avi', familyId: 'family-1', name: 'אבי', avatar: '👨', color: '#5B8DEF', createdAt: FIXED },
  { id: 'user-noa', familyId: 'family-1', name: 'נועה', avatar: '👩', color: '#E57373', createdAt: FIXED },
] as unknown as FamilyUser[];

const haircut: HealthTask = {
  id: 'task-haircut', familyId: 'family-1', dogId: 'dog-1', category: 'grooming', title: 'תספורת',
  notes: 'שעת תור: 15:00', dueDate: '2099-10-20', responsibleUserId: 'user-avi', createdAt: FIXED, updatedAt: FIXED,
};
const vet: HealthTask = {
  id: 'task-vet', familyId: 'family-1', dogId: 'dog-1', category: 'vet_visit', title: 'חיסון כלבת',
  notes: 'שעת תור: 09:00', dueDate: '2099-11-02', recurrenceIntervalDays: 365, createdAt: FIXED, updatedAt: FIXED,
};
const done: HealthTask = { ...haircut, id: 'task-done', dueDate: '2026-09-01', completedAt: '2026-09-01T10:00:00.000Z', completedByUserId: 'user-avi' };

const originalOs = Platform.OS;
const originalConfirm = host.confirm;
const originalAlert = host.alert;
const hadWindow = 'window' in globalThis;
const originalWindow = host.window;

function setOs(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

function showKeyboard(visualHeight: number) {
  fakeWindow.visualViewport = { height: visualHeight, offsetTop: 0, scale: 1, addEventListener: jest.fn(), removeEventListener: jest.fn() };
}

beforeEach(() => {
  host.confirm = jest.fn().mockReturnValue(true);
  host.alert = jest.fn();
  fakeWindow = { innerHeight: 667, visualViewport: undefined, scrollY: 0, scrollTo: jest.fn() };
  host.window = fakeWindow;
  setOs('web');
});

afterEach(() => {
  setOs(originalOs);
  host.confirm = originalConfirm;
  host.alert = originalAlert;
  if (hadWindow) host.window = originalWindow;
  else delete host.window;
});

function Harness({ initial, deleteImpl, onSave = jest.fn().mockResolvedValue(undefined), bottomInset = 0 }: {
  initial: HealthTask[];
  deleteImpl: (id: string) => Promise<void>;
  onSave?: jest.Mock;
  bottomInset?: number;
}) {
  const [tasks, setTasks] = useState(initial);
  const [visible, setVisible] = useState(true);
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: bottomInset } }}>
      <HealthGroomingModal
        visible={visible}
        dog={dog}
        tasks={tasks}
        users={users}
        currentUserId="user-avi"
        onSave={onSave}
        onComplete={jest.fn()}
        onDelete={async (id) => {
          // Same contract as healthStore.deleteTask: resolve only after the
          // server confirmed, then drop the entry from the calendar.
          await deleteImpl(id);
          setTasks((current) => current.filter((t) => t.id !== id));
        }}
        onClose={() => setVisible(false)}
      />
      <Pressable testID="reopen-calendar" onPress={() => setVisible(true)} />
    </SafeAreaProvider>
  );
}

function openHaircut(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getByLabelText(/^עריכת תספורת/));
  expect(screen.getByText('עריכת רשומה')).toBeTruthy();
}

describe('HealthGroomingModal edit sheet on iPhone Safari / PWA — layout (P0-A)', () => {
  it('Save, Cancel and "מחיקת משימה" are in a footer outside the scrolling body, so they are always on screen', () => {
    const screen = render(<Harness initial={[haircut]} deleteImpl={jest.fn()} />);
    openHaircut(screen);

    const footer = screen.getByTestId('health-task-form-footer');
    const body = screen.getByTestId('health-task-form-scroll');
    expect(within(footer).getByText('מחיקת משימה')).toBeTruthy();
    expect(within(footer).getByText('שמירה')).toBeTruthy();
    expect(within(footer).getByText('ביטול')).toBeTruthy();
    expect(within(body).queryByText('מחיקת משימה')).toBeNull();
    expect(within(body).queryByText('שמירה')).toBeNull();
    // The whole form, down to its last field, lives in the scrollable body.
    expect(within(body).getByLabelText('הערות')).toBeTruthy();
    expect(within(body).getByLabelText('אבי')).toBeTruthy();
    // The body can shrink below its content (and therefore scroll) inside the column.
    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
    expect(StyleSheet.flatten(footer.props.style)).toMatchObject({ flexShrink: 0 });
  });

  it('small iPhone viewport: the sheet gets an explicit pixel height that fits the screen', () => {
    const screen = render(<Harness initial={[haircut]} deleteImpl={jest.fn()} />);
    openHaircut(screen);
    const sheet = StyleSheet.flatten(screen.getByTestId('health-task-form-sheet').props.style);
    expect(typeof sheet.height).toBe('number');
    expect(sheet.height).toBeLessThanOrEqual(667 - 20 - 24);
    expect(sheet.maxHeight).toBe(sheet.height);
    expect(sheet.overflow).toBe('hidden');
  });

  it('bottom safe area: the footer pads for the home indicator (CSS env() on web)', () => {
    const screen = render(<Harness initial={[haircut]} deleteImpl={jest.fn()} bottomInset={34} />);
    openHaircut(screen);
    const footer = StyleSheet.flatten(screen.getByTestId('health-task-form-footer').props.style);
    expect(footer.paddingBottom).toBe('max(34px, env(safe-area-inset-bottom, 0px))');
  });

  it('bottom safe area on native: numeric inset padding', () => {
    setOs('ios');
    const screen = render(<Harness initial={[haircut]} deleteImpl={jest.fn()} bottomInset={34} />);
    openHaircut(screen);
    expect(StyleSheet.flatten(screen.getByTestId('health-task-form-footer').props.style).paddingBottom).toBe(34);
  });

  it('keyboard open (iOS shrinks only the visual viewport): the sheet is lifted above it and the actions stay visible', () => {
    showKeyboard(407);
    const screen = render(<Harness initial={[haircut]} deleteImpl={jest.fn()} bottomInset={34} />);
    openHaircut(screen);

    const backdrop = StyleSheet.flatten(screen.getByTestId('health-task-form-backdrop').props.style);
    const sheet = StyleSheet.flatten(screen.getByTestId('health-task-form-sheet').props.style);
    const footer = StyleSheet.flatten(screen.getByTestId('health-task-form-footer').props.style);
    expect(backdrop.paddingBottom).toBe(260);
    expect((sheet.height as number) + 260).toBeLessThanOrEqual(667 - 20 - 24);
    expect(footer.paddingBottom).toBe(8); // keyboard already covers the home indicator
    expect(within(screen.getByTestId('health-task-form-footer')).getByText('מחיקת משימה')).toBeTruthy();
  });

  it('RTL: the secondary action row is row-reverse with Cancel on the right and Delete on the left', () => {
    const screen = render(<Harness initial={[haircut]} deleteImpl={jest.fn()} />);
    openHaircut(screen);
    const row = screen.getByTestId('health-task-form-secondary-actions');
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row-reverse');
    expect(within(row).getAllByText(/^(ביטול|מחיקת משימה)$/).map((n) => n.props.children)).toEqual(['ביטול', 'מחיקת משימה']);
  });

  it('Save still works from the pinned footer and keeps the entry identity', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = render(<Harness initial={[haircut]} deleteImpl={jest.fn()} onSave={onSave} />);
    openHaircut(screen);
    fireEvent.press(screen.getByText('שמירה'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'task-haircut', category: 'grooming', dueDate: '2099-10-20', responsibleUserId: 'user-avi' });
    expect(onSave.mock.calls[0][0].notes).toContain('שעת תור: 15:00');
  });

  it('completed history entries never offer deletion', () => {
    const screen = render(<Harness initial={[done]} deleteImpl={jest.fn()} />);
    fireEvent.press(screen.getByLabelText(/^עריכת תספורת/));
    expect(screen.getByText('עריכת רשומה')).toBeTruthy();
    expect(screen.queryByText('מחיקת משימה')).toBeNull();
  });
});

describe('HealthGroomingModal edit sheet on iPhone Safari / PWA — delete (P0-B)', () => {
  it('tapping "מחיקת משימה" shows a real browser confirmation naming the entry (Alert.alert is a no-op on web)', async () => {
    const screen = render(<Harness initial={[haircut]} deleteImpl={jest.fn()} />);
    openHaircut(screen);
    fireEvent.press(screen.getByText('מחיקת משימה'));
    expect(screen.getByTestId('health-task-delete-confirmation')).toBeTruthy();
    expect(screen.getByText('מחיקת משימה?')).toBeTruthy();
    expect(screen.getByText('20-10-2099')).toBeTruthy();
    expect(screen.getByText('מחק משימה')).toBeTruthy();
  });

  it('cancelling the confirmation leaves the entry unchanged and the sheet open', async () => {
    host.confirm!.mockReturnValue(false);
    const deleteImpl = jest.fn().mockResolvedValue(undefined);
    const screen = render(<Harness initial={[haircut, vet]} deleteImpl={deleteImpl} />);
    openHaircut(screen);
    fireEvent.press(screen.getByText('מחיקת משימה'));
    fireEvent.press(within(screen.getByTestId('health-task-delete-confirmation')).getByLabelText('ביטול'));
    await act(async () => {});
    expect(deleteImpl).not.toHaveBeenCalled();
    expect(screen.getByText('עריכת רשומה')).toBeTruthy();
    expect(screen.getByText('מחיקת משימה')).toBeTruthy();
  });

  it('confirming deletes exactly once even on a double tap, then the entry disappears and the others remain', async () => {
    let finish!: () => void;
    const deleteImpl = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const screen = render(<Harness initial={[haircut, vet]} deleteImpl={deleteImpl} />);
    openHaircut(screen);

    const button = screen.getByText('מחיקת משימה');
    fireEvent.press(button);
    const approve = screen.getByText('מחק משימה');
    fireEvent.press(approve);
    fireEvent.press(approve);
    fireEvent.press(screen.getByText('מחק משימה'));
    await waitFor(() => expect(deleteImpl).toHaveBeenCalledTimes(1));
    expect(deleteImpl).toHaveBeenCalledWith('task-haircut');
    // No success state before the server confirms: the sheet is still open.
    expect(screen.getByText('עריכת רשומה')).toBeTruthy();

    await act(async () => { finish(); });

    await waitFor(() => expect(screen.queryByText('עריכת רשומה')).toBeNull());
    expect(screen.queryByLabelText(/^עריכת תספורת/)).toBeNull();
    expect(screen.getByLabelText(/^עריכת חיסון כלבת/)).toBeTruthy();
    expect(deleteImpl).toHaveBeenCalledTimes(1);
    expect(host.alert).not.toHaveBeenCalled();
  });

  it('a failed delete shows a clear Hebrew error, keeps the entry, and a retry succeeds (network interruption)', async () => {
    const deleteImpl = jest.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(undefined);
    const screen = render(<Harness initial={[haircut, vet]} deleteImpl={deleteImpl} />);
    openHaircut(screen);

    fireEvent.press(screen.getByText('מחיקת משימה'));
    fireEvent.press(screen.getByText('מחק משימה'));
    await waitFor(() => expect(host.alert).toHaveBeenCalledTimes(1));
    const message = host.alert!.mock.calls[0][0] as string;
    expect(message).toContain('לא הצלחנו למחוק');
    expect(message).toContain('לא נמחקה');
    expect(message).not.toContain('Failed to fetch');
    expect(screen.getByText('עריכת רשומה')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('מחיקת משימה')).toBeTruthy());
    fireEvent.press(screen.getByText('מחיקת משימה'));
    fireEvent.press(screen.getByText('מחק משימה'));
    await waitFor(() => expect(deleteImpl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText(/^עריכת תספורת/)).toBeNull());
    expect(screen.getByLabelText(/^עריכת חיסון כלבת/)).toBeTruthy();
  });

  it('permission denial is reported in Hebrew and nothing is removed', async () => {
    const deleteImpl = jest.fn().mockRejectedValue(new Error('Open health task was not deleted or is no longer authorized'));
    const screen = render(<Harness initial={[haircut]} deleteImpl={deleteImpl} />);
    openHaircut(screen);
    fireEvent.press(screen.getByText('מחיקת משימה'));
    fireEvent.press(screen.getByText('מחק משימה'));
    await waitFor(() => expect(host.alert).toHaveBeenCalledTimes(1));
    expect(host.alert!.mock.calls[0][0]).toContain('אין הרשאה');
    expect(screen.getByLabelText(/^עריכת תספורת/)).toBeTruthy();
  });

  it('reopening the calendar after deletion does not bring the entry back', async () => {
    const deleteImpl = jest.fn().mockResolvedValue(undefined);
    const screen = render(<Harness initial={[haircut, vet]} deleteImpl={deleteImpl} />);
    openHaircut(screen);
    fireEvent.press(screen.getByText('מחיקת משימה'));
    fireEvent.press(screen.getByText('מחק משימה'));
    await waitFor(() => expect(deleteImpl).toHaveBeenCalledTimes(1));
    expect(host.alert).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText(/^עריכת תספורת/)).toBeNull());
    await waitFor(() => expect(screen.queryByText('עריכת רשומה')).toBeNull());

    fireEvent.press(screen.getByText('סגור'));
    expect(screen.queryByLabelText(/^עריכת חיסון כלבת/)).toBeNull();
    fireEvent.press(screen.getByTestId('reopen-calendar'));
    expect(screen.getByLabelText(/^עריכת חיסון כלבת/)).toBeTruthy();
    expect(screen.queryByLabelText(/^עריכת תספורת/)).toBeNull();
  });

  it('deleting a recurring entry warns that its future repeats stop, and only that entry is deleted', async () => {
    const deleteImpl = jest.fn().mockResolvedValue(undefined);
    const screen = render(<Harness initial={[haircut, vet]} deleteImpl={deleteImpl} />);
    fireEvent.press(screen.getByLabelText(/^עריכת חיסון כלבת/));
    fireEvent.press(screen.getByText('מחיקת משימה'));
    fireEvent.press(screen.getByText('מחק משימה'));
    await waitFor(() => expect(deleteImpl).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('health-task-delete-confirmation')).toBeNull();
    expect(deleteImpl).toHaveBeenCalledWith('task-vet');
    await waitFor(() => expect(screen.getByLabelText(/^עריכת תספורת/)).toBeTruthy());
  });
});
