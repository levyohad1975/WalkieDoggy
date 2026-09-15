import { validateAndRoutePushEvent, type RequestRowForPush } from '../pushRouting';

function swapRow(overrides: Partial<RequestRowForPush> = {}): RequestRowForPush {
  return {
    id: 'req1',
    kind: 'swap',
    familyId: 'fam1',
    status: 'pending',
    requestedByUserId: 'requester',
    targetUserId: 'target',
    ...overrides,
  };
}

function timeChangeRow(overrides: Partial<RequestRowForPush> = {}): RequestRowForPush {
  return {
    id: 'req2',
    kind: 'timeChange',
    familyId: 'fam1',
    status: 'pending',
    requestedByUserId: 'requester',
    ...overrides,
  };
}

describe('validateAndRoutePushEvent — swap requests', () => {
  it('routes a new swap request to the target when the requester reports it', () => {
    const result = validateAndRoutePushEvent(swapRow(), 'created', {
      callerUserId: 'requester',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
    });
    expect(result).toMatchObject({ authorized: true, recipientUserIds: ['target'] });
  });

  it('rejects a "created" report from anyone other than the actual requester (cannot route to an unrelated user)', () => {
    const result = validateAndRoutePushEvent(swapRow(), 'created', {
      callerUserId: 'someone-else',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
    });
    expect(result.authorized).toBe(false);
    expect(result.recipientUserIds).toEqual([]);
  });

  it('routes an approved decision back to the requester, only when the actual target reports it', () => {
    const row = swapRow({ status: 'approved' });
    const good = validateAndRoutePushEvent(row, 'approved', {
      callerUserId: 'target',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
    });
    expect(good).toMatchObject({ authorized: true, recipientUserIds: ['requester'] });

    const bad = validateAndRoutePushEvent(row, 'approved', {
      callerUserId: 'requester', // the requester can't report their own approval
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
    });
    expect(bad.authorized).toBe(false);
  });

  it('rejects an event whose claimed status does not match the persisted row (cannot fake "approved" on a still-pending request)', () => {
    const row = swapRow({ status: 'pending' });
    const result = validateAndRoutePushEvent(row, 'approved', {
      callerUserId: 'target',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
    });
    expect(result.authorized).toBe(false);
  });

  it('rejects a cross-family caller outright', () => {
    const result = validateAndRoutePushEvent(swapRow(), 'created', {
      callerUserId: 'requester',
      callerFamilyId: 'a-different-family',
      callerIsAdmin: false,
    });
    expect(result.authorized).toBe(false);
  });

  it('drops a resolved recipient who is not confirmed to be in the same family (defense in depth)', () => {
    const result = validateAndRoutePushEvent(swapRow(), 'created', {
      callerUserId: 'requester',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
      // "target" is claimed to belong to a different family than the request.
      recipientFamilyIds: { target: 'a-different-family' },
    });
    expect(result.authorized).toBe(false);
    expect(result.recipientUserIds).toEqual([]);
  });

  it('keeps a recipient confirmed to be in the same family', () => {
    const result = validateAndRoutePushEvent(swapRow(), 'created', {
      callerUserId: 'requester',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
      recipientFamilyIds: { target: 'fam1' },
    });
    expect(result).toMatchObject({ authorized: true, recipientUserIds: ['target'] });
  });
});

describe('validateAndRoutePushEvent — time-change requests', () => {
  it('routes a new time-change request to every current admin (the one legitimate multi-recipient case)', () => {
    const result = validateAndRoutePushEvent(timeChangeRow(), 'created', {
      callerUserId: 'requester',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
      familyAdminUserIds: ['admin1', 'admin2', 'admin1'],
    });
    expect(result.authorized).toBe(true);
    expect(result.recipientUserIds.sort()).toEqual(['admin1', 'admin2']);
  });

  it('rejects a decision report from a non-admin caller', () => {
    const row = timeChangeRow({ status: 'rejected' });
    const result = validateAndRoutePushEvent(row, 'rejected', {
      callerUserId: 'not-an-admin',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
    });
    expect(result.authorized).toBe(false);
  });

  it('routes a decided time-change request back to the requester only, never all admins, when an admin reports it', () => {
    const row = timeChangeRow({ status: 'approved' });
    const result = validateAndRoutePushEvent(row, 'approved', {
      callerUserId: 'admin1',
      callerFamilyId: 'fam1',
      callerIsAdmin: true,
      familyAdminUserIds: ['admin1', 'admin2'],
    });
    expect(result).toMatchObject({ authorized: true, recipientUserIds: ['requester'] });
  });

  it('resolves no recipients (and denies) for a new time-change request when no admin list is provided at all', () => {
    const result = validateAndRoutePushEvent(timeChangeRow(), 'created', {
      callerUserId: 'requester',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
    });
    expect(result.authorized).toBe(false);
    expect(result.recipientUserIds).toEqual([]);
  });

  it('never broadcasts a swap request with no target to anyone', () => {
    const row = swapRow({ targetUserId: undefined });
    const result = validateAndRoutePushEvent(row, 'created', {
      callerUserId: 'requester',
      callerFamilyId: 'fam1',
      callerIsAdmin: false,
    });
    expect(result.authorized).toBe(false);
    expect(result.recipientUserIds).toEqual([]);
  });
});
