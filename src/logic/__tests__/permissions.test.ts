import {
  canAccessHistoryScreen,
  canAccessStatisticsScreen,
  canViewHistory,
  canViewStatistics,
  resolveEffectivePermission,
  type MemberPermissionOverride,
  type PermissionLoadStatus,
} from '../permissions';

describe('resolveEffectivePermission', () => {
  it('role default when no override exists', () => {
    expect(resolveEffectivePermission('view_history', 'noam', [])).toBe(true);
    expect(resolveEffectivePermission('view_statistics', 'noam', [])).toBe(true);
  });

  it('explicit permission override (denied) takes precedence over the role default', () => {
    const overrides: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_history', allowed: false }];
    expect(resolveEffectivePermission('view_history', 'noam', overrides)).toBe(false);
  });

  it('explicit permission override (explicitly allowed) also takes precedence, even though it matches the default', () => {
    const overrides: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_history', allowed: true }];
    expect(resolveEffectivePermission('view_history', 'noam', overrides)).toBe(true);
  });

  it('an override for a DIFFERENT member never affects this member\'s effective permission', () => {
    const overrides: MemberPermissionOverride[] = [{ userId: 'someone-else', permissionKey: 'view_history', allowed: false }];
    expect(resolveEffectivePermission('view_history', 'noam', overrides)).toBe(true);
  });

  it('an override for a DIFFERENT permission key never affects this permission', () => {
    const overrides: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_statistics', allowed: false }];
    expect(resolveEffectivePermission('view_history', 'noam', overrides)).toBe(true);
  });

  it('clearing an override (removing its row) restores the role default', () => {
    const withOverride: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_history', allowed: false }];
    expect(resolveEffectivePermission('view_history', 'noam', withOverride)).toBe(false);

    // "Clearing" is modeled as the row simply no longer being present —
    // exactly what clear_member_permission_override() does server-side
    // (0023) and what familyStore.clearPermissionOverride() reflects
    // locally after it succeeds (a fresh loadPermissionOverrides()).
    const afterClear: MemberPermissionOverride[] = [];
    expect(resolveEffectivePermission('view_history', 'noam', afterClear)).toBe(true);
  });

  it('falls back to the role default for a null/undefined userId (no identity to look up an override for)', () => {
    expect(resolveEffectivePermission('view_history', null, [{ userId: 'noam', permissionKey: 'view_history', allowed: false }])).toBe(
      true
    );
  });
});

describe('canViewHistory / canViewStatistics (screen-facing wrappers)', () => {
  it('canViewHistory mirrors resolveEffectivePermission(\'view_history\', ...)', () => {
    const overrides: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_history', allowed: false }];
    expect(canViewHistory('noam', overrides)).toBe(false);
    expect(canViewHistory('yael', overrides)).toBe(true);
  });

  it('canViewStatistics mirrors resolveEffectivePermission(\'view_statistics\', ...)', () => {
    const overrides: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_statistics', allowed: false }];
    expect(canViewStatistics('noam', overrides)).toBe(false);
    expect(canViewStatistics('yael', overrides)).toBe(true);
  });
});

/**
 * BATCH 3 CORRECTION #2 (post-review): canAccessHistoryScreen()/
 * canAccessStatisticsScreen() are the NEW fail-closed screen-level gate —
 * distinct from canViewHistory()/canViewStatistics() above, which stay
 * fail-open-while-loading (correct for their own, non-boundary callers:
 * the nav tab convenience, MemberDetailsModal's admin UI). Covers exactly
 * the five scenarios the review asked for: loading/unknown state, load
 * failure, explicit false, no override after a successful load, and
 * clearing an override restoring the role default.
 */
describe('canAccessHistoryScreen / canAccessStatisticsScreen (fail-closed screen-level gate)', () => {
  const ALLOWED_OVERRIDE: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_history', allowed: true }];
  const DENIED_OVERRIDE: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_history', allowed: false }];
  const NO_OVERRIDE: MemberPermissionOverride[] = [];

  it('"idle" (never asked) status denies access even though the role default would otherwise allow it', () => {
    expect(canAccessHistoryScreen('noam', NO_OVERRIDE, 'idle')).toBe(false);
  });

  it('"loading" (unresolved/unknown) status denies access even though the role default would otherwise allow it', () => {
    expect(canAccessHistoryScreen('noam', NO_OVERRIDE, 'loading')).toBe(false);
  });

  it('"loading" status denies access even for a member who ALSO happens to have an explicit allowed=true override — unverified means unverified, regardless of what the stale/incoming data would say', () => {
    expect(canAccessHistoryScreen('noam', ALLOWED_OVERRIDE, 'loading')).toBe(false);
  });

  it('"error" (load failure) status denies access', () => {
    expect(canAccessHistoryScreen('noam', NO_OVERRIDE, 'error')).toBe(false);
    expect(canAccessStatisticsScreen('noam', NO_OVERRIDE, 'error')).toBe(false);
  });

  it('"loaded" status with an explicit false override denies access', () => {
    expect(canAccessHistoryScreen('noam', DENIED_OVERRIDE, 'loaded')).toBe(false);
  });

  it('"loaded" status with no override present (after a genuinely successful load) allows access — the role default applies, exactly like canViewHistory()', () => {
    expect(canAccessHistoryScreen('noam', NO_OVERRIDE, 'loaded')).toBe(true);
  });

  it('"loaded" status after clearing an override (row removed) restores the role default and allows access', () => {
    // "Clearing" is modeled as the row simply no longer being present,
    // exactly like resolveEffectivePermission()'s own equivalent test above.
    expect(canAccessHistoryScreen('noam', DENIED_OVERRIDE, 'loaded')).toBe(false);
    expect(canAccessHistoryScreen('noam', NO_OVERRIDE, 'loaded')).toBe(true);
  });

  it('canAccessStatisticsScreen mirrors the exact same fail-closed rule for view_statistics', () => {
    const deniedStats: MemberPermissionOverride[] = [{ userId: 'noam', permissionKey: 'view_statistics', allowed: false }];
    expect(canAccessStatisticsScreen('noam', deniedStats, 'idle')).toBe(false);
    expect(canAccessStatisticsScreen('noam', deniedStats, 'loading')).toBe(false);
    expect(canAccessStatisticsScreen('noam', deniedStats, 'loaded')).toBe(false);
    expect(canAccessStatisticsScreen('noam', [], 'loaded')).toBe(true);
  });

  it('every PermissionLoadStatus value other than \'loaded\' denies access (exhaustive)', () => {
    const nonLoaded: PermissionLoadStatus[] = ['idle', 'loading', 'error'];
    for (const status of nonLoaded) {
      expect(canAccessHistoryScreen('noam', NO_OVERRIDE, status)).toBe(false);
      expect(canAccessStatisticsScreen('noam', NO_OVERRIDE, status)).toBe(false);
    }
  });
});
