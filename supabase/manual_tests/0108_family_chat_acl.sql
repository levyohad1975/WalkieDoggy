-- ============================================================================
-- manual_tests/0108_family_chat_acl.sql
--
-- Manual verification for migration 0108_family_chat.sql.
--
-- Proves, as real `authenticated` sessions (never as the table owner):
--   * one conversation per family, created lazily and idempotently;
--   * cross-family isolation for reads AND every write RPC;
--   * the sender is derived server-side and a message id is idempotent;
--   * content validation (empty / too long / control characters);
--   * clients cannot INSERT/UPDATE/DELETE chat rows directly;
--   * only a real family admin can moderate, and moderation erases the text;
--   * impersonating admins, removed members and the System Admin hidden
--     observer are all locked out as designed;
--   * unread counters, the read marker and the mute preference;
--   * push context / recipients / de-duplication.
--
-- Everything runs in one transaction and is rolled back.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/manual_tests/0108_family_chat_acl.sql
-- ============================================================================

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000c108001'), -- family A admin
  ('00000000-0000-0000-0000-00000c108002'), -- family A member
  ('00000000-0000-0000-0000-00000c108003'), -- family A member (child)
  ('00000000-0000-0000-0000-00000c108004'), -- family A removed member
  ('00000000-0000-0000-0000-00000c108005'), -- family B admin
  ('00000000-0000-0000-0000-00000c108006')  -- system admin (observer)
on conflict (id) do nothing;

do $$
declare
  fam_a uuid;
  fam_b uuid;
  a_admin uuid;
  a_member uuid;
  a_child uuid;
  a_removed uuid;
  b_admin uuid;
begin
  insert into families (name, invite_code) values ('משפחת צ׳אט א', 'CHT08A') returning id into fam_a;
  insert into families (name, invite_code) values ('משפחת צ׳אט ב', 'CHT08B') returning id into fam_b;

  insert into users (family_id, name, avatar, color, role) values (fam_a, 'אבא', '🐶', '#111111', 'admin') returning id into a_admin;
  insert into users (family_id, name, avatar, color, role) values (fam_a, 'אמא', '🐕', '#222222', 'member') returning id into a_member;
  insert into users (family_id, name, avatar, color, role) values (fam_a, 'נועה', '🐩', '#333333', 'member') returning id into a_child;
  insert into users (family_id, name, avatar, color, role, removed_at) values (fam_a, 'לשעבר', '🦴', '#444444', 'member', now()) returning id into a_removed;
  insert into users (family_id, name, avatar, color, role) values (fam_b, 'שכן', '🐾', '#555555', 'admin') returning id into b_admin;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam_a, '00000000-0000-0000-0000-00000c108001', 'admin'),
    (fam_a, '00000000-0000-0000-0000-00000c108002', 'member'),
    (fam_a, '00000000-0000-0000-0000-00000c108003', 'member'),
    (fam_a, '00000000-0000-0000-0000-00000c108004', 'member'),
    (fam_b, '00000000-0000-0000-0000-00000c108005', 'admin');

  insert into profile_auth_sessions (auth_user_id, family_id, user_id) values
    ('00000000-0000-0000-0000-00000c108001', fam_a, a_admin),
    ('00000000-0000-0000-0000-00000c108002', fam_a, a_member),
    ('00000000-0000-0000-0000-00000c108003', fam_a, a_child),
    ('00000000-0000-0000-0000-00000c108004', fam_a, a_removed),
    ('00000000-0000-0000-0000-00000c108005', fam_b, b_admin);

  insert into system_admins (auth_user_id) values ('00000000-0000-0000-0000-00000c108006');

  create temporary table t108 as
  select fam_a, fam_b, a_admin, a_member, a_child, a_removed, b_admin,
         null::uuid as conv_a, null::uuid as conv_b,
         '00000000-0000-0000-0000-0000108aaaa1'::uuid as msg_1;
end $$;

grant select, update on t108 to authenticated, anon, service_role;

-- A tiny assertion helper that reports which check failed.
create or replace function pg_temp.expect_error(p_sql text, p_fragment text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_fragment in sqlerrm) = 0 then
      raise exception 'FAIL [%]: expected error containing "%", got "%"', p_label, p_fragment, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL [%]: expected an error containing "%", but the statement succeeded', p_label, p_fragment;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Family A member opens the conversation, sends, and retries idempotently
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c108002"}';

