// GymBee - proactive-coach-sweep Edge Function
//
// Woken up every 15 minutes by run_proactive_coach_sweep()
// (0059_proactive_coach.sql), itself scheduled via pg_cron and invoked with
// the service-role key the same way push_dispatch's own net.http_post calls
// are — there is no caller JWT to verify here, this is server-to-server
// only.
//
// Three independent passes, each Pro-only:
//   1. Streak risk — it's locally evening for the athlete and they haven't
//      logged today's required training day yet. Ports computeStreak /
//      getProgramDayForDate / getWeeklyScheduleForDate (src/utils/streak.ts,
//      src/services/api/queries/programs.ts, .../weeklySchedule.ts) against
//      the athlete's own IANA timezone (profiles.timezone, defaulting to UTC
//      if never synced) rather than this process's own local time (which is
//      UTC in every Deno edge runtime) — the same class of bug this app has
//      hit before with date-only strings, just at the "what day is it for
//      this specific person right now" level instead of a single string.
//   2. PR pace — pr_pace_candidates() (same migration) does the whole
//      regression in SQL via Postgres's native regr_slope/regr_intercept/
//      regr_r2, so this function only has to read its output.
//   3. Meal gap (0063_food_photo_logging.sql, 0064_meal_skip_and_reminder_
//      settings.sql) — it's locally evening, the athlete has logged or
//      skipped at least one meal today, but dinner is neither. Reuses the
//      same local-evening cutoff as streak risk; deliberately does NOT fire
//      for an athlete who hasn't logged anything at all today (see
//      runMealGapPass's own comment). Also requires
//      push_meal_reminders_enabled, a sub-toggle under push_ai_coach_enabled
//      (see send-push's resolveMealGapNudge).
//   4. PR hit (0072_expanded_push_notifications.sql) — a workout completed
//      60-75 minutes ago (a window exactly one tick wide, so each workout
//      is only ever caught once) gets checked via workout_pr_hits() for any
//      exercise whose session-best e1rm beat the athlete's prior all-time
//      best. One push per *workout*, not per PR — send-push's resolvePrHit
//      bundles multiple hits into one line.
//   5. Morning brief (0072) — once per local ~7am, a two-line "good
//      morning" combining today's plan, streak, and (if connected) WHOOP
//      recovery. Ports the same getProgramDayForDate/computeStreak logic
//      the streak-risk pass already carries, so send-push's resolver only
//      has to format pre-computed fields, not recompute them.
//   6. Recovery nudge (0072) — once per local ~9am, WHOOP-connected
//      athletes only, no session logged yet today, recovery notably high or
//      low (>=70 or <=35).
//
// All three new passes additionally rely on send-push's isActiveInApp()
// check (profiles.last_foreground_at) to skip anyone currently in the app —
// see 0072's own header comment.
//
// Every notification is deduped through proactive_coach_notifications:
// `insert ... on conflict do nothing` both checks and records atomically,
// so send-push is only ever called once per unique (user, notification).
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "proactive-coach-sweep" -> paste this whole file -> Deploy.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// --- Timezone-aware local-date helpers ------------------------------------
// A Deno edge function's own `new Date()` getters (getDay/getDate/etc.) read
// the process's local time, which is UTC — none of these are safe to call
// directly against `now` when the question is "what day/hour is it for a
// specific IANA zone." Everything below goes through Intl.DateTimeFormat
// instead, then uses Date.UTC(y, m, d) purely as a whole-day counter (the
// same trick getProgramDayForDate itself already uses), never as an actual
// instant.

type LocalDateParts = { year: number; month: number; day: number; weekday: number };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localHour(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(instant);
  return Number(formatted);
}

