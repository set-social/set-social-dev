-- Milestone 11: profile avatar photo uploads via Supabase Storage.
-- Files live at avatars/{user_id}/{filename} — RLS keys off the first path
-- segment matching auth.uid() so each user can only write their own folder.
-- Bucket is public-read so avatar URLs work directly in <Image> without a
-- signed-URL round trip (matches how public_profiles.avatar_url is already
-- exposed today).

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar_images_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatar_images_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatar_images_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatar_images_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
