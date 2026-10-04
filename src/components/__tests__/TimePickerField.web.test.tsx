import React from 'react';
import { Platform, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TimePickerField } from '../TimePickerField';

/**
 * Real-device QA fix — real-iPhone screenshot showed the browser's native
 * <input type="time"> picker (the previous implementation of this
 * component on web) overlaying the middle of RuleFormModal, hiding the
 * assignee section and Save/Cancel buttons until dismissed. See
 * TimePickerField.tsx's own web-branch doc comment: the fix replaces that
 * native control entirely with a plain button that opens a fully custom,
 * app-controlled picker sheet (WebTimePickerSheet) — no OS picker chrome,
 * explicit "אישור"/"ביטול" controls, closes completely on either.
 */
describe('TimePickerField on Web — custom picker sheet (no native <input type="time">)', () => {
  const originalOs = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOs });
  });

  function ControlledField() {
    const [selectedTime, setSelectedTime] = React.useState('08:00');
    return (
      <>
        <TimePickerField value={selectedTime} onChange={setSelectedTime} webLabel="בחירת שעת טיול" />
        <Text testID="selected-time">{selectedTime}</Text>
      </>
    );
  }

  it('renders a plain button showing the current value — never a native <input type="time">', () => {
    const screen = render(<ControlledField />);
    const field = screen.getByLabelText('בחירת שעת טיול');
    expect(field.props.type).toBeUndefined();
    expect(screen.getByTestId('selected-time').props.children).toBe('08:00');
  });

  it('tapping the field opens the picker sheet, not an inline/overlay native control', () => {
    const screen = render(<ControlledField />);
    expect(screen.queryByText('אישור')).toBeNull();

    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));

    expect(screen.getByText('אישור')).toBeTruthy();
    expect(screen.getByText('ביטול')).toBeTruthy();
  });

  it.each([
    [7, 0, '07:00'],
    [19, 30, '19:30'],
    [8, 5, '08:05'],
  ])('selecting hour %i and minute %i and confirming commits %s', (hour, minute, expected) => {
    const screen = render(<ControlledField />);
    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));

    fireEvent.press(screen.getByLabelText(`שעה ${String(hour).padStart(2, '0')}`));
    fireEvent.press(screen.getByLabelText(`דקה ${String(minute).padStart(2, '0')}`));
    fireEvent.press(screen.getByText('אישור'));

    expect(screen.getByTestId('selected-time').props.children).toBe(expected);
  });

  it('confirming closes the sheet completely — the confirm/cancel controls are gone afterwards', () => {
    const screen = render(<ControlledField />);
    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));
    fireEvent.press(screen.getByText('אישור'));

    expect(screen.queryByText('אישור')).toBeNull();
    expect(screen.queryByText('ביטול')).toBeNull();
  });

  it('cancelling discards any in-progress selection and never calls onChange', () => {
    const onChange = jest.fn();
    const screen = render(<TimePickerField value="08:00" onChange={onChange} webLabel="בחירת שעת טיול" />);
    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));

    fireEvent.press(screen.getByLabelText('שעה 19'));
    fireEvent.press(screen.getByText('ביטול'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('אישור')).toBeNull();
  });

  it('re-opening the sheet (editing an existing time) starts from the field\'s current value, not a prior in-progress selection', () => {
    const screen = render(<ControlledField />);

    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));
    fireEvent.press(screen.getByLabelText('שעה 19'));
    fireEvent.press(screen.getByText('ביטול')); // discard — value stays 08:00

    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));
    expect(screen.getByLabelText('שעה 08').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('שעה 19').props.accessibilityState.selected).toBe(false);
  });
});
