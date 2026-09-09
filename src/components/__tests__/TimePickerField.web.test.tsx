import React from 'react';
import { Platform, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TimePickerField } from '../TimePickerField';

describe('TimePickerField on Web', () => {
  const originalOs = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOs });
  });

  it.each(['07:00', '19:30', '08:00'])('updates the rendered browser control to %s', (time) => {
    function ControlledField() {
      const [selectedTime, setSelectedTime] = React.useState('08:00');
      return (
        <>
          <TimePickerField value={selectedTime} onChange={setSelectedTime} webLabel="בחירת שעת טיול" />
          <Text testID="selected-time">{selectedTime}</Text>
        </>
      );
    }

    const screen = render(<ControlledField />);

    const input = screen.getByLabelText('בחירת שעת טיול');
    fireEvent(input, 'change', { target: { value: time } });

    expect(screen.getByTestId('selected-time').props.children).toBe(time);
    expect(input.props.type).toBe('time');
    expect(input.props.value).toBe(time);
  });
});