function localDateParts(instant: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

function partsToUtcMs(parts: Pick<LocalDateParts, 'year' | 'month' | 'day'>): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function partsToKey(parts: Pick<LocalDateParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** One calendar day earlier, as fresh {year,month,day,weekday} parts —
 * recomputed via Date.UTC/getUTCDay rather than mutating a raw Date's local
 * getters, so this never drifts back onto the process's own timezone. */
function previousDay(parts: LocalDateParts): LocalDateParts {
  const ms = partsToUtcMs(parts) - 86_400_000;
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

// --- Ported program/streak logic (src/utils/streak.ts, programs.ts, weeklySchedule.ts) ---

type ProgramDay = { day_of_week: number; is_rest_day: boolean };
type ProgramWeek = { week_number: number; program_days: ProgramDay[] };
type ProgramTree = { start_date: string; weeks_count: number; program_weeks: ProgramWeek[] } | null;

function getProgramDayForDate(program: ProgramTree, parts: LocalDateParts): ProgramDay | null {
  if (!program) return null;
  const start = new Date(program.start_date); // date-only string parses as UTC midnight
  const daysSinceStart = Math.floor((partsToUtcMs(parts) - start.getTime()) / 86_400_000);
  if (daysSinceStart < 0) return null;
  const weekNumber = Math.floor(daysSinceStart / 7) + 1;
  if (weekNumber > program.weeks_count) return null;
  const week = program.program_weeks.find(w => w.week_number === weekNumber);
  if (!week) return null;
  return week.program_days.find(d => d.day_of_week === parts.weekday) ?? null;
}

const MAX_LOOKBACK_DAYS = 90;

// A rest day counts toward the streak the same as a completed day (see
// src/utils/streak.ts's own comment — this is a straight port, keep both in
// sync). Only fires when there's real evidence of a plan (an active program
// or at least one weekly_schedule entry); otherwise every day would
// trivially resolve "no plan for this day" and the streak would run the
// full 90-day lookback for a user who's never set anything up.
function countsForStreak(
  program: ProgramTree,
  completedDateKeys: Set<string>,
  weeklyScheduleDaysOfWeek: Set<number>,
  parts: LocalDateParts,
): boolean {
  if (completedDateKeys.has(partsToKey(parts))) return true;
  const hasAnyPlan = program != null || weeklyScheduleDaysOfWeek.size > 0;
  if (!hasAnyPlan) return false;
  const resolved = getProgramDayForDate(program, parts);
  const hasWeeklyPlan = weeklyScheduleDaysOfWeek.has(parts.weekday);
  return (!resolved || resolved.is_rest_day) && !hasWeeklyPlan;
}

function computeStreak(
  program: ProgramTree,
  completedDateKeys: Set<string>,
  todayParts: LocalDateParts,
  weeklyScheduleDaysOfWeek: Set<number>,
): number {
  let streak = countsForStreak(program, completedDateKeys, weeklyScheduleDaysOfWeek, todayParts) ? 1 : 0;
  let cursor = previousDay(todayParts);

  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    if (countsForStreak(program, completedDateKeys, weeklyScheduleDaysOfWeek, cursor)) {
      streak++;
    } else {
      break;
    }
    cursor = previousDay(cursor);
  }
  return streak;
}

type Admin = ReturnType<typeof createClient>;

async function fetchProgramTree(admin: Admin, userId: string): Promise<ProgramTree> {
  const { data } = await admin
    .from('programs')
    .select('start_date, weeks_count, program_weeks ( week_number, program_days ( day_of_week, is_rest_day ) )')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  return (data as ProgramTree) ?? null;
}

/** hasPlanToday, reproduced exactly as TodayScreen.tsx computes it — a
 * one-off scheduled_workouts row wins, then a *training* (non-cardio)
 * weekly_schedule entry, then a non-rest AI program day. Deliberately not
 * the same check computeStreak itself uses (which counts any weekly entry,
 * cardio included, as "not a rest day") — the push's gating should match
 * what the athlete would see if they opened the app right now, which is
 * hasPlanToday's definition, not computeStreak's looser one. */
async function hasPlanToday(admin: Admin, userId: string, parts: LocalDateParts, program: ProgramTree): Promise<boolean> {
  const dateKey = partsToKey(parts);

  const { data: scheduled } = await admin
    .from('scheduled_workouts')
    .select('id')
    .eq('user_id', userId)
    .eq('scheduled_date', dateKey)
    .maybeSingle();
  if (scheduled) return true;

  const { data: weeklyEntry } = await admin
    .from('weekly_schedule')
    .select('day_type, workout_template_id')
    .eq('user_id', userId)
    .eq('day_of_week', parts.weekday)
    .maybeSingle();
  if (weeklyEntry && weeklyEntry.day_type !== 'cardio' && weeklyEntry.workout_template_id) return true;

  const resolved = getProgramDayForDate(program, parts);
  if (resolved) return !resolved.is_rest_day;

  return false;
}

async function isTodayCompleted(admin: Admin, userId: string, timezone: string, dateKey: string): Promise<boolean> {
  // A generous UTC window (48h back) that's guaranteed to contain the
  // athlete's local "today" regardless of their UTC offset, then filtered
  // precisely by converting each row's completed_at to their own local
  // calendar date — simpler and more robust than computing exact UTC
  // day-boundary offsets per zone (including half-hour-offset zones).
  const { data } = await admin
    .from('workout_logs')
    .select('completed_at')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
  return (data ?? []).some(row => partsToKey(localDateParts(new Date(row.completed_at as string), timezone)) === dateKey);
}

/** Same generous-UTC-window-then-precise-local-filter approach as
 * isTodayCompleted above, applied to food_log_entries instead of
 * workout_logs — status in ('confirmed', 'skipped'), so an unconfirmed AI
 * photo estimate never counts as "logged" any more than it counts toward
 * Home's energy totals (see useFoodLogEntriesInRange, Phase 1/2), but an
 * intentional skip (LogFoodScreen's "Skip this meal", or chat-coach's
 * skip_meal tool) counts as accounted-for so the gap nudge stops nagging
 * about it. */
async function hasLoggedMealToday(
  admin: Admin,
  userId: string,
  timezone: string,
  dateKey: string,
): Promise<{ hasAnyMeal: boolean; hasDinner: boolean }> {
  const { data } = await admin
    .from('food_log_entries')
    .select('logged_at, meal_type')
    .eq('user_id', userId)
    .in('status', ['confirmed', 'skipped'])
    .gte('logged_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
  const todaysRows = (data ?? []).filter(
    row => partsToKey(localDateParts(new Date(row.logged_at as string), timezone)) === dateKey,
  );
  return {
    hasAnyMeal: todaysRows.length > 0,
    hasDinner: todaysRows.some(row => row.meal_type === 'dinner'),
  };
}

async function fetchCompletedDateKeys(admin: Admin, userId: string, timezone: string): Promise<Set<string>> {
  const { data } = await admin
    .from('workout_logs')
    .select('completed_at')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', new Date(Date.now() - (MAX_LOOKBACK_DAYS + 2) * 24 * 60 * 60 * 1000).toISOString());
  return new Set((data ?? []).map(row => partsToKey(localDateParts(new Date(row.completed_at as string), timezone))));
}

async function fetchWeeklyScheduleDaysOfWeek(admin: Admin, userId: string): Promise<Set<number>> {
  const { data } = await admin.from('weekly_schedule').select('day_of_week').eq('user_id', userId);
  return new Set((data ?? []).map(row => row.day_of_week as number));
}

async function tryNotify(admin: Admin, userId: string, notificationKey: string): Promise<boolean> {
  const { data, error } = await admin
    .from('proactive_coach_notifications')
    .insert({ user_id: userId, notification_key: notificationKey })
    .select('id')
    .maybeSingle();
  // A unique-violation (23505) just means this exact notification already
  // fired — not a real error, and not something that should stop the sweep.
  if (error && error.code !== '23505') {
    console.error('tryNotify insert failed', notificationKey, error);
    return false;
  }
  return data != null;
}

async function sendPush(type: string, body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type, ...body }),
    });
  } catch (err) {
    // One candidate's push failure must never abort the sweep for anyone
    // else — same fire-and-forget posture push_dispatch itself already has.
    console.error('sendPush failed', type, body, err);
  }
}

