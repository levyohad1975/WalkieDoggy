-- Isolated, transactional Postgres integration test for the additive
-- System Admin chat viewer migration. No hosted project is modified.
begin;
insert into auth.users (id,is_anonymous,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000cafe001',false,'chat-admin@example.invalid',now()),
 ('00000000-0000-0000-0000-000000cafe002',true,null,null)
on conflict(id) do update set is_anonymous=excluded.is_anonymous,email=excluded.email,email_confirmed_at=excluded.email_confirmed_at;
insert into system_admins(auth_user_id) values ('00000000-0000-0000-0000-000000cafe001') on conflict do nothing;

create temporary table t_system_admin_chat_qa(f1 uuid,f2 uuid,a uuid,b uuid,c_family uuid,c_direct uuid,c_group uuid,old_read timestamptz);
do $$
declare f1 uuid; f2 uuid; a uuid; b uuid; c_family uuid; c_direct uuid; c_group uuid; old_read timestamptz;
begin
  insert into families(name,invite_code) values ('Chat Audit QA','CHATQA01') returning id into f1;
  insert into families(name,invite_code) values ('Chat Isolation QA','CHATQA02') returning id into f2;
  insert into users(family_id,name,avatar,color,role) values(f1,'QA Admin','🐶','#111111','admin') returning id into a;
  insert into users(family_id,name,avatar,color,role) values(f1,'QA Member','🐕','#222222','member') returning id into b;
  insert into family_auth_members(family_id,auth_user_id,role) values(f1,'00000000-0000-0000-0000-000000cafe002','member');
  insert into profile_auth_sessions(auth_user_id,family_id,user_id) values('00000000-0000-0000-0000-000000cafe002',f1,b);
  insert into chat_conversations(kind,family_id,title) values('family',f1,'Family QA') returning id into c_family;
  insert into chat_conversations(kind,family_id,direct_user_low,direct_user_high,title)
    values('direct',f1,least(a,b),greatest(a,b),null) returning id into c_direct;
  -- The released staging schema supports group kind; the historical local
  -- bootstrap migration keeps it disabled. Relax only this disposable test
  -- transaction's check so the viewer's group read path is exercised.
  alter table public.chat_conversations drop constraint if exists chat_conversations_same_family_kinds;
  insert into chat_conversations(kind,family_id,title) values('group',f1,'Group QA') returning id into c_group;
  insert into chat_conversation_members(conversation_id,user_id,family_id) values
    (c_family,a,f1),(c_family,b,f1),(c_direct,a,f1),(c_direct,b,f1),(c_group,a,f1),(c_group,b,f1);
  insert into chat_messages(id,conversation_id,family_id,sender_user_id,body,created_at)
    values('00000000-0000-0000-0000-0000cafe0001',c_direct,f1,b,'private content',now());
  insert into chat_messages(conversation_id,family_id,sender_user_id,body,deleted_at) values(c_direct,f1,b,'',now());
  select last_read_at into old_read from chat_conversation_members where conversation_id=c_direct and user_id=a;
  insert into t_system_admin_chat_qa values(f1,f2,a,b,c_family,c_direct,c_group,old_read);
end $$;
grant select on t_system_admin_chat_qa to authenticated;

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000cafe001","is_anonymous":false}';
do $$
declare x t_system_admin_chat_qa; v_messages jsonb;
begin
  select * into x from t_system_admin_chat_qa;
  assert jsonb_array_length(system_admin_list_chat_families('Chat Audit QA',100,0))=1;
  assert jsonb_array_length(system_admin_list_family_chats(x.f1))=3;
  v_messages := system_admin_read_chat_messages(x.f1,x.c_direct,'support',null,null,40);
  assert jsonb_array_length(v_messages)=2;
  assert exists(select 1 from jsonb_array_elements(v_messages) m where m->>'deleted_at' is not null and m->'body'='null'::jsonb), 'deleted message body must remain hidden';
  begin
    perform system_admin_read_chat_messages(x.f2,x.c_direct,'support',null,null,10);
    raise exception 'cross-family conversation scope was accepted';
  exception when no_data_found then null;
  end;
end $$;

reset role;
do $$
declare x t_system_admin_chat_qa;
begin
  select * into x from t_system_admin_chat_qa;
  assert (select last_read_at=x.old_read from chat_conversation_members where conversation_id=x.c_direct and user_id=x.a), 'admin read changed read marker';
  assert (select count(*)=1 from system_admin_chat_access_audit where family_id=x.f1 and conversation_id=x.c_direct and access_reason='support'), 'missing access audit';
  assert not exists(select 1 from information_schema.columns where table_schema='public' and table_name='system_admin_chat_access_audit' and column_name in ('body','attachment_path','file_content')), 'audit must not contain private content';
end $$;

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000cafe002","is_anonymous":true}';
do $$
declare x t_system_admin_chat_qa;
begin
  select * into x from t_system_admin_chat_qa;
  begin
    perform system_admin_list_family_chats(x.f1);
    raise exception 'regular anonymous member was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
