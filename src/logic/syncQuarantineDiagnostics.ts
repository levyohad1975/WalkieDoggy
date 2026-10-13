export interface QuarantinedDiagnosticItem {
  op?: { type?: unknown; payload?: unknown };
  reason?: unknown;
}

export type QuarantineReasonCode = 'legacy_unknown_owner' | 'legacy_member_delete' | 'other';

export interface ConflictDiagnosticItem {
  op?: { type?: unknown; payload?: unknown };
  code?: unknown;
  message?: unknown;
}

export interface SyncConflictSummary {
  total: number;
  byCode: Array<{ code: string; count: number }>;
  byOperation: Array<{ operationType: string; count: number }>;
  byOperationAndCode: Array<{ operationType: string; code: string; count: number }>;
}

export interface SyncQuarantineSummary {
  total: number;
  byReason: Array<{ code: QuarantineReasonCode; label: string; count: number }>;
  byOperation: Array<{ operationType: string; count: number }>;
}

/** Summarize only allowlisted metadata; never return a quarantine reason, ID, or payload. */
const ALLOWED_OPERATION_TYPES = new Set([
  'createUser', 'upsertUser', 'deleteUser', 'deleteFamilyMember', 'upsertDog',
  'upsertHealthTask', 'upsertGpsSession', 'upsertAchievementUnlock',
  'upsertScheduleRule', 'deleteScheduleRule', 'addScheduleEntries',
  'updateScheduleEntry', 'deleteScheduleEntry', 'saveWalk', 'deleteWalk',
  'updateUserReminderSetting', 'updateUserGamificationSetting',
]);

function safeOperationType(value: unknown): string {
  return typeof value === 'string' && ALLOWED_OPERATION_TYPES.has(value) ? value : 'unknown';
}

export function summarizeSyncConflicts(items: ConflictDiagnosticItem[]): SyncConflictSummary {
  const codeCounts = new Map<string, number>();
  const operationCounts = new Map<string, number>();
  const operationCodeCounts = new Map<string, number>();
  for (const item of items) {
    const code = typeof item.code === 'string' && /^[0-9A-Z]{5}$/.test(item.code) ? item.code : 'unknown';
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    const operationType = safeOperationType(item.op?.type);
    operationCounts.set(operationType, (operationCounts.get(operationType) ?? 0) + 1);
    const key = operationType + '\\u0000' + code;
    operationCodeCounts.set(key, (operationCodeCounts.get(key) ?? 0) + 1);
  }
  return {
    total: items.length,
    byCode: [...codeCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })),
    byOperation: [...operationCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([operationType, count]) => ({ operationType, count })),
    byOperationAndCode: [...operationCodeCounts.entries()]
      .map(([key, count]) => {
        const [operationType, code] = key.split('\\u0000');
        return { operationType, code, count };
      })
      .sort((a, b) => a.operationType.localeCompare(b.operationType) || a.code.localeCompare(b.code)),
  };
}

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
    const safeType = safeOperationType(type);
    operationCounts.set(safeType, (operationCounts.get(safeType) ?? 0) + 1);
  }

  return {
    total: items.length,
    byReason: reasonLabels.map(({ code, label }) => ({ code, label, count: reasonCounts[code] })),
    byOperation: [...operationCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([operationType, count]) => ({ operationType, count })),
  };
}
