-- Milestone 58: a privacy-safe "more consistent than N% of your friends
-- this month" stat for Home. Follows the same contract as nearby_checkins()
-- (0037_gym_checkins.sql) and live_friend_workouts() (0051): a single
-- SECURITY DEFINER function that reads across tables server-side but
-- returns only an aggregate for the caller, never any per-friend row —
-- friends' individual counts are never exposed by this function, only where
-- the caller ranks among them.
--
-- v1 definition is workout count this month (leaderboard_stats'
-- workouts_this_month), not the full schedule-adherence ratio
-- (workoutsCompleted / scheduled training days) — that ratio only exists
-- today as client-side TS walking a program tree (walkScheduledDays), and
-- porting it server-side is out of scope for this pass.
create or replace function public.friend_consistency_percentile()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with friends as (
    select case when fr.requester_id = auth.uid() then fr.addressee_id else fr.requester_id end as id
    from public.friend_requests fr
    where fr.status = 'accepted' and (fr.requester_id = auth.uid() or fr.addressee_id = auth.uid())
  ),
  -- leaderboard_stats only has a row for a user who logged at least one
  -- workout this month (it's built by grouping workout_logs, no row means
  -- no group) — an inner join against it would silently drop 0-workout
  -- friends from the denominator and inflate the caller's percentile.
  -- left join + coalesce keeps them in eligible, correctly counted as 0.
  -- A friend who has hidden their stats never has a row here either way
  -- (leaderboard_stats' own `where` already excludes them for anyone but
  -- themselves) but is also excluded explicitly below so a 0-workout
  -- reason and a hidden-stats reason are never conflated.
  eligible as (
    select coalesce(ls.workouts_this_month, 0) as workouts_this_month
    from friends f
    join public.profiles p on p.id = f.id
    left join public.leaderboard_stats ls on ls.user_id = f.id
    where coalesce(p.hide_stats_from_friends, false) = false
      and not exists (
        select 1 from public.blocked_users bu
        where (bu.blocker_id = auth.uid() and bu.blocked_id = f.id)
           or (bu.blocker_id = f.id and bu.blocked_id = auth.uid())
      )
  ),
  my_count as (
    select coalesce((select workouts_this_month from public.leaderboard_stats where user_id = auth.uid()), 0) as n
  )
  select
    case
      when count(*) = 0 then null
      else round(100.0 * count(*) filter (where e.workouts_this_month < (select n from my_count)) / count(*))::integer
    end
  from eligible e;
$$;

grant execute on function public.friend_consistency_percentile() to authenticated;
