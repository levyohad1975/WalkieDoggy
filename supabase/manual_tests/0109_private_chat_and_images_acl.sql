-- ============================================================================
-- manual_tests/0109_private_chat_and_images_acl.sql
--
-- Manual verification for migration 0109_private_chat_and_images.sql.
--
-- Proves, as real `authenticated` sessions:
--   * one private conversation per pair, whichever side opens it;
--   * only the two participants can list, read, send, mark read, mute;
--   * a family ADMIN cannot read, send, moderate or even see it — directly
--     or while impersonating one of the participants;
--   * the System Admin hidden observer, a removed member and another family
--     get nothing;
--   * no private conversation can be opened across families;
--   * image upload / read / delete rules on the private bucket, including
--     guessed paths, someone else's upload folder and attached-file reuse;
--   * removing a message revokes its image immediately and queues the file;
--   * push recipients: a private message notifies only the other participant;
--   * the family conversation still behaves as in 0108.
--
-- Everything runs in one transaction and is rolled back.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/manual_tests/0109_private_chat_and_images_acl.sql
-- ============================================================================

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000c109001'), -- family A admin (אבא)
  ('00000000-0000-0000-0000-00000c109002'), -- family A member (אמא)
  ('00000000-0000-0000-0000-00000c109003'), -- family A member (נועה)
  ('00000000-0000-0000-0000-00000c109004'), -- family A removed member
  ('00000000-0000-0000-0000-00000c109005'), -- family B admin
  ('00000000-0000-0000-0000-00000c109006')  -- system admin (observer)
on conflict (id) do nothing;

do $$
declare
  fam_a uuid;
  fam_b uuid;
  a_admin uuid;
  a_ima uuid;
  a_noa uuid;
  a_removed uuid;
  b_admin uuid;
begin
  insert into families (name, invite_code) values ('משפחת פרטי א', 'CHT09A') returning id into fam_a;
  insert into families (name, invite_code) values ('משפחת פרטי ב', 'CHT09B') returning id into fam_b;

  insert into users (family_id, name, avatar, color, role) values (fam_a, 'אבא', '🐶', '#111111', 'admin') returning id into a_admin;
  insert into users (family_id, name, avatar, color, role) values (fam_a, 'אמא', '🐕', '#222222', 'member') returning id into a_ima;
  insert into users (family_id, name, avatar, color, role) values (fam_a, 'נועה', '🐩', '#333333', 'member') returning id into a_noa;
  insert into users (family_id, name, avatar, color, role, removed_at) values (fam_a, 'לשעבר', '🦴', '#444444', 'member', now()) returning id into a_removed;
  insert into users (family_id, name, avatar, color, role) values (fam_b, 'שכן', '🐾', '#555555', 'admin') returning id into b_admin;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam_a, '00000000-0000-0000-0000-00000c109001', 'admin'),
    (fam_a, '00000000-0000-0000-0000-00000c109002', 'member'),
    (fam_a, '00000000-0000-0000-0000-00000c109003', 'member'),
    (fam_a, '00000000-0000-0000-0000-00000c109004', 'member'),
    (fam_b, '00000000-0000-0000-0000-00000c109005', 'admin');

  insert into profile_auth_sessions (auth_user_id, family_id, user_id) values
    ('00000000-0000-0000-0000-00000c109001', fam_a, a_admin),
    ('00000000-0000-0000-0000-00000c109002', fam_a, a_ima),
    ('00000000-0000-0000-0000-00000c109003', fam_a, a_noa),
    ('00000000-0000-0000-0000-00000c109004', fam_a, a_removed),
    ('00000000-0000-0000-0000-00000c109005', fam_b, b_admin);

  insert into system_admins (auth_user_id) values ('00000000-0000-0000-0000-00000c109006');

  create temporary table t109 as
  select fam_a, fam_b, a_admin, a_ima, a_noa, a_removed, b_admin,
         null::uuid as conv_family, null::uuid as conv_direct, null::uuid as conv_b,
         '00000000-0000-4000-8000-0000109aaaa1'::uuid as msg_text,
         '00000000-0000-4000-8000-0000109aaaa2'::uuid as msg_image,
         '00000000-0000-4000-8000-0000109aaaa3'::uuid as msg_family_image,
         '00000000-0000-4000-8000-0000109aaaa4'::uuid as msg_orphan,
         null::text as path_image, null::text as path_family_image, null::text as path_orphan;
