import {
  buildInviteLinkText,
  canManageFamilyInvites,
  createInviteButtonLabel,
  formatInviteExpiry,
  inviteStatusLabel,
  isMemberInviteEligible,
  latestInviteByTarget,
  parseInviteInput,
  shouldOfferRegenerate,
  type InviteEligibilityInput,
} from '../familyInvites';
import type { FamilyInviteListItem } from '../../lib/invites';

/**
 * Round 3 — pure decision-logic tests for the admin invite-creation/
 * management UI. No React Native component-rendering infrastructure exists
 * in this repo (see familyManagement.test.ts's own doc comment) — these
 * cover the extracted pure functions behind FamilyScreen/MemberDetailsModal's
 * wiring, which is verified by careful code reading (see the Round 3 report).
 */

function baseEligibility(overrides: Partial<InviteEligibilityInput> = {}): InviteEligibilityInput {
  return {
    isRealAdmin: true,
    targetRemovedAt: null,
    targetRole: null,
    activityLoaded: true,
    ...overrides,
  };
}

describe('isMemberInviteEligible', () => {
  it('eligible: real admin, active target, unclaimed (role null), activity loaded', () => {
    expect(isMemberInviteEligible(baseEligibility())).toBe(true);
  });

  it('hidden for a non-admin viewer', () => {
    expect(isMemberInviteEligible(baseEligibility({ isRealAdmin: false }))).toBe(false);
  });

  // isRealFamilyAdmin() (authStore.ts) already resolves false during
  // impersonation — isRealAdmin: false is exactly what FamilyScreen passes
  // in during an active impersonation session, so this is the same case as
  // the non-admin test above, asserted explicitly per the round's own
  // "hidden during impersonation" requirement.
  it('hidden while impersonating (isRealAdmin already resolves false during impersonation)', () => {
    expect(isMemberInviteEligible(baseEligibility({ isRealAdmin: false }))).toBe(false);
  });

  it('hidden for a removed (soft-deleted) target member', () => {
    expect(isMemberInviteEligible(baseEligibility({ targetRemovedAt: '2026-01-01T00:00:00Z' }))).toBe(false);
  });

  it('hidden for a claimed target member (role is "member")', () => {
    expect(isMemberInviteEligible(baseEligibility({ targetRole: 'member' }))).toBe(false);
  });

  it('hidden for a claimed target member (role is "admin")', () => {
    expect(isMemberInviteEligible(baseEligibility({ targetRole: 'admin' }))).toBe(false);
  });

  it('hidden when activity has not loaded, even if targetRole looks null — never guess "unclaimed" from missing data', () => {
    expect(isMemberInviteEligible(baseEligibility({ activityLoaded: false, targetRole: null }))).toBe(false);
    expect(isMemberInviteEligible(baseEligibility({ activityLoaded: false, targetRole: undefined }))).toBe(false);
  });

  it('eligible when targetRole is undefined (not just null) and activity has loaded — the LEFT JOIN can produce either for "no match"', () => {
    expect(isMemberInviteEligible(baseEligibility({ targetRole: undefined }))).toBe(true);
  });
});

describe('canManageFamilyInvites', () => {
  it('true only for a real, non-impersonating admin', () => {
    expect(canManageFamilyInvites(true)).toBe(true);
    expect(canManageFamilyInvites(false)).toBe(false);
  });
});

describe('inviteStatusLabel', () => {
  it('maps every effective status to its Hebrew label', () => {
    expect(inviteStatusLabel('pending')).toBe('הזמנה בתוקף');
    expect(inviteStatusLabel('expired')).toBe('פגה תוקף');
    expect(inviteStatusLabel('redeemed')).toBe('נוצלה');
    expect(inviteStatusLabel('revoked')).toBe('בוטלה');
  });

  it('returns an empty string for a status value outside the known union (e.g. a future server-side status the client type does not model yet), rather than throwing or showing a broken label', () => {
    expect(inviteStatusLabel('some-future-status' as unknown as Parameters<typeof inviteStatusLabel>[0])).toBe('');
  });
});

