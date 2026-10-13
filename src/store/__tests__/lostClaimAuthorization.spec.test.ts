/**
 * NARROW MIGRATION/SECURITY FIX — "lost-claim admin-restoration" bug.
 *
 * The real fix lives entirely server-side, in
 * migrations/0016_*.sql's current_family_role()/is_real_family_admin() —
 * see those two functions' own doc comments, and the "LOST-CLAIM
 * ADVERSARIAL WALKTHROUGH" comment block right above set_member_role() in
 * that file, for the authoritative SQL-level reasoning covering all 10
 * required adversarial cases. There is no live Postgres database in this
 * sandbox (see this pass's delivery report — node_modules has never been
 * present across this entire engagement), so nothing here executes the
 * actual SQL.
 *
 * What THIS file is: a small, deliberately literal pure-JS mirror of the
 * SAME decision logic those two SQL functions implement (persona branch
 * first; else a genuine "does this family have ANY active persona yet"
 * bootstrap check; else fail closed) — kept in lockstep with the SQL by
 * hand — so the 10 required adversarial cases can be exercised as real,
 * executable assertions wherever the reasoning is expressible as pure
 * logic, independent of a live database. This is a SPECIFICATION check
 * (does the decision table itself behave correctly for every case), not a
 * proof that the deployed SQL matches this mirror line-for-line — that
 * correspondence is what the migration's own inline SQL comments establish
 * by direct reasoning against the actual statements.
 */

interface Persona {
  id: string;
  familyId: string;
  role: 'admin' | 'member';
  removedAt: string | null;
  authUserId: string | null; // null = unclaimed
}

interface FamilyAuthMember {
  authUserId: string;
  familyId: string;
  role: 'admin' | 'member';
}

/** Mirrors real_current_profile_id() + current_family_role(). */
function resolveFamilyRole(
  authUserId: string,
  personas: Persona[],
  members: FamilyAuthMember[]
): 'admin' | 'member' | null {
  const claimed = personas.find((p) => p.authUserId === authUserId && p.removedAt === null);
  if (claimed) return claimed.role; // persona branch — unaffected by this fix

  const member = members.find((m) => m.authUserId === authUserId);
  if (!member) return null; // no family_auth_members row at all yet

  // Bootstrap predicate — exact mirror of bootstrap_first_member_role()'s
  // own `exists (select 1 from users where family_id = fam and removed_at
  // is null)`, reused by current_family_role()'s fallback gate.
  const familyHasActivePersonas = personas.some((p) => p.familyId === member.familyId && p.removedAt === null);
  if (familyHasActivePersonas) return null; // THE FIX: fail closed, not the old family_auth_members.role fallback

  return member.role; // genuine bootstrap — zero active personas in this family yet
}

/** Mirrors real_current_profile_id() + is_real_family_admin(target_family_id). */
function resolveIsFamilyAdmin(
  authUserId: string,
  targetFamilyId: string,
  personas: Persona[],
  members: FamilyAuthMember[]
): boolean {
  const claimed = personas.find((p) => p.authUserId === authUserId && p.removedAt === null);
  if (claimed) return claimed.familyId === targetFamilyId && claimed.role === 'admin';

  const familyHasActivePersonas = personas.some((p) => p.familyId === targetFamilyId && p.removedAt === null);
  if (familyHasActivePersonas) return false; // THE FIX

  const member = members.find((m) => m.authUserId === authUserId && m.familyId === targetFamilyId);
  return Boolean(member && member.role === 'admin');
}