end $$;

grant select, update on t109 to authenticated, anon, service_role;

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

-- Stand-in for an upload through the Storage API as the current session:
-- the API inserts the object row under the caller's JWT, subject to RLS.
create or replace function pg_temp.upload(p_path text, p_mime text default 'image/jpeg', p_size integer default 240000)
returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('chat-attachments', p_path, auth.uid()::text,
          jsonb_build_object('mimetype', p_mime, 'size', p_size));
$$;

-- ---------------------------------------------------------------------------
-- 1. אמא opens a private conversation with נועה and writes
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109002"}';

do $$
declare
  v_state jsonb;
  v_again jsonb;
  v_list jsonb;
  v_msg chat_messages;
begin
  v_state := chat_open_direct_conversation((select a_noa from t109));
  v_again := chat_open_direct_conversation((select a_noa from t109));
  assert v_state->>'conversation_id' = v_again->>'conversation_id', 'opening twice returns the same conversation';
  assert v_state->>'kind' = 'direct', 'kind is direct';
  assert (v_state->>'other_user_id')::uuid = (select a_noa from t109), 'the other participant is reported';
  assert (v_state->>'can_moderate')::boolean = false, 'nobody moderates a private conversation';
  update t109 set conv_direct = (v_state->>'conversation_id')::uuid;

  v_list := chat_list_conversations();
  assert jsonb_array_length(v_list) = 2, format('family + one private conversation expected, got %s', jsonb_array_length(v_list));
  update t109 set conv_family = (
    select (e->>'conversation_id')::uuid from jsonb_array_elements(v_list) e where e->>'kind' = 'family');

  v_msg := chat_send_message((select conv_direct from t109), (select msg_text from t109), 'רק בינינו');
  assert v_msg.sender_user_id = (select a_ima from t109), 'sender derived server-side';

  perform pg_temp.expect_error(
    format('select chat_open_direct_conversation(%L)', (select a_ima from t109)),
    'choose another family member', 'conversation with myself');
  perform pg_temp.expect_error(
    format('select chat_open_direct_conversation(%L)', (select b_admin from t109)),
    'chat member not found', 'private conversation across families');
  perform pg_temp.expect_error(
    format('select chat_open_direct_conversation(%L)', (select a_removed from t109)),
    'chat member not found', 'private conversation with a removed member');
  perform pg_temp.expect_error(
    format('insert into chat_conversations (kind, family_id, direct_user_low, direct_user_high) values (''direct'', %L, %L, %L)',
      (select fam_a from t109), least((select a_ima from t109), (select a_admin from t109)), greatest((select a_ima from t109), (select a_admin from t109))),
    'permission denied', 'direct insert of a conversation');
end $$;

-- ---------------------------------------------------------------------------
-- 2. נועה (the other participant): same conversation, can read and reply
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109003"}';

do $$
declare
  v_state jsonb;
  v_list jsonb;
