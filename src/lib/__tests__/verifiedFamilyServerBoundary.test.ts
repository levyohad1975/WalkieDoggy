describe('verified family onboarding server boundary', () => {
  const fs = require('fs');

  const migration = [
    '../../../supabase/migrations/0032_verified_family_onboarding.sql',
    '../../../supabase/migrations/0033_verified_family_onboarding_cutover.sql',
  ]
    .map((path) => fs.readFileSync(require.resolve(path), 'utf8'))
    .join('\n');
  const edge = fs.readFileSync(
    require.resolve('../../../supabase/functions/create-verified-family/index.ts'),
    'utf8'
  );

  it('keeps verified creation service-role-only and disables the anonymous legacy bypass at cutover', () => {
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain('v_auth_user.email_confirmed_at is null');
    expect(migration).toContain('coalesce(v_auth_user.is_anonymous, true)');
    expect(migration).toContain(
      'revoke all on function create_family(text, text) from public'
    );
    expect(migration).toContain(
      'revoke execute on function create_family(text, text) from anon'
    );
    expect(migration).toContain(
      'grant execute on function create_verified_family(uuid, text, text, boolean) to service_role'
    );
  });

  it('gates normal family authorization and invite joining on active approval at cutover', () => {
    expect(migration).toContain("f.approval_status = 'active'");
    expect(migration).toContain("p_approval_status not in ('active', 'rejected')");
    expect(migration).toContain('if not is_system_admin()');
  });

  it('derives identity and approval policy server-side', () => {
    expect(edge).toContain('userClient.auth.getUser()');
    expect(edge).toContain("Deno.env.get('AUTO_APPROVE_NEW_FAMILIES')");
    expect(edge).toContain('p_auth_user_id: user.id');
    expect(edge).not.toContain('p_auth_user_id: body.');
    expect(edge).not.toContain('p_auto_approve: body.');
  });

  it('keeps email failures best-effort after durable family creation', () => {
    expect(edge).toContain("warnings.push('welcome_email_not_sent')");
    expect(edge).toContain("warnings.push('system_owner_notification_not_sent')");
    expect(edge).toContain('approvalStatus: row.approval_status');
  });

  it('never hands out a working-looking join link/QR in the welcome email while a family is still pending approval', () => {
    // find_family_by_invite_code()/join_family() (0033) only resolve
    // approval_status = 'active' families, so a pending family's invite
    // code/link/QR do not work yet -- the welcome email must say so instead
    // of handing out the same "join now" link/QR the active email sends.
    expect(edge).toContain("row.approval_status === 'pending'");
    const pendingMarkerIndex = edge.indexOf('ממתינה לאישור מנהל המערכת');
    const joinLinkIndex = edge.indexOf('${safeJoin}');
    expect(pendingMarkerIndex).toBeGreaterThan(-1);
    expect(joinLinkIndex).toBeGreaterThan(pendingMarkerIndex);
  });
});