const EVENING_HOUR = 17; // matches StreakRiskNudge.tsx's own EVENING_HOUR

async function runStreakRiskPass(admin: Admin): Promise<void> {
  const { data: candidates } = await admin
    .from('profiles')
    .select('id, timezone')
    .eq('is_premium', true)
    .eq('push_ai_coach_enabled', true);

  const now = new Date();

  for (const candidate of candidates ?? []) {
    try {
      const userId = candidate.id as string;
      const timezone = (candidate.timezone as string | null) ?? 'UTC';
      if (localHour(now, timezone) < EVENING_HOUR) continue;

      const todayParts = localDateParts(now, timezone);
      const todayKey = partsToKey(todayParts);

      const [program, weeklyScheduleDaysOfWeek, completed] = await Promise.all([
        fetchProgramTree(admin, userId),
        fetchWeeklyScheduleDaysOfWeek(admin, userId),
        isTodayCompleted(admin, userId, timezone, todayKey),
      ]);
      if (completed) continue;

      const planToday = await hasPlanToday(admin, userId, todayParts, program);
      if (!planToday) continue;

      const completedDateKeys = await fetchCompletedDateKeys(admin, userId, timezone);
      const streak = computeStreak(program, completedDateKeys, todayParts, weeklyScheduleDaysOfWeek);
      if (streak <= 0) continue;

      const inserted = await tryNotify(admin, userId, `streak_risk:${todayKey}`);
      if (inserted) await sendPush('streak_risk_nudge', { user_id: userId, streak });
    } catch (err) {
      console.error('streak-risk candidate failed', candidate.id, err);
    }
  }
}