begin
  v_state := chat_open_direct_conversation((select a_ima from t109));
  assert (v_state->>'conversation_id')::uuid = (select conv_direct from t109), 'no duplicate conversation from the other side';
  assert (select count(*) from chat_conversations where kind = 'direct') = 1, 'exactly one private conversation is visible';
  assert (select body from chat_messages where id = (select msg_text from t109)) = 'רק בינינו', 'the participant reads the message';

  v_list := chat_list_conversations();
  assert jsonb_array_length(v_list) = 2, 'the recipient sees the conversation once it has a message';
  assert (select e->'last_message'->>'preview' from jsonb_array_elements(v_list) e where e->>'kind' = 'direct') = 'רק בינינו',
    'last-message preview';
  assert (select (e->>'unread_count')::int from jsonb_array_elements(v_list) e where e->>'kind' = 'direct') >= 0, 'unread count is reported per conversation';

  perform chat_send_message((select conv_direct from t109), null, 'קיבלתי');
  assert chat_mark_read((select conv_direct from t109)) = 0, 'participant can mark read';
  assert chat_set_notifications_muted((select conv_direct from t109), false) = false, 'participant can set mute';
  -- Only the SENDER can remove a private message.
  perform pg_temp.expect_error(
    format('select chat_delete_message(%L)', (select msg_text from t109)),
    'only the sender can remove this message', 'recipient deleting the sender''s message');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The family ADMIN is not a participant: no access of any kind
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109001"}';

do $$
declare
  v_list jsonb;
begin
  assert (select count(*) from chat_messages where conversation_id = (select conv_direct from t109)) = 0,
    'an admin cannot read private messages';
  assert (select count(*) from chat_conversations where id = (select conv_direct from t109)) = 0,
    'an admin cannot see the private conversation exists';
  assert (select count(*) from chat_conversation_members where conversation_id = (select conv_direct from t109)) = 0,
    'an admin cannot see its membership rows';

  v_list := chat_list_conversations();
  assert jsonb_array_length(v_list) = 1 and v_list->0->>'kind' = 'family',
    'an admin''s list contains only the family conversation';
  assert (v_list->0->>'can_moderate')::boolean, 'the admin still moderates the FAMILY conversation';

  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_direct from t109), 'admin'),
    'chat conversation not found', 'admin send into a private conversation');
  perform pg_temp.expect_error(
    format('select chat_delete_message(%L)', (select msg_text from t109)),
    'chat message not found', 'admin moderating a private message');
  perform pg_temp.expect_error(
    format('select chat_mark_read(%L)', (select conv_direct from t109)),
    'chat conversation not found', 'admin mark read');
  assert chat_push_context((select msg_text from t109)) is null, 'no push context for a private message the admin did not send';
end $$;

-- ...and impersonating a participant does not help.
reset role;
insert into impersonation_sessions (family_id, admin_auth_user_id, admin_user_id, target_user_id)
select fam_a, '00000000-0000-0000-0000-00000c109001', a_admin, a_ima from t109;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109001"}';
do $$
declare
  v_list jsonb;
begin
  assert active_impersonation_target() = (select a_ima from t109), 'impersonation is active for this check';
  assert (select count(*) from chat_messages where conversation_id = (select conv_direct from t109)) = 0,
    'impersonating a participant does not expose their private messages';
  v_list := chat_list_conversations();
  assert jsonb_array_length(v_list) = 1 and (v_list->0->>'user_id')::uuid = (select a_admin from t109),
    'while impersonating, the chat list is still the admin''s own';
  -- The admin's OWN private conversation with the impersonated member does
  -- not exist yet, and cannot be created while impersonating.
  perform pg_temp.expect_error(
    format('select chat_open_direct_conversation(%L)', (select a_ima from t109)),
    'read-only while impersonating', 'creating a conversation while impersonating');
  perform pg_temp.expect_error(
    format('select pg_temp.upload(%L)', (select conv_family from t109) || '/' || (select a_admin from t109) || '/' || gen_random_uuid() || '.jpg'),
    'row-level security', 'upload while impersonating');
end $$;
reset role;
update impersonation_sessions set ended_at = now() where admin_auth_user_id = '00000000-0000-0000-0000-00000c109001';

