import { SupabaseRepository } from '../supabaseRepository';
import type { Dog, Family, FamilyUser, ScheduleRule } from '../../types';

/**
 * Verifies the SupabaseRepository <-> Postgres row mapping — specifically
 * that every write actually carries the right family_id (the RLS policies
 * in supabase/migrations/0002_*.sql enforce that a device can only write
 * its OWN family_id in practice, but that's a database guarantee; this is
 * the client-side half — that the app never accidentally sends the wrong
 * one, or omits it).
 */
function makeMockClient(opts: { updateMatches?: boolean } = {}) {
  const calls: { table: string; method: string; payload: unknown }[] = [];
  // QA pass v3, issue 1: `upsertUser` is now `.update().eq().select()`, with
  // a fallback `.insert()` when zero rows matched (see supabaseRepository.ts's
  // doc comment) — `opts.updateMatches` (default true) simulates whether the
  // `.update()` actually matched an existing row.
  const updateMatches = opts.updateMatches ?? true;
  const client: any = {
    from: (table: string) => ({
      upsert: (payload: unknown) => {
        calls.push({ table, method: 'upsert', payload });
        return Promise.resolve({ error: null });
      },
      insert: (payload: unknown) => {
        calls.push({ table, method: 'insert', payload });
        return Promise.resolve({ error: null });
      },
      update: (payload: unknown) => ({
        eq: () => ({
          select: () => {
            calls.push({ table, method: 'update', payload });
            return Promise.resolve({ data: updateMatches ? [{ id: 'x' }] : [], error: null });
          },
        }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  };
  return { client, calls };
}

describe('SupabaseRepository — writes carry the correct familyId', () => {
  it('upsertUser sends family_id mapped from user.familyId', async () => {
    const { client, calls } = makeMockClient();
    const repo = new SupabaseRepository(client);
    const user: FamilyUser = {
      id: 'user-1',
      familyId: 'fam-42',
      name: 'אבא',
      avatar: '👨',
      color: '#5B8DEF',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };

    await repo.upsertUser(user);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('users');
    expect((calls[0].payload as any).family_id).toBe('fam-42');
  });

  /**
   * QA pass v3, issue 1 (root-cause fix). PRE-EXISTING TEST NOTE: the test
   * above ("upsertUser sends family_id...") previously asserted `upsertUser`
   * calls `.upsert()` — that assertion described the OLD, buggy behavior
   * (see repository.ts/supabaseRepository.ts's doc comments: `.upsert()`
   * sends `INSERT ... ON CONFLICT DO UPDATE`, which Postgres's RLS checks
   * against the admin-only INSERT policy even for a legitimate self-profile
   * UPDATE, producing the reported 42501). It has been updated (via
   * `makeMockClient`, above) to route through `.update()` instead, which is
   * genuinely new intended behavior, not a weakened assertion — the
   * family_id-is-correctly-mapped assertion it exists to check is unchanged.
   */
  it('upsertUser calls .update() (not .upsert()/.insert()) for an existing row — the RLS 42501 fix', async () => {
    const { client, calls } = makeMockClient({ updateMatches: true });
    const repo = new SupabaseRepository(client);
    const user: FamilyUser = {
      id: 'user-1',
      familyId: 'fam-42',
      name: 'אבא',
      avatar: '👨',
      color: '#5B8DEF',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };

    await repo.upsertUser(user);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('update');
    expect(calls[0].table).toBe('users');
    expect((calls[0].payload as any).family_id).toBe('fam-42');
  });

  it('upsertUser falls back to .insert() when .update() matches zero rows (legacy pre-fix queued create)', async () => {
    const { client, calls } = makeMockClient({ updateMatches: false });
    const repo = new SupabaseRepository(client);
    const user: FamilyUser = {
      id: 'user-new',
      familyId: 'fam-42',
      name: 'בן משפחה חדש',
      avatar: '🙂',
      color: '#5B8DEF',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };

    await repo.upsertUser(user);

    expect(calls.map((c) => c.method)).toEqual(['update', 'insert']);
    expect((calls[1].payload as any).family_id).toBe('fam-42');
  });

  it('createUser calls .insert() (the admin-authorized new-row path)', async () => {
    const { client, calls } = makeMockClient();
    const repo = new SupabaseRepository(client);
    const user: FamilyUser = {
      id: 'user-brand-new',
      familyId: 'fam-42',
      name: 'בן משפחה',
      avatar: '🙂',
      color: '#5B8DEF',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };

    await repo.createUser(user);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('insert');
    expect(calls[0].table).toBe('users');
  });

  it('upsertDog sends family_id mapped from dog.familyId', async () => {
    const { client, calls } = makeMockClient();
    const repo = new SupabaseRepository(client);
    const dog: Dog = { id: 'dog-1', familyId: 'fam-42', name: 'טופי', walksPerDay: 4 };

    await repo.upsertDog(dog);

    expect(calls[0].table).toBe('dogs');
    expect((calls[0].payload as any).family_id).toBe('fam-42');
  });

  it('upsertScheduleRule sends family_id mapped from rule.familyId', async () => {
    const { client, calls } = makeMockClient();
    const repo = new SupabaseRepository(client);
    const rule: ScheduleRule = {
      id: 'rule-1',
      familyId: 'fam-42',
      dogId: 'dog-1',
      time: '07:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-1'],
      rotationAnchorDate: '2026-08-27',
      sortOrder: 0,
      active: true,
      createdAt: new Date().toISOString(),
    };

    await repo.upsertScheduleRule(rule);

    expect(calls[0].table).toBe('schedule_rules');
    expect((calls[0].payload as any).family_id).toBe('fam-42');
  });

  it('getUsers maps removed_at -> removedAt (undefined when null) so History can tell a soft-deleted member apart from an active one', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                { id: 'user-1', family_id: 'fam-42', name: 'אבא', avatar: '👨', color: '#000', reminders_enabled: true, created_at: 'x', removed_at: null },
                { id: 'user-2', family_id: 'fam-42', name: 'אמא', avatar: '👩', color: '#000', reminders_enabled: true, created_at: 'x', removed_at: '2026-08-29T00:00:00.000Z' },
              ],
              error: null,
            }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);

    const users = await repo.getUsers('fam-42');
    expect(users.find((u) => u.id === 'user-1')?.removedAt).toBeUndefined();
    expect(users.find((u) => u.id === 'user-2')?.removedAt).toBe('2026-08-29T00:00:00.000Z');
  });

  it('deleteFamilyMember calls the admin_delete_family_member RPC with the target user and mapped payloads', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const client: any = { rpc };
    const repo = new SupabaseRepository(client);

    await repo.deleteFamilyMember({
      userId: 'user-1',
      updatedRules: [
        {
          id: 'rule-1',
          familyId: 'fam-42',
          dogId: 'dog-1',
          time: '07:00',
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          rotationUserIds: ['user-2', 'user-3'],
          rotationAnchorDate: '2026-08-27',
          sortOrder: 0,
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
      updatedEntries: [
        { id: 'entry-1', familyId: 'fam-42', dogId: 'dog-1', date: '2026-08-30', time: '07:00', responsibleUserId: 'user-2', createdAt: new Date().toISOString() },
      ],
      updatedWalks: [],
    });

    expect(rpc).toHaveBeenCalledWith('admin_delete_family_member', {
      target_user_id: 'user-1',
      rule_updates: [{ id: 'rule-1', rotation_user_ids: ['user-2', 'user-3'] }],
      entry_updates: [{ id: 'entry-1', responsible_user_id: 'user-2' }],
      walk_updates: [],
    });
  });

  it('deleteFamilyMember throws when the RPC reports an error (e.g. a Member calling it directly — admin permission required)', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
    const client: any = { rpc };
    const repo = new SupabaseRepository(client);

    await expect(
      repo.deleteFamilyMember({ userId: 'user-1', updatedRules: [], updatedEntries: [], updatedWalks: [] })
    ).rejects.toBeTruthy();
  });

  it('getFamily maps invite_code -> inviteCode', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: 'fam-42', name: 'המשפחה שלנו', invite_code: 'ABC123', created_at: new Date().toISOString() },
                error: null,
              }),
          }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);

    const family = (await repo.getFamily('fam-42')) as Family;
    expect(family.id).toBe('fam-42');
    expect(family.inviteCode).toBe('ABC123');
  });
});
