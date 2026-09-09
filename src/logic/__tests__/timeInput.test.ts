import { is24HourTime, pickerDateToTime, timeToPickerDate } from '../timeInput';

describe('24-hour time input', () => {
  it.each(['07:00', '06:30', '08:00', '12:15', '19:30', '23:00'])('accepts %s', (time) => expect(is24HourTime(time)).toBe(true));
  it.each(['7:00', '24:00', '19:60', 'abc'])('rejects invalid time %s', (time) => expect(is24HourTime(time)).toBe(false));
  it('round-trips a selected 07:00 without changing it', () => expect(pickerDateToTime(timeToPickerDate('07:00'))).toBe('07:00'));
  it('round-trips a selected 19:30 without changing it', () => expect(pickerDateToTime(timeToPickerDate('19:30'))).toBe('19:30'));
});