async function runPrPacePass(admin: Admin): Promise<void> {
  const { data: forecasts, error } = await admin.rpc('pr_pace_candidates');
  if (error) {
    console.error('pr_pace_candidates failed', error);
    return;
  }

  for (const forecast of (forecasts ?? []) as Array<{
    user_id: string;
    exercise_id: string;
    exercise_name: string;
    target_date: string;
  }>) {
    try {
      const inserted = await tryNotify(admin, forecast.user_id, `pr_pace:${forecast.exercise_id}:${forecast.target_date}`);
      if (inserted) {
        await sendPush('pr_pace_forecast_ready', {
          user_id: forecast.user_id,
          exercise_id: forecast.exercise_id,
          exercise_name: forecast.exercise_name,
          target_date: forecast.target_date,
        });
      }
    } catch (err) {
      console.error('pr-pace candidate failed', forecast.user_id, forecast.exercise_id, err);
    }
  }
}

/** Only fires for an athlete who's already logged or skipped at least one
 * meal today but not dinner — nudging someone who's never used food logging
 * at all is a different (onboarding) notification, not a "gap" nudge, and
 * would read as presumptuous. Same Pro + push_ai_coach_enabled gate and
 * EVENING_HOUR cutoff as runStreakRiskPass, for the same "this is the AI
 * coach category, not a new preference" reason. */
async function runMealGapPass(admin: Admin): Promise<void> {
  const { data: candidates } = await admin
    .from('profiles')
    .select('id, timezone')
    .eq('is_premium', true)
    .eq('push_ai_coach_enabled', true);

  const now = new Date();

  for (const candidate of candidates ?? []) {
    try {
      const userId = candidate.id as string;
      const timezone = (candidate.timezone as string | null) ?? 'UTC';
      if (localHour(now, timezone) < EVENING_HOUR) continue;

      const todayParts = localDateParts(now, timezone);
      const todayKey = partsToKey(todayParts);

      const { hasAnyMeal, hasDinner } = await hasLoggedMealToday(admin, userId, timezone, todayKey);
      if (!hasAnyMeal || hasDinner) continue;

      const inserted = await tryNotify(admin, userId, `meal_gap:${todayKey}`);
      if (inserted) await sendPush('meal_gap_nudge', { user_id: userId });
    } catch (err) {
      console.error('meal-gap candidate failed', candidate.id, err);
    }
  }
}

const PR_HIT_DELAY_MIN_MINUTES = 60;
const PR_HIT_DELAY_MAX_MINUTES = 75; // exactly one 15-minute tick past the minimum, so each workout is caught by only one sweep run

async function runPrHitPass(admin: Admin): Promise<void> {
  const windowStart = new Date(Date.now() - PR_HIT_DELAY_MAX_MINUTES * 60 * 1000).toISOString();
  const windowEnd = new Date(Date.now() - PR_HIT_DELAY_MIN_MINUTES * 60 * 1000).toISOString();

  const { data: candidates } = await admin
    .from('workout_logs')
    .select('id, user_id, profiles!inner(is_premium, push_pr_alerts_enabled)')
    .not('completed_at', 'is', null)
    .gte('completed_at', windowStart)
    .lte('completed_at', windowEnd)
    .eq('profiles.is_premium', true)
    .eq('profiles.push_pr_alerts_enabled', true);

  for (const workout of (candidates ?? []) as Array<{ id: string; user_id: string }>) {
    try {
      // Claims the workout before knowing whether it actually produced a
      // PR — a session with none should still never be re-examined once
      // it's aged out of the window above.
      const inserted = await tryNotify(admin, workout.user_id, `pr_hit:${workout.id}`);
      if (!inserted) continue;

      const { data: hits, error } = await admin.rpc('workout_pr_hits', { p_workout_log_id: workout.id });
      if (error) {
        console.error('workout_pr_hits failed', workout.id, error);
        continue;
      }
      if (!hits || hits.length === 0) continue;

      await sendPush('pr_hit', { user_id: workout.user_id, workout_log_id: workout.id, hits });
    } catch (err) {
      console.error('pr-hit candidate failed', workout.id, err);
    }
  }
}

