import { SupabaseRepository } from '../supabaseRepository';
import type { Dog, Family, FamilyUser, ScheduleEntry, ScheduleRule, Walk } from '../../types';

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

  it('getFamily maps a null invite_code/timezone to undefined', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: 'fam-1', name: 'x', invite_code: null, timezone: null, created_at: 'x' }, error: null }),
          }),
        }),
      }),
    };
    const family = (await new SupabaseRepository(client).getFamily('fam-1')) as Family;
    expect(family.inviteCode).toBeUndefined();
    expect(family.timezone).toBeUndefined();
  });

  it('getFamily returns undefined when no row exists', async () => {
    const client: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) };
    expect(await new SupabaseRepository(client).getFamily('fam-42')).toBeUndefined();
  });

  it('getFamily throws when the query errors', async () => {
    const client: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) };
    await expect(new SupabaseRepository(client).getFamily('fam-42')).rejects.toBeTruthy();
  });

  it('getUsers throws when the query errors', async () => {
    const client: any = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) };
    await expect(new SupabaseRepository(client).getUsers('fam-42')).rejects.toBeTruthy();
  });

  it('getUsers falls back to an empty array when data is null', async () => {
    const client: any = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }) };
    expect(await new SupabaseRepository(client).getUsers('fam-42')).toEqual([]);
  });

  it('createUser throws when the insert errors (e.g. a non-admin device)', async () => {
    const client: any = { from: () => ({ insert: () => Promise.resolve({ error: { message: '42501' } }) }) };
    const user: FamilyUser = { id: 'u1', familyId: 'fam-42', name: 'x', avatar: '🙂', color: '#000', remindersEnabled: true, createdAt: 'x' };
    await expect(new SupabaseRepository(client).createUser(user)).rejects.toBeTruthy();
  });

  it('upsertUser throws when the conditional update itself errors', async () => {
    const client: any = { from: () => ({ update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) };
    const user: FamilyUser = { id: 'u1', familyId: 'fam-42', name: 'x', avatar: '🙂', color: '#000', remindersEnabled: true, createdAt: 'x' };
    await expect(new SupabaseRepository(client).upsertUser(user)).rejects.toBeTruthy();
  });

  it('upsertUser throws when the zero-match fallback insert itself errors', async () => {
    const client: any = {
      from: () => ({
        update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
        insert: () => Promise.resolve({ error: { message: 'x' } }),
      }),
    };
    const user: FamilyUser = { id: 'u1', familyId: 'fam-42', name: 'x', avatar: '🙂', color: '#000', remindersEnabled: true, createdAt: 'x' };
    await expect(new SupabaseRepository(client).upsertUser(user)).rejects.toBeTruthy();
  });

  it('upsertDog throws when the upsert errors', async () => {
    const client: any = { from: () => ({ upsert: () => Promise.resolve({ error: { message: 'x' } }) }) };
    const dog: Dog = { id: 'dog-1', familyId: 'fam-42', name: 'x', walksPerDay: 3 };
    await expect(new SupabaseRepository(client).upsertDog(dog)).rejects.toBeTruthy();
  });

  it('upsertScheduleRule throws when the upsert errors', async () => {
    const client: any = { from: () => ({ upsert: () => Promise.resolve({ error: { message: 'x' } }) }) };
    const rule: ScheduleRule = {
      id: 'rule-1', familyId: 'fam-42', dogId: 'dog-1', time: '07:00',
      daysOfWeek: [0], rotationUserIds: ['u1'], rotationAnchorDate: '2026-08-27',
      sortOrder: 0, active: true, createdAt: 'x',
    };
    await expect(new SupabaseRepository(client).upsertScheduleRule(rule)).rejects.toBeTruthy();
  });

  it('getScheduleRules falls back to an empty array when data is null', async () => {
    const client: any = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }) };
    expect(await new SupabaseRepository(client).getScheduleRules('fam-42')).toEqual([]);
  });

  it('getScheduleEntries falls back to an empty array when data is null', async () => {
    const client: any = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }) };
    expect(await new SupabaseRepository(client).getScheduleEntries('fam-42')).toEqual([]);
  });

  it('getWalks falls back to an empty array when data is null', async () => {
    const client: any = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }) };
    expect(await new SupabaseRepository(client).getWalks('fam-42')).toEqual([]);
  });
});

