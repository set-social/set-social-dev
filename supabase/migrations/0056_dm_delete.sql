-- DM "unsend a message" (sender-only, real delete — this app has no
-- soft-delete/tombstone convention anywhere, so a removed message is just
-- gone rather than replaced by a placeholder) and "delete a conversation"
-- (per-user hide, not a real delete — matches every mainstream messaging
-- app: removing your own copy of a chat doesn't erase the other
-- participant's history, and it resurfaces for whoever hid it the moment
-- a new message arrives).

-- Only the sender may remove their own message.
create policy "dm_messages_delete_own" on public.dm_messages
  for delete using (auth.uid() = sender_id);

-- Realtime DELETE events can only be filtered on `conversation_id` (a
-- non-primary-key column) if the WAL's old-row image actually includes it —
-- with the default replica identity (primary key only), it wouldn't, and
-- useConversationRealtime's DELETE subscription would silently never match.
alter table public.dm_messages replica identity full;

-- Mirrors dm_touch_conversation()'s own INSERT-side bookkeeping (0032,
-- redefined 0038) — recomputes the same denormalized "last message" fields
-- from whatever now remains, so deleting the current last message doesn't
-- leave the inbox sorting/unread-state off a row that no longer exists.
create function public.dm_untouch_conversation() returns trigger as $$
begin
  update public.dm_conversations c
  set
    last_message_at = coalesce(
      (select max(m.created_at) from public.dm_messages m where m.conversation_id = old.conversation_id),
      c.created_at
    ),
    last_message_sender_id = (
      select m.sender_id from public.dm_messages m
      where m.conversation_id = old.conversation_id
      order by m.created_at desc
      limit 1
    )
  where c.id = old.conversation_id;
  return old;
end;
$$ language plpgsql security definer;

create trigger dm_messages_untouch_conversation
  after delete on public.dm_messages
  for each row execute function public.dm_untouch_conversation();

-- Per-participant "hidden from my inbox" flags — deliberately not exposed
-- via a broad update RLS policy (dm_conversations_update_recipient is
-- already scoped to accept/decline only; a wider policy would let either
-- participant update *any* column, including status). set_dm_conversation_hidden()
-- below is the only way a client can touch these.
alter table public.dm_conversations
  add column hidden_for_requester boolean not null default false,
  add column hidden_for_recipient boolean not null default false;

create function public.set_dm_conversation_hidden(p_conversation_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dm_conversations
  set
    hidden_for_requester = case when requester_id = auth.uid() then p_hidden else hidden_for_requester end,
    hidden_for_recipient = case when recipient_id = auth.uid() then p_hidden else hidden_for_recipient end
  where id = p_conversation_id
    and (requester_id = auth.uid() or recipient_id = auth.uid());
end;
$$;

revoke all on function public.set_dm_conversation_hidden(uuid, boolean) from public, anon;
grant execute on function public.set_dm_conversation_hidden(uuid, boolean) to authenticated;

-- A new message un-hides the thread for both sides — otherwise someone who
-- hid a conversation would never see a reply land in their inbox again.
create or replace function public.dm_touch_conversation() returns trigger as $$
begin
  update public.dm_conversations
  set
    last_message_at = new.created_at,
    last_message_sender_id = new.sender_id,
    hidden_for_requester = false,
    hidden_for_recipient = false
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql security definer;
