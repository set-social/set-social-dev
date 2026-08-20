-- Milestone 59: the proactive-coach cron sweep — pushes a Pro athlete a
-- notification when (a) a confident PR-pace forecast just became available,
-- or (b) it's locally evening for them and they haven't logged today's
-- required training day yet (streak risk). Requires 0057's profiles.timezone
-- to know what "locally evening" means for a given user, and reuses
-- push_dispatch's own two Vault secrets (0049_push_dispatch_use_vault.sql)
-- rather than creating new ones.
--
-- The cron job itself only wakes up a new edge function
-- (proactive-coach-sweep) every 15 minutes — the actual per-user streak/
-- schedule-walk logic lives there in Deno/TS, not plpgsql, since porting
-- getProgramDayForDate's week/day-of-week resolution is real control flow,
-- not a query. PR-pace detection, by contrast, is pure SQL below
-- (pr_pace_candidates()) since Postgres's native regr_slope/regr_intercept/
-- regr_r2 aggregates reproduce predictPersonalRecords' regression exactly,
-- without hand-porting any regression math.

-- Pure server-side send log — dedupes notifications so the same forecast/
-- streak-risk day never fires twice. Never read or written by a client
-- (RLS enabled, zero policies), same "server bookkeeping only" posture
-- `subscriptions` already has for its own writes.
create table public.proactive_coach_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  notification_key text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, notification_key)
);

alter table public.proactive_coach_notifications enable row level security;

-- Reproduces predictPersonalRecords' thresholds (src/services/coaching/
-- engine.ts:1373-1412, constants at engine.ts:1985-1990): 90-day lookback,
-- min 4 points, min 14-day span, slope > 0, r2 >= 0.3, min 1kg gain,
-- 42-day horizon. e1rm uses the same Epley formula chat-coach's own
-- estimateOneRepMax already duplicates server-side: load_kg * (1 + reps/30).
-- Filters to Pro users inside the query itself — no separate round trip.
create or replace function public.pr_pace_candidates()
returns table (
  user_id uuid,
  exercise_id uuid,
  exercise_name text,
  current_best_e1rm numeric,
  predicted_e1rm numeric,
  confidence numeric,
  target_date date
)
language sql
stable
security definer
set search_path = public
as $$
  with daily_best as (
    select
      wl.user_id,
      wls.exercise_id,
      date_trunc('day', wls.logged_at)::date as day,
      max(wls.load_kg * (1 + wls.reps / 30.0)) as e1rm
    from public.workout_log_sets wls
    join public.workout_logs wl on wl.id = wls.workout_log_id
    where wls.completed and not wls.is_warmup and wls.load_kg is not null and wls.load_kg > 0
      and wls.logged_at >= now() - interval '90 days'
    group by wl.user_id, wls.exercise_id, date_trunc('day', wls.logged_at)
  ),
  points as (
    select
      user_id,
      exercise_id,
      day,
      e1rm,
      -- `day` is a plain `date`, so `date - date` already yields an
      -- integer day-count directly — no extract(epoch from ...) needed
      -- (and extract() doesn't accept an integer operand anyway, which is
      -- what this query originally tried and failed on). Cast straight to
      -- double precision since that's what regr_slope/regr_intercept/
      -- regr_r2 below actually require.
      (day - min(day) over (partition by user_id, exercise_id))::double precision as x
    from daily_best
  ),
  stats as (
    select
      user_id,
      exercise_id,
      count(*) as n,
      (max(day) - min(day)) as span_days,
      regr_slope(e1rm::double precision, x) as slope,
      regr_intercept(e1rm::double precision, x) as intercept,
      regr_r2(e1rm::double precision, x) as r2,
      max(e1rm) as current_best_e1rm,
      max(day) as last_day,
      max(x) as last_x
    from points
    group by user_id, exercise_id
  ),
  forecasts as (
    select
      s.user_id,
      s.exercise_id,
      s.current_best_e1rm,
      (s.slope * (s.last_x + 42) + s.intercept) as predicted_e1rm,
      s.r2 as confidence,
      (s.last_day + 42) as target_date
    from stats s
    where s.n >= 4 and s.span_days >= 14 and s.slope > 0 and s.r2 >= 0.3
  )
  select
    f.user_id,
    f.exercise_id,
    ex.name as exercise_name,
    f.current_best_e1rm,
    f.predicted_e1rm,
    f.confidence,
    f.target_date
  from forecasts f
  join public.exercises ex on ex.id = f.exercise_id
  join public.profiles pr on pr.id = f.user_id
  where pr.is_premium = true
    and (f.predicted_e1rm - f.current_best_e1rm) >= 1;
$$;

-- Same shape as push_dispatch (0049) — reads the same two Vault secrets,
-- fire-and-forget net.http_post, swallows every error so a misconfigured
-- Vault (or a transient network blip) can never fail the cron job itself.
-- Only wakes the edge function up; carries no payload of its own.
create or replace function public.run_proactive_coach_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_functions_url text;
  v_service_role_key text;
begin
  select decrypted_secret into v_functions_url
    from vault.decrypted_secrets where name = 'push_functions_url';
  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'push_service_role_key';

  if v_functions_url is null or v_service_role_key is null then
    return;
  end if;

  perform net.http_post(
    url := v_functions_url || '/proactive-coach-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := '{}'::jsonb
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.run_proactive_coach_sweep() from public, anon, authenticated;

-- Every 15 minutes — frequent enough that each user's own local evening
-- arrival (the streak-risk check) is caught within 15 minutes of it
-- starting, without needing 0053's 5-minute idle-checkout tightness.
select cron.schedule('proactive-coach-sweep', '*/15 * * * *', $$select public.run_proactive_coach_sweep()$$);
