import { buildSyncDiagnosticExport } from '../syncDiagnosticExport';

const familyId = '226f9962-98ea-4406-bb81-2787156f5426';
const dogId = 'e38c92fd-01e8-4db7-81a0-45e64b7c5d94';

describe('sanitized sync reconciliation export', () => {
  it('includes only allowlisted IDs and failure metadata, with ownership and reconciliation left explicit', () => {
    const result = buildSyncDiagnosticExport(
      [{
        code: '23503',
        httpStatus: 409,
        claimedByUserId: '963e4567-e89b-42d3-a456-426614174000',
        message: 'secret token private name and note',
        op: { type: 'saveWalk', payload: { id: '563e4567-e89b-42d3-a456-426614174000', familyId, dogId, responsibleUserId: '663e4567-e89b-42d3-a456-426614174000', note: 'private route' } },
      }],
      [{
        reason: 'legacy unowned operation contains private content',
        op: { type: 'saveWalk', payload: { id: '763e4567-e89b-42d3-a456-426614174000', familyId, dogId, note: 'private route' } },
      }],
      '2026-10-12T14:00:00.000Z',
    );

    expect(result.counts).toEqual({ permanentFailures: 1, quarantined: 1, total: 2 });
    expect(result.reconciliationStatus).toBe('not_reconciled_server_read_required');
    expect(result.records[0]).toMatchObject({
      operationType: 'saveWalk',
      source: 'permanent_failure',
      sqlstate: '23503',
      httpStatus: 409,
      relationships: { familyId, dogId, responsibleUserId: '663e4567-e89b-42d3-a456-426614174000' },
      ownershipEvidence: { status: 'queue_actor_tag', actorId: '963e4567-e89b-42d3-a456-426614174000' },
      serverReconciliation: 'awaiting_read_only_staging_match',
    });
    expect(result.records[1]).toMatchObject({
      ownershipEvidence: { status: 'unknown_legacy_owner' },
      serverReconciliation: 'unknown_ownership',
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of ['secret token', 'private name', 'private route', 'legacy unowned operation']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(result.serverManifest.unknownOwnership).toHaveLength(1);
    expect(result.serverManifest.awaitingReadOnlyMatch).toHaveLength(1);
  });

  it('omits malformed IDs, SQLSTATEs, HTTP status, and operation types instead of exporting arbitrary strings', () => {
    const result = buildSyncDiagnosticExport(
      [{ code: 'email@example.com', httpStatus: 9999, op: { type: 'name: private', payload: { id: 'private name', familyId: 'token' } } }],
      [],
    );
    expect(result.records[0]).toMatchObject({
      operationType: 'unknown',
      sqlstate: null,
      httpStatus: null,
      relationships: {},
    });
  });
});
