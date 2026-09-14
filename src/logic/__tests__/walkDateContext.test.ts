import { walkDateContextLabel, walkTimeWithDateContext } from '../walkDateContext';

const NOW = new Date('2026-09-04T12:00:00'); // Friday

describe('walkDateContextLabel', () => {
  it('labels today', () => {
    expect(walkDateContextLabel('2026-09-04', NOW)).toBe('היום');
  });

  it('labels tomorrow', () => {
    expect(walkDateContextLabel('2026-09-05', NOW)).toBe('מחר');
  });

  it('labels yesterday', () => {
    expect(walkDateContextLabel('2026-09-03', NOW)).toBe('אתמול');
  });

  it('labels a further-away date compactly (DD/MM)', () => {
    expect(walkDateContextLabel('2026-09-10', NOW)).toBe('10/09');
    expect(walkDateContextLabel('2026-08-20', NOW)).toBe('20/08');
  });

  it('is stable across a whole day regardless of time-of-day', () => {
    expect(walkDateContextLabel('2026-09-04', new Date('2026-09-04T00:01:00'))).toBe('היום');
    expect(walkDateContextLabel('2026-09-04', new Date('2026-09-04T23:59:00'))).toBe('היום');
  });

  it('defaults to the real current moment when called with no `now` argument', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(walkDateContextLabel(today)).toBe('היום');
  });
});

describe('walkTimeWithDateContext', () => {
  it('combines the date label and time into one compact string', () => {
    expect(walkTimeWithDateContext('2026-09-04', '07:00', NOW)).toBe('היום · 07:00');
    expect(walkTimeWithDateContext('2026-09-05', '07:00', NOW)).toBe('מחר · 07:00');
  });

  it('lets two same-time walks on different days read as visibly different', () => {
    const next = walkTimeWithDateContext('2026-09-04', '07:00', NOW);
    const last = walkTimeWithDateContext('2026-09-03', '07:00', NOW);
    expect(next).not.toBe(last);
  });

  it('defaults to the real current moment when called with no `now` argument', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(walkTimeWithDateContext(today, '07:00')).toBe('היום · 07:00');
  });
});
