import {
  computeRequestLifecycle,
  countActionableRequests,
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
});
