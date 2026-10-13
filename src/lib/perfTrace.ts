/**
 * TEMPORARY DIAGNOSTIC INSTRUMENTATION — Staging-only, added specifically
 * to find the real cause of the Schedule-save "~10 seconds" delay that
 * two rounds of network-round-trip-based fixes (6a369d8, e42936f) did not
 * move. Remove this module and every perfMark()/perfReport() call site
 * once the real bottleneck is confirmed fixed by an actual real-device
 * measurement — this is not meant to ship long-term.
 *
 * A dead-simple, zero-dependency timestamp log: call perfMark(label) at
 * each checkpoint of a single save attempt, perfReset() at the very start
 * of that attempt, and perfReport() to render the full ordered list with
 * per-step and cumulative-since-start deltas as one plain string.
 *
 * Deliberately global/module-level rather than threaded through every
 * function's return value: the whole save path (RuleFormModal -> onSave
 * -> scheduleStore.addRule -> OfflineFirstRepository ->
 * SupabaseRepository) runs on one JS thread inside a single await chain,
 * so a shared ordered log is simpler and less invasive than plumbing a
 * trace object through every signature, for something explicitly meant
 * to be deleted again shortly.
 */
interface PerfMarkEntry {
  label: string;
  t: number;
}

let marks: PerfMarkEntry[] = [];

export function perfReset(): void {
  marks = [];
}

export function perfMark(label: string): void {
  const t = Date.now();
  marks.push({ label, t });
  // eslint-disable-next-line no-console
  console.log(`[perf] +${marks.length > 1 ? t - marks[0].t : 0}ms ${label}`);
}

export function perfReport(): string {
  if (marks.length === 0) return '(no perf marks recorded)';
  const t0 = marks[0].t;
  return marks
    .map((m, i) => {
      const sincePrev = i === 0 ? 0 : m.t - marks[i - 1].t;
      const sinceStart = m.t - t0;
      return `+${sinceStart}ms (Δ${sincePrev}ms) ${m.label}`;
    })
    .join('\n');
}
