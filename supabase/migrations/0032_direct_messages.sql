-- Milestone 32: direct messages. Instagram-style — any two non-blocked
-- users can start a thread; it lands as 'pending' until the recipient
-- accepts, at which point it behaves like a normal conversation. Unlike
-- friend_requests, this isn't gated on an existing friendship.

create type public.dm_conversation_status as enum ('pending', 'accepted', 'declined');

create table public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status public.dm_conversation_status not null default 'pending',
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint dm_conversations_no_self check (requester_id <> recipient_id)
);

-- One conversation per pair regardless of who started it — normalized via
-- least/greatest so (A,B) and (B,A) can never both exist.
create unique index dm_conversations_pair_idx
  on public.dm_conversations (least(requester_id, recipient_id), greatest(requester_id, recipient_id));

create index dm_conversations_requester_id_idx on public.dm_conversations (requester_id);
create index dm_conversations_recipient_id_idx on public.dm_conversations (recipient_id);

alter table public.dm_conversations enable row level security;

create policy "dm_conversations_select_participant" on public.dm_conversations
  for select using (auth.uid() = requester_id or auth.uid() = recipient_id);

-- A blocked pair (in either direction) can never start a thread.
create policy "dm_conversations_insert_requester" on public.dm_conversations
  for insert with check (
    auth.uid() = requester_id
    and not exists (
      select 1 from public.blocked_users bu
      where (bu.blocker_id = requester_id and bu.blocked_id = recipient_id)
         or (bu.blocker_id = recipient_id and bu.blocked_id = requester_id)
    )
  );

-- Only the recipient accepts/declines a pending request. last_message_at is
-- kept in sync by a trigger (below) rather than a broader update policy, so
-- sending a message never needs the sender to also have update rights on
-- the conversation row.
create policy "dm_conversations_update_recipient" on public.dm_conversations
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text,
  photo_path text,
  created_at timestamptz not null default now(),
  constraint dm_messages_has_content check (body is not null or photo_path is not null)
);

create index dm_messages_conversation_id_idx on public.dm_messages (conversation_id);

alter table public.dm_messages enable row level security;

create policy "dm_messages_select_participant" on public.dm_messages
  for select using (
    exists (
      select 1 from public.dm_conversations c
      where c.id = conversation_id and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
    )
  );

create policy "dm_messages_insert_participant" on public.dm_messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.dm_conversations c
      where c.id = conversation_id and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
    )
  );

-- Keeps dm_conversations.last_message_at (the inbox sort key) current
-- without every call site remembering to bump it — runs as the table
-- owner so it isn't blocked by dm_conversations' recipient-only update
-- policy, which is unrelated to "a message was just sent".
create function public.dm_touch_conversation() returns trigger as $$
begin
  update public.dm_conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$ language plpgsql security definer;

create trigger dm_messages_touch_conversation
  after insert on public.dm_messages
  for each row execute function public.dm_touch_conversation();

create table public.dm_message_likes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.dm_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index dm_message_likes_message_id_idx on public.dm_message_likes (message_id);

alter table public.dm_message_likes enable row level security;

create policy "dm_message_likes_select_participant" on public.dm_message_likes
  for select using (
    exists (
      select 1 from public.dm_messages m
      join public.dm_conversations c on c.id = m.conversation_id
      where m.id = message_id and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
    )
  );

create policy "dm_message_likes_insert_participant" on public.dm_message_likes
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.dm_messages m
      join public.dm_conversations c on c.id = m.conversation_id
      where m.id = message_id and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
    )
  );

-- Only the liker can remove their own like — same as post_likes.
create policy "dm_message_likes_delete_own" on public.dm_message_likes
  for delete using (auth.uid() = user_id);

-- First table in this project to use Realtime — DM delivery needs live
-- push while a conversation is open, unlike everything else so far, which
-- reads via refetch-on-focus/pull-to-refresh.
alter publication supabase_realtime add table public.dm_messages;

-- Private bucket, keyed by conversation id rather than sender id (unlike
-- post-photos/{userId}/...) since both participants must be able to read a
-- photo either of them sent.
insert into storage.buckets (id, name, public)
values ('dm-photos', 'dm-photos', false)
on conflict (id) do nothing;

create policy "dm_photos_participant_all" on storage.objects
  for all
  using (
    bucket_id = 'dm-photos'
    and exists (
      select 1 from public.dm_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
    )
  )
  with check (
    bucket_id = 'dm-photos'
    and exists (
      select 1 from public.dm_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
    )
  );
