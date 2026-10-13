import { describePresence, describePresenceCompact, PRESENCE_FRESH_MINUTES } from '../presence';

/**
 * Round 7, Part 2/5. `now` is always injected here — never real wall-clock
 * time — per the "do not write wall-clock-sensitive tests without freezing
 * time" requirement. Dates are built with the local `new Date(y, m, d, h,
 * min)` constructor (never a UTC-suffixed ISO string), matching
 * dateFormat.test.ts's own convention — this keeps the "same local day" /
 * "yesterday" assertions correct regardless of which timezone this suite
 * happens to run in.
 */
describe('describePresence', () => {
  const NOW = new Date(2026, 7, 31, 14, 0, 0); // 2026-08-31 14:00 local

  // ---- Requirement 11: recent last_seen_at -> active now ----
  it('within the fresh window -> active, with the exact "פעיל עכשיו" label', () => {
    const lastSeenAt = new Date(NOW.getTime() - (PRESENCE_FRESH_MINUTES - 1) * 60000).toISOString();
    expect(describePresence(lastSeenAt, NOW)).toEqual({ active: true, label: 'פעיל עכשיו' });
  });

  it('exactly "now" -> active', () => {
    expect(describePresence(NOW.toISOString(), NOW)).toEqual({ active: true, label: 'פעיל עכשיו' });
  });

  // ---- Requirement 12: stale last_seen_at -> not active ----
  it('exactly at the fresh-window boundary -> no longer active (boundary is exclusive)', () => {
    const lastSeenAt = new Date(NOW.getTime() - PRESENCE_FRESH_MINUTES * 60000).toISOString();
    const result = describePresence(lastSeenAt, NOW);
    expect(result.active).toBe(false);
  });

  it('an hour ago -> not active', () => {
    const lastSeenAt = new Date(NOW.getTime() - 60 * 60000).toISOString();
    expect(describePresence(lastSeenAt, NOW).active).toBe(false);
  });

  // ---- Requirement 13: null last_seen_at -> no misleading "active" text ----
  it('null last_seen_at -> not active, no label at all', () => {
    expect(describePresence(null, NOW)).toEqual({ active: false, label: null });
  });

  it('undefined last_seen_at -> not active, no label at all', () => {
    expect(describePresence(undefined, NOW)).toEqual({ active: false, label: null });
  });

  it('an unparseable timestamp -> not active, no label (never crashes, never fakes "active")', () => {
    expect(describePresence('not-a-real-date', NOW)).toEqual({ active: false, label: null });
  });

  // ---- Requirement 14: Hebrew "last seen" formatting ----
  it('minutes-ago phrasing for a stale-but-recent timestamp (under an hour)', () => {
    const lastSeenAt = new Date(NOW.getTime() - 12 * 60000).toISOString();
    expect(describePresence(lastSeenAt, NOW)).toEqual({ active: false, label: 'נראה לפני 12 דק׳' });
  });

  it('"today at HH:MM" phrasing for the same local calendar day, an hour or more ago', () => {
    const lastSeenAt = new Date(2026, 7, 31, 9, 30, 0); // same local day as NOW, 09:30
    expect(describePresence(lastSeenAt.toISOString(), NOW)).toEqual({ active: false, label: 'נראה היום ב-09:30' });
  });

  it('"yesterday at HH:MM" phrasing for the previous local calendar day', () => {
    const lastSeenAt = new Date(2026, 7, 30, 9, 30, 0); // previous local day
    expect(describePresence(lastSeenAt.toISOString(), NOW)).toEqual({ active: false, label: 'נראה אתמול ב-09:30' });
  });

  it('older than yesterday -> omits the label cleanly rather than inventing a new phrasing', () => {
    const lastSeenAt = new Date(2026, 7, 20, 9, 30, 0);
    expect(describePresence(lastSeenAt.toISOString(), NOW)).toEqual({ active: false, label: null });
  });
});

/**
 * Round 8, Fix 2: the Family screen's row subtitle was truncating on a real
 * iPhone ("מנהל · פעיל..."). describePresenceCompact() is the SHORTER
 * label used only for that row — same active/threshold semantics as
 * describePresence() (verified above), just less text for the non-active
 * cases. The full precise label (with exact clock time) is unchanged and
 * still used as-is in MemberDetailsModal via plain describePresence().
 */
describe('describePresenceCompact', () => {
  const NOW = new Date(2026, 7, 31, 14, 0, 0); // 2026-08-31 14:00 local

  it('active (within the fresh window) -> identical to describePresence, "פעיל עכשיו"', () => {
    const lastSeenAt = new Date(NOW.getTime() - (PRESENCE_FRESH_MINUTES - 1) * 60000).toISOString();
    expect(describePresenceCompact(lastSeenAt, NOW)).toEqual({ active: true, label: 'פעיל עכשיו' });
  });

  it('null last_seen_at -> not active, no label', () => {
    expect(describePresenceCompact(null, NOW)).toEqual({ active: false, label: null });
  });

  it('an unparseable timestamp -> not active, no label (never crashes)', () => {
    expect(describePresenceCompact('not-a-real-date', NOW)).toEqual({ active: false, label: null });
  });

  it('under an hour ago -> drops the "נראה" prefix, keeps the minute count', () => {
    const lastSeenAt = new Date(NOW.getTime() - 12 * 60000).toISOString();
    expect(describePresenceCompact(lastSeenAt, NOW)).toEqual({ active: false, label: 'לפני 12 דק׳' });
  });

  it('about an hour ago (60-89 minutes) -> "לפני שעה", not a raw minute count', () => {
    const lastSeenAt = new Date(NOW.getTime() - 75 * 60000).toISOString();
    expect(describePresenceCompact(lastSeenAt, NOW)).toEqual({ active: false, label: 'לפני שעה' });
  });

  it('same local day, 90+ minutes ago -> "היום", no "נראה" prefix and no clock time', () => {
    const lastSeenAt = new Date(2026, 7, 31, 9, 30, 0);
    expect(describePresenceCompact(lastSeenAt.toISOString(), NOW)).toEqual({ active: false, label: 'היום' });
  });

  it('previous local day -> "אתמול", no "נראה" prefix and no clock time', () => {
    const lastSeenAt = new Date(2026, 7, 30, 9, 30, 0);
    expect(describePresenceCompact(lastSeenAt.toISOString(), NOW)).toEqual({ active: false, label: 'אתמול' });
  });

  it('older than yesterday -> omits the label cleanly, matching describePresence', () => {
    const lastSeenAt = new Date(2026, 7, 20, 9, 30, 0);
    expect(describePresenceCompact(lastSeenAt.toISOString(), NOW)).toEqual({ active: false, label: null });
  });
});