function invite(overrides: Partial<FamilyInviteListItem>): FamilyInviteListItem {
  return {
    inviteId: 'invite-1',
    targetUserId: 'user-1',
    targetName: 'דנה',
    targetAvatar: null,
    status: 'pending',
    expiresAt: '2026-09-03T00:00:00Z',
    createdAt: '2026-08-31T00:00:00Z',
    ...overrides,
  };
}

describe('latestInviteByTarget', () => {
  it('keeps only the first (server-ordered newest) entry per target', () => {
    const items = [
      invite({ inviteId: 'newer', targetUserId: 'user-1', createdAt: '2026-08-31T12:00:00Z' }),
      invite({ inviteId: 'older', targetUserId: 'user-1', createdAt: '2026-08-01T12:00:00Z' }),
      invite({ inviteId: 'other', targetUserId: 'user-2', createdAt: '2026-08-30T12:00:00Z' }),
    ];
    const map = latestInviteByTarget(items);
    expect(map.size).toBe(2);
    expect(map.get('user-1')?.inviteId).toBe('newer');
    expect(map.get('user-2')?.inviteId).toBe('other');
  });

  it('returns an empty map for an empty list', () => {
    expect(latestInviteByTarget([]).size).toBe(0);
  });
});

describe('shouldOfferRegenerate / createInviteButtonLabel', () => {
  it('no existing invite -> create, not regenerate', () => {
    expect(shouldOfferRegenerate(null)).toBe(false);
    expect(createInviteButtonLabel(null)).toBe('צור הזמנה');
  });

  it.each(['pending', 'expired', 'revoked'] as const)('an existing %s invite -> regenerate wording', (status) => {
    expect(shouldOfferRegenerate(invite({ status }))).toBe(true);
    expect(createInviteButtonLabel(invite({ status }))).toBe('צור הזמנה חדשה');
  });

  it('a redeemed invite is excluded defensively (member would already be ineligible upstream)', () => {
    expect(shouldOfferRegenerate(invite({ status: 'redeemed' }))).toBe(false);
    expect(createInviteButtonLabel(invite({ status: 'redeemed' }))).toBe('צור הזמנה');
  });
});

describe('buildInviteLinkText', () => {
  it('without an origin, falls back to the legacy opaque-token dogwalkfamily:// form', () => {
    expect(buildInviteLinkText('abc123XYZ')).toBe('dogwalkfamily://invite/abc123XYZ');
    expect(buildInviteLinkText('abc123XYZ', null)).toBe('dogwalkfamily://invite/abc123XYZ');
  });

  it('never embeds anything beyond the token itself (no family/user data) in the legacy form', () => {
    const link = buildInviteLinkText('the-raw-token');
    expect(link).toBe('dogwalkfamily://invite/the-raw-token');
    expect(link.split('/').length).toBe(4); // 'dogwalkfamily:', '', 'invite', '<token>'
  });

  it('with a web origin, builds a real clickable HTTPS invite URL carrying only the opaque token', () => {
    const link = buildInviteLinkText('abc123XYZ', 'https://walkie-doggy-staging.vercel.app');
    expect(link).toBe('https://walkie-doggy-staging.vercel.app/?invite=abc123XYZ');
  });

  it('percent-encodes the token in the HTTPS form so a URL-unsafe token still produces a valid link', () => {
    const link = buildInviteLinkText('a b&c', 'https://example.com');
    expect(link).toBe('https://example.com/?invite=a%20b%26c');
  });

  it('never embeds anything beyond the token itself in the HTTPS form either', () => {
    const link = buildInviteLinkText('the-raw-token', 'https://example.com');
    expect(link).toBe('https://example.com/?invite=the-raw-token');
  });
});

describe('formatInviteExpiry', () => {
  it('formats a valid ISO timestamp as local DD-MM-YYYY בשעה HH:MM', () => {
    const d = new Date(2026, 8, 3, 14, 5); // local: 3 Sep 2026, 14:05
    expect(formatInviteExpiry(d.toISOString())).toBe('03-09-2026 בשעה 14:05');
  });

  it('returns null for a missing value', () => {
    expect(formatInviteExpiry(null)).toBeNull();
    expect(formatInviteExpiry(undefined)).toBeNull();
  });

  it('returns null for an unparseable value rather than a broken string', () => {
    expect(formatInviteExpiry('not-a-date')).toBeNull();
  });
});

