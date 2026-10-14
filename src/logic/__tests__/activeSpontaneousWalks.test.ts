import type { Walk } from '../../types';
import {
  UNASSIGNED_DOG_GROUP_KEY,
  activeSpontaneousGroupKey,
  activeSpontaneousHomeBlocks,
  duplicateActiveWalkNotice,
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

describe('duplicateActiveWalkNotice', () => {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  const fourRecords = {
    dogId: DOG,
    walks: [
      walk('0b8f6a1e-1111-4c1d-9a7e-0d1f2e3a4b5c', { startedAt: '2026-10-13T09:00:00.000Z' }),
      walk('0b8f6a1e-2222-4c1d-9a7e-0d1f2e3a4b5c', { startedAt: '2026-10-13T12:00:00.000Z' }),
      walk('0b8f6a1e-3333-4c1d-9a7e-0d1f2e3a4b5c', { startedAt: '2026-10-14T07:00:00.000Z' }),
      walk('0b8f6a1e-4444-4c1d-9a7e-0d1f2e3a4b5c', { startedAt: '2026-10-14T10:00:00.000Z' }),
    ],
  };

  it('gives a Family Admin a short Hebrew message and a review action, with no ids or raw timestamps', () => {
    const notice = duplicateActiveWalkNotice(fourRecords, { dogName: 'רקסי', viewerIsAdmin: true, canReview: true });
    expect(notice.title).toBe('נמצאו 4 טיולים פעילים כפולים לרקסי');
    expect(notice.reviewActionLabel).toBe('בדיקת מנהל/ת');
    const text = `${notice.title} ${notice.body}`;
    expect(text).not.toMatch(uuid);
    expect(text).not.toMatch(iso);
    expect(text).not.toContain(AVI);
    expect(notice.body.length).toBeLessThanOrEqual(120);
  });

  it('offers no action to an admin when the review panel is not available on this device', () => {
    const notice = duplicateActiveWalkNotice(fourRecords, { dogName: 'רקסי', viewerIsAdmin: true, canReview: false });
    expect(notice.reviewActionLabel).toBeNull();
    expect(notice.body).toContain('נדרשת בדיקת מנהל/ת');
  });

  it('never offers the review action to a non-admin, even if a review gate were wrongly true', () => {
    const notice = duplicateActiveWalkNotice(fourRecords, { dogName: 'רקסי', viewerIsAdmin: false, canReview: true });
    expect(notice.reviewActionLabel).toBeNull();
    expect(notice.body).toContain('מנהל/ת המשפחה');
  });

  it('names the unassigned group without a dog, and falls back when the dog name is unknown', () => {
    expect(duplicateActiveWalkNotice({ ...fourRecords, dogId: null }, { viewerIsAdmin: true, canReview: true }).title)
      .toBe('נמצאו 4 טיולים פעילים כפולים ללא שיוך לכלב');
    expect(duplicateActiveWalkNotice(fourRecords, { dogName: null, viewerIsAdmin: true, canReview: true }).title)
      .toBe('נמצאו 4 טיולים פעילים כפולים לאותו כלב');
  });
});
