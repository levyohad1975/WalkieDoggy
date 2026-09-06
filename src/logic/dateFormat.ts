/**
 * Shared date-display helpers. Deliberately separate from rotation.ts's
 * `toDateOnly()`, which is UTC-anchored on purpose for internal date
 * arithmetic (rotation generation, day-of-week math) — this file is for
 * VIEWER-FACING date formatting, where "today" must mean the viewer's own
 * local calendar day, not the UTC one. Using `toDateOnly(new Date())` for a
 * "is this today" check is the classic off-by-one bug: for someone in a
 * timezone ahead of UTC (e.g. Israel), a few hours after midnight local time
 * is still "yesterday" in UTC, which would wrongly fail to show "היום".
 */

/** Local (not UTC) "YYYY-MM-DD" for a given moment — defaults to right now. */
export function localDateOnly(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * "YYYY-MM-DD" -> "DD-MM-YYYY" (the app's required History date format), or
 * "היום" when `isoDate` is the viewer's local today. `now` is injectable for
 * tests; defaults to the real current moment.
 */
export function formatHistoryDate(isoDate: string, now: Date = new Date()): string {
  if (isoDate === localDateOnly(now)) return 'היום';
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}