/**
 * Coverage-completion pass (Release Candidate quantitative-coverage angle,
 * continuing from familyManagement.ts/verifiedAdminOnboarding.ts): the reads,
 * deletes, and row-mapping functions below had zero direct test coverage
 * before this file existed — only the family_id write-mapping checks above
 * were covered. Same bespoke-inline-mock style as the rest of this file, no
 * shared abstraction introduced.
 */
describe('SupabaseRepository — reads map rows correctly (toDog/toRule/toEntry/toWalk)', () => {
  it('getDog returns undefined when no row exists', async () => {
    const client: any = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    };
    const repo = new SupabaseRepository(client);
    expect(await repo.getDog('fam-42')).toBeUndefined();
  });

  it('getDog throws when the query errors', async () => {
    const client: any = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }),
    };
    const repo = new SupabaseRepository(client);
    await expect(repo.getDog('fam-42')).rejects.toBeTruthy();
  });

  it('getDog maps a full row, including nullish photo_url/notes/sex -> undefined', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: 'dog-1', family_id: 'fam-42', name: 'טופי', photo_url: null, walks_per_day: 3, notes: null, sex: null },
                error: null,
              }),
          }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const dog = (await repo.getDog('fam-42')) as Dog;
    expect(dog).toEqual({ id: 'dog-1', familyId: 'fam-42', name: 'טופי', photoUrl: undefined, walksPerDay: 3, notes: undefined, sex: undefined });
  });

  it('getDog maps a full row with photo_url/notes/sex present', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: 'dog-1', family_id: 'fam-42', name: 'טופי', photo_url: 'https://x/y.png', walks_per_day: 3, notes: 'אוהב לרוץ', sex: 'male' },
                error: null,
              }),
          }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const dog = (await repo.getDog('fam-42')) as Dog;
    expect(dog.photoUrl).toBe('https://x/y.png');
    expect(dog.notes).toBe('אוהב לרוץ');
    expect(dog.sex).toBe('male');
  });

  it('getDogs maps every row for the family via toDog (arbitrary N, not just one)', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                { id: 'dog-1', family_id: 'fam-42', name: 'טופי', photo_url: null, walks_per_day: 4, notes: null, sex: null },
                { id: 'dog-2', family_id: 'fam-42', name: 'ריקי', photo_url: null, walks_per_day: 2, notes: null, sex: null },
              ],
              error: null,
            }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const dogs = await repo.getDogs('fam-42');
    expect(dogs).toEqual([
      { id: 'dog-1', familyId: 'fam-42', name: 'טופי', photoUrl: undefined, walksPerDay: 4, notes: undefined, sex: undefined },
      { id: 'dog-2', familyId: 'fam-42', name: 'ריקי', photoUrl: undefined, walksPerDay: 2, notes: undefined, sex: undefined },
    ]);
  });

  it('getDogs throws when the query errors', async () => {
    const client: any = {
      from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }),
    };
    const repo = new SupabaseRepository(client);
    await expect(repo.getDogs('fam-42')).rejects.toBeTruthy();
  });

  it('getScheduleRules maps rows via toRule, including nullish label -> undefined and sort_order default 0', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                {
                  id: 'rule-1', family_id: 'fam-42', dog_id: 'dog-1', time: '07:00', label: null,
                  days_of_week: [0, 1], rotation_user_ids: ['user-1'], rotation_anchor_date: '2026-08-27',
                  sort_order: null, active: true, created_at: 'x',
                },
                {
                  id: 'rule-2', family_id: 'fam-42', dog_id: 'dog-1', time: '14:00', label: 'טיול צהריים',
                  days_of_week: [0, 1], rotation_user_ids: ['user-1'], rotation_anchor_date: '2026-08-27',
                  sort_order: 2, active: false, created_at: 'x',
                },
              ],
              error: null,
            }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const rules = await repo.getScheduleRules('fam-42');
    expect(rules[0].label).toBeUndefined();
    expect(rules[0].sortOrder).toBe(0);
    expect(rules[1].label).toBe('טיול צהריים');
    expect(rules[1].sortOrder).toBe(2);
    expect(rules[1].active).toBe(false);
  });

  it('getScheduleRules throws when the query errors', async () => {
    const client: any = {
      from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }),
    };
    const repo = new SupabaseRepository(client);
    await expect(repo.getScheduleRules('fam-42')).rejects.toBeTruthy();
  });

  it('getScheduleEntries maps rows via toEntry, including nullish rule_id -> undefined', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                { id: 'entry-1', family_id: 'fam-42', dog_id: 'dog-1', rule_id: null, date: '2026-08-30', time: '07:00', responsible_user_id: 'user-1', created_at: 'x' },
                { id: 'entry-2', family_id: 'fam-42', dog_id: 'dog-1', rule_id: 'rule-1', date: '2026-08-31', time: '07:00', responsible_user_id: 'user-1', created_at: 'x' },
              ],
              error: null,
            }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const entries = await repo.getScheduleEntries('fam-42');
    expect(entries[0].ruleId).toBeUndefined();
    expect(entries[1].ruleId).toBe('rule-1');
  });

  it('getScheduleEntries throws when the query errors', async () => {
    const client: any = {
      from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }),
    };
    const repo = new SupabaseRepository(client);
    await expect(repo.getScheduleEntries('fam-42')).rejects.toBeTruthy();
  });

  it('getWalks maps rows via toWalk, with all optional fields nullish -> undefined and no swap', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                {
                  id: 'walk-1', family_id: 'fam-42', schedule_entry_id: null, dog_id: 'dog-1',
                  date: '2026-08-30', scheduled_time: '07:00', responsible_user_id: 'user-1',
                  status: 'pending', completed_at: null, completed_by_user_id: null,
                  had_pee: null, had_poop: null, note: null, duration_minutes: null,
                  is_unplanned: null, swap_new_user_id: null,
                  created_at: 'x', updated_at: 'y',
                },
              ],
              error: null,
            }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const walks = await repo.getWalks('fam-42');
    expect(walks[0].scheduleEntryId).toBeUndefined();
    expect(walks[0].swap).toBeUndefined();
    expect(walks[0].hadPee).toBeUndefined();
    expect(walks[0].isUnplanned).toBeUndefined();
  });

  it('getWalks maps a completed, swapped walk row with every optional field present', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                {
                  id: 'walk-2', family_id: 'fam-42', schedule_entry_id: 'entry-1', dog_id: 'dog-1',
                  date: '2026-08-30', scheduled_time: '07:00', responsible_user_id: 'user-2',
                  status: 'done', completed_at: '2026-08-30T07:10:00.000Z', completed_by_user_id: 'user-2',
                  had_pee: true, had_poop: false, note: 'טיול טוב', duration_minutes: 20,
                  is_unplanned: true,
                  swap_original_user_id: 'user-1', swap_new_user_id: 'user-2',
                  swap_swapped_at: '2026-08-29T00:00:00.000Z', swap_swapped_by_user_id: 'user-1',
                  created_at: 'x', updated_at: 'y',
                },
              ],
              error: null,
            }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const walks = await repo.getWalks('fam-42');
    expect(walks[0].scheduleEntryId).toBe('entry-1');
    expect(walks[0].swap).toEqual({
      originalUserId: 'user-1',
      newUserId: 'user-2',
      swappedAt: '2026-08-29T00:00:00.000Z',
      swappedByUserId: 'user-1',
    });
    expect(walks[0].isUnplanned).toBe(true);
  });

  it('getWalks throws when the query errors', async () => {
    const client: any = {
      from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }),
    };
    const repo = new SupabaseRepository(client);
    await expect(repo.getWalks('fam-42')).rejects.toBeTruthy();
  });
});

