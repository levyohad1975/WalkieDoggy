import type { DuplicateActiveWalkReviewRecord } from '../data/repository';

export const TEST_DUPLICATE_RESOLUTION_RATIONALE =
  'Family Admin confirmed the selected test-generated duplicate active walks; no canonical walk selected.';

export interface DuplicateActiveWalkGroup {
  familyId: string;
  dogId: string;
  records: DuplicateActiveWalkReviewRecord[];
  walkIds: string[];
}

/** Group only the current family's unresolved active rows, by dog. */
export function getDuplicateActiveWalkGroups(
  records: DuplicateActiveWalkReviewRecord[],
  familyId: string,
): DuplicateActiveWalkGroup[] {
  const byDog = new Map<string, DuplicateActiveWalkReviewRecord[]>();
  for (const record of records) {
    if (record.familyId !== familyId || record.status !== 'in_progress' || record.duplicateResolutionGroupId) continue;
    const group = byDog.get(record.dogId) ?? [];
    group.push(record);
    byDog.set(record.dogId, group);
  }
  return [...byDog.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([dogId, group]) => ({
      familyId,
      dogId,
      records: [...group].sort((a, b) => (a.createdAt ?? a.startedAt ?? '').localeCompare(b.createdAt ?? b.startedAt ?? '') || a.walkId.localeCompare(b.walkId)),
      walkIds: group.map((record) => record.walkId).sort(),
    }))
    .sort((a, b) => a.dogId.localeCompare(b.dogId));
}

export type DuplicateResolutionReadiness = 'ready' | 'missing_records' | 'already_resolved' | 'invalid_group';

export function getDuplicateResolutionReadiness(
  records: DuplicateActiveWalkReviewRecord[],
  familyId: string,
  walkIds: string[],
): DuplicateResolutionReadiness {
  const byId = new Map(records.map((record) => [record.walkId, record]));
  if (walkIds.length < 2 || new Set(walkIds).size !== walkIds.length || walkIds.some((id) => !byId.has(id))) return 'missing_records';
  const selected = walkIds.map((id) => byId.get(id)!);
  if (selected.some((record) => record.familyId !== familyId || record.status !== 'in_progress'
      || record.duplicateResolutionGroupId)) return 'already_resolved';
  if (new Set(selected.map((record) => record.dogId)).size !== 1) return 'invalid_group';
  return 'ready';
}

export function canOpenDuplicateResolution(input: {
  staging: boolean;
  configured: boolean;
  familyId: string | null;
  profileId: string | null;
  familyRole: string | null;
  impersonating: boolean;
  systemObserver: boolean;
  testMode: boolean;
}): boolean {
  return input.staging && input.configured && !!input.familyId && !!input.profileId
    && input.familyRole === 'admin' && !input.impersonating && !input.systemObserver && !input.testMode;
}

export type DuplicateResolutionErrorKind = 'permission' | 'migration' | 'network' | 'other';

export function getDuplicateResolutionErrorKind(error: unknown): DuplicateResolutionErrorKind {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = typeof value?.code === 'string' ? value.code.toUpperCase() : '';
  const message = typeof value?.message === 'string' ? value.message.toLowerCase() : String(error ?? '').toLowerCase();
  if (code === '42501' || /family admin required|active profile required|permission denied|not authorized/.test(message)) return 'permission';
  if (code === '42883' || code === '42703' || code === 'PGRST202' || /could not find the function|function .* does not exist|schema cache|column .* does not exist/.test(message)) return 'migration';
  if (/network|failed to fetch|fetch failed|timeout|timed out|connection lost|load failed/.test(message)) return 'network';
  return 'other';
}

export function getDuplicateResolutionErrorMessage(error: unknown): string {
  const rawMessage = typeof (error as { message?: unknown } | null)?.message === 'string'
    ? (error as { message: string }).message : '';
  if (/no resolution request was sent/i.test(rawMessage)) {
    return 'המכשיר אינו מחובר. לא נשלחה בקשת שינוי; התחברו לרשת ובדקו שוב.';
  }
  switch (getDuplicateResolutionErrorKind(error)) {
    case 'permission': return 'השרת לא אישר את פעולת מנהל/ת המשפחה. לא בוצע שינוי; ודאו שהפרופיל הפעיל הוא מנהל/ת.';
    case 'migration': return 'תשתית פתרון הכפילויות עדיין לא זמינה ב-Staging. לא בוצע שינוי; יש להשלים את המיגרציה המאושרת.';
    case 'network': return 'לא התקבלה תשובת שרת. ייתכן שהפעולה הושלמה; נסו שוב כדי לבדוק בבטחה עם אותו מזהה פעולה.';
    default: return 'השרת לא אישר את הפעולה. הרשומות נשארו ללא שינוי; בדקו את הנתונים ונסו שוב רק לאחר בירור.';
  }
}

export function getDuplicateResolutionReviewErrorMessage(error: unknown): string {
  switch (getDuplicateResolutionErrorKind(error)) {
    case 'permission': return 'לא ניתן לקרוא את רשומות הבדיקה בהרשאות הנוכחיות. לא נשלחה בקשת שינוי.';
    case 'migration': return 'שדות או פונקציות המיגרציה אינם זמינים ב-Staging. לא נשלחה בקשת שינוי.';
    case 'network': return 'לא ניתן לאמת את הרשומות מול Staging כרגע. לא נשלחה בקשת שינוי.';
    default: return 'לא ניתן לאמת את רשומות הבדיקה מול Staging. לא נשלחה בקשת שינוי.';
  }
}