-- ---------------------------------------------------------------------------
-- 4. Images in the private conversation (אמא uploads and sends)
-- ---------------------------------------------------------------------------
update t109 set
  path_image = conv_direct || '/' || a_ima || '/' || msg_image || '.jpg',
  path_family_image = conv_family || '/' || a_ima || '/' || msg_family_image || '.jpg',
  path_orphan = conv_direct || '/' || a_ima || '/' || msg_orphan || '.jpg';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109002"}';

do $$
declare
  v_msg chat_messages;
  v_retry chat_messages;
  v_other_path text;
begin
  -- Upload rules.
  perform pg_temp.expect_error(
    format('select pg_temp.upload(%L)', (select conv_direct from t109) || '/' || (select a_noa from t109) || '/' || gen_random_uuid() || '.jpg'),
    'row-level security', 'upload into another member''s folder');
  perform pg_temp.expect_error(
    format('select pg_temp.upload(%L)', gen_random_uuid() || '/' || (select a_ima from t109) || '/' || gen_random_uuid() || '.jpg'),
    'row-level security', 'upload into a guessed conversation id');
  perform pg_temp.expect_error(
    format('select pg_temp.upload(%L)', 'anything/else.jpg'),
    'row-level security', 'upload with a malformed path');
  perform pg_temp.expect_error(
    format('select pg_temp.upload(%L)', (select conv_direct from t109) || '/' || (select a_ima from t109) || '/' || gen_random_uuid() || '.svg'),
    'row-level security', 'upload with an unsupported extension');

  -- Sending before uploading is refused.
  perform pg_temp.expect_error(
    format('select chat_send_image_message(%L, %L, %L, 1200, 900)', (select conv_direct from t109), (select msg_image from t109), (select path_image from t109)),
    'chat attachment was not uploaded', 'image message without a file');

  perform pg_temp.upload((select path_image from t109));
  assert (select count(*) from storage.objects where name = (select path_image from t109)) = 1, 'uploader can see their own pending upload';

  perform pg_temp.expect_error(
    format('select chat_send_image_message(%L, %L, %L, 5000, 900)', (select conv_direct from t109), (select msg_image from t109), (select path_image from t109)),
    'dimensions are not supported', 'oversized dimensions');
  -- The file is named after its message: it cannot be attached to another id.
  perform pg_temp.expect_error(
    format('select chat_send_image_message(%L, %L, %L, 1200, 900)', (select conv_direct from t109), gen_random_uuid(), (select path_image from t109)),
    'chat attachment is not valid', 'file attached to a different message id');
  -- ...nor to another conversation.
  perform pg_temp.expect_error(
    format('select chat_send_image_message(%L, %L, %L, 1200, 900)', (select conv_family from t109), (select msg_image from t109), (select path_image from t109)),
    'chat attachment is not valid', 'file attached to a different conversation');

  v_msg := chat_send_image_message((select conv_direct from t109), (select msg_image from t109), (select path_image from t109), 1200, 900);
  assert v_msg.attachment_path = (select path_image from t109) and v_msg.body = '', 'image message without caption';
  assert v_msg.attachment_mime = 'image/jpeg' and v_msg.attachment_size = 240000, 'type and size come from Storage, not the client';
  v_retry := chat_send_image_message((select conv_direct from t109), (select msg_image from t109), (select path_image from t109), 1, 1, 'retry');
  assert v_retry.id = v_msg.id and v_retry.attachment_width = 1200, 'image send is idempotent';

  -- Type / size as recorded by Storage are enforced.
  v_other_path := (select conv_direct from t109) || '/' || (select a_ima from t109) || '/00000000-0000-4000-8000-0000109bbbb1.png';
  perform pg_temp.upload(v_other_path, 'application/pdf', 1000);
  perform pg_temp.expect_error(
    format('select chat_send_image_message(%L, %L, %L, 10, 10)', (select conv_direct from t109), '00000000-0000-4000-8000-0000109bbbb1', v_other_path),
    'type is not supported', 'non-image content');
  v_other_path := (select conv_direct from t109) || '/' || (select a_ima from t109) || '/00000000-0000-4000-8000-0000109bbbb2.jpg';
  perform pg_temp.upload(v_other_path, 'image/jpeg', 9000000);
  perform pg_temp.expect_error(
    format('select chat_send_image_message(%L, %L, %L, 10, 10)', (select conv_direct from t109), '00000000-0000-4000-8000-0000109bbbb2', v_other_path),
    'chat attachment is too large', 'oversized file');

  -- An unsent upload can be removed by its uploader; an attached file cannot.
  perform pg_temp.upload((select path_orphan from t109));
  delete from storage.objects where name = (select path_orphan from t109);
  assert not exists (select 1 from storage.objects where name = (select path_orphan from t109)), 'uploader removes an unsent upload';
  delete from storage.objects where name = (select path_image from t109);
  assert exists (select 1 from storage.objects where name = (select path_image from t109)), 'a sent image cannot be deleted by a client';
  -- No UPDATE policy exists, so this silently affects nothing.
  update storage.objects set name = 'renamed' where name = (select path_image from t109);