describe('parseInviteInput', () => {
  it('returns a bare pasted token unchanged', () => {
    expect(parseInviteInput('abc123XYZ')).toBe('abc123XYZ');
  });

  it('strips the dogwalkfamily://invite/ prefix from a full pasted link', () => {
    expect(parseInviteInput('dogwalkfamily://invite/abc123XYZ')).toBe('abc123XYZ');
  });

  it('trims surrounding whitespace on a bare token', () => {
    expect(parseInviteInput('  abc123XYZ  ')).toBe('abc123XYZ');
  });

  it('trims surrounding whitespace on a full link', () => {
    expect(parseInviteInput('  dogwalkfamily://invite/abc123XYZ  ')).toBe('abc123XYZ');
  });

  it('extracts an invite token when the entire shared message is pasted', () => {
    expect(
      parseInviteInput(`הוזמנת להצטרף למשפחה באפליקציית Walkie Doggy Link!

קישור ההזמנה:
dogwalkfamily://invite/abc123XYZ

אפשר להדביק את כל ההודעה`)
    ).toBe('abc123XYZ');
  });

  it('extracts a link embedded inline in surrounding message text', () => {
    expect(parseInviteInput('קישור ההזמנה: dogwalkfamily://invite/abc123XYZ תודה')).toBe('abc123XYZ');
  });

  it('returns null for empty input', () => {
    expect(parseInviteInput('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parseInviteInput('   ')).toBeNull();
  });

  it('returns null when the link prefix is pasted with nothing after it', () => {
    expect(parseInviteInput('dogwalkfamily://invite/')).toBeNull();
  });

  it('does not validate token shape/length — any non-empty leftover string is returned, leaving validation to inspect_family_invite() server-side', () => {
    expect(parseInviteInput('not-a-real-token-at-all')).toBe('not-a-real-token-at-all');
  });

  // Family Lifecycle repair — the real HTTPS link form (buildInviteLinkText()
  // with an origin). Regression coverage per item 12: "HTTPS invite
  // parsing/routing" and "full-message paste fallback".
  describe('HTTPS invite URL recognition (fallback paste, alongside launch-URL auto-detection)', () => {
    it('extracts the token from a full HTTPS invite URL', () => {
      expect(parseInviteInput('https://walkie-doggy-staging.vercel.app/?invite=abc123XYZ')).toBe('abc123XYZ');
    });

    it('extracts the token when the invite param is not the first query param', () => {
      expect(parseInviteInput('https://example.com/?utm_source=whatsapp&invite=abc123XYZ')).toBe('abc123XYZ');
    });

    it('extracts the token when the whole share message (HTTPS variant) is pasted', () => {
      expect(
        parseInviteInput(`הוזמנת להצטרף למשפחה באפליקציית Walkie Doggy!

https://walkie-doggy-staging.vercel.app/?invite=abc123XYZ`)
      ).toBe('abc123XYZ');
    });

    it('extracts an HTTPS link embedded inline in surrounding message text', () => {
      expect(parseInviteInput('קישור ההזמנה: https://example.com/?invite=abc123XYZ תודה')).toBe('abc123XYZ');
    });

    it('decodes a percent-encoded token from the query string', () => {
      expect(parseInviteInput('https://example.com/?invite=a%20b%26c')).toBe('a b&c');
    });

    it('still prefers the legacy dogwalkfamily:// prefix when both forms somehow appear (legacy checked first)', () => {
      expect(parseInviteInput('dogwalkfamily://invite/legacy-token https://example.com/?invite=https-token')).toBe('legacy-token');
    });

    it('the HTTPS form round-trips through buildInviteLinkText -> parseInviteInput back to the original token', () => {
      const rawToken = 'round-trip-token-123';
      const link = buildInviteLinkText(rawToken, 'https://walkie-doggy-staging.vercel.app');
      expect(parseInviteInput(link)).toBe(rawToken);
    });
  });
});
