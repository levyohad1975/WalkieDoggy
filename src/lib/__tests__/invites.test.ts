const ORIGINAL_ENV = process.env;

function mockSupabaseClient(rpc: jest.Mock) {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc,
      from: jest.fn(),
      storage: { from: jest.fn() },
    })),
  }));
}

/**
 * ROUND-2 FIX: the RPC wrappers here reject with the *exact* `{ message }`
 * object Supabase's client returns for a Postgres RPC error — not
 * necessarily a real Error instance (same shape claim_family_profile()'s/
 * beginImpersonation()'s own rejections use, see
 * src/store/__tests__/authStore.test.ts's "ROUND-3 FIX" comment, which
 * documents the exact same issue for that file). `.rejects.toThrow(exact
 * string)` is not reliable for a non-Error rejection value in this
 * repository's real Jest/React Native environment — it originally passed
 * against the Jest run performed while writing these tests, but failed on
 * the real Windows verification run with "Received function did not
 * throw" for every one of these exact-message assertions (11 failures),
 * while the plain `.rejects.toBeTruthy()` assertions elsewhere in this file
 * passed. That is: the mocked RPC promise unambiguously rejects — only the
 * specific-message `toThrow(string)` form is unreliable here. Production
 * behavior is unaffected either way — `invites.ts` unconditionally does
 * `if (error) throw error`, so any error object always propagates; this was
 * purely a test-assertion defect, fixed the same way authStore.test.ts's
 * was: a manual catch that proves both "it rejected" and "with the right
 * reason", regardless of the rejection value's shape.
 */
async function expectRejectsWithMessage(promise: Promise<unknown>, expectedSubstring: string): Promise<void> {
  let caught: unknown;
  let resolved = false;
  try {
    await promise;
    resolved = true;
  } catch (err) {
    caught = err;
  }
  expect(resolved).toBe(false);
  expect(caught).toBeTruthy();
  expect(String((caught as { message?: string } | undefined)?.message ?? caught)).toContain(expectedSubstring);
}

/**
 * Round 2. Client-side (call-shape / error-propagation / token-safety) tests
 * for the migration-0008 family-invite RPC wrappers (lib/invites.ts), mirroring
 * lib/__tests__/family.test.ts and lib/__tests__/requests.test.ts's approach.
 * These cannot verify the actual server-side authorization/atomicity/RLS
 * behavior (that's covered by supabase/manual_tests/0008_family_invites_acl.sql
 * against a real Postgres instance — see the Round 1 report: 20/20 PASSED) —
 * only that the client sends the exact deployed RPC name/params, maps the
 * exact deployed result shape, and propagates/translates server errors
 * faithfully without ever persisting or logging the raw token.
 */