do $$
declare
  v_open jsonb;
  v_again jsonb;
  v_msg chat_messages;
  v_retry chat_messages;
  v_clean chat_messages;
begin
  v_open := chat_open_family_conversation();
  v_again := chat_open_family_conversation();
  assert v_open->>'conversation_id' = v_again->>'conversation_id', 'open must be idempotent';
  assert (v_open->>'can_moderate')::boolean = false, 'a regular member cannot moderate';
  assert (v_open->>'user_id')::uuid = (select a_member from t108), 'identity is the real claimed profile';
  update t108 set conv_a = (v_open->>'conversation_id')::uuid;

  v_msg := chat_send_message((select conv_a from t108), (select msg_1 from t108), E'  שלום לכולם \n ');
  assert v_msg.body = 'שלום לכולם', 'body is trimmed';
  assert v_msg.sender_user_id = (select a_member from t108), 'sender is derived server-side';
  assert v_msg.family_id = (select fam_a from t108), 'message carries the sender family';

  v_retry := chat_send_message((select conv_a from t108), (select msg_1 from t108), 'a different text on retry');
  assert v_retry.id = v_msg.id and v_retry.body = 'שלום לכולם', 'same id returns the original row';
  assert (select count(*) from chat_messages where conversation_id = (select conv_a from t108)) = 1,
    'a retried send never creates a second row';

  v_clean := chat_send_message((select conv_a from t108), null, E'Hello\x07 family\tOK');
  assert v_clean.body = E'Hello family\tOK', 'control characters are stripped, tabs kept';

  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_a from t108), E' \n\t '),
    'chat message is empty', 'whitespace-only message');
  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_a from t108), repeat('א', 2001)),
    'chat message is too long', 'over-length message');
  perform chat_send_message((select conv_a from t108), null, repeat('א', 2000));

  -- No direct writes, whatever the row claims.
  perform pg_temp.expect_error(
    format('insert into chat_messages (conversation_id, family_id, sender_user_id, body) values (%L, %L, %L, %L)',
      (select conv_a from t108), (select fam_a from t108), (select a_admin from t108), 'forged'),
    'permission denied', 'direct insert');
  perform pg_temp.expect_error(
    format('update chat_messages set body = %L where id = %L', 'edited', (select msg_1 from t108)),
    'permission denied', 'direct update');
  perform pg_temp.expect_error(
    format('delete from chat_messages where id = %L', (select msg_1 from t108)),
    'permission denied', 'direct delete');
  perform pg_temp.expect_error(
    format('update chat_conversation_members set last_read_at = now() where conversation_id = %L', (select conv_a from t108)),
    'permission denied', 'direct membership update');

  -- A regular member cannot moderate.
  perform pg_temp.expect_error(
    format('select chat_delete_message(%L)', (select msg_1 from t108)),
    'admin permission required', 'member moderation');

  -- Server-only helpers are not callable by clients.
  perform pg_temp.expect_error(
    format('select claim_chat_push_event(%L)', (select msg_1 from t108)),
    'permission denied', 'client claim_chat_push_event');
  perform pg_temp.expect_error(
    format('select * from chat_push_recipients(%L)', (select msg_1 from t108)),
    'permission denied', 'client chat_push_recipients');
  perform pg_temp.expect_error('select * from chat_push_events', 'permission denied', 'client chat_push_events');

  -- Push context exists only for the author.
  assert chat_push_context((select msg_1 from t108))->>'sender_name' = 'אמא', 'author gets push context';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Family B is fully isolated from family A
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c108005"}';

do $$
declare
  v_open jsonb;
