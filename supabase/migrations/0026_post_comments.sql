-- Milestone 26: comments on posts.

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index post_comments_post_id_idx on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;

-- Visibility inherits from the post itself rather than duplicating the
-- friend/block/hide_photos_from_friends logic in posts_select_visible: a
-- select against an RLS-protected table from inside another table's policy
-- is itself evaluated under the querying user's own permissions, so this
-- exists() only finds a row when the post is actually visible to them.
create policy "post_comments_select_visible"
  on public.post_comments for select
  using (exists (select 1 from public.posts p where p.id = post_id));

create policy "post_comments_insert_visible"
  on public.post_comments for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.posts p where p.id = post_id)
  );

-- Comment author can delete their own; post owner can moderate any comment
-- on their own post. No update policy - comments aren't editable, only
-- deletable.
create policy "post_comments_delete_own_or_post_owner"
  on public.post_comments for delete
  using (
    auth.uid() = user_id
    or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );
