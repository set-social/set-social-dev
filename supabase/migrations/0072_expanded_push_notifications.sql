-- Milestone 72: schema for five new push notification types — a daily
-- "good morning" brief, a real PR-hit alert (distinct from the existing
-- pr_pace_forecast_ready prediction), a friend-PR fan-out, a recovery-aware
-- nudge, and a "friend's live nearby" ping. All five respect a shared
-- "don't interrupt someone who's already in the app" rule — see
-- last_foreground_at below — on top of their own per-category toggle.

-- ---------------------------------------------------------------------------
-- last_foreground_at: a heartbeat, not an event log. The client (see
-- useAppForegroundHeartbeat) writes this once on foregrounding and again
-- every ~60s while the app stays in the foreground, and simply stops
-- writing on backgrounding — so send-push's isActiveInApp() treating
-- anything older than ~90s as "not active" needs no separate
-- foreground/background transition tracking, and degrades safely if the
-- app is killed without a clean background event (the timestamp just goes
-- stale on its own).
alter table public.profiles
  add column last_foreground_at timestamptz,
  add column push_pr_alerts_enabled boolean not null default true,
  add column push_friend_prs_enabled boolean not null default true,
  add column push_morning_brief_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- workout_pr_hits: given a completed session, returns every exercise where
-- that session's best set beat the athlete's all-time e1rm for that
-- exercise from every *other* session. Same Epley e1rm
-- (load_kg * (1 + reps/30)) pr_pace_candidates() (0059_proactive_coach.sql)
-- and chat-coach's estimateOneRepMax already both use. Requires real prior
-- history to compare against — an exercise trained for the very first time
-- is not a "PR", it's just a first data point.
--
-- No security definer and no grant: this is only ever called from
-- proactive-coach-sweep via the service-role client, which already bypasses
-- RLS. It takes a bare workout_log_id with no auth.uid() scoping of its
-- own, so — unlike nearby_checkins()/live_friend_workouts(), which scope
-- internally and are deliberately grant to authenticated — this must NOT be
-- reachable by an authenticated client directly, or any user could read any
-- other user's set history for an arbitrary workout_log_id.
create function public.workout_pr_hits(p_workout_log_id uuid)
returns table (
  exercise_id uuid,
  exercise_name text,
  load_kg numeric,
  reps smallint,
  e1rm numeric
)
language sql
stable
set search_path = public
as $$
  with target as (
    select id, user_id from public.workout_logs where id = p_workout_log_id
  ),
  session_best as (
    select distinct on (wls.exercise_id)
      wls.exercise_id, wls.load_kg, wls.reps,
      wls.load_kg * (1 + wls.reps / 30.0) as e1rm
    from public.workout_log_sets wls
    join target t on t.id = wls.workout_log_id
    where wls.completed and not wls.is_warmup and wls.load_kg is not null and wls.load_kg > 0
    order by wls.exercise_id, (wls.load_kg * (1 + wls.reps / 30.0)) desc
  ),
  prior_best as (
    select
      wls.exercise_id,
      max(wls.load_kg * (1 + wls.reps / 30.0)) as e1rm
    from public.workout_log_sets wls
    join public.workout_logs wl on wl.id = wls.workout_log_id
    join target t on t.user_id = wl.user_id and wl.id <> t.id
    where wls.completed and not wls.is_warmup and wls.load_kg is not null and wls.load_kg > 0
    group by wls.exercise_id
  )
  select sb.exercise_id, ex.name as exercise_name, sb.load_kg, sb.reps, sb.e1rm
  from session_best sb
  join public.exercises ex on ex.id = sb.exercise_id
  join prior_best pb on pb.exercise_id = sb.exercise_id
  where sb.e1rm > pb.e1rm;
$$;

revoke execute on function public.workout_pr_hits(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- friend_live_nearby: fires the moment a session starts (workout_logs
-- insert with completed_at still null) — send-push's own resolver is what
-- actually checks whether the athlete has an active gym check-in (the same
-- "Live Now" requirement 0053_gym_checkin_idle_timeout.sql's rule 1
-- introduced), so a plain "started a workout" with no check-in never
-- reaches anyone.
create function public.workout_logs_live_push()
returns trigger
language plpgsql
as $$
begin
  if new.completed_at is null then
    perform public.push_dispatch(
      jsonb_build_object('type', 'friend_live_nearby', 'workout_log_id', new.id, 'user_id', new.user_id)
    );
  end if;
  return new;
end;
$$;

create trigger workout_logs_push_after_insert
  after insert on public.workout_logs
  for each row execute function public.workout_logs_live_push();