end $$;

do $$
begin
  assert exists (select 1 from storage.objects where name = (select path_image from t109)),
    'a chat image is never renamed or overwritten by a client';

  -- A family-conversation image, for the checks below.
  perform pg_temp.upload((select path_family_image from t109), 'image/webp', 90000);
  perform chat_send_image_message((select conv_family from t109), (select msg_family_image from t109), (select path_family_image from t109), 800, 600, 'טופי בגינה');
end $$;

-- נועה (participant) can read the private image and cannot delete it.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109003"}';
do $$
begin
  assert (select count(*) from storage.objects where name = (select path_image from t109)) = 1, 'the recipient can read the image';
  assert (select count(*) from storage.objects where name = (select path_family_image from t109)) = 1, 'a family member can read a family-chat image';
  delete from storage.objects where name = (select path_image from t109);
  assert (select count(*) from storage.objects where name = (select path_image from t109)) = 1, 'the recipient cannot delete the image';
  -- Re-using someone else's uploaded file for my own message is refused.
  perform pg_temp.expect_error(
    format('select chat_send_image_message(%L, %L, %L, 10, 10)', (select conv_direct from t109), (select msg_image from t109), (select path_image from t109)),
    'chat message id conflict', 'reusing another sender''s message id and file');
end $$;

-- The admin can read the family image but NOT the private one.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109001"}';
do $$
begin
  assert (select count(*) from storage.objects where name = (select path_family_image from t109)) = 1, 'admin reads family-chat images like any member';
  assert (select count(*) from storage.objects where name = (select path_image from t109)) = 0, 'admin cannot read a private image, even knowing its exact path';
  perform pg_temp.expect_error(
    format('select pg_temp.upload(%L)', (select conv_direct from t109) || '/' || (select a_admin from t109) || '/' || gen_random_uuid() || '.jpg'),
    'row-level security', 'admin upload into a private conversation');
end $$;

-- Another family, a removed member, the hidden observer and anon: nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109005"}';
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'chat-attachments') = 0, 'another family reads no chat image';
  assert (select count(*) from chat_messages where conversation_id in ((select conv_direct from t109), (select conv_family from t109))) = 0, 'another family reads no message';
  perform pg_temp.expect_error(
    format('select pg_temp.upload(%L)', (select conv_family from t109) || '/' || (select b_admin from t109) || '/' || gen_random_uuid() || '.jpg'),
    'row-level security', 'cross-family upload');
  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_direct from t109), 'x'),
    'chat conversation not found', 'cross-family send into a private conversation');
end $$;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109004"}';
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'chat-attachments') = 0, 'a removed member reads no chat image';
  assert (select count(*) from chat_messages) = 0, 'a removed member reads no message';
  perform pg_temp.expect_error('select chat_list_conversations()', 'no active profile', 'removed member list');
end $$;

