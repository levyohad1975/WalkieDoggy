import fs from 'fs';
import path from 'path';

/**
 * Field report 2026-11-06: read chat messages kept showing as unread. Root
 * cause is a timestamp-precision mismatch — chat_messages.created_at is stored
 * at microsecond precision, but the client's read marker (round-tripped through
 * a JS Date) is only millisecond-precise, so chat_unread_count's strict `>`
 * counted the just-read message forever. This migration compares both sides at
 * millisecond granularity.
 */
const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../supabase/migrations/20261106080000_chat_unread_millisecond_precision.sql',
  ),
  'utf8',
);

describe('chat unread millisecond-precision migration', () => {
  it('redefines chat_unread_count with the same signature and security', () => {
    expect(migration).toMatch(
      /create or replace function chat_unread_count\(\s*p_conversation_id uuid,\s*p_user_id uuid,\s*p_last_read_at timestamptz\s*\)/i,
    );
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/set search_path to 'public'/i);
  });

  it('compares message time and the read marker at millisecond granularity', () => {
    expect(migration).toMatch(
      /date_trunc\('milliseconds', msg\.created_at\)\s*>\s*date_trunc\('milliseconds', p_last_read_at\)/,
    );
    // The cleared_at boundary is truncated the same way.
    expect(migration).toMatch(/date_trunc\('milliseconds', m\.cleared_at\)/);
    // It must NOT keep the raw microsecond comparison as an actual SQL clause
    // (the explanatory comment may still quote it).
    expect(migration).not.toMatch(/\n\s*and msg\.created_at > p_last_read_at/);
  });

  it('keeps the helper internal (execute revoked), unchanged from 0108', () => {
    expect(migration).toMatch(
      /revoke all on function chat_unread_count\(uuid, uuid, timestamptz\) from public, anon, authenticated;/i,
    );
    // Still only counts other members' non-deleted messages.
    expect(migration).toMatch(/msg\.deleted_at is null/);
    expect(migration).toMatch(/msg\.sender_user_id is distinct from p_user_id/);
  });
});