describe('SupabaseRepository — deletes and simple updates', () => {
  it('deleteUser calls .from("users").delete().eq("id", userId)', async () => {
    const calls: string[] = [];
    const client: any = {
      from: (table: string) => ({
        delete: () => ({
          eq: (col: string, val: string) => {
            calls.push(`${table}.delete.eq(${col},${val})`);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    await repo.deleteUser('user-1');
    expect(calls).toEqual(['users.delete.eq(id,user-1)']);
  });

  it('deleteUser throws on error (expected — RLS blocks direct user deletes)', async () => {
    const client: any = {
      from: () => ({ delete: () => ({ eq: () => Promise.resolve({ error: { message: '42501' } }) }) }),
    };
    const repo = new SupabaseRepository(client);
    await expect(repo.deleteUser('user-1')).rejects.toBeTruthy();
  });

  it('updateUserReminderSetting updates reminders_enabled for the given userId', async () => {
    const calls: unknown[] = [];
    const client: any = {
      from: () => ({
        update: (payload: unknown) => ({
          eq: (col: string, val: string) => {
            calls.push({ payload, col, val });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    await repo.updateUserReminderSetting('user-1', false);
    expect(calls).toEqual([{ payload: { reminders_enabled: false }, col: 'id', val: 'user-1' }]);
  });

  it('updateUserReminderSetting throws on error', async () => {
    const client: any = {
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: { message: 'x' } }) }) }),
    };
    const repo = new SupabaseRepository(client);
    await expect(repo.updateUserReminderSetting('user-1', true)).rejects.toBeTruthy();
  });

  it('deleteFamilyMember maps a non-empty updatedWalks list through the walk_updates callback', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const client: any = { rpc };
    const repo = new SupabaseRepository(client);

    await repo.deleteFamilyMember({
      userId: 'user-1',
      updatedRules: [],
      updatedEntries: [],
      updatedWalks: [{ id: 'walk-1', responsibleUserId: 'user-2' } as Walk],
    });

    expect(rpc).toHaveBeenCalledWith('admin_delete_family_member', {
      target_user_id: 'user-1',
      rule_updates: [],
      entry_updates: [],
      walk_updates: [{ id: 'walk-1', responsible_user_id: 'user-2' }],
    });
  });

  it('deleteScheduleRule calls .from("schedule_rules").delete().eq("id", ruleId) and throws on error', async () => {
    const calls: string[] = [];
    const okClient: any = {
      from: (table: string) => ({ delete: () => ({ eq: (col: string, val: string) => { calls.push(`${table}.${col}.${val}`); return Promise.resolve({ error: null }); } }) }),
    };
    await new SupabaseRepository(okClient).deleteScheduleRule('rule-1');
    expect(calls).toEqual(['schedule_rules.id.rule-1']);

    const errClient: any = { from: () => ({ delete: () => ({ eq: () => Promise.resolve({ error: { message: 'x' } }) }) }) };
    await expect(new SupabaseRepository(errClient).deleteScheduleRule('rule-1')).rejects.toBeTruthy();
  });

  it('deleteScheduleEntry calls .from("schedule_entries").delete().eq("id", entryId) and throws on error', async () => {
    const calls: string[] = [];
    const okClient: any = {
      from: (table: string) => ({ delete: () => ({ eq: (col: string, val: string) => { calls.push(`${table}.${col}.${val}`); return Promise.resolve({ error: null }); } }) }),
    };
    await new SupabaseRepository(okClient).deleteScheduleEntry('entry-1');
    expect(calls).toEqual(['schedule_entries.id.entry-1']);

    const errClient: any = { from: () => ({ delete: () => ({ eq: () => Promise.resolve({ error: { message: 'x' } }) }) }) };
    await expect(new SupabaseRepository(errClient).deleteScheduleEntry('entry-1')).rejects.toBeTruthy();
  });

  it('deleteWalk calls .from("walks").delete().eq("id", walkId) and throws on error', async () => {
    const calls: string[] = [];
    const okClient: any = {
      from: (table: string) => ({ delete: () => ({ eq: (col: string, val: string) => { calls.push(`${table}.${col}.${val}`); return Promise.resolve({ error: null }); } }) }),
    };
    await new SupabaseRepository(okClient).deleteWalk('walk-1');
    expect(calls).toEqual(['walks.id.walk-1']);

    const errClient: any = { from: () => ({ delete: () => ({ eq: () => Promise.resolve({ error: { message: 'x' } }) }) }) };
    await expect(new SupabaseRepository(errClient).deleteWalk('walk-1')).rejects.toBeTruthy();
  });
});

describe('SupabaseRepository — schedule entry writes', () => {
  const entry: ScheduleEntry = {
    id: 'entry-1', familyId: 'fam-42', dogId: 'dog-1', ruleId: 'rule-1',
    date: '2026-08-30', time: '07:00', responsibleUserId: 'user-1', createdAt: 'x',
  };

  it('addScheduleEntries is a no-op when given an empty array (never calls the client)', async () => {
    const client: any = { from: jest.fn() };
    await new SupabaseRepository(client).addScheduleEntries([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('addScheduleEntries upserts mapped rows with the dog_id,date,time conflict target, ignoring duplicates', async () => {
    let captured: { payload: unknown; opts: unknown } | undefined;
    const client: any = {
      from: () => ({
        upsert: (payload: unknown, opts: unknown) => {
          captured = { payload, opts };
          return Promise.resolve({ error: null });
        },
      }),
    };
    await new SupabaseRepository(client).addScheduleEntries([entry]);
    expect(captured?.opts).toEqual({ onConflict: 'dog_id,date,time', ignoreDuplicates: true });
    expect((captured?.payload as any[])[0]).toEqual({
      id: 'entry-1', family_id: 'fam-42', dog_id: 'dog-1', rule_id: 'rule-1', date: '2026-08-30', time: '07:00', responsible_user_id: 'user-1',
    });
  });

  it('addScheduleEntries throws on error', async () => {
    const client: any = { from: () => ({ upsert: () => Promise.resolve({ error: { message: 'x' } }) }) };
    await expect(new SupabaseRepository(client).addScheduleEntries([entry])).rejects.toBeTruthy();
  });

  it('updateScheduleEntry upserts the mapped row, including a null rule_id for a ruleId-less entry', async () => {
    let captured: unknown;
    const client: any = { from: () => ({ upsert: (payload: unknown) => { captured = payload; return Promise.resolve({ error: null }); } }) };
    await new SupabaseRepository(client).updateScheduleEntry({ ...entry, ruleId: undefined });
    expect((captured as any).rule_id).toBeNull();
  });

  it('updateScheduleEntry throws on error', async () => {
    const client: any = { from: () => ({ upsert: () => Promise.resolve({ error: { message: 'x' } }) }) };
    await expect(new SupabaseRepository(client).updateScheduleEntry(entry)).rejects.toBeTruthy();
  });
});

describe('SupabaseRepository — saveWalk (the "two people mark done at once" race)', () => {
  const baseWalk: Walk = {
    id: 'walk-1', familyId: 'fam-42', dogId: 'dog-1', date: '2026-08-30',
    scheduledTime: '07:00', responsibleUserId: 'user-1', status: 'pending',
    createdAt: 'x', updatedAt: 'x',
  };

  it('status "done": updates the still-pending row and never falls back to an upsert when it matches', async () => {
    const calls: string[] = [];
    const client: any = {
      from: () => ({
        update: () => ({ eq: () => ({ eq: () => ({ select: () => { calls.push('update'); return Promise.resolve({ data: [{ id: 'walk-1' }], error: null }); } }) }) }),
        upsert: () => { calls.push('upsert'); return Promise.resolve({ error: null }); },
      }),
    };
    await new SupabaseRepository(client).saveWalk({ ...baseWalk, status: 'done' });
    expect(calls).toEqual(['update']);
  });

  it('status "done": throws if the conditional update itself errors', async () => {
    const client: any = { from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) }) };
    await expect(new SupabaseRepository(client).saveWalk({ ...baseWalk, status: 'done' })).rejects.toBeTruthy();
  });

  it('status "done": falls back to an idempotent upsert when no pending row matched (unplanned or already completed by someone else)', async () => {
    const calls: string[] = [];
    let upsertOpts: unknown;
    const client: any = {
      from: () => ({
        update: () => ({ eq: () => ({ eq: () => ({ select: () => { calls.push('update'); return Promise.resolve({ data: [], error: null }); } }) }) }),
        upsert: (_payload: unknown, opts: unknown) => { calls.push('upsert'); upsertOpts = opts; return Promise.resolve({ error: null }); },
      }),
    };
    await new SupabaseRepository(client).saveWalk({ ...baseWalk, status: 'done' });
    expect(calls).toEqual(['update', 'upsert']);
    expect(upsertOpts).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('status "done": throws if the fallback upsert itself errors', async () => {
    const client: any = {
      from: () => ({
        update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) }),
        upsert: () => Promise.resolve({ error: { message: 'x' } }),
      }),
    };
    await expect(new SupabaseRepository(client).saveWalk({ ...baseWalk, status: 'done' })).rejects.toBeTruthy();
  });

  it('status "pending"/"skipped": upserts directly, skipping the atomic-update race path entirely', async () => {
    const calls: string[] = [];
    const client: any = { from: () => ({ update: jest.fn(), upsert: () => { calls.push('upsert'); return Promise.resolve({ error: null }); } }) };
    await new SupabaseRepository(client).saveWalk({ ...baseWalk, status: 'pending' });
    expect(calls).toEqual(['upsert']);
  });

  it('status "pending": throws on upsert error', async () => {
    const client: any = { from: () => ({ upsert: () => Promise.resolve({ error: { message: 'x' } }) }) };
    await expect(new SupabaseRepository(client).saveWalk(baseWalk)).rejects.toBeTruthy();
  });

  it('fromWalk maps a valid-UUID swap.swappedByUserId through, but drops a non-UUID one to null', async () => {
    let captured: any;
    const client: any = { from: () => ({ upsert: (payload: unknown) => { captured = payload; return Promise.resolve({ error: null }); } }) };
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    await new SupabaseRepository(client).saveWalk({
      ...baseWalk,
      swap: { originalUserId: 'user-1', newUserId: 'user-2', swappedAt: 'x', swappedByUserId: validUuid },
    });
    expect(captured.swap_swapped_by_user_id).toBe(validUuid);

    await new SupabaseRepository(client).saveWalk({
      ...baseWalk,
      swap: { originalUserId: 'user-1', newUserId: 'user-2', swappedAt: 'x', swappedByUserId: 'not-a-uuid' },
    });
    expect(captured.swap_swapped_by_user_id).toBeNull();
  });
});

describe('SupabaseRepository — getNotificationSettings', () => {
  it('derives one setting per user, with enabled mirroring remindersEnabled', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                { id: 'user-1', family_id: 'fam-42', name: 'א', avatar: '👨', color: '#000', reminders_enabled: true, created_at: 'x' },
                { id: 'user-2', family_id: 'fam-42', name: 'ב', avatar: '👩', color: '#000', reminders_enabled: false, created_at: 'x' },
              ],
              error: null,
            }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const settings = await repo.getNotificationSettings('fam-42');
    expect(settings).toHaveLength(2);
    expect(settings.find((s) => s.userId === 'user-1')?.enabled).toBe(true);
    expect(settings.find((s) => s.userId === 'user-2')?.enabled).toBe(false);
  });
});
