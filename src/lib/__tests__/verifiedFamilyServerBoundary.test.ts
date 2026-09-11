describe('verified family onboarding server boundary', () => {
  const fs = require('fs');

  const migration = fs.readFileSync(
    require.resolve('../../../supabase/migrations/0032_verified_family_onboarding.sql'),
    'utf8'
  );
  const edge = fs.readFileSync(
    require.resolve('../../../supabase/functions/create-verified-family/index.ts'),
    'utf8'
  );

  it('keeps verified creation service-role-only and disables the anonymous legacy bypass', () => {
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

  it('gates normal family authorization and invite joining on active approval', () => {
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
});
