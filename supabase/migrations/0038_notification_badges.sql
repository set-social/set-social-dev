-- Milestone 38: unread indicators for the Social tab — a red dot on the
-- bottom tab bar when there's anything new (message, friend request, like,
-- or comment), and on the specific place to go look (Messages tile,
-- profile avatar) at the top of the Social tab itself.
--
-- Deliberately no new "notifications" table/feed — these are cheap "is
-- there anything newer than the last time I looked" queries against tables
-- that already exist, not a persisted event log. Friend requests need
-- nothing new here (a pending request is inherently "new" until acted on —
-- see useIncomingFriendRequests, already inline on the feed itself).

alter table public.profiles
  add column messages_seen_at timestamptz not null default now(),
  add column activity_seen_at timestamptz not null default now();

-- Lets "is there an unread message" exclude the athlete's own outgoing
-- messages (last_message_at alone doesn't say who sent it) without a
-- second query per conversation. Kept current by the same trigger that
-- already bumps last_message_at on every insert.
alter table public.dm_conversations add column last_message_sender_id uuid references public.profiles (id);

create or replace function public.dm_touch_conversation() returns trigger as $$
begin
  update public.dm_conversations
  set last_message_at = new.created_at, last_message_sender_id = new.sender_id
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql security definer;

-- Backfill existing conversations so a pre-existing thread's last message
-- isn't misread as "unread" for both participants the moment this ships.
update public.dm_conversations c
set last_message_sender_id = m.sender_id
from public.dm_messages m
where m.id = (
  select id from public.dm_messages
  where conversation_id = c.id
  order by created_at desc
  limit 1
);
