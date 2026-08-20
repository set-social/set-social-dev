-- Milestone 18: blocked users. Filtering built into every social query
-- (search, friend relationships, friend requests) now, so Phase 3's
-- posts/visibility work builds on a foundation that already excludes
-- blocked relationships rather than retrofitting it later.

create table public.blocked_users (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_users_no_self_block check (blocker_id <> blocked_id)
);

create index blocked_users_blocked_id_idx on public.blocked_users (blocked_id);

alter table public.blocked_users enable row level security;

-- Both the blocker and the blocked party can see a block row — the blocked
-- party needs to know a block exists so their own client-side filtering
-- (and, later, RLS on posts) can hide the blocker's content from them too;
-- mutual invisibility requires both sides to be able to detect the block.
create policy "blocked_users_select_participant" on public.blocked_users
  for select using (auth.uid() = blocker_id or auth.uid() = blocked_id);

create policy "blocked_users_insert_own" on public.blocked_users
  for insert with check (auth.uid() = blocker_id);

-- Only the blocker can undo their own block.
create policy "blocked_users_delete_own" on public.blocked_users
  for delete using (auth.uid() = blocker_id);
