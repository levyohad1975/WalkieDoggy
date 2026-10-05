import type { ScheduleEntry, ScheduleRule, Walk } from '../types';
import { localDateOnly } from './dateFormat';
import { computeNextWalk, walkDateTime } from './nextWalk';

/**
 * TEMPORARY P0 DIAGNOSTIC (real-device QA round 5) — the b58d6fb
 * pending-outranks-skipped fix did NOT resolve the real-iPhone symptom: a
 * confirmed TODAY 14:00 occurrence (visible on the Schedule screen) is
 * still absent from Home's "next walk" selection, which instead shows
 * TOMORROW's occurrence. Every hypothesis tested so far (computeNextWalk,
 * dedupeCanonicalWalks, finalizeSupersededPendingWalks, the orphan-repair
 * generation path, the full store+repository stack) reproduced CORRECTLY
 * against synthetic data — so this round adds READ-ONLY, real-device
 * instrumentation instead of another speculative fix: a report, triggered
 * from Home, that traces today's (and tomorrow's, for comparison)
 * occurrences through every stage this app actually has data for —
 * schedule_rules, schedule_entries, the merged-pre-dedupe walk list,
 * post-dedupe, and the live Zustand `walks` state computeNextWalk
 * consumes — and states exactly where each occurrence's canonical walk
 * stopped being visible, or why computeNextWalk did not select it.
 *
 * Remove this file, its call site in offlineFirstRepository.ts
 * (debugWalksTrace), and the temporary diagnostic button/modal in
 * HomeScreen.tsx / WalkPipelineDiagnosticsModal.tsx once the real root
 * cause for THIS symptom is identified and fixed.
 */

export interface WalkTraceEntry {
  id: string;
  scheduleEntryId?: string;
  date: string;
  scheduledTime: string;
  status: Walk['status'];
  origin: 'remote' | 'local-only';
  isPendingInQueue: boolean;
  conflict?: { code?: string; message: string; failedAt: string };
}

export interface WalksDebugTrace {
  familyId: string;
  fetchedAt: string;
  isOnline: boolean;
  remoteFetchError?: string;
  /** Every walk the remote (Supabase) currently reports for this family — empty if offline or the fetch failed. */
  remoteWalks: WalkTraceEntry[];
  /** Every walk in this device's local cache, annotated with queue/conflict state. */
  localWalks: WalkTraceEntry[];
  /** What getWalks() merges BEFORE running dedupeCanonicalWalks — mirrors its own online/offline branch exactly. */
  mergedBeforeDedupe: WalkTraceEntry[];
  /** What getWalks() actually returns after dedupeCanonicalWalks. */
  afterDedupe: WalkTraceEntry[];
}

/** Used by OfflineFirstRepository.debugWalksTrace to build each WalkTraceEntry — kept here so it's testable without touching the repository. */
export function toWalkTraceEntry(walk: Walk, origin: 'remote' | 'local-only', isPendingInQueue: boolean, conflict?: WalkTraceEntry['conflict']): WalkTraceEntry {
  return {
    id: walk.id,
    scheduleEntryId: walk.scheduleEntryId,
    date: walk.date,
    scheduledTime: walk.scheduledTime,
    status: walk.status,
    origin,
    isPendingInQueue,
    conflict,
  };
}

/**
 * Diagnostic-only mirror of dedupeCanonicalWalks's exact rank table
 * (src/logic/nextWalk.ts) applied to WalkTraceEntry instead of Walk, so
 * this read-only instrument can show "would this survive dedupe" without
 * importing/casting through the real function — this round must not
 * modify dedupeCanonicalWalks's signature or behavior at all. MUST be
 * kept numerically identical to nextWalk.ts's statusRank; it is checked
 * against it directly in this module's own test file.
 */
const DIAGNOSTIC_STATUS_RANK: Record<Walk['status'], number> = { skipped: 0, pending: 1, in_progress: 2, done: 3 };

