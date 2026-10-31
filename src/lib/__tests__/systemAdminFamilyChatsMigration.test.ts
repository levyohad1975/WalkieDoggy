import fs from 'fs';
import path from 'path';

const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261019190000_system_admin_readonly_family_chats.sql'), 'utf8');
const attachmentFunction = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/system-admin-chat-attachment/index.ts'), 'utf8');

describe('System Admin read-only family chat access migration', () => {
  it('restricts every reader to a verified admin outside observer and impersonation modes', () => {
    expect(migration.match(/perform public\.system_admin_chat_assert_access\(\)/g)?.length).toBe(4);
    expect(migration).toContain('not public.is_verified_system_admin()');
    expect(migration).toContain('public.active_system_admin_observer_family() is not null');
    expect(migration).toContain('public.active_impersonation_target() is not null');
    expect(migration).toMatch(/revoke all on function public\.system_admin_read_chat_messages[\s\S]*?from public, anon/);
  });

  it('keeps scope checks, audit metadata and the conversation tables read-only', () => {
    expect(migration).toContain('c.id=p_conversation_id and c.family_id=p_family_id');
    expect(migration).toContain('m.family_id=p_family_id and m.conversation_id=p_conversation_id');
    expect(migration).toContain('actor_auth_user_id,family_id,conversation_id,conversation_kind,access_reason');
    expect(migration).not.toMatch(/update public\.chat_(messages|conversations|conversation_members)/i);
    expect(migration).not.toContain('last_read_at =');
    expect(migration).toContain('case when m.deleted_at is null then m.body else null end body');
    expect(migration).toMatch(/create table if not exists public\.system_admin_chat_access_audit[\s\S]*?access_type text/);
    expect(migration).not.toMatch(/system_admin_chat_access_audit[\s\S]{0,500}references public\.(families|chat_)/i);
  });

  it('uses private short-lived attachment URLs only after authenticated RPC authorization', () => {
    expect(attachmentFunction).toContain("caller.rpc('system_admin_prepare_chat_attachment'");
    expect(attachmentFunction).toContain("createSignedUrl(path, 60)");
    const client = fs.readFileSync(path.join(process.cwd(), 'src/lib/systemAdminChat.ts'), 'utf8');
    expect(client).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(client).not.toContain('service_role');
  });
});
