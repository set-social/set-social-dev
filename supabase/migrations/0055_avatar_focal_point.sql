-- Lets an athlete recenter their profile photo instead of being stuck with
-- whatever a plain center-crop lands on (their circular avatar renders at
-- all sorts of sizes across the app — 30px in a feed card up to 78px on
-- their own profile — and a face positioned off-center in the source photo
-- gets cut off at small sizes especially). Stored as a normalized 0-1
-- fraction of the source image's own bounding box, same convention as CSS
-- `object-position` — (0.5, 0.5) is a plain center crop, i.e. today's
-- existing behavior, so every existing row defaults to exactly what's
-- already on screen.
alter table public.profiles
  add column avatar_focal_x numeric not null default 0.5 check (avatar_focal_x >= 0 and avatar_focal_x <= 1),
  add column avatar_focal_y numeric not null default 0.5 check (avatar_focal_y >= 0 and avatar_focal_y <= 1);

-- public_profiles (last recreated in 0050_premium_subscriptions.sql) needs
-- the same two columns so a friend's client renders the same framing, not
-- just the owner's own client.
drop view if exists public.public_profiles cascade;

create view public.public_profiles
  with (security_invoker = false) as
  select id, display_name, avatar_url, avatar_focal_x, avatar_focal_y, bio, hide_stats_from_friends, hide_photos_from_friends, handle, is_private, is_premium
  from public.profiles;

grant select on public.public_profiles to authenticated;