reset role;
insert into system_admin_observer_sessions (system_admin_auth_user_id, family_id)
select '00000000-0000-0000-0000-00000c109006', fam_a from t109;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109006"}';
do $$
begin
  assert current_family_id() = (select fam_a from t109), 'observer mode is active for this check';
  assert (select count(*) from chat_messages) = 0, 'the hidden observer reads no message, family or private';
  assert (select count(*) from chat_conversations) = 0, 'the hidden observer sees no conversation';
  assert (select count(*) from storage.objects where bucket_id = 'chat-attachments') = 0, 'the hidden observer reads no chat image';
  perform pg_temp.expect_error('select chat_list_conversations()', 'no active profile', 'observer list');
  -- A System Admin may read storage totals — never content.
  assert (chat_storage_usage()->>'total_images')::int = 2, 'storage usage reports image totals';
  assert chat_storage_usage()::text not like '%רק בינינו%', 'storage usage carries no message text';
end $$;
reset role;
update system_admin_observer_sessions set ended_at = now() where system_admin_auth_user_id = '00000000-0000-0000-0000-00000c109006';

set local role anon;
set local request.jwt.claims = '{}';
do $$
begin
  perform pg_temp.expect_error('select chat_list_conversations()', 'permission denied', 'anon list');
  assert (select count(*) from storage.objects where bucket_id = 'chat-attachments') = 0, 'anon reads no chat image';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. Push recipients
-- ---------------------------------------------------------------------------
set local role service_role;
do $$
declare
  v_private uuid[];
  v_family uuid[];
begin
  select array_agg(r) into v_private from chat_push_recipients((select msg_image from t109)) r;
  assert v_private = array[(select a_noa from t109)],
    format('a private message notifies only the other participant, got %s', v_private);

  select array_agg(r order by r) into v_family from chat_push_recipients((select msg_family_image from t109)) r;
  assert v_family = (select array_agg(x order by x) from unnest(array[(select a_admin from t109), (select a_noa from t109)]) x),
    format('a family message notifies the other active members, got %s', v_family);
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109003"}';
select chat_set_notifications_muted((select conv_direct from t109), true);
reset role;
set local role service_role;
do $$
begin
  assert (select count(*) from chat_push_recipients((select msg_image from t109))) = 0, 'a muted private conversation notifies nobody';
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109002"}';
do $$
declare
  v_ctx jsonb;
begin
  v_ctx := chat_push_context((select msg_image from t109));
  assert (v_ctx->>'has_image')::boolean and v_ctx->>'conversation_kind' = 'direct', 'push context describes an image in a private conversation';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Removing messages: access to the image ends at once, the file is queued
-- ---------------------------------------------------------------------------
do $$
declare
  v_deleted chat_messages;
begin
  v_deleted := chat_delete_message((select msg_image from t109));
  assert v_deleted.deleted_at is not null and v_deleted.attachment_path is null and v_deleted.body = '',
    'the sender removes their own private image message';
  assert (select count(*) from storage.objects where name = (select path_image from t109)) = 0,
    'even the sender can no longer read a removed message''s image';
end $$;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109003"}';
do $$
begin
  assert (select count(*) from storage.objects where name = (select path_image from t109)) = 0,
    'the recipient can no longer read a removed message''s image';
end $$;

-- A regular member cannot remove a FAMILY message (unchanged from 0108); the admin can.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109002"}';
do $$
begin
  perform pg_temp.expect_error(
    format('select chat_delete_message(%L)', (select msg_family_image from t109)),
    'admin permission required', 'member removing a family message');
end $$;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109001"}';
do $$
begin
  assert (chat_delete_message((select msg_family_image from t109))).attachment_path is null, 'admin removes a family image message';
end $$;

reset role;
do $$
begin
  assert (select count(*) from chat_attachment_deletions where removed_at is null) = 2, 'both removed images are queued for cleanup';
  assert (select count(*) from audit_log where action = 'chat_message_deleted' and target_id = (select msg_family_image from t109)) = 1,
    'family moderation is audited';
  assert (select count(*) from audit_log where target_id = (select msg_image from t109)) = 0,
    'removing my own private message leaves no trace in the family audit log';
