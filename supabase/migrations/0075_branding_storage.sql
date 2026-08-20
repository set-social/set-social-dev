-- Public bucket for static brand assets referenced by URL from outside the
-- app itself — starting with the SetSocial mark PNG embedded in
-- send-welcome-email's <img> tag, where an inline SVG (what the app's own
-- SetSocialMarkOutline uses) isn't an option: most email clients (Outlook,
-- many mobile Mail apps) don't render SVG at all, only <img src> to a
-- hosted raster file. No owner/insert policies here on purpose — unlike
-- avatars (0011_avatar_storage.sql), nothing in the app uploads to this
-- bucket at runtime; assets are added once by hand via the Dashboard or
-- `supabase storage cp`, so read-only for everyone is the whole policy.

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

create policy "branding_assets_public_read"
  on storage.objects for select
  using (bucket_id = 'branding');
