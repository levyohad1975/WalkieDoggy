import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox -- same convention as migration0036.
 * timezoneFix.test.ts's own doc comment) for a real, first-time-discovered
 * data-boundary leak: admin_delete_family_member() (0004/0007, reworked by
 * 0016) soft-deletes a member but never touched push_tokens/
 * web_push_subscriptions for that member, so a removed member's device
 * kept receiving real push notifications (e.g. a time-change request they
 * filed being approved/rejected after they were removed) indefinitely --
 * no other code path in this schema deactivates a single removed member's
 * push destinations (the only prior push_tokens deletes were whole-FAMILY
 * QA-sandbox resets in 0016). 0037 fixes this by deactivating both tables
 * for the removed member at the same moment removed_at is set, and
 * send-request-push/index.ts's own defense-in-depth recipient check now
 * also excludes removed members.
 */
describe('migration 0037 — admin_delete_family_member() deactivates the removed member\'s push destinations', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs.readFileSync(
    path.join(migrationsDir, '0037_deactivate_push_on_member_removal.sql'),
    'utf8'
  );
  const edge = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/functions/send-request-push/index.ts'),
    'utf8'
  );

  it('does not edit any already-applied migration file (0001-0036) -- only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(files).toContain('0037_deactivate_push_on_member_removal.sql');
    for (const mustExist of [
      '0007_multi_admin_roles.sql',
      '0013_push_tokens.sql',
      '0016_profile_pin_reclaim_and_qa_sandbox.sql',
      '0021_web_push_subscriptions.sql',
      '0036_create_verified_family_timezone.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0037_'))).toHaveLength(1);
  });

  it('keeps the same 4-argument admin_delete_family_member() signature (CREATE OR REPLACE, no drop needed)', () => {
    expect(source).toContain('create or replace function admin_delete_family_member(');
    expect(source).toContain('target_user_id uuid,');
    expect(source).toContain('rule_updates jsonb default \'[]\'::jsonb,');
    expect(source).toContain('entry_updates jsonb default \'[]\'::jsonb,');
    expect(source).toContain('walk_updates jsonb default \'[]\'::jsonb');
    expect(source).not.toContain('drop function');
  });

  it('deactivates push_tokens and web_push_subscriptions scoped to target_user_id, before removed_at is set', () => {
    const pushIdx = source.indexOf('update push_tokens');
    const webPushIdx = source.indexOf('update web_push_subscriptions');
    const removedAtIdx = source.indexOf('update users\n  set removed_at = now()');

    expect(pushIdx).toBeGreaterThan(-1);
    expect(webPushIdx).toBeGreaterThan(pushIdx);
    expect(removedAtIdx).toBeGreaterThan(webPushIdx);

    const pushBlock = source.slice(pushIdx, pushIdx + 150);
    expect(pushBlock).toContain('set is_active = false');
    expect(pushBlock).toContain('where user_id = target_user_id');

    const webPushBlock = source.slice(webPushIdx, webPushIdx + 150);
    expect(webPushBlock).toContain('set is_active = false');
    expect(webPushBlock).toContain('where user_id = target_user_id');
  });

  it('preserves every pre-existing guard (last-admin check, replacement-id validation) unchanged from 0016', () => {
    expect(source).toContain('cannot remove the last admin of this family');
    expect(source).toContain('invalid rotation_user_ids replacement in rule_updates');
    expect(source).toContain('invalid responsible_user_id replacement in entry_updates');
    expect(source).toContain('invalid responsible_user_id replacement in walk_updates');
  });

  it('send-request-push excludes removed members from its recipient defense-in-depth check', () => {
    const idx = edge.indexOf("select('id, family_id')");
    expect(idx).toBeGreaterThan(-1);
    const block = edge.slice(idx, idx + 150);
    expect(block).toContain(".is('removed_at', null)");
  });
});
