/**
 * P1 — Home today/tomorrow date ambiguity.
 *
 * Pure, single shared helper for the compact "היום · 07:00" / "מחר · 07:00"
 * style label used by BOTH the "next walk" and "last walk" cards on Home —
 * previously each just printed `walk.scheduledTime` on its own with no date
 * context, so two genuinely different-day walks could show the identical
 * "07:00" and read as duplicates. This is a pure DISPLAY helper only — it
 * does not change, and must never be used to change, which walk
 * computeNextWalk()/computeLastWalk() (src/logic/nextWalk.ts) picks.
 *
 * `date` is the walk's local calendar date as already stored on the Walk
 * type (`YYYY-MM-DD`, no time/zone component — see types.ts) — parsed with
 * an explicit `T00:00:00` local-time suffix, matching how the rest of the
 * app already parses this same field (see WalkRow.tsx's date rendering)
 * rather than relying on `new Date('YYYY-MM-DD')`'s UTC-midnight parsing,
 * which can land on the wrong local calendar day near a timezone boundary.
 */

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * @param isoDate a `YYYY-MM-DD` local calendar date (Walk.date).
 * @param now injectable for tests; defaults to the real current time.
 * @returns a short Hebrew label: "היום", "מחר", "אתמול", or a compact
 *   DD/MM date for anything further away — never a full weekday/year, to
 *   stay compact on a card.
 */
export function walkDateContextLabel(isoDate: string, now: Date = new Date()): string {
  const target = startOfDay(new Date(`${isoDate}T00:00:00`));
  const today = startOfDay(now);

  // Compare calendar days in UTC space so DST transitions cannot turn a
  // one-day local calendar difference into 23/25 hours and skew the label.
  const targetDay = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((targetDay - todayDay) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'היום';
  if (diffDays === 1) return 'מחר';
  if (diffDays === -1) return 'אתמול';

  // Do not delegate the separator to Intl: some JS/OS implementations
  // render Hebrew numeric dates as DD.MM while the product format is DD/MM.
  const day = String(target.getDate()).padStart(2, '0');
  const month = String(target.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

/**
 * Combines walkDateContextLabel() with the walk's scheduled time into the
 * exact compact string both Home cards render, e.g. "היום · 07:00" /
 * "מחר · 07:00" / "12/09 · 07:00" — the ONE function both cards call, so the
 * format can never drift between them.
 */
export function walkTimeWithDateContext(isoDate: string, scheduledTime: string, now: Date = new Date()): string {
  return `${walkDateContextLabel(isoDate, now)} · ${scheduledTime}`;
}
