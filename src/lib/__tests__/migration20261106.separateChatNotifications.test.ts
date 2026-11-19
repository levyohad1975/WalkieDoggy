import fs from 'fs';
import path from 'path';

/**
 * Field report 2026-11-06: reminders_enabled was a single master switch for all
 * push, and chat_push_recipients() filtered on it, so a member who turned OFF
 * walk reminders also stopped receiving chat notifications. This migration adds
 * a dedicated chat_notifications_enabled flag, backfills it from the existing
 * reminders_enabled (to preserve behaviour), grants the per-column client write,
 * and moves chat push to gate on the new flag instead.
 */
const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../supabase/migrations/20261106190000_separate_chat_notifications.sql',
  ),
  'utf8',
);

describe('separate chat notifications migration', () => {
  it('adds a chat_notifications_enabled column defaulting to true (idempotent)', () => {
    expect(migration).toMatch(
      /alter table users\s*add column if not exists chat_notifications_enabled boolean not null default true/i,
    );
  });

  it('backfills existing members from reminders_enabled to preserve behaviour', () => {
    expect(migration).toMatch(
      /update users\s*set chat_notifications_enabled = reminders_enabled\s*where chat_notifications_enabled is distinct from reminders_enabled/i,
    );
  });

  it('grants only the per-column client write (table-wide UPDATE stays revoked)', () => {
    expect(migration).toMatch(
      /grant update \(chat_notifications_enabled\) on public\.users to authenticated;/i,
    );
    // Must not re-grant table-wide UPDATE on users to authenticated.
    expect(migration).not.toMatch(/grant update on public\.users to authenticated/i);
  });

  it('redefines chat_push_recipients with the same signature and security', () => {
    expect(migration).toMatch(
      /create or replace function chat_push_recipients\(p_message_id uuid\)/i,
    );
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/set search_path to 'public'/i);
  });

  it('gates chat push on the new flag, not reminders_enabled', () => {
    // The new predicate is present as an actual clause.
    expect(migration).toMatch(/\n\s*and u\.chat_notifications_enabled/);
    // The old reminders_enabled predicate must not remain in the recipient
    // query (the explanatory comment may still reference it).
    expect(migration).not.toMatch(/\n\s*and u\.reminders_enabled/);
  });

  it('keeps the rest of the recipient filter intact (family/direct, not sender, active, per-conversation mute)', () => {
    expect(migration).toMatch(/c\.kind = 'family'/);
    expect(migration).toMatch(/c\.kind = 'direct' and u\.id in \(c\.direct_user_low, c\.direct_user_high\)/);
    expect(migration).toMatch(/u\.id is distinct from msg\.sender_user_id/);
    expect(migration).toMatch(/u\.removed_at is null/);
    expect(migration).toMatch(/coalesce\(m\.notifications_muted, false\) = false/);
  });
});
