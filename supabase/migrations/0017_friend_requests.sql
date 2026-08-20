-- Milestone 17: real friend requests (pending/accepted/declined), replacing
-- the instant one-directional `follows` table as the app's relationship
-- model. `follows` is left in place, unused, rather than dropped — nothing
-- reads or writes it after this migration.

create type public.friend_request_status as enum ('pending', 'accepted', 'declined');

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status public.friend_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint friend_requests_no_self check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create index friend_requests_addressee_id_idx on public.friend_requests (addressee_id);
create index friend_requests_requester_id_idx on public.friend_requests (requester_id);

alter table public.friend_requests enable row level security;

create policy "friend_requests_select_participant" on public.friend_requests
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "friend_requests_insert_own" on public.friend_requests
  for insert with check (auth.uid() = requester_id);

-- Only the addressee accepts/declines a pending request.
create policy "friend_requests_update_addressee" on public.friend_requests
  for update using (auth.uid() = addressee_id) with check (auth.uid() = addressee_id);

-- Either participant can delete: cancels a pending request (requester) or
-- removes an accepted friendship (either side) — "unfriend" is a delete,
-- not a status transition, keeping pending->accepted/declined as the only
-- status changes.
create policy "friend_requests_delete_participant" on public.friend_requests
  for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Backfill: a mutual pair of existing follows rows (A follows B and B
-- follows A) becomes one accepted friend_requests row — a best-effort
-- "these two already had a relationship" migration. One-directional
-- follows don't map to a mutual friendship and are left behind in
-- `follows`, uncarried.
insert into public.friend_requests (requester_id, addressee_id, status, resolved_at)
select f1.follower_id, f1.followee_id, 'accepted', now()
from public.follows f1
join public.follows f2
  on f2.follower_id = f1.followee_id and f2.followee_id = f1.follower_id
where f1.follower_id < f1.followee_id
on conflict do nothing;