export function dedupeTraceEntries(entries: WalkTraceEntry[]): WalkTraceEntry[] {
  const canonicalByEntry = new Map<string, WalkTraceEntry>();
  for (const entry of entries) {
    if (!entry.scheduleEntryId) continue;
    const current = canonicalByEntry.get(entry.scheduleEntryId);
    if (!current || DIAGNOSTIC_STATUS_RANK[entry.status] > DIAGNOSTIC_STATUS_RANK[current.status]) {
      canonicalByEntry.set(entry.scheduleEntryId, entry);
    }
  }
  const kept = new Set(canonicalByEntry.values());
  return entries.filter((entry) => !entry.scheduleEntryId || kept.has(entry));
}

/**
 * Builds the full, human-readable (plain text, not Hebrew — this is an
 * internal diagnostic, not user-facing copy) pipeline report for today's
 * and tomorrow's occurrences. Pure and synchronous — takes already-fetched
 * data, never calls the repository itself, so it stays unit-testable.
 */
export function buildWalkPipelineReport(params: {
  now: Date;
  familyId: string;
  rules: ScheduleRule[];
  entries: ScheduleEntry[];
  trace: WalksDebugTrace;
  /** The LIVE useScheduleStore `walks` array — what computeNextWalk and Home actually consume. */
  storeWalks: Walk[];
}): string {
  const { now, familyId, rules, entries, trace, storeWalks } = params;
  const today = localDateOnly(now);
  const tomorrow = localDateOnly(new Date(now.getTime() + 86400000));
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`=== Walk pipeline diagnostic — P0 round 5 ===`);
  push(`generatedAt: ${new Date().toISOString()}`);
  push(`familyId: ${familyId}`);
  push(`"now" used for selection: ${now.toISOString()} (local today=${today}, local tomorrow=${tomorrow})`);
  push(`trace.fetchedAt: ${trace.fetchedAt}`);
  push(`trace.isOnline: ${trace.isOnline}`);
  if (trace.remoteFetchError) push(`trace.remoteFetchError: ${trace.remoteFetchError}`);
  push('');

  push(`--- schedule_rules (configuration, not occurrence data) ---`);
  if (rules.length === 0) push('(none)');
  for (const r of rules) {
    push(`rule ${r.id}: time=${r.time} active=${r.active} daysOfWeek=[${r.daysOfWeek.join(',')}] dogId=${r.dogId}`);
  }
  push('');

  for (const [label, date] of [['TODAY', today], ['TOMORROW', tomorrow]] as const) {
    push(`--- ${label} (${date}) schedule_entries (actual occurrence data) ---`);
    const dayEntries = entries.filter((e) => e.date === date);
    if (dayEntries.length === 0) push('(no schedule_entries for this date — a rule can exist without a generated entry; see rules list above)');
    for (const entry of dayEntries) {
      const rule = entry.ruleId ? rules.find((r) => r.id === entry.ruleId) : undefined;
      push(
        `entry ${entry.id}: time=${entry.time} ruleId=${entry.ruleId ?? '(none — legacy/manual entry)'} ` +
          `ruleFound=${entry.ruleId ? Boolean(rule) : 'n/a'} ruleActive=${rule ? rule.active : 'n/a'} dogId=${entry.dogId}`
      );

      const merged = trace.mergedBeforeDedupe.filter((w) => w.scheduleEntryId === entry.id);
      const after = trace.afterDedupe.filter((w) => w.scheduleEntryId === entry.id);
      const inStore = storeWalks.filter((w) => w.scheduleEntryId === entry.id);

      if (merged.length === 0) {
        push(`  -> NO WALK references this entry at the getWalks() merge stage at all (never generated, or already pruned from local cache before this read).`);
      } else {
        for (const w of merged) {
          const survived = after.some((a) => a.id === w.id);
          push(
            `  walk ${w.id} [${w.origin}]: status=${w.status} queued=${w.isPendingInQueue} ` +
              `conflict=${w.conflict ? `${w.conflict.code ?? '?'}: ${w.conflict.message}` : 'none'} ` +
              `-> ${survived ? 'SURVIVED dedupe' : 'DISCARDED by dedupe (a higher-ranked walk for this same entry won)'}`
          );
        }
      }

      if (after.length > 1) {
        push(`  !! INVARIANT VIOLATION: ${after.length} walks for this one entry survived dedupe (expected at most 1).`);
      }

      if (inStore.length === 0) {
        push(`  -> store.walks: ABSENT (repository.getWalks() returned ${after.length} for this entry, but the live store has none — dropped between the repository read and the store, or a later load() overwrote it).`);
      } else {
        for (const w of inStore) {
          push(`  -> store.walks: walk ${w.id} status=${w.status} date=${w.date} scheduledTime=${w.scheduledTime}`);
        }
      }
      push('');
    }
  }

  push(`--- computeNextWalk verdict ---`);
  const selected = computeNextWalk(storeWalks, now);
  push(`selected: ${selected ? `walk ${selected.id} (entry ${selected.scheduleEntryId ?? 'unplanned'}, ${selected.date} ${selected.scheduledTime}, status=${selected.status})` : '(none)'}`);
  push('');

  push(`--- why each TODAY/TOMORROW entry's walk did or did not win ---`);
  for (const date of [today, tomorrow]) {
    const dayEntries = entries.filter((e) => e.date === date);
    for (const entry of dayEntries) {
      const w = storeWalks.find((x) => x.scheduleEntryId === entry.id);
      if (!w) {
        push(`entry ${entry.id} (${date} ${entry.time}): no walk in store.walks — cannot be a computeNextWalk candidate at all.`);
        continue;
      }
      if (w.id === selected?.id) {
        push(`entry ${entry.id}: walk ${w.id} IS the selected walk.`);
        continue;
      }
      if (w.status === 'in_progress') {
        push(`entry ${entry.id}: walk ${w.id} is in_progress but was not selected — unexpected, computeNextWalk always prefers in_progress.`);
        continue;
      }
      if (w.status !== 'pending') {
        push(`entry ${entry.id}: walk ${w.id} status is '${w.status}', not 'pending' — not eligible as a next-walk candidate.`);
        continue;
      }
      const activeWalk = storeWalks.find((x) => x.status === 'in_progress');
      if (activeWalk) {
        push(`entry ${entry.id}: walk ${w.id} is pending but an in_progress walk (${activeWalk.id}) takes priority.`);
        continue;
      }
      const thisTime = walkDateTime(w).getTime();
      const isOverdue = thisTime < now.getTime();
      const pending = storeWalks.filter((x) => x.status === 'pending');
      const overdue = pending.filter((x) => walkDateTime(x).getTime() < now.getTime());
      if (!isOverdue && overdue.length > 0) {
        const latest = [...overdue].sort((a, b) => walkDateTime(b).getTime() - walkDateTime(a).getTime())[0];
        push(
          `entry ${entry.id}: walk ${w.id} is a FUTURE pending walk, but ${overdue.length} OVERDUE pending walk(s) exist ` +
            `(most recent: ${latest.id} at ${latest.date} ${latest.scheduledTime}) — overdue walks always win over future ones.`
        );
        continue;
      }
      const candidates = isOverdue ? overdue : pending.filter((x) => walkDateTime(x).getTime() >= now.getTime());
      const earlier = candidates.filter((x) => x.id !== w.id && (isOverdue ? walkDateTime(x).getTime() > thisTime : walkDateTime(x).getTime() < thisTime));
      if (earlier.length > 0) {
        push(
          `entry ${entry.id}: walk ${w.id} lost the earliest-first tiebreak to ${earlier.length} other candidate(s), e.g. ${earlier[0].id} at ${earlier[0].date} ${earlier[0].scheduledTime}.`
        );
        continue;
      }
      push(`entry ${entry.id}: walk ${w.id} looks like it SHOULD have been selected (pending, no in_progress walk, no earlier candidate) — if it wasn't, re-check this report's own logic against computeNextWalk's.`);
    }
  }

  return lines.join('\n');
}
