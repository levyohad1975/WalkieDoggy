import {
  computeRequestLifecycle,
  countActionableRequests,
  countPendingRequestsForViewer,
  countUnreadRequestResults,
  isRequestActive,
  isRequestVisible,
  type RequestLike,
} from '../requestLifecycle';

const NOW = new Date('2026-08-26T18:00:00Z');

function makeRequest(overrides: Partial<RequestLike>): RequestLike {
  return {
    id: 'r1',
    walk_id: 'w1',
    status: 'pending',
    created_at: NOW.toISOString(),
    resolved_at: null,
    ...overrides,
  };
}

describe('computeRequestLifecycle', () => {
  it('is active for a pending request whose walk is still pending', () => {
    const r = makeRequest({ status: 'pending' });
    const walks = { w1: { status: 'pending' as const } };
    expect(computeRequestLifecycle(r, walks, NOW)).toBe('active');
  });

  it('is expired for a pending request whose walk already resolved another way', () => {
    const r = makeRequest({ status: 'pending' });
    const walks = { w1: { status: 'done' as const } };
    expect(computeRequestLifecycle(r, walks, NOW)).toBe('expired');
  });

  it('is expired for a mutual swap when the exact target walk is no longer pending', () => {
    const r = makeRequest({ status: 'pending', target_walk_id: 'w2' });
    const walks = { w1: { status: 'pending' as const }, w2: { status: 'done' as const } };
    expect(computeRequestLifecycle(r, walks, NOW)).toBe('expired');
  });

  it('is expired for a pending request whose walk no longer exists', () => {
    const r = makeRequest({ status: 'pending' });
    expect(computeRequestLifecycle(r, {}, NOW)).toBe('expired');
  });

  it('is recentlyResolved for an approved request resolved within 24 hours', () => {
    const r = makeRequest({
      status: 'approved',
      resolved_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    });
    expect(computeRequestLifecycle(r, {}, NOW)).toBe('recentlyResolved');
  });

  it('stays recentlyResolved at exactly 24 hours', () => {
    const r = makeRequest({
      status: 'approved',
      resolved_at: new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(computeRequestLifecycle(r, {}, NOW)).toBe('recentlyResolved');
  });

  it('is archived for a rejected request resolved more than 24 hours ago', () => {
    const r = makeRequest({
      status: 'rejected',
      resolved_at: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(),
    });
    expect(computeRequestLifecycle(r, {}, NOW)).toBe('archived');
  });

  it('is archived when an approved/rejected request has no resolved_at (defensive fallback)', () => {
    const r = makeRequest({ status: 'approved', resolved_at: null });
    expect(computeRequestLifecycle(r, {}, NOW)).toBe('archived');
  });

  it('is active for a mutual swap when both the walk and its exact target walk are pending', () => {
    const r = makeRequest({ status: 'pending', target_walk_id: 'w2' });
    const walks = { w1: { status: 'pending' as const }, w2: { status: 'pending' as const } };
    expect(computeRequestLifecycle(r, walks, NOW)).toBe('active');
  });

  it('defaults now to the current time when omitted', () => {
    const r = makeRequest({ status: 'pending' });
    const walks = { w1: { status: 'pending' as const } };
    expect(computeRequestLifecycle(r, walks)).toBe('active');
  });
});

describe('isRequestActive / isRequestVisible', () => {
  it('only "active" counts as active', () => {
    expect(isRequestActive('active')).toBe(true);
    expect(isRequestActive('recentlyResolved')).toBe(false);
    expect(isRequestActive('expired')).toBe(false);
    expect(isRequestActive('archived')).toBe(false);
  });

  it('active and recentlyResolved are visible; expired/archived are not', () => {
    expect(isRequestVisible('active')).toBe(true);
    expect(isRequestVisible('recentlyResolved')).toBe(true);
    expect(isRequestVisible('expired')).toBe(false);
    expect(isRequestVisible('archived')).toBe(false);
  });
});

describe('countActionableRequests', () => {
  it('counts only active requests addressed to the viewer', () => {
    const requests: RequestLike[] = [
      makeRequest({ id: 'a', walk_id: 'w1', status: 'pending' }), // active, addressed
      makeRequest({ id: 'b', walk_id: 'w2', status: 'pending' }), // active, not addressed
      makeRequest({ id: 'c', walk_id: 'w3', status: 'pending' }), // expired (walk gone), addressed
      makeRequest({
        id: 'd',
        walk_id: 'w1',
        status: 'approved',
        resolved_at: NOW.toISOString(),
      }), // recentlyResolved, addressed — doesn't count
    ];
    const walks = {
      w1: { status: 'pending' as const },
      w2: { status: 'pending' as const },
    };
    const addressedIds = new Set(['a', 'c', 'd']);
    const count = countActionableRequests(requests, walks, (r) => addressedIds.has(r.id), NOW);
    expect(count).toBe(1);
  });

  it('defaults now to the current time when omitted', () => {
    const requests: RequestLike[] = [makeRequest({ id: 'a', walk_id: 'w1', status: 'pending' })];
    const walks = { w1: { status: 'pending' as const } };
    const count = countActionableRequests(requests, walks, (r) => r.id === 'a');
    expect(count).toBe(1);
  });
});

describe('countUnreadRequestResults', () => {
  it('counts a recentlyResolved request created by the viewer that has not been seen', () => {
    const requests: RequestLike[] = [
      makeRequest({
        id: 'a',
        status: 'approved',
        resolved_at: NOW.toISOString(),
        requested_by_user_id: 'viewer',
        requester_seen_at: null,
      }),
    ];
    expect(countUnreadRequestResults(requests, {}, 'viewer', NOW)).toBe(1);
  });

  it('excludes requests created by someone else', () => {
    const requests: RequestLike[] = [
      makeRequest({
        status: 'approved',
        resolved_at: NOW.toISOString(),
        requested_by_user_id: 'someoneElse',
        requester_seen_at: null,
      }),
    ];
    expect(countUnreadRequestResults(requests, {}, 'viewer', NOW)).toBe(0);
  });

  it('excludes requests already seen by the requester', () => {
    const requests: RequestLike[] = [
      makeRequest({
        status: 'approved',
        resolved_at: NOW.toISOString(),
        requested_by_user_id: 'viewer',
        requester_seen_at: NOW.toISOString(),
      }),
    ];
    expect(countUnreadRequestResults(requests, {}, 'viewer', NOW)).toBe(0);
  });

  it('excludes archived (>24h resolved) results even if unseen', () => {
    const requests: RequestLike[] = [
      makeRequest({
        status: 'rejected',
        resolved_at: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(),
        requested_by_user_id: 'viewer',
        requester_seen_at: null,
      }),
    ];
    expect(countUnreadRequestResults(requests, {}, 'viewer', NOW)).toBe(0);
  });

  it('excludes still-pending (active) requests, since they have no terminal outcome yet', () => {
    const requests: RequestLike[] = [
      makeRequest({
        status: 'pending',
        requested_by_user_id: 'viewer',
        requester_seen_at: null,
      }),
    ];
    const walks = { w1: { status: 'pending' as const } };
    expect(countUnreadRequestResults(requests, walks, 'viewer', NOW)).toBe(0);
  });

  it('defaults now to the current time when omitted', () => {
    const requests: RequestLike[] = [
      makeRequest({
        status: 'approved',
        resolved_at: new Date().toISOString(),
        requested_by_user_id: 'viewer',
        requester_seen_at: null,
      }),
    ];
    expect(countUnreadRequestResults(requests, {}, 'viewer')).toBe(1);
  });
});

describe('countPendingRequestsForViewer', () => {
  const walks = { w1: { status: 'pending' as const } };

  it('counts a pending swap addressed to a non-admin viewer', () => {
    const swaps: RequestLike[] = [makeRequest({ id: 's1', walk_id: 'w1', target_user_id: 'viewer' })];
    expect(countPendingRequestsForViewer(swaps, [], walks, 'viewer', false, NOW)).toBe(1);
  });

  it('ignores a pending swap addressed to someone else', () => {
    const swaps: RequestLike[] = [makeRequest({ id: 's1', walk_id: 'w1', target_user_id: 'someoneElse' })];
    expect(countPendingRequestsForViewer(swaps, [], walks, 'viewer', false, NOW)).toBe(0);
  });

  it('ignores every time-change request for a non-admin viewer, even one they created', () => {
    const timeChanges: RequestLike[] = [makeRequest({ id: 't1', walk_id: 'w1', requested_by_user_id: 'viewer' })];
    expect(countPendingRequestsForViewer([], timeChanges, walks, 'viewer', false, NOW)).toBe(0);
  });

  it('counts every pending time-change request for an admin viewer, regardless of requester', () => {
    const timeChanges: RequestLike[] = [makeRequest({ id: 't1', walk_id: 'w1', requested_by_user_id: 'someoneElse' })];
    expect(countPendingRequestsForViewer([], timeChanges, walks, 'admin', true, NOW)).toBe(1);
  });

  it('also counts a pending swap targeting an admin viewer, alongside time-change requests', () => {
    const swaps: RequestLike[] = [makeRequest({ id: 's1', walk_id: 'w1', target_user_id: 'admin' })];
    const timeChanges: RequestLike[] = [makeRequest({ id: 't1', walk_id: 'w1', requested_by_user_id: 'someoneElse' })];
    expect(countPendingRequestsForViewer(swaps, timeChanges, walks, 'admin', true, NOW)).toBe(2);
  });

  it('excludes expired/resolved requests from either category', () => {
    const swaps: RequestLike[] = [makeRequest({ id: 's1', walk_id: 'missing', target_user_id: 'admin' })];
    const timeChanges: RequestLike[] = [
      makeRequest({ id: 't1', walk_id: 'w1', status: 'approved', resolved_at: NOW.toISOString() }),
    ];
    expect(countPendingRequestsForViewer(swaps, timeChanges, walks, 'admin', true, NOW)).toBe(0);
  });

  it('defaults now to the current time when omitted', () => {
    const swaps: RequestLike[] = [makeRequest({ id: 's1', walk_id: 'w1', target_user_id: 'viewer' })];
    expect(countPendingRequestsForViewer(swaps, [], walks, 'viewer', false)).toBe(1);
  });
});
