import fs from 'fs';
import path from 'path';

/**
 * Source-scan contract for migration 0109 (Jest has no Postgres — same
 * convention as migration0108.familyChat.test.ts). The BEHAVIOUR — private
 * conversation isolation, admin/impersonation/observer lock-out, image
 * upload/read/delete rules, push recipients — is exercised for real by
 * supabase/manual_tests/0109_private_chat_and_images_acl.sql against a live
 * database. This file guards the security-critical shape of the SQL.
 */
describe('migration 0109 — private conversations and image messages', () => {
  const root = path.resolve(__dirname, '../../..');
  const migrationsDir = path.join(root, 'supabase/migrations');
  const source = fs.readFileSync(path.join(migrationsDir, '0109_private_chat_and_images.sql'), 'utf8').replace(/\r\n/g, '\n');
  const sql = source.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

  const functionBody = (name: string): string => {
    const start = sql.indexOf(`create or replace function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf('$$;', start);
    expect(end).toBeGreaterThan(start);
    return sql.slice(start, end);
  };

  it('is a new migration on top of 0108, which is left unedited', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(files.filter((f) => f.startsWith('0109_'))).toEqual(['0109_private_chat_and_images.sql']);
    const phase1 = fs.readFileSync(path.join(migrationsDir, '0108_family_chat.sql'), 'utf8');
    expect(phase1).toContain("constraint chat_conversations_phase1_family_only check (kind = 'family')");
    expect(phase1).not.toContain('attachment_path');
  });

  it('deletes and rewrites no existing data', () => {
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/drop (table|column|function|index|trigger)/i);
    // The only UPDATEs are inside functions, on chat-owned tables.
    const updates = [...sql.matchAll(/\bupdate (\w+)/g)].map((m) => m[1]);
    expect(new Set(updates)).toEqual(new Set(['chat_conversations', 'chat_messages', 'chat_attachment_deletions']));
    // Every altered table and every replaced function is chat-owned.
    expect([...sql.matchAll(/alter table (\w+)/g)].every((m) => m[1].startsWith('chat_'))).toBe(true);
    expect([...sql.matchAll(/create or replace function (\w+)\(/g)].every((m) => m[1].startsWith('chat_'))).toBe(true);
  });

  it('allows same-family private conversations only — group and family-less conversations stay impossible', () => {
    expect(sql).toMatch(/add constraint chat_conversations_same_family_kinds\s+check \(kind in \('family', 'direct'\)\);/);
    expect(sql).toMatch(/add constraint chat_conversations_requires_family\s+check \(family_id is not null\);/);
    expect(sql).toContain("drop constraint if exists chat_conversations_phase1_family_only;");
  });

  it('prevents duplicate private conversations with a canonical, unique pair', () => {
    expect(sql).toContain('direct_user_low < direct_user_high');
    expect(sql).toMatch(/create unique index if not exists chat_conversations_direct_pair_idx\s+on chat_conversations \(direct_user_low, direct_user_high\) where kind = 'direct';/);
    const open = functionBody('chat_open_direct_conversation');
    expect(open).toContain('v_low := least(v_actor, p_other_user_id);');
    expect(open).toContain('v_high := greatest(v_actor, p_other_user_id);');
    expect(open).toContain("on conflict (direct_user_low, direct_user_high) where kind = 'direct' do nothing;");
  });

  it('gives access to a private conversation to its two participants and to nobody else — no admin branch', () => {
    const access = functionBody('chat_can_access_conversation');
    expect(access).toContain('join users u on u.id = chat_actor_profile_id()');
    expect(access).toContain('u.removed_at is null');
    expect(access).toContain('c.family_id = u.family_id');
    expect(access).toContain('c.family_id = current_family_id()');
    expect(access).toContain("c.kind = 'direct' and u.id in (c.direct_user_low, c.direct_user_high)");
    expect(access).not.toMatch(/admin/i);
  });

  it('opens a private conversation only with an active member of the caller\'s own family, never while impersonating', () => {
    const open = functionBody('chat_open_direct_conversation');
    expect(open).toContain('v_actor := chat_actor_profile_id();');
    expect(open).toContain('p_other_user_id = v_actor');
    expect(open).toContain('where id = p_other_user_id and family_id = v_family and removed_at is null');
    expect(open).toContain("raise exception 'chat member not found';");
    expect(open).toContain("raise exception 'chat is read-only while impersonating';");
    expect(open).not.toMatch(/p_family|p_sender|p_user_id/);
  });

  it('lists only the caller\'s own conversations, in their own family', () => {
    const list = functionBody('chat_list_conversations');
    expect(list).toContain('v_actor := chat_actor_profile_id();');
    expect(list).toContain('where c.family_id = v_family');
    expect(list).toContain('v_actor in (c.direct_user_low, c.direct_user_high)');
    expect(list).toContain('perform chat_open_family_conversation();');
  });

  it('nobody moderates a private conversation; only its sender removes a private message', () => {
    const state = functionBody('chat_conversation_state');
    expect(state).toMatch(/'can_moderate',\s+v_conversation\.kind = 'family'/);
    const del = functionBody('chat_delete_message');
    expect(del).toContain('not chat_can_access_conversation(v_message.conversation_id)');
    expect(del).toMatch(/if v_conversation\.kind = 'family' then\s+if not is_real_family_admin\(v_conversation\.family_id\) then\s+raise exception 'admin permission required';/);
    expect(del).toContain("elsif v_message.sender_user_id is distinct from v_actor then");
    expect(del).toContain("raise exception 'only the sender can remove this message';");
  });

  it('removing a message erases text and attachment at once and queues the file — without auditing private removals', () => {
    const del = functionBody('chat_delete_message');
    expect(del).toContain('attachment_path = null,');
    expect(del).toContain('insert into chat_attachment_deletions (path)');
    const audit = del.slice(del.indexOf('perform log_audit_event('));
    expect(del.slice(0, del.indexOf('perform log_audit_event('))).toMatch(/if v_conversation\.kind = 'family' then\s*$/);
    expect(audit).not.toMatch(/\bbody\b|attachment/);
  });

  it('the single message writer still derives the sender server-side and keeps the Phase 1 rules', () => {
    const post = functionBody('chat_post_message');
    expect(post).not.toMatch(/p_sender|p_user_id|p_family_id/);
    expect(post).toContain('v_actor := chat_actor_profile_id();');
    expect(post).toContain("raise exception 'chat is read-only while impersonating';");
    expect(post).toContain('not chat_can_access_conversation(p_conversation_id)');
    expect(post).toContain("raise exception 'chat message is too long';");
    expect(post).toContain("raise exception 'chat messages are being sent too quickly';");
    expect(post).toContain("raise exception 'chat message id conflict';");
    expect(post).toContain("raise exception 'chat recipient is no longer in the family';");
    // Clients cannot call it directly; the public RPCs are thin wrappers.
    expect(sql).toContain('revoke all on function chat_post_message(uuid, uuid, text, text, integer, integer) from public, anon, authenticated;');
    expect(functionBody('chat_send_message')).toContain('chat_post_message(p_conversation_id, p_client_id, p_body, null, null, null)');
  });

  it('an attachment must be the caller\'s own upload, in this conversation, named after this message — type and size come from Storage', () => {
    const post = functionBody('chat_post_message');
    expect(post).toContain('v_parts[1] is distinct from p_conversation_id');
    expect(post).toContain('v_parts[2] is distinct from v_actor');
    expect(post).toContain('v_parts[3] is distinct from v_id');
    expect(post).toContain("o.bucket_id = 'chat-attachments'");
    expect(post).toContain('o.owner_id = auth.uid()::text');
    expect(post).toContain("v_mime := v_object_meta->>'mimetype';");
    expect(post).toContain("v_mime not in ('image/jpeg', 'image/png', 'image/webp')");
    expect(post).toContain('v_size > 5242880');
    expect(post).toContain('p_attachment_width not between 1 and 4096');
    expect(sql).toMatch(/create unique index if not exists chat_messages_attachment_path_idx\s+on chat_messages \(attachment_path\) where attachment_path is not null;/);
    expect(sql).toContain("attachment_mime in ('image/jpeg', 'image/png', 'image/webp')");
    expect(sql).toContain('attachment_size between 1 and 5242880');
  });

  it('accepts only a strict three-uuid path with an image extension', () => {
    const parts = functionBody('chat_attachment_path_parts');
    const pattern = parts.match(/p_name ~ '([^']+)'/);
    expect(pattern).not.toBeNull();
    const re = new RegExp(pattern![1]);
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    expect(re.test(`${id(1)}/${id(2)}/${id(3)}.jpg`)).toBe(true);
    expect(re.test(`${id(1)}/${id(2)}/${id(3)}.webp`)).toBe(true);
    expect(re.test(`${id(1)}/${id(2)}/${id(3)}.svg`)).toBe(false);
    expect(re.test(`${id(1)}/${id(2)}/../${id(3)}.jpg`)).toBe(false);
    expect(re.test(`${id(1)}/${id(3)}.jpg`)).toBe(false);
    expect(re.test(`x/${id(1)}/${id(2)}/${id(3)}.jpg`)).toBe(false);
    expect(re.test(`${id(1)}/${id(2)}/${id(3)}.jpg/extra`)).toBe(false);
  });

  it('storage: private bucket with size/type limits, and bucket-scoped policies that follow conversation access', () => {
    expect(sql).toMatch(/'chat-attachments', 'chat-attachments', false, 5242880,\s+array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
    expect(sql).toContain('set public = false,');
    const policies = [...sql.matchAll(/create policy "([^"]+)" on storage\.objects\s+for (\w+) to (\w+)\s+(?:using|with check) \(([^;]+)\);/g)].map((m) => ({ name: m[1], cmd: m[2], role: m[3], rule: m[4] }));
    expect(policies.map((p) => `${p.cmd}:${p.role}`).sort()).toEqual(['delete:authenticated', 'insert:authenticated', 'select:authenticated']);
    for (const policy of policies) {
      expect(policy.rule).toContain("bucket_id = 'chat-attachments'");
      expect(policy.name.startsWith('chat attachments')).toBe(true);
    }
    // Existing family-photos policies are not touched.
    expect(sql).not.toContain('family-photos');
    expect(sql).not.toMatch(/drop policy if exists "(?!chat attachments)/);
  });

  it('an image is readable only through a LIVE message in an accessible conversation (or as the uploader\'s own pending upload)', () => {
    const readable = functionBody('chat_attachment_readable');
    expect(readable).toContain('m.attachment_path = p_name');
    expect(readable).toContain('m.deleted_at is null');
    expect(readable).toContain('chat_can_access_conversation(m.conversation_id)');
    expect(readable).toContain('parts[2] = chat_actor_profile_id()');

    const uploadable = functionBody('chat_attachment_uploadable');
    expect(uploadable).toContain('parts[2] = chat_actor_profile_id()');
    expect(uploadable).toContain('active_impersonation_target() is null');
    expect(uploadable).toContain('chat_can_access_conversation(parts[1])');

    const removable = functionBody('chat_attachment_removable');
    expect(removable).toContain('parts[2] = chat_actor_profile_id()');
    expect(removable).toContain('not exists (select 1 from chat_messages m where m.attachment_path = p_name)');
  });

  it('a private message notifies only the other participant; a family message the other members', () => {
    const recipients = functionBody('chat_push_recipients');
    expect(recipients).toContain('join users u on u.family_id = c.family_id');
    expect(recipients).toContain("c.kind = 'direct' and u.id in (c.direct_user_low, c.direct_user_high)");
    expect(recipients).toContain('u.id is distinct from msg.sender_user_id');
    expect(recipients).toContain('u.removed_at is null');
    expect(recipients).toContain('u.reminders_enabled');
    expect(recipients).toContain('coalesce(m.notifications_muted, false) = false');
    const context = functionBody('chat_push_context');
    expect(context).toContain('v_message.sender_user_id is distinct from v_actor');
    expect(context).not.toContain('attachment_path,');
  });

  it('cleanup and monitoring are server-side; storage usage exposes totals, never content', () => {
    for (const fn of ['chat_attachment_cleanup_batch(integer)', 'chat_attachment_mark_removed(text[])', 'chat_conversation_state(uuid, uuid)']) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon, authenticated;`);
    }
    expect(sql).toContain('revoke all on table chat_attachment_deletions from public, anon, authenticated;');
    const usage = functionBody('chat_storage_usage');
    expect(usage).toContain('if not is_system_admin() then');
    expect(usage).not.toMatch(/\bbody\b|attachment_path,|sender_user_id/);
  });

  it('no automatic expiry: nothing deletes messages by age', () => {
    expect(sql).not.toMatch(/interval '(30|90) days'\s*\)?\s*;?\s*$/m);
    expect(sql).not.toMatch(/delete from chat_messages/i);
    // The only age-based cleanup is for uploads that never became a message.
    expect(functionBody('chat_attachment_cleanup_batch')).toContain('not exists (select 1 from chat_messages m where m.attachment_path = o.name)');
  });

  it('every function is SECURITY DEFINER with a pinned search_path (the pure path parser pins it too)', () => {
    const count = (sql.match(/create or replace function /g) ?? []).length;
    expect((sql.match(/set search_path = public/g) ?? []).length).toBe(count);
    expect((sql.match(/security definer/g) ?? []).length).toBe(count - 1);
  });

  it('ships a live-database ACL test alongside the migration', () => {
    const acl = fs.readFileSync(path.join(root, 'supabase/manual_tests/0109_private_chat_and_images_acl.sql'), 'utf8');
    for (const label of [
      "'an admin cannot read private messages'",
      "'impersonating a participant does not expose their private messages'",
      "'the hidden observer reads no message, family or private'",
      "'private conversation across families'",
      "'admin cannot read a private image, even knowing its exact path'",
      "'a private message notifies only the other participant",
      "'upload into a guessed conversation id'",
    ]) {
      expect(acl).toContain(label);
    }
    expect(acl.trimEnd().endsWith('rollback;')).toBe(true);
  });
});
