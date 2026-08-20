-- Milestone 19: posts (progress photos, before/after photos) with
-- Private/Friends visibility, enforced server-side at two layers — the
-- posts table itself, and Storage (photos live at
-- post-photos/{userId}/{visibility}/{filename}, so a private object can
-- never be fetched by anyone but its owner even with the exact path).
--
-- post_type intentionally only covers what this phase creates. Phase 4
-- (feed unification) will decide how workout-completed/PR/streak entries
-- work — most likely computed from the tables that already own that data
-- rather than duplicated into this table — and can add enum values with
-- `alter type ... add value` if it turns out they need to be real rows.

create type public.post_type as enum ('progress_photo', 'before_after_photo');
create type public.post_visibility as enum ('private', 'friends');

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_type public.post_type not null,
  visibility public.post_visibility not null default 'friends',
  caption text,
  photo_path text,
  before_photo_path text,
  after_photo_path text,
  created_at timestamptz not null default now()
);

create index posts_user_id_idx on public.posts (user_id);
create index posts_created_at_idx on public.posts (created_at desc);

alter table public.posts enable row level security;

create policy "posts_select_visible" on public.posts
  for select using (
    auth.uid() = user_id
    or (
      visibility = 'friends'
      and exists (
        select 1 from public.friend_requests fr
        where fr.status = 'accepted'
          and ((fr.requester_id = auth.uid() and fr.addressee_id = posts.user_id)
            or (fr.addressee_id = auth.uid() and fr.requester_id = posts.user_id))
      )
      and not exists (
        select 1 from public.blocked_users bu
        where (bu.blocker_id = auth.uid() and bu.blocked_id = posts.user_id)
           or (bu.blocker_id = posts.user_id and bu.blocked_id = auth.uid())
      )
    )
  );

create policy "posts_insert_own" on public.posts
  for insert with check (auth.uid() = user_id);

create policy "posts_update_own" on public.posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "posts_delete_own" on public.posts
  for delete using (auth.uid() = user_id);

-- Private bucket (unlike `avatars`) — photo access must go through RLS
-- (and, from the client, signed URLs), not a public URL, or "Private"
-- would be meaningless.
insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', false)
on conflict (id) do nothing;

create policy "post_photos_owner_all" on storage.objects
  for all
  using (bucket_id = 'post-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'post-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "post_photos_friends_select" on storage.objects
  for select
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[2] = 'friends'
    and exists (
      select 1 from public.friend_requests fr
      where fr.status = 'accepted'
        and ((fr.requester_id = auth.uid() and fr.addressee_id::text = (storage.foldername(name))[1])
          or (fr.addressee_id = auth.uid() and fr.requester_id::text = (storage.foldername(name))[1]))
    )
    and not exists (
      select 1 from public.blocked_users bu
      where (bu.blocker_id = auth.uid() and bu.blocked_id::text = (storage.foldername(name))[1])
         or (bu.blocker_id::text = (storage.foldername(name))[1] and bu.blocked_id = auth.uid())
    )
  );
