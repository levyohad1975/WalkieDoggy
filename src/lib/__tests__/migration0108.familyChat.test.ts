import fs from 'fs';
import path from 'path';

/**
 * Source-scan contract for migration 0108 (same convention as the other
 * migrationNNNN tests: Jest has no Postgres). The BEHAVIOUR of these rules
 * — cross-family isolation, server-derived sender, idempotency, moderation,
 * impersonation/observer lock-out — is exercised for real by
 * supabase/manual_tests/0108_family_chat_acl.sql against a live database.
 * This file guards the security-critical shape of the SQL against an
 * accidental edit.
 */
describe('migration 0108 — family chat', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs.readFileSync(path.join(migrationsDir, '0108_family_chat.sql'), 'utf8').replace(/\r\n/g, '\n');
  // Comments explain the design in prose; assertions about what the SQL does
  // must not be satisfied (or tripped) by a comment.
  const sql = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const functionBody = (name: string): string => {
    const start = sql.indexOf(`create or replace function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf('$$;', start);
    expect(end).toBeGreaterThan(start);
    return sql.slice(start, end);
  };

  it('is a new, additive migration — no existing object is altered or dropped', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(files.filter((f) => f.startsWith('0108_'))).toEqual(['0108_family_chat.sql']);
    expect(files).toContain('0107_prevent_overlapping_schedule_rules.sql');
    expect(sql).not.toMatch(/drop (table|function|index|trigger)/i);
    expect(sql).not.toMatch(/alter table (?!chat_)/i);
    const dropped = [...sql.matchAll(/drop policy if exists "[^"]+" on (\w+)/g)].map((m) => m[1]);
    expect(dropped.every((table) => table.startsWith('chat_'))).toBe(true);
    const replaced = [...sql.matchAll(/create or replace function (\w+)\(/g)].map((m) => m[1]);
    expect(replaced.length).toBeGreaterThan(0);
    expect(replaced.every((name) => /^(chat_|claim_chat_|mark_chat_)/.test(name))).toBe(true);
  });

  it('allows exactly one family conversation per family and blocks cross-family kinds in Phase 1', () => {
    expect(sql).toMatch(/create unique index if not exists chat_conversations_one_per_family_idx\s+on chat_conversations \(family_id\) where kind = 'family';/);
    expect(sql).toMatch(/constraint chat_conversations_phase1_family_only check \(kind = 'family'\)/);
    expect(sql).toMatch(/check \(kind in \('family', 'direct', 'group'\)\)/);
  });

  it('limits message length in the table itself, not only in the RPC', () => {
    expect(sql).toMatch(/deleted_at is null and char_length\(body\) between 1 and 2000/);
    expect(sql).toMatch(/deleted_at is not null and body = ''/);
  });

  it('enables RLS on every chat table and exposes SELECT policies only', () => {
    for (const table of ['chat_conversations', 'chat_conversation_members', 'chat_messages', 'chat_push_events']) {
      expect(sql).toContain(`alter table ${table} enable row level security;`);
    }
    const policies = [...sql.matchAll(/create policy "[^"]+" on (\w+)\s+for (\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(policies.sort()).toEqual([
      'chat_conversation_members:select',
      'chat_conversations:select',
      'chat_messages:select',
    ]);
  });

  it('reduces client table privileges to SELECT, and gives clients nothing on the push ledger', () => {
    for (const table of ['chat_conversations', 'chat_conversation_members', 'chat_messages', 'chat_push_events']) {
      expect(sql).toContain(`revoke all on table ${table} from public, anon, authenticated;`);
    }
    const grants = [...sql.matchAll(/grant ([\w, ]+) on table (\w+) to (\w+);/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}`);
    expect(grants.sort()).toEqual([
      'select|chat_conversation_members|authenticated',
      'select|chat_conversations|authenticated',
      'select|chat_messages|authenticated',
    ]);
  });

  it('gates every read through the single family-membership predicate', () => {
    expect(sql).toMatch(/on chat_messages\s+for select using \(chat_can_access_conversation\(conversation_id\)\);/);
    expect(sql).toMatch(/on chat_conversations\s+for select using \(chat_can_access_conversation\(id\)\);/);
    const access = functionBody('chat_can_access_conversation');
    expect(access).toContain('join users u on u.id = chat_actor_profile_id()');
    expect(access).toContain('u.removed_at is null');
    expect(access).toContain('c.family_id = u.family_id');
    expect(access).toContain('c.family_id = current_family_id()');
  });

  it('resolves identity from the REAL profile and hides chat from the System Admin observer', () => {
    const actor = functionBody('chat_actor_profile_id');
    expect(actor).toContain('when active_system_admin_observer_family() is not null then null');
    expect(actor).toContain('else real_current_profile_id()');
    // The impersonation-aware resolver must never be used for chat identity.
    expect(sql).not.toMatch(/[^_]current_profile_id\(\)/);
  });

  it('chat_send_message() takes no sender, derives it server-side, validates and is idempotent', () => {
    expect(sql).toMatch(/create or replace function chat_send_message\(\s*p_conversation_id uuid,\s*p_client_id uuid,\s*p_body text\s*\)/);
    const send = functionBody('chat_send_message');
    expect(send).not.toMatch(/p_sender|p_user_id|p_family_id/);
    expect(send).toContain('v_actor := chat_actor_profile_id();');
    expect(send).toContain("raise exception 'chat is read-only while impersonating';");
    expect(send).toContain('not chat_can_access_conversation(p_conversation_id)');
    expect(send).toContain("raise exception 'chat message is empty';");
    expect(send).toContain('if char_length(v_body) > 2000 then');
    expect(send).toContain("raise exception 'chat messages are being sent too quickly';");
    // Idempotent on the client id, without ever handing back someone else's row.
    expect(send).toContain('v_message.sender_user_id = v_actor and v_message.conversation_id = p_conversation_id');
    expect(send).toContain("raise exception 'chat message id conflict';");
    expect(send).toContain('exception when unique_violation then');
    expect(send).toMatch(/values \(v_id, p_conversation_id, v_family, v_actor, v_body\)/);
  });

  it('chat_delete_message() requires a real family admin, erases the text and audits without copying it', () => {
    const del = functionBody('chat_delete_message');
    expect(del).toContain("raise exception 'chat is read-only while impersonating';");
    expect(del).toContain('not chat_can_access_conversation(v_message.conversation_id)');
    expect(del).toContain('not is_real_family_admin(v_conversation.family_id)');
    expect(del).toContain("raise exception 'admin permission required';");
    expect(del).toContain("set body = '', deleted_at = now(), deleted_by_user_id = v_actor");
    expect(del).toContain("'chat_message_deleted'");
    const auditCall = del.slice(del.indexOf('perform log_audit_event('));
    expect(auditCall).not.toMatch(/body/);
  });

  it('the read marker can only move forward and never into the future', () => {
    const mark = functionBody('chat_mark_read');
    expect(mark).toContain('v_read_at := least(coalesce(p_read_at, now()), now());');
    expect(mark).toContain('greatest(chat_conversation_members.last_read_at, excluded.last_read_at)');
  });

  it('push: context only for the author, recipients exclude the sender and honour preferences, delivery is claimed once', () => {
    const context = functionBody('chat_push_context');
    expect(context).toContain('v_message.sender_user_id is distinct from v_actor');
    expect(context).toContain('v_message.deleted_at is not null');
    expect(context).toContain("v_message.created_at < now() - interval '10 minutes'");

    const recipients = functionBody('chat_push_recipients');
    expect(recipients).toContain('u.id is distinct from msg.sender_user_id');
    expect(recipients).toContain('u.removed_at is null');
    expect(recipients).toContain('u.reminders_enabled');
    expect(recipients).toContain('coalesce(m.notifications_muted, false) = false');

    const claim = functionBody('claim_chat_push_event');
    expect(claim).toContain('on conflict (message_id) do update');
    expect(claim).toContain("where chat_push_events.status = 'failed'");
    expect(claim).not.toContain("status = 'sent'\n       or");
  });

  it('server-only helpers are not executable by clients; client RPCs are not executable by anon', () => {
    for (const fn of [
      'chat_unread_count(uuid, uuid, timestamptz)',
      'chat_push_recipients(uuid)',
      'claim_chat_push_event(uuid, int)',
      'mark_chat_push_event(uuid, text)',
    ]) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon, authenticated;`);
      expect(sql).not.toContain(`grant execute on function ${fn} to authenticated;`);
    }
    for (const fn of [
      'chat_open_family_conversation()',
      'chat_send_message(uuid, uuid, text)',
      'chat_delete_message(uuid)',
      'chat_mark_read(uuid, timestamptz)',
      'chat_set_notifications_muted(uuid, boolean)',
      'chat_push_context(uuid)',
    ]) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon;`);
      expect(sql).toContain(`grant execute on function ${fn} to authenticated;`);
    }
  });

  it('every function is SECURITY DEFINER with a pinned search_path', () => {
    const count = (sql.match(/create or replace function /g) ?? []).length;
    expect((sql.match(/security definer\s+set search_path = public/g) ?? []).length).toBe(count);
  });

  it('publishes only chat_messages to Realtime, guarded like migration 0017', () => {
    expect(sql).toContain("if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then");
    expect(sql).toContain('alter publication supabase_realtime add table public.chat_messages;');
    expect((sql.match(/alter publication supabase_realtime add table/g) ?? []).length).toBe(1);
  });

  it('ships a live-database ACL test alongside the migration', () => {
    const acl = fs.readFileSync(path.resolve(__dirname, '../../../supabase/manual_tests/0108_family_chat_acl.sql'), 'utf8');
    expect(acl).toContain("'family B cannot read family A messages'");
    expect(acl).toContain("'cross-family send'");
    expect(acl).toContain("'the hidden observer cannot read a family conversation'");
    expect(acl.trimEnd().endsWith('rollback;')).toBe(true);
  });
});
