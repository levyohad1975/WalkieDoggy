import { summarizeSyncQuarantine } from '../syncQuarantineDiagnostics';

describe('sync quarantine diagnostics', () => {
  it('counts only safe reason categories and operation types, never returns raw payload or reasons', () => {
    const summary = summarizeSyncQuarantine([
      { reason: 'legacy/untagged operation — original actor unknown, never auto-replayed', op: { type: 'saveWalk', payload: { note: 'private walk note' } } },
      { reason: 'legacy deleteFamilyMember entry from a pre-fix app version', op: { type: 'deleteFamilyMember', payload: { userId: 'private-user-id' } } },
      { reason: 'unexpected reason with private details', op: { type: 'saveWalk' } },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.byReason).toEqual([
      { code: 'legacy_unknown_owner', label: 'פעולה ישנה ללא בעלים ידוע', count: 1 },
      { code: 'legacy_member_delete', label: 'פעולת מחיקת חבר ישנה', count: 1 },
      { code: 'other', label: 'סיבה אחרת או לא מסווגת', count: 1 },
    ]);
    expect(summary.byOperation).toEqual([
      { operationType: 'deleteFamilyMember', count: 1 },
      { operationType: 'saveWalk', count: 2 },
    ]);
    expect(JSON.stringify(summary)).not.toContain('private walk note');
    expect(JSON.stringify(summary)).not.toContain('private-user-id');
    expect(JSON.stringify(summary)).not.toContain('unexpected reason');
  });

  it('hides malformed operation type strings instead of displaying persisted content', () => {
    expect(summarizeSyncQuarantine([{ reason: null, op: { type: 'name: private data' } }]).byOperation)
      .toEqual([{ operationType: 'unknown', count: 1 }]);
  });
});
