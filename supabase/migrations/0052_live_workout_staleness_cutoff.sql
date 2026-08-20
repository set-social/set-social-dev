-- live_friend_workouts() (0051_live_friend_workouts.sql) treats "live" as
-- purely `workout_logs.completed_at is null` — a workout abandoned without
-- ever tapping "Save Workout" (app killed, force-quit, walked out of the
-- gym mid-session) has no `completed_at` set and no other terminal signal,
-- so it stayed "Live" in the Social rail forever. Bound it the same way
-- gym_checkins already bounds a check-in's lifetime (CHECKIN_DURATION_HOURS
-- in src/services/api/queries/location.ts) — a session started more than 4
-- hours ago and never finished is stale, not live, regardless of
-- completed_at.
create or replace function public.live_friend_workouts()
returns table (
  friend_id uuid,
  workout_log_id uuid,
  started_at timestamptz,
  workout_title text,
  exercise_id uuid,
  exercise_name text,
  sets_done integer,
  best_load_kg numeric,
  best_reps smallint,
  pr_load_kg numeric,
  pr_reps smallint,
  at_your_gym boolean
)
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
  eligible as (
    select f.id
    from friends f
    join public.profiles p on p.id = f.id
    where coalesce(p.hide_live_workout_from_friends, false) = false
      and not exists (
        select 1 from public.blocked_users bu
        where (bu.blocker_id = auth.uid() and bu.blocked_id = f.id)
           or (bu.blocker_id = f.id and bu.blocked_id = auth.uid())
      )
  ),
  -- One in-progress workout per eligible friend — workout_logs has no
  -- partial-unique constraint forcing exactly one, but the app's own UI
  -- never lets someone start a second session before finishing the first,
  -- so in practice there's at most one; `distinct on` just makes the
  -- (harmless) edge case deterministic instead of returning duplicate rows.
  active as (
    select distinct on (wl.user_id)
      wl.id, wl.user_id, wl.started_at, wl.program_day_id, wl.scheduled_workout_id
    from public.workout_logs wl
    join eligible e on e.id = wl.user_id
    where wl.completed_at is null
      and wl.started_at > now() - interval '4 hours'
    order by wl.user_id, wl.started_at desc
  ),
  -- "Current exercise" = the exercise of the most recently logged set in
  -- that session — the same signal ActiveExerciseScreen itself is built
  -- around, just read from the other side.
  latest_set as (
    select distinct on (wls.workout_log_id)
      wls.workout_log_id, wls.exercise_id
    from public.workout_log_sets wls
    join active a on a.id = wls.workout_log_id
    order by wls.workout_log_id, wls.logged_at desc
  ),
  today_sets as (
    select
      ls.workout_log_id,
      count(*) filter (where wls.completed and not wls.is_warmup) as sets_done
    from latest_set ls
    join public.workout_log_sets wls
      on wls.workout_log_id = ls.workout_log_id and wls.exercise_id = ls.exercise_id
    group by ls.workout_log_id
  ),
  -- Best working set logged for the current exercise, this session —
  -- same completed/non-warmup/has-a-load filter fetchLoggedSets already
  -- uses client-side (progress.ts), ranked by estimated 1RM (Epley, the
  -- same formula estimateOneRepMax uses: load * (1 + reps/30)).
  today_best_set as (
    select distinct on (wls.workout_log_id)
      wls.workout_log_id, wls.load_kg, wls.reps
    from latest_set ls
    join public.workout_log_sets wls
      on wls.workout_log_id = ls.workout_log_id and wls.exercise_id = ls.exercise_id
    where wls.completed and not wls.is_warmup and wls.load_kg is not null and wls.load_kg > 0
    order by wls.workout_log_id, (wls.load_kg * (1 + wls.reps / 30.0)) desc
  ),
  -- All-time best set for that same exercise, across every one of the
  -- friend's own workout logs (not just this session) — this is the only
  -- part of the query that reaches outside the active session, and it
  -- still only ever surfaces one aggregated best set, never the list it
  -- was drawn from.
  pr_best_set as (
    select distinct on (a.id)
      a.id as workout_log_id, wls2.load_kg, wls2.reps
    from active a
    join latest_set ls on ls.workout_log_id = a.id
    join public.workout_log_sets wls2 on wls2.exercise_id = ls.exercise_id
    join public.workout_logs wl2
      on wl2.id = wls2.workout_log_id and wl2.user_id = a.user_id
    where wls2.completed and not wls2.is_warmup and wls2.load_kg is not null and wls2.load_kg > 0
    order by a.id, (wls2.load_kg * (1 + wls2.reps / 30.0)) desc
  ),
  -- Same reference-point contract as nearby_checkins() (0037_gym_checkins.sql):
  -- the comparison point is always the caller's own active check-in, read
  -- server-side, never a coordinate supplied by the client. If the caller
  -- hasn't checked in themselves, my_checkin is empty and every friend's
  -- at_your_gym comes back false — you only see "At your gym!" on someone
  -- else if you're there too.
  my_checkin as (
    select latitude, longitude
    from public.gym_checkins
    where user_id = auth.uid() and expires_at > now()
  ),
  gym_match as (
    select a.user_id
    from active a
    join public.gym_checkins gc on gc.user_id = a.user_id and gc.expires_at > now()
    cross join my_checkin mc
    where 6371000 * acos(
        least(1, greatest(-1,
          cos(radians(mc.latitude)) * cos(radians(gc.latitude))
            * cos(radians(gc.longitude) - radians(mc.longitude))
          + sin(radians(mc.latitude)) * sin(radians(gc.latitude))
        ))
      ) <= 150
  )
  select
    a.user_id as friend_id,
    a.id as workout_log_id,
    a.started_at,
    coalesce(pd.title, sw.name, 'Workout') as workout_title,
    ls.exercise_id,
    ex.name as exercise_name,
    coalesce(ts.sets_done, 0)::integer as sets_done,
    tbs.load_kg as best_load_kg,
    tbs.reps as best_reps,
    prb.load_kg as pr_load_kg,
    prb.reps as pr_reps,
    exists (select 1 from gym_match gm where gm.user_id = a.user_id) as at_your_gym
  from active a
  join latest_set ls on ls.workout_log_id = a.id
  join public.exercises ex on ex.id = ls.exercise_id
  left join public.program_days pd on pd.id = a.program_day_id
  left join public.scheduled_workouts sw on sw.id = a.scheduled_workout_id
  left join today_sets ts on ts.workout_log_id = a.id
  left join today_best_set tbs on tbs.workout_log_id = a.id
  left join pr_best_set prb on prb.workout_log_id = a.id;
$$;
