import fs from 'fs';
import path from 'path';

/**
 * Owner decision 2026-11-02: activity logs are visible to the verified
 * System Admin only, and the System Admin sees every audit source at once.
 */
const root = path.resolve(__dirname, '../../..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261102140000_system_admin_only_audit.sql'), 'utf8');

describe('migration 20261102140000 — System Admin only activity logs', () => {
  it('removes every family-admin path to the logs', () => {
    expect(sql).toContain('drop policy if exists "admin reads audit log" on public.audit_log;');
    expect(sql).toContain('drop policy if exists "family admins can view remote gps audit" on public.remote_gps_audit;');
    expect(sql).toContain(`execute 'drop policy if exists "family members can read walk lifecycle events" on public.walk_lifecycle_events';`);
    expect(sql).toContain('revoke all on function public.admin_list_audit_log(integer, integer) from public, anon, authenticated;');
  });

  it('leaves clients no privileges on audit tables', () => {
    for (const table of ['audit_log', 'system_audit_log', 'system_activity_audit_log', 'remote_gps_audit',
      'system_admin_chat_access_audit', 'system_admin_observer_sessions', 'email_delivery_log', 'impersonation_sessions']) {
      expect(sql).toContain(`revoke all on public.${table} from anon, authenticated;`);
    }
    expect(sql).not.toMatch(/grant (select|insert|update|delete)[^;]* on public\.\w+ to/i);
  });

  it('keeps the SELECT grant the Walk Lifecycle v1.1 capability check depends on', () => {
    // walk_lifecycle_server_capabilities() is SECURITY INVOKER and checks
    // has_table_privilege(walk_lifecycle_events, 'select').
    expect(sql).toContain("execute 'revoke insert, update, delete, truncate, references, trigger on public.walk_lifecycle_events from anon, authenticated';");
    expect(sql).not.toContain('revoke all on public.walk_lifecycle_events');
  });

  it('captures more changes with the metadata-only trigger, never per-read chat markers', () => {
    for (const table of ['health_tasks', 'family_invites', 'remote_gps_consents', 'remote_gps_commands', 'help_articles',
      'chat_conversations', 'chat_messages', 'chat_conversation_members', 'walk_gps_sessions', 'web_push_subscriptions', 'push_tokens']) {
      expect(sql).toMatch(new RegExp(`on public\\.${table}\\s+for each row[^;]*execute function public\\.capture_user_state_change\\(\\);`));
    }
    expect(sql).toContain('when (old.deleted_at is distinct from new.deleted_at)');
    const updateTriggers = [...sql.matchAll(/after update on public\.(chat_messages|chat_conversation_members|walk_gps_sessions)\s+for each row (\w+)/g)];
    expect(updateTriggers.length).toBe(3);
    for (const match of updateTriggers) expect(match[2]).toBe('when');
    expect(sql).not.toMatch(/insert or update or delete on public\.(chat_messages|chat_conversation_members|walk_gps_sessions)/);
    expect(sql).not.toContain('last_read_at');
  });

  it('merges every audit source behind a verified System Admin check', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.system_admin_list_global_audit'));
    expect(fn).toContain("if auth.uid() is null or not public.is_verified_system_admin() then");
    for (const source of ["'family_audit'", "'system_audit'", "'state_change'", "'walk_lifecycle'", "'remote_gps'", "'admin_access'"]) {
      expect(fn).toContain(source);
    }
    for (const table of ['audit_log', 'system_audit_log', 'system_activity_audit_log', 'walk_lifecycle_events', 'remote_gps_audit',
      'system_admin_chat_access_audit', 'system_admin_observer_sessions']) {
      expect(fn).toContain(`from public.${table}`);
    }
    expect(fn).toContain('revoke all on function public.system_admin_list_global_audit(integer) from public, anon;');
  });
});

describe('the family admin no longer has an activity log in the app', () => {
  it('Settings → ניהול המשפחה has no "📋 יומן פעילות"', () => {
    const settings = fs.readFileSync(path.join(root, 'src/screens/SettingsScreen.tsx'), 'utf8');
    expect(settings).not.toContain('label="📋 יומן פעילות"');
  });

  it('the console can show the System Admin\'s own access on demand', () => {
    const admin = fs.readFileSync(path.join(root, 'src/screens/SystemAdminScreen.tsx'), 'utf8');
    expect(admin).toContain('🛡️ הפעולות שלי');
    expect(admin).toContain("entry.source !== 'admin_access'");
  });
});