const MORNING_BRIEF_HOUR = 7;

async function runMorningBriefPass(admin: Admin): Promise<void> {
  const { data: candidates } = await admin
    .from('profiles')
    .select('id, timezone')
    .eq('is_premium', true)
    .eq('push_morning_brief_enabled', true);

  const now = new Date();

  for (const candidate of candidates ?? []) {
    try {
      const userId = candidate.id as string;
      const timezone = (candidate.timezone as string | null) ?? 'UTC';
      if (localHour(now, timezone) < MORNING_BRIEF_HOUR) continue;

      const todayParts = localDateParts(now, timezone);
      const todayKey = partsToKey(todayParts);

      const [program, weeklyScheduleDaysOfWeek, completedDateKeys, metrics] = await Promise.all([
        fetchProgramTree(admin, userId),
        fetchWeeklyScheduleDaysOfWeek(admin, userId),
        fetchCompletedDateKeys(admin, userId, timezone),
        admin.from('whoop_metrics').select('recovery_score, score_state').eq('user_id', userId).eq('cycle_date', todayKey).maybeSingle(),
      ]);

      const planToday = await hasPlanToday(admin, userId, todayParts, program);
      const streak = computeStreak(program, completedDateKeys, todayParts, weeklyScheduleDaysOfWeek);
      const recoveryScore = metrics.data?.score_state === 'SCORED' ? (metrics.data.recovery_score as number | null) : null;

      const inserted = await tryNotify(admin, userId, `morning_brief:${todayKey}`);
      if (inserted) {
        await sendPush('morning_brief', { user_id: userId, has_plan_today: planToday, streak, recovery_score: recoveryScore });
      }
    } catch (err) {
      console.error('morning-brief candidate failed', candidate.id, err);
    }
  }
}

const RECOVERY_NUDGE_HOUR = 9;
const RECOVERY_HIGH_THRESHOLD = 70;
const RECOVERY_LOW_THRESHOLD = 35;

async function runRecoveryNudgePass(admin: Admin): Promise<void> {
  const { data: candidates } = await admin
    .from('profiles')
    .select('id, timezone')
    .eq('is_premium', true)
    .eq('push_ai_coach_enabled', true);

  const now = new Date();

  for (const candidate of candidates ?? []) {
    try {
      const userId = candidate.id as string;
      const timezone = (candidate.timezone as string | null) ?? 'UTC';
      if (localHour(now, timezone) < RECOVERY_NUDGE_HOUR) continue;

      const todayParts = localDateParts(now, timezone);
      const todayKey = partsToKey(todayParts);

      const completed = await isTodayCompleted(admin, userId, timezone, todayKey);
      if (completed) continue;

      const { data: metrics } = await admin
        .from('whoop_metrics')
        .select('recovery_score, score_state')
        .eq('user_id', userId)
        .eq('cycle_date', todayKey)
        .maybeSingle();
      if (metrics?.score_state !== 'SCORED' || metrics.recovery_score == null) continue;
      const score = metrics.recovery_score as number;
      if (score < RECOVERY_HIGH_THRESHOLD && score > RECOVERY_LOW_THRESHOLD) continue;

      const inserted = await tryNotify(admin, userId, `recovery_nudge:${todayKey}`);
      if (inserted) await sendPush('recovery_nudge', { user_id: userId, recovery_score: score });
    } catch (err) {
      console.error('recovery-nudge candidate failed', candidate.id, err);
    }
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await Promise.all([
      runStreakRiskPass(admin),
      runPrPacePass(admin),
      runMealGapPass(admin),
      runPrHitPass(admin),
      runMorningBriefPass(admin),
      runRecoveryNudgePass(admin),
    ]);
    return json({ ok: true }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
