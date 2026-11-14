-- Chat reactions (owner request 2026-11-12, "like WhatsApp").
--
-- One reaction per person per message, from a fixed set of six. Removing a
-- reaction sets emoji to NULL instead of deleting the row: Realtime does not
-- apply RLS to DELETE events, so a delete would broadcast the row's key to
-- every subscriber of the table; an UPDATE is filtered by the SELECT policy
-- like any other change. No push notification (owner's choice).
--
-- Access: the same as reading the message. SELECT is allowed exactly when
-- chat_can_access_conversation() allows the conversation (family chat: the
-- family; private chat: its two participants, no admin branch), and only for
-- messages the caller has not cleared from their own history. There are no
-- client write privileges; chat_set_message_reaction() is the only writer
-- and re-checks the message and the caller.

create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  emoji text check (emoji in ('❤️', '👍', '😂', '😮', '😢', '🙏')),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists chat_message_reactions_conversation_idx
  on public.chat_message_reactions(conversation_id, updated_at desc);

alter table public.chat_message_reactions enable row level security;
revoke all on public.chat_message_reactions from public, anon, authenticated;
grant select on public.chat_message_reactions to authenticated;

drop policy if exists "chat reactions select accessible" on public.chat_message_reactions;
create policy "chat reactions select accessible" on public.chat_message_reactions
for select to authenticated
using (
  public.chat_can_access_conversation(conversation_id)
  and exists (
    select 1 from public.chat_messages m
    where m.id = chat_message_reactions.message_id
      and m.deleted_at is null
      and m.created_at > coalesce((
        select cm.cleared_at from public.chat_conversation_members cm
        where cm.conversation_id = m.conversation_id and cm.user_id = public.chat_actor_profile_id()
      ), '-infinity'::timestamptz)
  )
);

create or replace function public.chat_set_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := public.chat_actor_profile_id();
  m record;
  v_row public.chat_message_reactions;
begin
  if v_actor is null then
    raise exception 'no active profile' using errcode = '42501';
  end if;
  if p_emoji is not null and p_emoji not in ('❤️', '👍', '😂', '😮', '😢', '🙏') then
    raise exception 'unsupported reaction' using errcode = '22023';
  end if;
  select * into m from public.chat_messages where id = p_message_id;
  if m.id is null or m.deleted_at is not null or not public.chat_can_access_conversation(m.conversation_id) then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  insert into public.chat_message_reactions(message_id, user_id, conversation_id, family_id, emoji, updated_at)
  values (m.id, v_actor, m.conversation_id, m.family_id, p_emoji, now())
  on conflict (message_id, user_id)
  do update set emoji = excluded.emoji, updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'message_id', v_row.message_id, 'user_id', v_row.user_id, 'conversation_id', v_row.conversation_id,
    'emoji', v_row.emoji, 'updated_at', v_row.updated_at);
end $$;
revoke all on function public.chat_set_message_reaction(uuid, text) from public, anon;
grant execute on function public.chat_set_message_reaction(uuid, text) to authenticated;

-- Live: stream reaction changes like messages (see 20261112150000).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_message_reactions') then
    alter publication supabase_realtime add table public.chat_message_reactions;
  end if;
end $$;
