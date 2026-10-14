import type { DuplicateActiveWalkReviewRecord } from '../../data/repository';
import {
  canOpenDuplicateResolution,
  CONFIRMED_STAGING_DUPLICATE_WALK_IDS,
  getDuplicateResolutionErrorKind,
  getDuplicateResolutionErrorMessage,
  getDuplicateResolutionReviewErrorMessage,
  getDuplicateResolutionReadiness,
} from '../duplicateWalkResolution';

function reviewRecord(walkId: string, overrides: Partial<DuplicateActiveWalkReviewRecord> = {}): DuplicateActiveWalkReviewRecord {
  return {
    walkId, familyId: 'family-1', dogId: 'dog-1', status: 'in_progress', responsibleUserId: 'profile-1',
    startedAt: '2026-10-13T10:00:00Z', startedByUserId: 'profile-1', auditEntries: [], gpsSessions: [], ...overrides,
  };
}

const completeGroup = () => CONFIRMED_STAGING_DUPLICATE_WALK_IDS.map((id) => reviewRecord(id));

describe('Staging duplicate-walk resolution safeguards', () => {
  it('opens only for a real Family Admin in the exact configured Staging flow', () => {
    const authorized = { staging: true, configured: true, familyId: 'family-1', profileId: 'profile-1', familyRole: 'admin', impersonating: false, systemObserver: false, testMode: false };
    expect(canOpenDuplicateResolution(authorized)).toBe(true);
    for (const change of [
      { staging: false }, { configured: false }, { familyId: null }, { profileId: null },
      { familyRole: 'member' }, { impersonating: true }, { systemObserver: true }, { testMode: true },
    ]) expect(canOpenDuplicateResolution({ ...authorized, ...change })).toBe(false);
  });

  it('requires exactly the three currently unresolved active records from one family and dog', () => {
    expect(getDuplicateResolutionReadiness(completeGroup(), 'family-1')).toBe('ready');
    expect(getDuplicateResolutionReadiness(completeGroup().slice(0, 2), 'family-1')).toBe('missing_records');
    expect(getDuplicateResolutionReadiness(completeGroup().map((row, index) => index === 0 ? { ...row, status: 'done' } : row), 'family-1')).toBe('already_resolved');
    expect(getDuplicateResolutionReadiness(completeGroup().map((row, index) => index === 0 ? { ...row, duplicateResolutionGroupId: 'group-1' } : row), 'family-1')).toBe('already_resolved');
    expect(getDuplicateResolutionReadiness(completeGroup().map((row, index) => index === 0 ? { ...row, familyId: 'other-family' } : row), 'family-1')).toBe('already_resolved');
    expect(getDuplicateResolutionReadiness(completeGroup().map((row, index) => index === 0 ? { ...row, dogId: 'other-dog' } : row), 'family-1')).toBe('invalid_group');
  });

  it('maps authorization, missing migration, network uncertainty and unexpected errors distinctly', () => {
    expect(getDuplicateResolutionErrorKind({ code: '42501' })).toBe('permission');
    expect(getDuplicateResolutionErrorKind({ code: 'PGRST202' })).toBe('migration');
    expect(getDuplicateResolutionErrorKind(new Error('Network unavailable; no resolution request was sent.'))).toBe('network');
    expect(getDuplicateResolutionErrorKind(new Error('unrecognized RPC failure'))).toBe('other');
    expect(getDuplicateResolutionErrorMessage(new Error('Failed to fetch'))).toContain('ייתכן שהפעולה הושלמה');
    expect(getDuplicateResolutionReviewErrorMessage(new Error('Failed to fetch'))).toContain('לא נשלחה בקשת שינוי');
  });
});
