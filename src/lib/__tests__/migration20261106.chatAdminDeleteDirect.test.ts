import fs from 'fs';
import path from 'path';

/**
 * Field report 2026-11-06: a family admin could not delete another member's
 * message in a DIRECT chat (Omer's photo in his 1:1 with the admin). The UI
 * offers it (chat_conversation_state.can_moderate = true for an admin
 * participant), but chat_delete_messages' direct branch allowed only the
 * sender. This migration widens the direct branch to honour admin moderation.
 */
const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../supabase/migrations/20261106090000_chat_admin_delete_direct_message.sql',
  ),
  'utf8',
);

describe('chat admin delete direct-message migration', () => {
  it('redefines chat_delete_messages with the same signature and security', () => {
    expect(migration).toMatch(/create or replace function chat_delete_messages\(p_message_ids uuid\[\]\)/i);
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/set search_path to 'public'/i);
  });

  it('lets an admin participant moderate a direct conversation (mirrors can_moderate)', () => {
    // The direct branch now exempts an admin participant from the sender-only rule.
    expect(migration).toMatch(/v_actor in \(v_conversation\.direct_user_low, v_conversation\.direct_user_high\)/);
    expect(migration).toMatch(/is_real_family_admin\(me\.family_id\)/);
    expect(migration).toMatch(/me\.removed_at is null and other_member\.removed_at is null/);
  });

  it('still blocks a non-admin non-sender, and keeps the family branch and grants', () => {
    // The sender-only rejection is still present (now gated by the admin exemption).
    expect(migration).toMatch(/only the sender can remove this message/);
    // Family-chat admin rule unchanged.
    expect(migration).toMatch(/if v_conversation\.kind = 'family' then\s*if not is_real_family_admin/);
    // Attachment bookkeeping for image deletes preserved.
    expect(migration).toMatch(/insert into chat_attachment_deletions\(path\)/);
    // Execute stays granted to authenticated only.
    expect(migration).toMatch(/revoke all on function chat_delete_messages\(uuid\[\]\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function chat_delete_messages\(uuid\[\]\) to authenticated;/);
  });
});
