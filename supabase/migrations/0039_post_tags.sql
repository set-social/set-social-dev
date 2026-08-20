-- Milestone 39: tag friends in a post — set once at creation time (see
-- UploadPhotoPostScreen's Tag People picker), not editable afterward.

create table public.post_tags (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  tagged_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, tagged_user_id)
);

create index post_tags_post_id_idx on public.post_tags (post_id);
create index post_tags_tagged_user_id_idx on public.post_tags (tagged_user_id);

alter table public.post_tags enable row level security;

-- Same visibility-inheritance pattern as post_likes/post_comments (see
-- 0026/0028): a select against posts from within this policy is itself
-- subject to posts' own RLS, so this only matches when the post is visible
-- to the caller.
create policy "post_tags_select_visible"
  on public.post_tags for select
  using (exists (select 1 from public.posts p where p.id = post_id));

-- Only the post's own author sets tags, and only at creation time — there's
-- no "someone else tags you" or "edit tags later" flow.
create policy "post_tags_insert_post_owner"
  on public.post_tags for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));

create policy "post_tags_delete_post_owner"
  on public.post_tags for delete
  using (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
