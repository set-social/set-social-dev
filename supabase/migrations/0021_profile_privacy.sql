-- Milestone 21: per-athlete privacy controls — hide monthly stats and/or
-- hide friends-visible photos from friends, independently. Enforced at the
-- data layer (not just the client), same two-layer approach 0019 used for
-- post visibility itself:
--   - leaderboard_stats / public_profiles: view-level filtering
--   - posts + storage.objects: RLS policy changes

alter table public.profiles
  add column hide_stats_from_friends boolean not null default false,
  add column hide_photos_from_friends boolean not null default false;

-- Expose the two flags on the public, non-PII profile slice so friend-facing
-- screens can render "stats are private" instead of a misleading zero.
create or replace view public.public_profiles
  with (security_invoker = false) as
  select id, display_name, avatar_url, hide_stats_from_friends, hide_photos_from_friends
  from public.profiles;

-- A hidden athlete's row simply drops out of the view for everyone but
-- themselves — existing callers already treat "no row" as "0", which reads
-- fine as "nothing to show" here too.
create or replace view public.leaderboard_stats
  with (security_invoker = false) as
  select
    wl.user_id,
    coalesce(
      sum(wls.load_kg * wls.reps) filter (
        where wls.completed and not wls.is_warmup and wls.load_kg is not null
      ),
      0
    ) as volume_this_month,
    count(distinct wl.id) filter (where wl.completed_at is not null) as workouts_this_month
  from public.workout_logs wl
  left join public.workout_log_sets wls on wls.workout_log_id = wl.id
  join public.profiles p on p.id = wl.user_id
  where wl.started_at >= date_trunc('month', now())
    and (p.hide_stats_from_friends = false or wl.user_id = auth.uid())
  group by wl.user_id;

-- Re-scope posts_select_visible to also require the owner hasn't opted out
-- of showing photos to friends. Self-access (auth.uid() = user_id) is
-- untouched — hiding from friends never hides your own posts from you.
drop policy "posts_select_visible" on public.posts;

create policy "posts_select_visible" on public.posts
  for select using (
    auth.uid() = user_id
    or (
      visibility = 'friends'
      and not exists (
        select 1 from public.profiles p
        where p.id = posts.user_id and p.hide_photos_from_friends = true
      )
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

drop policy "post_photos_friends_select" on storage.objects;

create policy "post_photos_friends_select" on storage.objects
  for select
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[2] = 'friends'
    and not exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1] and p.hide_photos_from_friends = true
    )
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
