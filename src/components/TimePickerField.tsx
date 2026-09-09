import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors } from '../theme/colors';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { is24HourTime, pickerDateToTime, timeToPickerDate } from '../logic/timeInput';

interface TimePickerFieldProps {
  value: string;
  onChange: (time: string) => void;
  webLabel: string;
  androidLabel?: string;
}

/** Native picker on iOS/Android and a standards-based 24-hour input on Web. */
export function TimePickerField({ value, onChange, webLabel, androidLabel = 'שנה שעה' }: TimePickerFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(Platform.OS === 'ios');

  useEffect(() => setPickerOpen(Platform.OS === 'ios'), [value]);

  const handleNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type !== 'dismissed' && selected) onChange(pickerDateToTime(selected));
  };

  // Do not pair the browser control with a second, static time label. In the
  // previous Web layout the static label and the HTML input were siblings in
  // the same React Native Web flex row, so the visible "08:00" looked like a
  // non-editable field while the actual control was easy to miss. The native
  // time input is now the one and only representation of the selected value.
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'time',
      value,
      step: 60,
      'aria-label': webLabel,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      style: webInputStyle,
    });
  }

  return (
    <>
      <View style={styles.row}>
        <RtlText style={styles.value}>{value}</RtlText>
        {Platform.OS === 'android' ? <Button label={androidLabel} variant="secondary" onPress={() => setPickerOpen(true)} style={styles.button} /> : null}
      </View>
      {pickerOpen ? (
        <DateTimePicker value={timeToPickerDate(value)} mode="time" is24Hour display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={handleNativeChange} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  value: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: 14, fontSize: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  button: { flex: 1.25 },
});

const webInputStyle = {
  display: 'block', width: '100%', minHeight: 52, boxSizing: 'border-box', padding: 12, fontSize: 18, fontWeight: '700',
  borderRadius: 14, border: `1px solid ${colors.border}`, backgroundColor: colors.surface,
  color: colors.textPrimary, textAlign: 'center', direction: 'ltr', cursor: 'pointer',
};
