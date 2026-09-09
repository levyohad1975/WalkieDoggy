/** Strict 24-hour storage format used by schedule rules and walk instances. */
export function is24HourTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function timeToPickerDate(value: string): Date {
  const [hours, minutes] = is24HourTime(value) ? value.split(':').map(Number) : [12, 0];
  return new Date(2000, 0, 1, hours, minutes, 0, 0);
}

export function pickerDateToTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}