describe('lib/invites — Supabase mode', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ---- CREATE ----
  describe('createFamilyInvite', () => {
    it('calls create_family_invite with exact param name p_target_user_id and maps the deployed result shape', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [{ id: 'invite-1', raw_token: 'raw-token-abc', expires_at: '2026-09-03T00:00:00Z' }],
        error: null,
      });
      mockSupabaseClient(rpc);
      const { createFamilyInvite } = require('../invites');

      const result = await createFamilyInvite('user-2');

      expect(rpc).toHaveBeenCalledWith('create_family_invite', { p_target_user_id: 'user-2' });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 'invite-1', rawToken: 'raw-token-abc', expiresAt: '2026-09-03T00:00:00Z' });
    });

    it('also accepts a single-row (non-array) RPC result', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: { id: 'invite-1', raw_token: 'raw-token-abc', expires_at: '2026-09-03T00:00:00Z' },
        error: null,
      });
      mockSupabaseClient(rpc);
      const { createFamilyInvite } = require('../invites');

      const result = await createFamilyInvite('user-2');
      expect(result.rawToken).toBe('raw-token-abc');
    });

    it('surfaces "admin permission required" (non-admin rejection) rather than swallowing it', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
      mockSupabaseClient(rpc);
      const { createFamilyInvite } = require('../invites');

      await expect(createFamilyInvite('user-2')).rejects.toBeTruthy();
    });

    it('surfaces "cannot invite a removed profile"', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'cannot invite a removed profile' } });
      mockSupabaseClient(rpc);
      const { createFamilyInvite } = require('../invites');

      await expectRejectsWithMessage(createFamilyInvite('user-2'), 'cannot invite a removed profile');
    });

    it('surfaces "profile is already claimed"', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'profile is already claimed' } });
      mockSupabaseClient(rpc);
      const { createFamilyInvite } = require('../invites');

      await expectRejectsWithMessage(createFamilyInvite('user-2'), 'profile is already claimed');
    });

    it('throws SupabaseNotConfiguredError in local/demo mode', async () => {
      jest.resetModules();
      process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' };
      const { createFamilyInvite } = require('../invites');
      const { SupabaseNotConfiguredError } = require('../supabase');
      // Matches lib/__tests__/family.test.ts's proven convention exactly
      // (toBeInstanceOf on a real Error subclass, not toThrow(string)).
      await expect(createFamilyInvite('user-2')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    });
  });

  // ---- REVOKE ----
  describe('revokeFamilyInvite', () => {
    it('calls revoke_family_invite with exact param name p_invite_id and resolves on success', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
      mockSupabaseClient(rpc);
      const { revokeFamilyInvite } = require('../invites');

      await expect(revokeFamilyInvite('invite-1')).resolves.toBeUndefined();
      expect(rpc).toHaveBeenCalledWith('revoke_family_invite', { p_invite_id: 'invite-1' });
    });

    it('surfaces "admin permission required" rather than swallowing it', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
      mockSupabaseClient(rpc);
      const { revokeFamilyInvite } = require('../invites');

      await expect(revokeFamilyInvite('invite-1')).rejects.toBeTruthy();
    });

    it('surfaces "invite not found" (invalid invite id)', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'invite not found' } });
      mockSupabaseClient(rpc);
      const { revokeFamilyInvite } = require('../invites');

      await expectRejectsWithMessage(revokeFamilyInvite('bogus'), 'invite not found');
    });
  });

  // ---- LIST ----
  describe('listFamilyInvites', () => {
    it('calls list_family_invites with no params and maps the deployed result shape', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          {
            invite_id: 'invite-1',
            target_user_id: 'user-2',
            target_name: 'דנה',
            target_avatar: '🐶',
            status: 'pending',
            expires_at: '2026-09-03T00:00:00Z',
            created_at: '2026-08-31T00:00:00Z',
          },
          {
            invite_id: 'invite-2',
            target_user_id: 'user-3',
            target_name: 'איתן',
            target_avatar: null,
            status: 'expired',
            expires_at: '2026-08-01T00:00:00Z',
            created_at: '2026-07-29T00:00:00Z',
          },
        ],
        error: null,
      });
      mockSupabaseClient(rpc);
      const { listFamilyInvites } = require('../invites');

      const result = await listFamilyInvites();

      expect(rpc).toHaveBeenCalledWith('list_family_invites');
      expect(result).toEqual([
        {
          inviteId: 'invite-1',
          targetUserId: 'user-2',
          targetName: 'דנה',
          targetAvatar: '🐶',
          status: 'pending',
          expiresAt: '2026-09-03T00:00:00Z',
          createdAt: '2026-08-31T00:00:00Z',
        },
        {
          inviteId: 'invite-2',
          targetUserId: 'user-3',
          targetName: 'איתן',
          targetAvatar: null,
          status: 'expired',
          expiresAt: '2026-08-01T00:00:00Z',
          createdAt: '2026-07-29T00:00:00Z',
        },
      ]);
    });

    it('preserves the server-derived effective status verbatim (no client-side re-derivation of expiry)', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          {
            invite_id: 'invite-1',
            target_user_id: 'user-2',
            target_name: 'דנה',
            target_avatar: null,
            status: 'expired',
            expires_at: '2026-08-01T00:00:00Z',
            created_at: '2026-07-29T00:00:00Z',
          },
        ],
        error: null,
      });
      mockSupabaseClient(rpc);
      const { listFamilyInvites } = require('../invites');

      const [row] = await listFamilyInvites();
      expect(row.status).toBe('expired');
    });

    it('returns an empty array rather than null/undefined when data is empty', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
      mockSupabaseClient(rpc);
      const { listFamilyInvites } = require('../invites');

      await expect(listFamilyInvites()).resolves.toEqual([]);
    });

    it('the exposed domain result never contains a token_hash or raw_token key', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          {
            invite_id: 'invite-1',
            target_user_id: 'user-2',
            target_name: 'דנה',
            target_avatar: null,
            status: 'pending',
            expires_at: '2026-09-03T00:00:00Z',
            created_at: '2026-08-31T00:00:00Z',
            // Defensive: even if the server ever accidentally included these
            // (it does not — 0008's return signature has no such columns),
            // the mapping must not carry them through.
            token_hash: 'should-never-appear',
            raw_token: 'should-never-appear',
          },
        ],
        error: null,
      });
      mockSupabaseClient(rpc);
      const { listFamilyInvites } = require('../invites');

      const [row] = await listFamilyInvites();
      expect(row).not.toHaveProperty('token_hash');
      expect(row).not.toHaveProperty('tokenHash');
      expect(row).not.toHaveProperty('raw_token');
      expect(row).not.toHaveProperty('rawToken');
      expect(JSON.stringify(row)).not.toContain('should-never-appear');
    });

    it('surfaces "admin permission required" (e.g. impersonation rejection) rather than swallowing it', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
      mockSupabaseClient(rpc);
      const { listFamilyInvites } = require('../invites');

      await expect(listFamilyInvites()).rejects.toBeTruthy();
    });
  });

  // ---- INSPECT ----
  describe('inspectFamilyInvite', () => {
    it('calls inspect_family_invite with exact param name p_token and maps a valid preview', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          {
            family_name: 'משפחת לוי',
            target_name: 'דנה',
            target_avatar: '🐶',
            status: 'pending',
            expires_at: '2026-09-03T00:00:00Z',
          },
        ],
        error: null,
      });
      mockSupabaseClient(rpc);
      const { inspectFamilyInvite } = require('../invites');

      const result = await inspectFamilyInvite('some-raw-token');

      expect(rpc).toHaveBeenCalledWith('inspect_family_invite', { p_token: 'some-raw-token' });
      expect(result).toEqual({
        familyName: 'משפחת לוי',
        targetName: 'דנה',
        targetAvatar: '🐶',
        status: 'pending',
        expiresAt: '2026-09-03T00:00:00Z',
      });
    });

    it.each(['expired', 'revoked', 'redeemed'])('maps a %s-status preview using the server-derived status verbatim', async (status) => {
      const rpc = jest.fn().mockResolvedValue({
        data: [{ family_name: 'משפחת לוי', target_name: 'דנה', target_avatar: null, status, expires_at: '2026-08-01T00:00:00Z' }],
        error: null,
      });
      mockSupabaseClient(rpc);
      const { inspectFamilyInvite } = require('../invites');

      const result = await inspectFamilyInvite('tok');
      expect(result.status).toBe(status);
    });

    it('surfaces "invite not found" for an invalid/unknown token', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'invite not found' } });
      mockSupabaseClient(rpc);
      const { inspectFamilyInvite } = require('../invites');

      await expectRejectsWithMessage(inspectFamilyInvite('bogus-token'), 'invite not found');
    });

    it('the exposed preview never contains a token_hash or raw_token key', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          {
            family_name: 'משפחת לוי',
            target_name: 'דנה',
            target_avatar: null,
            status: 'pending',
            expires_at: '2026-09-03T00:00:00Z',
            token_hash: 'should-never-appear',
          },
        ],
        error: null,
      });
      mockSupabaseClient(rpc);
      const { inspectFamilyInvite } = require('../invites');

      const result = await inspectFamilyInvite('tok');
      expect(result).not.toHaveProperty('token_hash');
      expect(result).not.toHaveProperty('tokenHash');
      expect(JSON.stringify(result)).not.toContain('should-never-appear');
    });
  });

  // ---- REDEEM ----
  describe('redeemFamilyInvite', () => {
    it('calls redeem_family_invite with exact param name p_token and maps a successful result', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [{ family_id: 'family-1', family_name: 'משפחת לוי', target_user_id: 'user-2' }],
        error: null,
      });
      mockSupabaseClient(rpc);
      const { redeemFamilyInvite } = require('../invites');

      const result = await redeemFamilyInvite('some-raw-token');

      expect(rpc).toHaveBeenCalledWith('redeem_family_invite', { p_token: 'some-raw-token' });
      expect(result).toEqual({ familyId: 'family-1', familyName: 'משפחת לוי', targetUserId: 'user-2' });
    });

    it('maps a different-family collision rejection', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'account already belongs to a different family' },
      });
      mockSupabaseClient(rpc);
      const { redeemFamilyInvite } = require('../invites');

      await expectRejectsWithMessage(redeemFamilyInvite('tok'), 'account already belongs to a different family');
    });

    it('maps an already-claimed-profile collision rejection', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'account already has a claimed profile' },
      });
      mockSupabaseClient(rpc);
      const { redeemFamilyInvite } = require('../invites');

      await expectRejectsWithMessage(redeemFamilyInvite('tok'), 'account already has a claimed profile');
    });

    it('maps a target-unavailable rejection', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'target profile is not available for this invite' },
      });
      mockSupabaseClient(rpc);
      const { redeemFamilyInvite } = require('../invites');

      await expectRejectsWithMessage(redeemFamilyInvite('tok'), 'target profile is not available for this invite');
    });

    it.each([
      ['expired invite', 'invite expired'],
      ['revoked invite', 'invite was revoked'],
      ['already-used invite (sequential replay)', 'invite already used'],
      ['invalid/unknown token', 'invite not found'],
    ])('maps %s', async (_label, serverMessage) => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: serverMessage } });
      mockSupabaseClient(rpc);
      const { redeemFamilyInvite } = require('../invites');

      await expectRejectsWithMessage(redeemFamilyInvite('tok'), serverMessage);
    });
  });

  // ---- TOKEN SAFETY ----
  describe('token safety', () => {
    it('createFamilyInvite never calls console.log/console.error/console.warn with the raw token', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const rpc = jest.fn().mockResolvedValue({
          data: [{ id: 'invite-1', raw_token: 'super-secret-raw-token-xyz', expires_at: '2026-09-03T00:00:00Z' }],
          error: null,
        });
        mockSupabaseClient(rpc);
        const { createFamilyInvite } = require('../invites');

        const result = await createFamilyInvite('user-2');

        expect(result.rawToken).toBe('super-secret-raw-token-xyz');
        for (const spy of [logSpy, warnSpy, errorSpy]) {
          for (const call of spy.mock.calls) {
            expect(call.join(' ')).not.toContain('super-secret-raw-token-xyz');
          }
        }
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it('a create failure never includes the (not-yet-issued) token in its thrown error message', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
      mockSupabaseClient(rpc);
      const { createFamilyInvite } = require('../invites');

      let caught: unknown;
      try {
        await createFamilyInvite('user-2');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeTruthy();
      expect(String((caught as Error)?.message ?? caught)).not.toMatch(/raw[_-]?token/i);
    });

    it('redeemFamilyInvite never calls console.log/console.error/console.warn with the token argument', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const rpc = jest.fn().mockResolvedValue({
          data: [{ family_id: 'family-1', family_name: 'משפחת לוי', target_user_id: 'user-2' }],
          error: null,
        });
        mockSupabaseClient(rpc);
        const { redeemFamilyInvite } = require('../invites');

        await redeemFamilyInvite('super-secret-redeem-token-xyz');

        for (const spy of [logSpy, warnSpy, errorSpy]) {
          for (const call of spy.mock.calls) {
            expect(call.join(' ')).not.toContain('super-secret-redeem-token-xyz');
          }
        }
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it('the module imports none of AsyncStorage, the Zustand store, LocalRepository, or SyncQueue (structural guarantee against durable persistence)', () => {
      // Matches only actual import/require statements, not this file's own
      // doc comments explaining what it deliberately does NOT depend on.
      const source = require('fs').readFileSync(require.resolve('../invites'), 'utf8');
      const importLines = source
        .split('\n')
        .filter((line: string) => /^\s*import\b/.test(line) || /require\(/.test(line));
      const importedText = importLines.join('\n');
      expect(importedText).not.toMatch(/AsyncStorage/);
      expect(importedText).not.toMatch(/SyncQueue/);
      expect(importedText).not.toMatch(/LocalRepository/);
      expect(importedText).not.toMatch(/OfflineFirstRepository/);
      expect(importedText).not.toMatch(/zustand/i);
      // And structurally: the only local import is ./supabase.
      expect(source).toMatch(/from '\.\/supabase'/);
    });
  });
});
