import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RuleFormModal } from '../RuleFormModal';
import type { FamilyUser } from '../../types';

/**
 * Real-device QA fix — real-iPhone screenshot: opening the time picker
 * from ניהול שגרה → add/edit fixed time (RuleFormModal) covered the
 * middle of the modal — the "אחראי/ת לטיול" assignee section and the
 * Save/Cancel buttons — with iOS Safari's native <input type="time">
 * picker, blocking the rest of the flow. See TimePickerField.tsx's
 * web-branch doc comment for the fix (a fully custom picker sheet, no
 * native control at all). This is the end-to-end regression test the
 * fix itself was scoped against: open RuleFormModal → open the time
 * picker → pick a time → confirm → picker fully dismissed → assignee
 * controls reachable and select exactly one → Save once.
 */
describe('RuleFormModal — time picker sheet opens as a discrete step and never blocks the rest of the form', () => {
  const originalOs = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOs });
  });

  const users: FamilyUser[] = [
    { id: 'user-aba', name: 'אבא', avatar: '👨', color: '#5B8DEF' } as FamilyUser,
    { id: 'user-ima', name: 'אמא', avatar: '👩', color: '#F2994A' } as FamilyUser,
  ];

  it('full flow: open picker → select hour/minute → confirm → sheet gone → assignee reachable → Save fires once with the new time and exactly one assignee', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    const screen = render(
      <RuleFormModal visible editingRule={null} users={users} onSave={onSave} onClose={onClose} />
    );

    // Before opening the time picker, the assignee section and Save are
    // already present — opening the picker must not require scrolling
    // past, or otherwise disturbing, anything already on screen.
    expect(screen.getByText('אבא')).toBeTruthy();
    expect(screen.getByText('שמירה')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));

    // The picker sheet is now open — its own confirm/cancel controls are
    // visible (distinct accessibility labels from RuleFormModal's own
    // "ביטול", since both coexist in the tree while the sheet Modal is
    // open), as a discrete step.
    expect(screen.getByLabelText('אישור בחירת שעה')).toBeTruthy();
    expect(screen.getByLabelText('ביטול בחירת שעה')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('שעה 18'));
    fireEvent.press(screen.getByLabelText('דקה 30'));
    fireEvent.press(screen.getByLabelText('אישור בחירת שעה'));

    // The sheet is fully dismissed — its controls are gone — and
    // RuleFormModal's own assignee section and Save button are reachable
    // again, unobstructed.
    expect(screen.queryByLabelText('אישור בחירת שעה')).toBeNull();
    expect(screen.queryByLabelText('ביטול בחירת שעה')).toBeNull();
    expect(screen.getByText('אבא')).toBeTruthy();
    expect(screen.getByText('שמירה')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('אבא'));
    fireEvent.press(screen.getByText('שמירה'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ time: '18:30', rotationUserIds: ['user-aba'] })
    );
  });

  it('editing an existing rule seeds the picker sheet from the rule\'s current time, not a default', () => {
    const editingRule = {
      id: 'rule-1',
      familyId: 'family-1',
      dogId: 'dog-1',
      time: '07:15',
      label: '',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-aba'],
      active: true,
    } as unknown as Parameters<typeof RuleFormModal>[0]['editingRule'];

    const screen = render(
      <RuleFormModal visible editingRule={editingRule} users={users} onSave={jest.fn()} onClose={jest.fn()} />
    );

    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));

    expect(screen.getByLabelText('שעה 07').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('דקה 15').props.accessibilityState.selected).toBe(true);
  });

  it('cancelling the picker sheet leaves the previously selected time untouched and the form fully usable', () => {
    const screen = render(
      <RuleFormModal visible editingRule={null} users={users} onSave={jest.fn()} onClose={jest.fn()} />
    );

    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));
    fireEvent.press(screen.getByLabelText('שעה 23'));
    fireEvent.press(screen.getByLabelText('ביטול בחירת שעה'));

    // Default time (08:00) is unchanged; the field is still reachable.
    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));
    expect(screen.getByLabelText('שעה 08').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('שעה 23').props.accessibilityState.selected).toBe(false);
  });
});
