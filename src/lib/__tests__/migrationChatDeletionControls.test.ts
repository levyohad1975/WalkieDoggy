import fs from 'fs';
import path from 'path';

describe('chat deletion controls migration — authenticated, isolated and content-safe', () => {
  const root = path.resolve(__dirname, '../../..');
  const file = fs.readdirSync(path.join(root, 'supabase/migrations')).find((name) => /_chat_deletion_controls\.sql$/.test(name));
  if (!file) throw new Error('chat deletion controls migration is missing');
  const source = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8').replace(/\r\n/g, '\n');
  const sql = source.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  const functionBody = (name: string): string => {
    const start = sql.indexOf(`create or replace function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf('$$;', start);
    expect(end).toBeGreaterThan(start);
    return sql.slice(start, end);
  };

  it('lets only the authenticated sender or a real family admin remove messages', () => {
    const bulk = functionBody('chat_delete_messages');
    expect(bulk).toContain('auth.uid() is null');
    expect(bulk).toContain('v_actor := chat_actor_profile_id();');
    expect(bulk).toContain('chat_can_access_conversation(v_conversation.id)');
    expect(bulk).toContain('is_real_family_admin(v_conversation.family_id)');
    expect(bulk).toContain('sender_user_id is distinct from v_actor');
    expect(bulk).toContain("raise exception 'chat is read-only while impersonating';");
    expect(bulk).toContain('cardinality(p_message_ids) > 100');
    expect(bulk).toContain('v_conversation_count <> 1');
  });

  it('erases image references immediately and queues only the storage path for cleanup', () => {
    const bulk = functionBody('chat_delete_messages');
    expect(bulk).toContain('insert into chat_attachment_deletions(path)');
    expect(bulk).toContain("set body = '', deleted_at = now(), deleted_by_user_id = v_actor");
    expect(bulk).toContain('attachment_path = null');
    expect(sql).toContain("alter publication supabase_realtime add table public.chat_conversation_members");
  });

  it('keeps self-clears scoped to the caller and applies the same cutoff through RLS', () => {
    expect(sql).toContain('m.user_id = chat_actor_profile_id()');
    expect(sql).toContain("created_at > coalesce((");
    const clear = functionBody('chat_clear_conversation_for_me');
    expect(clear).toContain('chat_can_access_conversation(p_conversation_id)');
    expect(clear).toContain('v_actor, v_family, v_cleared_at, v_cleared_at');
  });

  it('limits permanent family-wide clearing to admins after explicit server confirmation and audits no contents', () => {
    const clear = functionBody('chat_clear_family_conversation_for_everyone');
    expect(clear).toContain("v_conversation.kind <> 'family'");
    expect(clear).toContain('is_real_family_admin(v_conversation.family_id)');
    expect(clear).toContain('p_confirm is distinct from true');
    expect(clear).toContain('insert into chat_attachment_deletions(path)');
    expect(clear).toContain("set body = '', deleted_at = coalesce(deleted_at, v_cleared_at)");
    expect(clear).toContain('from users u');
    expect(clear).toContain("'chat_conversation_cleared_for_everyone'");
    expect(clear).not.toMatch(/body\s*,|attachment_path\s*,|preview/i);
    expect(sql).toContain('jsonb_build_object(\'conversation_id\', p_conversation_id, \'deleted_count\', v_count)');
    expect(sql).toContain('revoke all on function chat_clear_family_conversation_for_everyone(uuid, boolean) from public, anon;');
    expect(sql).toContain('grant execute on function chat_clear_family_conversation_for_everyone(uuid, boolean) to authenticated;');
  });
});