begin
  v_open := chat_open_family_conversation();
  assert (v_open->>'conversation_id')::uuid <> (select conv_a from t108), 'each family has its own conversation';
  assert (v_open->>'can_moderate')::boolean, 'family B admin moderates family B';
  update t108 set conv_b = (v_open->>'conversation_id')::uuid;

  assert (select count(*) from chat_messages where conversation_id = (select conv_a from t108)) = 0,
    'family B cannot read family A messages';
  assert (select count(*) from chat_messages) = 0, 'family B sees no foreign messages at all';
  assert (select count(*) from chat_conversations) = 1, 'family B sees only its own conversation';
  assert (select count(*) from chat_conversation_members) = 1, 'family B sees only its own membership row';

  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_a from t108), 'intrusion'),
    'chat conversation not found', 'cross-family send');
  perform pg_temp.expect_error(
    format('select chat_mark_read(%L)', (select conv_a from t108)),
    'chat conversation not found', 'cross-family mark read');
  perform pg_temp.expect_error(
    format('select chat_set_notifications_muted(%L, true)', (select conv_a from t108)),
    'chat conversation not found', 'cross-family mute');
  -- An admin of ANOTHER family cannot moderate, and learns nothing.
  perform pg_temp.expect_error(
    format('select chat_delete_message(%L)', (select msg_1 from t108)),
    'chat message not found', 'cross-family moderation');
  -- Re-using a foreign message id neither overwrites nor reveals it.
  perform pg_temp.expect_error(
    format('select chat_send_message(%L, %L, %L)', (select conv_b from t108), (select msg_1 from t108), 'collision'),
    'chat message id conflict', 'foreign message id reuse');
  assert chat_push_context((select msg_1 from t108)) is null, 'no push context for a foreign message';

  -- Flood guard: 20 messages a minute per sender, then a clear rejection.
  for i in 1..20 loop
    perform chat_send_message((select conv_b from t108), null, format('הודעה %s', i));
  end loop;
  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_b from t108), 'one too many'),
    'sent too quickly', 'rate limit');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Unread counter, read marker and mute for another family A member
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c108003"}';
select chat_open_family_conversation();

-- The whole file is one transaction (now() is constant), so age the child's
-- read marker by hand to stand in for "these messages arrived later".
reset role;
update chat_conversation_members
set last_read_at = now() - interval '1 hour'
where user_id = (select a_child from t108);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c108003"}';

do $$
declare
  v_open jsonb;
begin
  v_open := chat_open_family_conversation();
  assert (v_open->>'unread_count')::int = 3, format('three unread messages expected, got %s', v_open->>'unread_count');
  assert (select count(*) from chat_messages where conversation_id = (select conv_a from t108)) = 3,
    'a family member reads the family conversation';
  -- The author of a message never sees it as unread, and does not get its push context.
  assert chat_push_context((select msg_1 from t108)) is null, 'non-author gets no push context';

  assert chat_mark_read((select conv_a from t108), now() + interval '1 day') = 0, 'mark read clears the counter';
  assert (select last_read_at from chat_conversation_members where user_id = (select a_child from t108)) <= now(),
    'the read marker can never be pushed into the future';
  assert chat_mark_read((select conv_a from t108), now() - interval '1 year') = 0,
    'the read marker never moves backwards';

  assert chat_set_notifications_muted((select conv_a from t108), true) = true, 'mute is stored';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Push recipients and de-duplication (service role)
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;

do $$
declare
  v_recipients uuid[];
begin
  select array_agg(r order by r) into v_recipients from chat_push_recipients((select msg_1 from t108)) r;
  -- Sender (אמא) excluded, muted child excluded, removed member excluded,
  -- family B excluded: only the family A admin remains.
  assert v_recipients = array[(select a_admin from t108)],
    format('unexpected push recipients: %s', v_recipients);

  assert claim_chat_push_event((select msg_1 from t108)) = true, 'first claim wins';
  assert claim_chat_push_event((select msg_1 from t108)) = false, 'a duplicate trigger is rejected';
  perform mark_chat_push_event((select msg_1 from t108), 'sent');
  assert claim_chat_push_event((select msg_1 from t108)) = false, 'a sent message is never re-notified';
end $$;

reset role;
-- The existing per-member notification switch is honoured too.
update users set reminders_enabled = false where id = (select a_admin from t108);
set local role service_role;
do $$
begin
  assert (select count(*) from chat_push_recipients((select msg_1 from t108))) = 0,
    'a member with notifications turned off is not a recipient';
end $$;
reset role;
update users set reminders_enabled = true where id = (select a_admin from t108);

-- ---------------------------------------------------------------------------
-- 5. Admin moderation, and the impersonation lock
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c108001"}';

do $$
declare
  v_open jsonb;
  v_deleted chat_messages;
