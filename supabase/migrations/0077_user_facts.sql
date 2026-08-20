-- Arnold "remembered facts" — athlete-named snippets (e.g. "standard shake" ->
-- its ingredients) that Arnold can save and recall on request via the
-- remember_fact/forget_fact tools in chat-coach. Deliberately a separate
-- table from chat_messages: Clear Chat (useClearChat) only deletes
-- chat_messages rows for the athlete's one conversation, and a fact is
-- supposed to survive that — it's tied to the athlete's account, not to any
-- particular conversation thread.

create table public.user_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive uniqueness backstop: chat-coach's remember_fact tool does
-- an explicit "find by label ilike, update if found else insert" rather than
-- relying on this for the happy path (an expression index isn't something
-- supabase-js's .upsert(onConflict:) can target directly) — this just keeps
-- two near-simultaneous calls from ever leaving duplicate rows for the same
-- label.
create unique index user_facts_user_id_label_lower_key on public.user_facts (user_id, lower(label));

alter table public.user_facts enable row level security;

create policy "user_facts_all_own"
  on public.user_facts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
