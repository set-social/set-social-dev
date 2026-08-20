-- Milestone 7: AI coach chat. One persistent conversation per user; the
-- chat-coach Edge Function streams the assistant's reply token-by-token over
-- Realtime Broadcast on topic `chat-<conversation id>` and persists both
-- sides of the exchange here once the reply finishes.

create type public.chat_role as enum ('user', 'assistant');

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One conversation per user for now - simplest shape for a single ongoing
-- coach thread. Revisit if/when multiple named conversations are needed.
create unique index chat_conversations_user_id_key on public.chat_conversations (user_id);

alter table public.chat_conversations enable row level security;

create policy "chat_conversations_all_own"
  on public.chat_conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  role public.chat_role not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index chat_messages_conversation_id_idx on public.chat_messages (conversation_id, created_at);

alter table public.chat_messages enable row level security;

create policy "chat_messages_all_own"
  on public.chat_messages for all
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id and c.user_id = auth.uid()
    )
  );