begin
  v_open := chat_open_family_conversation();
  assert (v_open->>'can_moderate')::boolean, 'family A admin can moderate';

  v_deleted := chat_delete_message((select msg_1 from t108));
  assert v_deleted.deleted_at is not null and v_deleted.body = '', 'moderation erases the text';
  assert v_deleted.deleted_by_user_id = (select a_admin from t108), 'moderator is recorded server-side';
  assert (chat_delete_message((select msg_1 from t108))).deleted_at = v_deleted.deleted_at, 'deleting twice is a no-op';
end $$;

reset role;
do $$
begin
  assert (select count(*) from audit_log
          where action = 'chat_message_deleted' and target_id = (select msg_1 from t108)
            and actor_user_id = (select a_admin from t108)) = 1, 'moderation is audited exactly once';
  assert (select count(*) from audit_log where metadata::text like '%שלום%') = 0, 'message text is never audited';
end $$;

-- The admin starts impersonating the regular member: chat becomes read-only.
insert into impersonation_sessions (family_id, admin_auth_user_id, admin_user_id, target_user_id)
select fam_a, '00000000-0000-0000-0000-00000c108001', a_admin, a_member from t108;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c108001"}';
do $$
declare
  v_open jsonb;
begin
  v_open := chat_open_family_conversation();
  assert (v_open->>'user_id')::uuid = (select a_admin from t108), 'chat identity stays the REAL profile while impersonating';
  assert (v_open->>'can_moderate')::boolean = false, 'no moderation while impersonating';
  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_a from t108), 'as someone else'),
    'read-only while impersonating', 'send while impersonating');
  perform pg_temp.expect_error(
    format('select chat_delete_message(%L)', (select id from chat_messages where deleted_at is null limit 1)),
    'read-only while impersonating', 'moderate while impersonating');
end $$;
reset role;
update impersonation_sessions set ended_at = now() where admin_auth_user_id = '00000000-0000-0000-0000-00000c108001';

-- ---------------------------------------------------------------------------
-- 6. Removed member, System Admin hidden observer, and anon
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c108004"}';
do $$
begin
  assert (select count(*) from chat_messages) = 0, 'a removed member reads nothing';
  perform pg_temp.expect_error('select chat_open_family_conversation()', 'no active profile', 'removed member open');
  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_a from t108), 'still here'),
    'no active profile', 'removed member send');
end $$;

reset role;
insert into system_admin_observer_sessions (system_admin_auth_user_id, family_id)
select '00000000-0000-0000-0000-00000c108006', fam_a from t108;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c108006"}';
do $$
begin
  assert current_family_id() = (select fam_a from t108), 'observer mode is active for this check';
  assert (select count(*) from chat_messages) = 0, 'the hidden observer cannot read a family conversation';
  assert (select count(*) from chat_conversations) = 0, 'the hidden observer cannot see the conversation';
  perform pg_temp.expect_error('select chat_open_family_conversation()', 'no active profile', 'observer open');
  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_a from t108), 'observer'),
    'no active profile', 'observer send');
end $$;

reset role;
set local role anon;
set local request.jwt.claims = '{}';
do $$
begin
  perform pg_temp.expect_error('select count(*) from chat_messages', 'permission denied', 'anon read');
  perform pg_temp.expect_error('select chat_open_family_conversation()', 'permission denied', 'anon open');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 7. Structural guarantees
-- ---------------------------------------------------------------------------
do $$
begin
  -- Cross-family kinds cannot be created, even by the table owner. (The
  -- guarding constraint is chat_conversations_phase1_family_only under 0108
  -- alone, and chat_conversations_same_family_kinds once 0109 is applied.)
  perform pg_temp.expect_error(
    'insert into chat_conversations (kind) values (''group'')',
    'violates check constraint "chat_conversations_', 'conversation kind guard');
  perform pg_temp.expect_error(
    format('insert into chat_conversations (kind, family_id) values (''family'', %L)', (select fam_a from t108)),
    'chat_conversations_one_per_family_idx', 'one conversation per family');
  assert (select count(*) from pg_policies
          where tablename like 'chat\_%' and cmd <> 'SELECT') = 0, 'chat tables expose SELECT policies only';
  assert (select bool_and(relrowsecurity) from pg_class
          where relname in ('chat_conversations', 'chat_conversation_members', 'chat_messages', 'chat_push_events')),
    'RLS is enabled on every chat table';
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    assert exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'chat_messages'),
      'chat_messages is published to Realtime';
  end if;
end $$;

select '0108 family chat ACL checks passed' as result;

rollback;
