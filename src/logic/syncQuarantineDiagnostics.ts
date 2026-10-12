export interface QuarantinedDiagnosticItem {
  op?: { type?: unknown; payload?: unknown };
  reason?: unknown;
}

export type QuarantineReasonCode = 'legacy_unknown_owner' | 'legacy_member_delete' | 'other';

export interface SyncQuarantineSummary {
  total: number;
  byReason: Array<{ code: QuarantineReasonCode; label: string; count: number }>;
  byOperation: Array<{ operationType: string; count: number }>;
}

/** Summarize only allowlisted metadata; never return a quarantine reason, ID, or payload. */
export function summarizeSyncQuarantine(items: QuarantinedDiagnosticItem[]): SyncQuarantineSummary {
  const reasonLabels: Array<{ code: QuarantineReasonCode; label: string }> = [
    { code: 'legacy_unknown_owner', label: 'פעולה ישנה ללא בעלים ידוע' },
    { code: 'legacy_member_delete', label: 'פעולת מחיקת חבר ישנה' },
    { code: 'other', label: 'סיבה אחרת או לא מסווגת' },
  ];
  const reasonCounts: Record<QuarantineReasonCode, number> = {
    legacy_unknown_owner: 0,
    legacy_member_delete: 0,
    other: 0,
  };
  const allowedOperationTypes = new Set([
    'createUser', 'upsertUser', 'deleteUser', 'deleteFamilyMember', 'upsertDog',
    'upsertHealthTask', 'upsertGpsSession', 'upsertAchievementUnlock',
    'upsertScheduleRule', 'deleteScheduleRule', 'addScheduleEntries',
    'updateScheduleEntry', 'deleteScheduleEntry', 'saveWalk', 'deleteWalk',
    'updateUserReminderSetting', 'updateUserGamificationSetting',
  ]);
  const operationCounts = new Map<string, number>();

  for (const item of items) {
    const reason = typeof item.reason === 'string' ? item.reason : '';
    const reasonCode: QuarantineReasonCode = reason.startsWith('legacy/untagged operation')
      ? 'legacy_unknown_owner'
      : reason.startsWith('legacy deleteFamilyMember entry')
        ? 'legacy_member_delete'
        : 'other';
    reasonCounts[reasonCode]++;

    const type = item.op?.type;
    const safeType = typeof type === 'string' && allowedOperationTypes.has(type) ? type : 'unknown';
    operationCounts.set(safeType, (operationCounts.get(safeType) ?? 0) + 1);
  }

  return {
    total: items.length,
    byReason: reasonLabels.map(({ code, label }) => ({ code, label, count: reasonCounts[code] })),
    byOperation: [...operationCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([operationType, count]) => ({ operationType, count })),
  };
}
