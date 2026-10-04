import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TimePickerField } from '../TimePickerField';

/**
 * Real-device QA fix — "first tap on שמירה does nothing, second tap
 * starts saving". Real-iPhone sequence: select time -> select assignee
 * -> tap Save once -> nothing visible happens -> tap again -> saving
 * finally starts. Root cause: picking a time leaves the native
 * <input type="time"> focused with iOS Safari's own picker/keyboard
 * still open. On iOS Safari, the FIRST tap elsewhere is consumed to
 * dismiss that picker/keyboard — it never reaches the tapped element as
 * a real click; only the SECOND tap does. Fix: blur the input the
 * moment a time is actually chosen, so nothing is still focused by the
 * time the person reaches "שמירה" — see TimePickerField.tsx's own doc
 * comment on the web onChange handler.
 */
describe('TimePickerField on Web — auto-blur after picking a time', () => {
  const originalOs = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOs });
  });

  it('calls blur() on the input itself immediately after a time is picked, dismissing iOS Safari\'s own picker/keyboard without waiting for the next tap', () => {
    const screen = render(<TimePickerField value="08:00" onChange={() => undefined} webLabel="בחירת שעת טיול" />);
    const input = screen.getByLabelText('בחירת שעת טיול');
    const blur = jest.fn();

    fireEvent(input, 'change', { target: { value: '18:00', blur } });

    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('still calls the caller\'s onChange with the new value — blurring is additive, never a replacement for reporting the change', () => {
    const onChange = jest.fn();
    const screen = render(<TimePickerField value="08:00" onChange={onChange} webLabel="בחירת שעת טיול" />);
    const input = screen.getByLabelText('בחירת שעת טיול');

    fireEvent(input, 'change', { target: { value: '18:00', blur: jest.fn() } });

    expect(onChange).toHaveBeenCalledWith('18:00');
  });

  it('never throws when the event target has no blur method (a plain DOM-shape mock, or a future test harness) — blur is called optionally', () => {
    const onChange = jest.fn();
    const screen = render(<TimePickerField value="08:00" onChange={onChange} webLabel="בחירת שעת טיול" />);
    const input = screen.getByLabelText('בחירת שעת טיול');

    expect(() => fireEvent(input, 'change', { target: { value: '18:00' } })).not.toThrow();
    expect(onChange).toHaveBeenCalledWith('18:00');
  });
});
