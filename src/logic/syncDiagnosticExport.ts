type DiagnosticOperation = {
  op?: { type?: unknown; payload?: unknown };
  code?: unknown;
  httpStatus?: unknown;
  claimedByUserId?: unknown;
};

type DiagnosticRecord = {
  safeOperationId: string;
  operationType: string;
  source: 'permanent_failure' | 'quarantine';
  sqlstate: string | null;
  httpStatus: number | null;
  ownershipEvidence: { status: 'unknown_legacy_owner' | 'not_recorded' | 'queue_actor_tag'; actorId?: string };
  relationships: Record<string, string | string[]>;
  serverReconciliation: 'awaiting_read_only_staging_match' | 'unknown_ownership';
};

const ALLOWED_TYPES = new Set([
  'createUser', 'upsertUser', 'deleteUser', 'deleteFamilyMember', 'upsertDog',
  'upsertHealthTask', 'upsertGpsSession', 'upsertAchievementUnlock',
  'upsertScheduleRule', 'deleteScheduleRule', 'addScheduleEntries',
  'updateScheduleEntry', 'deleteScheduleEntry', 'saveWalk', 'deleteWalk',
  'updateUserReminderSetting', 'updateUserGamificationSetting',
]);

const RELATION_KEYS: Record<string, string[]> = {
  createUser: ['id', 'familyId'],
  upsertUser: ['id', 'familyId'],
  deleteUser: ['userId'],
  deleteFamilyMember: ['familyId', 'userId', 'requestedByUserId'],
  upsertDog: ['id', 'familyId'],
  upsertHealthTask: ['id', 'familyId', 'dogId'],
  upsertGpsSession: ['id', 'familyId', 'dogId', 'walkId', 'createdByUserId'],
  upsertAchievementUnlock: ['id', 'familyId', 'userId'],
  upsertScheduleRule: ['id', 'familyId', 'dogId'],
  deleteScheduleRule: ['ruleId'],
  addScheduleEntries: ['id', 'familyId', 'dogId', 'ruleId', 'responsibleUserId'],
  updateScheduleEntry: ['id', 'familyId', 'dogId', 'ruleId', 'responsibleUserId'],
  deleteScheduleEntry: ['entryId'],
  saveWalk: ['id', 'familyId', 'dogId', 'scheduleEntryId', 'responsibleUserId'],
  deleteWalk: ['walkId'],
  updateUserReminderSetting: ['userId'],
  updateUserGamificationSetting: ['userId'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function operationRows(value: unknown): Array<Record<string, unknown>> {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

function safeHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `op-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function relationshipsFor(type: string, payload: unknown): Record<string, string | string[]> {
  const keys = RELATION_KEYS[type] ?? [];
  const rows = operationRows(payload);
  const result: Record<string, string | string[]> = {};
  for (const key of keys) {
    const ids = rows.map((row) => safeUuid(row[key])).filter((id): id is string => id !== null);
    if (ids.length === 1) result[key] = ids[0];
    else if (ids.length > 1) result[key] = ids;
  }
  return result;
}

function recordFor(item: DiagnosticOperation, source: DiagnosticRecord['source'], ordinal: number): DiagnosticRecord {
  const rawType = item.op?.type;
  const operationType = typeof rawType === 'string' && ALLOWED_TYPES.has(rawType) ? rawType : 'unknown';
  const relationships = relationshipsFor(operationType, item.op?.payload);
  const sqlstate = typeof item.code === 'string' && /^[0-9A-Z]{5}$/.test(item.code) ? item.code : null;
  const httpStatus = typeof item.httpStatus === 'number' && Number.isInteger(item.httpStatus) && item.httpStatus >= 100 && item.httpStatus <= 599
    ? item.httpStatus : null;
  const actorId = safeUuid(item.claimedByUserId);
  const ownershipEvidence: DiagnosticRecord['ownershipEvidence'] = source === 'quarantine'
    ? { status: 'unknown_legacy_owner' }
    : actorId
      ? { status: 'queue_actor_tag', actorId }
      : { status: 'not_recorded' };
  const identity = JSON.stringify([source, ordinal, operationType, relationships]);
  return {
    safeOperationId: safeHash(identity),
    operationType,
    source,
    sqlstate,
    httpStatus,
    ownershipEvidence,
    relationships,
    serverReconciliation: source === 'quarantine' ? 'unknown_ownership' : 'awaiting_read_only_staging_match',
  };
}

/**
 * Builds a device-local, read-only export. It intentionally excludes operation
 * messages, quarantine reasons, timestamps, and every non-allowlisted payload
 * field. UUID relationships are included for a later read-only Staging match.
 */
export function buildSyncDiagnosticExport(
  conflicts: DiagnosticOperation[],
  quarantined: DiagnosticOperation[],
  generatedAt = new Date().toISOString(),
) {
  const records = [
    ...conflicts.map((item, index) => recordFor(item, 'permanent_failure', index + 1)),
    ...quarantined.map((item, index) => recordFor(item, 'quarantine', index + 1)),
  ];
  return {
    format: 'walkie-sync-reconciliation-v1',
    generatedAt,
    environment: 'staging',
    dataSource: 'device-local',
    reconciliationStatus: 'not_reconciled_server_read_required',
    counts: { permanentFailures: conflicts.length, quarantined: quarantined.length, total: records.length },
    serverManifest: {
      verifiedMatches: [] as DiagnosticRecord[],
      missingRecords: [] as DiagnosticRecord[],
      conflicts: [] as DiagnosticRecord[],
      unknownOwnership: records.filter((record) => record.ownershipEvidence.status !== 'queue_actor_tag'),
      awaitingReadOnlyMatch: records.filter((record) => record.serverReconciliation === 'awaiting_read_only_staging_match'),
    },
    records,
  };
}
