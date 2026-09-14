import { formatHistoryDate, localDateOnly } from '../dateFormat';

describe('localDateOnly', () => {
  it('formats a Date as local YYYY-MM-DD, not UTC', () => {
    // 2026-01-05 23:30 local time — a UTC-anchored formatter in a timezone
    // behind UTC would report this as the next day; this must not.
    const d = new Date(2026, 0, 5, 23, 30);
    expect(localDateOnly(d)).toBe('2026-01-05');
  });

  it('pads single-digit month/day', () => {
    expect(localDateOnly(new Date(2026, 2, 4))).toBe('2026-03-04');
  });

  it('defaults to the real current moment when called with no argument', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(localDateOnly()).toBe(expected);
  });
});

describe('formatHistoryDate', () => {
  it('shows היום for the viewer\'s local today', () => {
    const now = new Date(2026, 7, 30, 9, 0);
    expect(formatHistoryDate('2026-08-30', now)).toBe('היום');
  });

  it('formats a non-today date as DD-MM-YYYY', () => {
    const now = new Date(2026, 7, 30, 9, 0);
    expect(formatHistoryDate('2026-08-29', now)).toBe('29-08-2026');
  });

  it('handles yesterday distinctly from today', () => {
    const now = new Date(2026, 7, 30, 0, 5);
    expect(formatHistoryDate('2026-08-29', now)).toBe('29-08-2026');
    expect(formatHistoryDate('2026-08-30', now)).toBe('היום');
  });

  it('handles a month boundary correctly', () => {
    const now = new Date(2026, 8, 1, 12, 0); // Sep 1
    expect(formatHistoryDate('2026-08-31', now)).toBe('31-08-2026');
    expect(formatHistoryDate('2026-09-01', now)).toBe('היום');
  });

  it('handles a year boundary correctly', () => {
    const now = new Date(2027, 0, 1, 12, 0); // Jan 1 2027
    expect(formatHistoryDate('2026-12-31', now)).toBe('31-12-2026');
    expect(formatHistoryDate('2027-01-01', now)).toBe('היום');
  });

  it('defaults to the real current moment when called with no `now` argument', () => {
    expect(formatHistoryDate(localDateOnly())).toBe('היום');
  });
});
