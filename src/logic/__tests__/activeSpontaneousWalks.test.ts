import type { Walk } from '../../types';
import {
  UNASSIGNED_DOG_GROUP_KEY,
  activeSpontaneousGroupKey,
  activeSpontaneousHomeBlocks,
  groupActiveSpontaneousWalks,
} from '../activeSpontaneousWalks';

const FAMILY = 'fam-1';
const DOG = 'dog-1';
const OTHER_DOG = 'dog-2';
const ADMIN = 'user-admin';
const AVI = 'user-avi';
const MEMBER = 'user-member';

function walk(id: string, overrides: Partial<Walk> = {}): Walk {
  return {
    id,
    familyId: FAMILY,
    dogId: DOG,
    date: '2026-10-14',
    scheduledTime: '15:40',
    responsibleUserId: AVI,
    status: 'in_progress',
    isUnplanned: true,
    startedAt: '2026-10-14T12:40:00.000Z',
    createdAt: '2026-10-14T12:40:00.000Z',
    updatedAt: '2026-10-14T12:40:00.000Z',
    ...overrides,
  };
}

const adminView = { familyId: FAMILY, knownDogIds: [DOG, OTHER_DOG], viewerUserId: ADMIN, viewerIsAdmin: true };

describe('groupActiveSpontaneousWalks', () => {
  it('real-iPhone P0 scenario: four active spontaneous records for one dog render as ONE duplicate block, not four cards', () => {
    const records = [
      walk('walk-d', { startedAt: '2026-10-14T12:43:00.000Z' }),
      walk('walk-b', { startedAt: '2026-10-14T12:41:00.000Z' }),
      walk('walk-a', { startedAt: '2026-10-14T12:40:00.000Z' }),
      walk('walk-c', { startedAt: '2026-10-14T12:42:00.000Z' }),
    ];
    const pending1600 = walk('walk-1600', { isUnplanned: false, status: 'pending', scheduledTime: '16:00', scheduleEntryId: 'entry-1', startedAt: undefined });

    const groups = groupActiveSpontaneousWalks([...records, pending1600], adminView);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: DOG, dogId: DOG, duplicate: true });
    // Stable audit order: oldest start first, every exact id preserved.
    expect(groups[0].walks.map((w) => w.id)).toEqual(['walk-a', 'walk-b', 'walk-c', 'walk-d']);
    expect(activeSpontaneousHomeBlocks(groups, pending1600.id)).toHaveLength(1);
  });

  it('collapses repeated copies of the SAME record id (keeping the newest copy) without merging distinct walks', () => {
    const older = walk('walk-a', { updatedAt: '2026-10-14T12:40:00.000Z', lifecycleSyncStatus: 'pending' });
    const newer = walk('walk-a', { updatedAt: '2026-10-14T12:41:00.000Z' });
    const groups = groupActiveSpontaneousWalks([older, newer, older], adminView);
    expect(groups).toHaveLength(1);
    expect(groups[0].duplicate).toBe(false);
    expect(groups[0].walks).toEqual([newer]);
  });

  it('breaks start-time ties by id so the order is deterministic across renders', () => {
    const groups = groupActiveSpontaneousWalks([walk('walk-z'), walk('walk-m'), walk('walk-a')], adminView);
    expect(groups[0].walks.map((w) => w.id)).toEqual(['walk-a', 'walk-m', 'walk-z']);
  });

  it('keeps distinct dogs in distinct groups', () => {
    const groups = groupActiveSpontaneousWalks([
      walk('walk-1', { dogId: DOG }),
      walk('walk-2', { dogId: OTHER_DOG, startedAt: '2026-10-14T12:45:00.000Z' }),
    ], adminView);
    expect(groups.map((g) => [g.key, g.duplicate])).toEqual([[DOG, false], [OTHER_DOG, false]]);
  });

  it('collects missing, blank and unknown dog ids into ONE unassigned group and never merges them into a real dog', () => {
    const groups = groupActiveSpontaneousWalks([
      walk('walk-known', { dogId: DOG }),
      walk('walk-empty', { dogId: '' }),
      walk('walk-blank', { dogId: '   ' }),
      walk('walk-null', { dogId: null as unknown as string }),
      walk('walk-stale', { dogId: 'dog-deleted' }),
    ], adminView);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: DOG, duplicate: false });
    expect(groups[0].walks.map((w) => w.id)).toEqual(['walk-known']);
    // Unassigned group sorts last and is flagged for review.
    expect(groups[1]).toMatchObject({ key: UNASSIGNED_DOG_GROUP_KEY, dogId: null, duplicate: true });
    expect(groups[1].walks.map((w) => w.id).sort()).toEqual(['walk-blank', 'walk-empty', 'walk-null', 'walk-stale']);
  });

  it('uses raw dog ids while the family dog list is still loading', () => {
    expect(activeSpontaneousGroupKey({ dogId: 'dog-x' }, [])).toBe('dog-x');
    expect(activeSpontaneousGroupKey({ dogId: '' }, [])).toBe(UNASSIGNED_DOG_GROUP_KEY);
    expect(activeSpontaneousGroupKey({ dogId: 'dog-x' }, [DOG])).toBe(UNASSIGNED_DOG_GROUP_KEY);
  });

  it('ignores planned, non-active, other-family and admin-resolved records', () => {
    const groups = groupActiveSpontaneousWalks([
      walk('planned-active', { isUnplanned: false, scheduleEntryId: 'entry-1' }),
      walk('pending', { status: 'pending' }),
      walk('done', { status: 'done' }),
      walk('resolved', { duplicateResolutionGroupId: 'group-1' }),
      walk('other-family', { familyId: 'fam-2' }),
      walk('live'),
    ], adminView);
    expect(groups).toHaveLength(1);
    expect(groups[0].walks.map((w) => w.id)).toEqual(['live']);
  });

  describe('permission filtering', () => {
    const records = [
      walk('avi-responsible'),
      walk('member-actual', { responsibleUserId: AVI, actualWalkerUserId: MEMBER, startedAt: '2026-10-14T12:41:00.000Z' }),
      walk('member-responsible', { responsibleUserId: MEMBER, dogId: OTHER_DOG }),
    ];

    it('admin sees every active spontaneous walk', () => {
      const groups = groupActiveSpontaneousWalks(records, adminView);
      expect(groups.flatMap((g) => g.walks.map((w) => w.id)).sort()).toEqual(['avi-responsible', 'member-actual', 'member-responsible']);
    });

    it('a member sees only walks they physically walk (actual walker outranks responsible)', () => {
      const groups = groupActiveSpontaneousWalks(records, { ...adminView, viewerUserId: MEMBER, viewerIsAdmin: false });
      expect(groups.flatMap((g) => g.walks.map((w) => w.id)).sort()).toEqual(['member-actual', 'member-responsible']);
      const aviGroups = groupActiveSpontaneousWalks(records, { ...adminView, viewerUserId: AVI, viewerIsAdmin: false });
      expect(aviGroups.flatMap((g) => g.walks.map((w) => w.id))).toEqual(['avi-responsible']);
    });

    it('an unknown viewer sees nothing', () => {
      expect(groupActiveSpontaneousWalks(records, { ...adminView, viewerUserId: null, viewerIsAdmin: false })).toEqual([]);
    });
  });
});

describe('activeSpontaneousHomeBlocks', () => {
  it('does not repeat a single active walk that is already the main next-walk card', () => {
    const groups = groupActiveSpontaneousWalks([walk('walk-a')], adminView);
    expect(activeSpontaneousHomeBlocks(groups, 'walk-a')).toEqual([]);
    expect(activeSpontaneousHomeBlocks(groups, 'walk-other')).toHaveLength(1);
  });

  it('still surfaces a duplicate of the main-card walk instead of a second remote-GPS card', () => {
    const groups = groupActiveSpontaneousWalks([walk('walk-a'), walk('walk-b', { startedAt: '2026-10-14T12:41:00.000Z' })], adminView);
    const blocks = activeSpontaneousHomeBlocks(groups, 'walk-a');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].duplicate).toBe(true);
    expect(blocks[0].walks.map((w) => w.id)).toEqual(['walk-a', 'walk-b']);
  });
});
