-- Milestone 8: community — public follow graph, leaderboard, activity feed.

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_no_self_follow check (follower_id <> followee_id)
);

create index follows_followee_id_idx on public.follows (followee_id);

alter table public.follows enable row level security;

-- The follow graph itself is public (needed to render "following" state on
-- any profile and to scope the leaderboard) - only creating/removing an edge
-- is restricted to its owner.
create policy "follows_select_all"
  on public.follows for select
  using (true);

create policy "follows_insert_own"
  on public.follows for insert
  with check (auth.uid() = follower_id);

create policy "follows_delete_own"
  on public.follows for delete
  using (auth.uid() = follower_id);

-- public_profiles was created in Milestone 2 with security_invoker = true,
-- which means it never actually bypassed profiles' own-row-only RLS policy -
-- querying it as another user returned nothing. Flip it to security definer
-- (the default) now that something depends on it actually being public; it's
-- still safe because the view's column list is fixed to non-PII fields only.
alter view public.public_profiles set (security_invoker = false);

-- Aggregated, non-sensitive monthly stats per athlete. Security definer so
-- followers can see a number without gaining row access to raw
-- workout_logs/workout_log_sets (which stay owner-only via their own RLS).
create view public.leaderboard_stats
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
  where wl.started_at >= date_trunc('month', now())
  group by wl.user_id;

grant select on public.leaderboard_stats to authenticated;

-- One row per completed workout, joined down to just the fields an activity
-- feed needs to render — no set-level detail (weights, reps, notes) leaks
-- through this view.
create view public.activity_feed
  with (security_invoker = false) as
  select
    wl.id as workout_log_id,
    wl.user_id,
    p.display_name,
    p.avatar_url,
    wl.completed_at,
    pd.title as day_title
  from public.workout_logs wl
  join public.profiles p on p.id = wl.user_id
  left join public.program_days pd on pd.id = wl.program_day_id
  where wl.completed_at is not null;

grant select on public.activity_feed to authenticated;
