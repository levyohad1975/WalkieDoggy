import { computeWalkRequestStatusLine } from '../walkRequestStatusLine';
import type { SwapRequestRow, TimeChangeRequestRow } from '../../lib/requests';

function swap(overrides: Partial<SwapRequestRow> = {}): SwapRequestRow {
  return {
    id: 'swap-1',
    family_id: 'fam-1',
    walk_id: 'walk-1',
    requested_by_user_id: 'u1',
    target_user_id: 'u2',
    target_walk_id: null,
    status: 'pending',
    created_at: '2026-09-04T08:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

function timeChange(overrides: Partial<TimeChangeRequestRow> = {}): TimeChangeRequestRow {
  return {
    id: 'tc-1',
    family_id: 'fam-1',
    walk_id: 'walk-1',
    requested_by_user_id: 'u1',
    proposed_time: '19:30',
    expected_time: '18:00',
    status: 'pending',
    created_at: '2026-09-04T08:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

const NOW = new Date('2026-09-04T10:00:00.000Z');
const walksById = { 'walk-1': { status: 'pending' as const } };

describe('computeWalkRequestStatusLine', () => {
  it('returns null when there are no requests for this walk', () => {
    expect(computeWalkRequestStatusLine({ id: 'walk-1' }, [], [], walksById, NOW)).toBeNull();
  });

  it('ignores requests for OTHER walks', () => {
    const result = computeWalkRequestStatusLine(
      { id: 'walk-1' },
      [swap({ walk_id: 'walk-2' })],
      [],
      walksById,
      NOW
    );
    expect(result).toBeNull();
  });

  it('renders a pending time-change request', () => {
    const result = computeWalkRequestStatusLine({ id: 'walk-1' }, [], [timeChange()], walksById, NOW);
    expect(result).toEqual({ text: '🕐 19:30 · ממתין', kind: 'timeChange', status: 'pending' });
  });

  it('renders an approved time-change request within the recently-resolved window', () => {
    const result = computeWalkRequestStatusLine(
      { id: 'walk-1' },
      [],
      [timeChange({ status: 'approved', resolved_at: '2026-09-04T09:30:00.000Z' })],
      walksById,
      NOW
    );
    expect(result).toEqual({ text: '✓ 19:30 אושר', kind: 'timeChange', status: 'approved' });
  });

  it('renders a rejected time-change request', () => {
    const result = computeWalkRequestStatusLine(
      { id: 'walk-1' },
      [],
      [timeChange({ status: 'rejected', resolved_at: '2026-09-04T09:30:00.000Z' })],
      walksById,
      NOW
    );
    expect(result).toEqual({ text: '✕ 19:30 נדחה', kind: 'timeChange', status: 'rejected' });
  });

  it('shows a mutual swap status on the exact target walk too', () => {
    const mutual = swap({ target_walk_id: 'walk-2' });
    const bothWalks = { 'walk-1': { status: 'pending' as const }, 'walk-2': { status: 'pending' as const } };
    expect(computeWalkRequestStatusLine({ id: 'walk-2' }, [mutual], [], bothWalks, NOW)?.text).toBe('🔁 ממתין');
  });

  it('renders a pending / approved / rejected swap request', () => {
    expect(computeWalkRequestStatusLine({ id: 'walk-1' }, [swap()], [], walksById, NOW)?.text).toBe(
      '🔁 ממתין'
    );
    expect(
      computeWalkRequestStatusLine(
        { id: 'walk-1' },
        [swap({ status: 'approved', resolved_at: '2026-09-04T09:30:00.000Z' })],
        [],
        walksById,
        NOW
      )?.text
    ).toBe('✓ אושר');
    expect(
      computeWalkRequestStatusLine(
        { id: 'walk-1' },
        [swap({ status: 'rejected', resolved_at: '2026-09-04T09:30:00.000Z' })],
        [],
        walksById,
        NOW
      )?.text
    ).toBe('✕ נדחה');
  });

  it('hides a resolved request once it is outside the ~24h recently-resolved window', () => {
    const result = computeWalkRequestStatusLine(
      { id: 'walk-1' },
      [],
      [timeChange({ status: 'approved', resolved_at: '2026-09-01T09:30:00.000Z' })],
      walksById,
      NOW
    );
    expect(result).toBeNull();
  });

  it('hides an expired pending request (its walk is no longer pending)', () => {
    const result = computeWalkRequestStatusLine(
      { id: 'walk-1' },
      [],
      [timeChange()],
      { 'walk-1': { status: 'done' } },
      NOW
    );
    expect(result).toBeNull();
  });

  it('picks the MOST RECENT relevant request when several exist for the same walk', () => {
    const older = timeChange({
      id: 'tc-old',
      status: 'rejected',
      created_at: '2026-09-04T07:00:00.000Z',
      resolved_at: '2026-09-04T07:05:00.000Z',
    });
    const newer = swap({
      id: 'swap-new',
      status: 'pending',
      created_at: '2026-09-04T09:00:00.000Z',
    });
    const result = computeWalkRequestStatusLine({ id: 'walk-1' }, [newer], [older], walksById, NOW);
    expect(result).toEqual({ text: '🔁 ממתין', kind: 'swap', status: 'pending' });
  });
});

describe('time-change resolved status is personal to requester', () => {
  it('shows approved time + check only to the requester', () => {
    const approved = timeChange({ status: 'approved', resolved_at: '2026-09-04T09:30:00.000Z' });
    expect(computeWalkRequestStatusLine({ id: 'walk-1' }, [], [approved], walksById, NOW, 'u1')?.text).toBe('✓ 19:30 אושר');
    expect(computeWalkRequestStatusLine({ id: 'walk-1' }, [], [approved], walksById, NOW, 'u2')).toBeNull();
  });

  it('shows rejection only to the requester', () => {
    const rejected = timeChange({ status: 'rejected', resolved_at: '2026-09-04T09:30:00.000Z' });
    expect(computeWalkRequestStatusLine({ id: 'walk-1' }, [], [rejected], walksById, NOW, 'u1')?.text).toBe('✕ 19:30 נדחה');
    expect(computeWalkRequestStatusLine({ id: 'walk-1' }, [], [rejected], walksById, NOW, 'u2')).toBeNull();
  });
});