end $$;

set local role service_role;
do $$
declare
  v_batch text[];
begin
  select array_agg(p) into v_batch from chat_attachment_cleanup_batch(50) p;
  assert (select path_image from t109) = any (v_batch) and (select path_family_image from t109) = any (v_batch),
    'cleanup batch lists the queued files';
  assert chat_attachment_mark_removed(v_batch) = 2, 'cleanup marks them removed';
  assert (select count(*) from chat_attachment_cleanup_batch(50) p where p in ((select path_image from t109), (select path_family_image from t109))) = 0,
    'removed files are not listed again';
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109002"}';
do $$
begin
  perform pg_temp.expect_error('select * from chat_attachment_deletions', 'permission denied', 'client reading the cleanup queue');
  perform pg_temp.expect_error('select chat_attachment_cleanup_batch(10)', 'permission denied', 'client cleanup batch');
  perform pg_temp.expect_error('select chat_storage_usage()', 'system admin permission required', 'member storage usage');
  perform pg_temp.expect_error(
    format('select chat_post_message(%L, null, %L, null, null, null)', (select conv_direct from t109), 'x'),
    'permission denied', 'client calling the internal post function');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 7. The other participant leaves the family
-- ---------------------------------------------------------------------------
update users set removed_at = now() where id = (select a_noa from t109);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109002"}';
do $$
begin
  assert (select count(*) from chat_messages where conversation_id = (select conv_direct from t109)) >= 2,
    'the remaining participant keeps the history';
  perform pg_temp.expect_error(
    format('select chat_send_message(%L, null, %L)', (select conv_direct from t109), 'עוד שם?'),
    'recipient is no longer in the family', 'sending to a removed member');
end $$;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000c109003"}';
do $$
begin
  assert (select count(*) from chat_messages) = 0, 'the removed participant loses access to the private conversation';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 8. Structural guarantees
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.expect_error(
    format('insert into chat_conversations (kind, family_id) values (''group'', %L)', (select fam_a from t109)),
    'chat_conversations_same_family_kinds', 'group conversations stay impossible');
  perform pg_temp.expect_error(
    'insert into chat_conversations (kind) values (''direct'')',
    'violates check constraint', 'a conversation without a family');
  perform pg_temp.expect_error(
    format('insert into chat_conversations (kind, family_id, direct_user_low, direct_user_high) values (''direct'', %L, %L, %L)',
      (select fam_a from t109), least((select a_ima from t109), (select a_noa from t109)), greatest((select a_ima from t109), (select a_noa from t109))),
    'chat_conversations_direct_pair_idx', 'duplicate private conversation');
  perform pg_temp.expect_error(
    format('insert into chat_conversations (kind, family_id, direct_user_low, direct_user_high) values (''direct'', %L, %L, %L)',
      (select fam_a from t109), (select a_ima from t109), (select a_ima from t109)),
    'chat_conversations_direct_pair', 'private conversation with one participant');
  assert (select public from storage.buckets where id = 'chat-attachments') = false, 'the chat bucket is private';
  assert (select file_size_limit from storage.buckets where id = 'chat-attachments') = 5242880, 'the bucket enforces the size limit';
  assert (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'chat attachments%' and cmd = 'UPDATE') = 0,
    'no client UPDATE policy on chat images';
  assert (select count(*) from pg_policies where tablename like 'chat\_%' and cmd <> 'SELECT') = 0, 'chat tables still expose SELECT policies only';
  assert (select bool_and(relrowsecurity) from pg_class where relname in
    ('chat_conversations', 'chat_conversation_members', 'chat_messages', 'chat_push_events', 'chat_attachment_deletions')),
    'RLS is enabled on every chat table';
end $$;

select '0109 private chat and images ACL checks passed' as result;

rollback;
