-- Milestone 28: likes on posts.

create table public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index post_likes_post_id_idx on public.post_likes (post_id);

alter table public.post_likes enable row level security;

-- Same visibility-inheritance pattern as post_comments (see 0026): a select
-- against posts from within this policy is itself subject to posts' own
-- RLS, so this only matches when the post is visible to the caller.
create policy "post_likes_select_visible"
  on public.post_likes for select
  using (exists (select 1 from public.posts p where p.id = post_id));

create policy "post_likes_insert_visible"
  on public.post_likes for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.posts p where p.id = post_id)
  );

-- Unlike comments, only the liker can remove their own like - there's no
-- "post owner moderates" equivalent for a like.
create policy "post_likes_delete_own"
  on public.post_likes for delete
  using (auth.uid() = user_id);