describe('lost-claim admin-restoration fix — pure-logic spec mirror of current_family_role()/is_real_family_admin()', () => {
  const FAMILY = 'family-1';

  it('case 1: brand-new family, zero active users — creator can perform the minimum legitimate bootstrap action', () => {
    const members: FamilyAuthMember[] = [{ authUserId: 'device-a', familyId: FAMILY, role: 'admin' }];
    const personas: Persona[] = [];
    expect(resolveIsFamilyAdmin('device-a', FAMILY, personas, members)).toBe(true);
    expect(resolveFamilyRole('device-a', personas, members)).toBe('admin');
  });

  it('case 2: first persona created and claimed — bootstrap window closes, resolves via the persona branch', () => {
    const members: FamilyAuthMember[] = [{ authUserId: 'device-a', familyId: FAMILY, role: 'admin' }];
    const personas: Persona[] = [{ id: 'dad', familyId: FAMILY, role: 'admin', removedAt: null, authUserId: 'device-a' }];
    expect(resolveFamilyRole('device-a', personas, members)).toBe('admin');
    expect(resolveIsFamilyAdmin('device-a', FAMILY, personas, members)).toBe(true);
    // A DIFFERENT device with no claim of its own can no longer bootstrap
    // into this family — the window is genuinely closed now that an
    // active persona exists.
    const strangerMembers: FamilyAuthMember[] = [{ authUserId: 'device-x', familyId: FAMILY, role: 'admin' }];
    expect(resolveIsFamilyAdmin('device-x', FAMILY, personas, strangerMembers)).toBe(false);
  });

  it('case 3: Dad/Admin -> Idan/Member real switch on the SAME device — resolves member while claimed', () => {
    const members: FamilyAuthMember[] = [{ authUserId: 'device-a', familyId: FAMILY, role: 'admin' }];
    const personas: Persona[] = [
      { id: 'dad', familyId: FAMILY, role: 'admin', removedAt: null, authUserId: null },
      { id: 'idan', familyId: FAMILY, role: 'member', removedAt: null, authUserId: 'device-a' },
    ];
    expect(resolveFamilyRole('device-a', personas, members)).toBe('member');
    expect(resolveIsFamilyAdmin('device-a', FAMILY, personas, members)).toBe(false);
  });

  it('case 4 (THE CORE FIX): Device B claims Idan away from Device A — A gets NO role and is NOT admin, even though A\'s family_auth_members.role is still "admin"', () => {
    const members: FamilyAuthMember[] = [
      { authUserId: 'device-a', familyId: FAMILY, role: 'admin' }, // stale — A created this family, never demoted here
      { authUserId: 'device-b', familyId: FAMILY, role: 'member' },
    ];
    const personas: Persona[] = [
      { id: 'dad', familyId: FAMILY, role: 'admin', removedAt: null, authUserId: null },
      { id: 'idan', familyId: FAMILY, role: 'member', removedAt: null, authUserId: 'device-b' }, // B just took it from A
    ];
    // A holds no claim at all now.
    expect(resolveFamilyRole('device-a', personas, members)).toBeNull();
    expect(resolveIsFamilyAdmin('device-a', FAMILY, personas, members)).toBe(false);

    // Sanity: under the OLD (buggy) logic — "persona_id is null" alone
    // gating the fallback, with no bootstrap check — A WOULD have
    // incorrectly resolved admin here. Demonstrate the old bug explicitly
    // so this test also documents what was wrong, not just what's right now.
    function oldBuggyIsFamilyAdmin(authUserId: string, targetFamilyId: string, ps: Persona[], ms: FamilyAuthMember[]): boolean {
      const claimed = ps.find((p) => p.authUserId === authUserId && p.removedAt === null);
      if (claimed) return claimed.familyId === targetFamilyId && claimed.role === 'admin';
      const member = ms.find((m) => m.authUserId === authUserId && m.familyId === targetFamilyId);
      return Boolean(member && member.role === 'admin'); // no bootstrap gate at all — the bug
    }
    expect(oldBuggyIsFamilyAdmin('device-a', FAMILY, personas, members)).toBe(true); // the vulnerability, reproduced
  });

  it('case 5: enforcement is a pure function of server-side state, independent of any "revalidation already ran" flag', () => {
    // There is no such flag anywhere in this model — resolveIsFamilyAdmin
    // takes only server-shaped state (personas, members) and always
    // recomputes from scratch. Calling it "before" vs. "after" some
    // imagined client revalidation step produces the IDENTICAL result,
    // because the function has no notion of client revalidation at all —
    // which is exactly the point: enforcement lives at this layer alone.
    const members: FamilyAuthMember[] = [{ authUserId: 'device-a', familyId: FAMILY, role: 'admin' }];
    const personas: Persona[] = [
      { id: 'dad', familyId: FAMILY, role: 'admin', removedAt: null, authUserId: null },
      { id: 'idan', familyId: FAMILY, role: 'member', removedAt: null, authUserId: 'device-b' },
    ];
    const resultA = resolveIsFamilyAdmin('device-a', FAMILY, personas, members);
    const resultB = resolveIsFamilyAdmin('device-a', FAMILY, personas, members); // same inputs, called again
    expect(resultA).toBe(false);
    expect(resultB).toBe(false);
  });

  it('case 6: A reclaims Dad with the correct PIN — admin restored', () => {
    const members: FamilyAuthMember[] = [{ authUserId: 'device-a', familyId: FAMILY, role: 'admin' }];
    const personas: Persona[] = [
      { id: 'dad', familyId: FAMILY, role: 'admin', removedAt: null, authUserId: 'device-a' }, // reclaimed
      { id: 'idan', familyId: FAMILY, role: 'member', removedAt: null, authUserId: 'device-b' },
    ];
    expect(resolveFamilyRole('device-a', personas, members)).toBe('admin');
    expect(resolveIsFamilyAdmin('device-a', FAMILY, personas, members)).toBe(true);
  });

  it('case 7: A reclaims Idan instead — member again', () => {
    const members: FamilyAuthMember[] = [{ authUserId: 'device-a', familyId: FAMILY, role: 'admin' }];
    const personas: Persona[] = [
      { id: 'dad', familyId: FAMILY, role: 'admin', removedAt: null, authUserId: null },
      { id: 'idan', familyId: FAMILY, role: 'member', removedAt: null, authUserId: 'device-a' },
    ];
    expect(resolveFamilyRole('device-a', personas, members)).toBe('member');
    expect(resolveIsFamilyAdmin('device-a', FAMILY, personas, members)).toBe(false);
  });

  it('case 8: local stale currentUserId cannot restore server privilege — the resolver never reads any client-supplied id', () => {
    // resolveFamilyRole/resolveIsFamilyAdmin take only authUserId (the
    // device's real authenticated identity — the server-side analogue of
    // auth.uid(), never client-suppliable) plus server state. There is no
    // parameter here for "what the client THINKS its currentUserId is" —
    // by construction, nothing a client claims about its own local state
    // can influence the result.
    const members: FamilyAuthMember[] = [{ authUserId: 'device-a', familyId: FAMILY, role: 'admin' }];
    const personas: Persona[] = [
      { id: 'dad', familyId: FAMILY, role: 'admin', removedAt: null, authUserId: null },
      { id: 'idan', familyId: FAMILY, role: 'member', removedAt: null, authUserId: 'device-b' },
    ];
    // "A's local currentUserId still says dad" has no representation in
    // this function's inputs at all — proving it can't matter.
    expect(resolveFamilyRole.length).toBe(3); // (authUserId, personas, members) — no client-state parameter
    expect(resolveFamilyRole('device-a', personas, members)).toBeNull();
  });

  it('case 9: QA full reset leaves a QA family with zero personas — fresh-onboarding bootstrap still works there', () => {
    const QA_FAMILY = 'qa-family-1';
    const members: FamilyAuthMember[] = [{ authUserId: 'device-a', familyId: QA_FAMILY, role: 'admin' }];
    // qa_reset_full() just deleted every persona in this QA family.
    const personas: Persona[] = [];
    expect(resolveIsFamilyAdmin('device-a', QA_FAMILY, personas, members)).toBe(true);
    expect(resolveFamilyRole('device-a', personas, members)).toBe('admin');
  });

  it('case 10: joining an existing family with active personas but no claimed profile yet — no accidental admin via the fallback', () => {
    // join_family() already sets role='member' for a genuinely new join —
    // but prove the fix is airtight independent of that: even if this
    // device's family_auth_members row were (incorrectly, hypothetically)
    // 'admin', the bootstrap predicate alone closes the fallback the
    // moment the family has ANY active persona.
    const members: FamilyAuthMember[] = [{ authUserId: 'device-c', familyId: FAMILY, role: 'admin' }];
    const personas: Persona[] = [
      { id: 'dad', familyId: FAMILY, role: 'admin', removedAt: null, authUserId: 'device-a' },
      { id: 'idan', familyId: FAMILY, role: 'member', removedAt: null, authUserId: 'device-b' },
    ];
    expect(resolveIsFamilyAdmin('device-c', FAMILY, personas, members)).toBe(false);
    expect(resolveFamilyRole('device-c', personas, members)).toBeNull();
  });
});
