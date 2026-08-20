import { addDays, format } from 'date-fns';
import { resolveDayPlan, type ResolvedDayPlan, type ScheduledWorkoutLike } from '../../utils/dayPlan';
import { estimateWorkoutMinutes } from '../../utils/workoutTiming';
import type { ProgramTree } from '../api/queries/programs';
import type { WeeklyScheduleEntry } from '../api/queries/weeklySchedule';
import type { WorkoutLogSummary } from '../api/queries/workoutLogs';
import type { ReadinessBand } from '../coaching';
import type { WidgetPayload, WidgetPlan } from './types';

/** How far past a rest/none day to look for something worth calling "Next." */
const PEEK_AHEAD_DAYS = 7;

function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** Null for 'programRest' and 'none' — the caller decides what those become
 * (either "Rest day" as-is, or a peek at the next planned day), since that
 * decision depends on whether this is being resolved for today or for a
 * candidate day found while peeking ahead. */
function planFromResolved(resolved: ResolvedDayPlan, workoutLogs: WorkoutLogSummary[] | null | undefined): WidgetPlan | null {
  switch (resolved.kind) {
    case 'completed': {
      const loggedTimestamps = (workoutLogs ?? [])
        .filter(log => resolved.workoutLogIds.includes(log.id))
        .map(log => new Date(log.completedAt).getTime())
        .sort((a, b) => a - b);
      const firstLoggedAt = loggedTimestamps[0];
      return {
        kind: 'completed',
        label: 'Today · Done',
        title: resolved.title ?? 'Workout',
        meta: firstLoggedAt != null ? `Logged ${format(new Date(firstLoggedAt), 'h:mm a')}` : null,
      };
    }
    case 'weeklyCardio':
    case 'programCardio':
    case 'overrideCardio':
      return { kind: 'cardio', label: 'Today', title: 'Cardio Day', meta: null };
    case 'scheduled':
      // ScheduledWorkoutLike only carries id/name/date — no exercise list to
      // size a meta line from, same limitation TodayScreen's own plan
      // summary has for this kind.
      return { kind: 'training', label: 'Today', title: resolved.scheduledWorkout.name, meta: null };
    case 'weeklyRecurring': {
      // The weekly-schedule query only selects order_index for its nested
      // exercises (see WeeklyScheduleEntry) — no target_sets/rest_seconds to
      // estimate a duration from, same limitation CalendarScreen's own
      // planLineFor has for this kind. Count only, no "~N min".
      const count = resolved.entry.workout_templates?.workout_template_exercises.length ?? 0;
      return {
        kind: 'training',
        label: 'Today',
        title: resolved.entry.workout_templates?.name ?? 'Workout',
        meta: count > 0 ? `${count} exercise${count === 1 ? '' : 's'}` : null,
      };
    }
    case 'programTraining': {
      const exercises = resolved.day.program_exercises;
      return {
        kind: 'training',
        label: 'Today',
        title: resolved.day.title ?? 'Training Day',
        meta: exerciseMeta(exercises),
      };
    }
    case 'programRest':
    case 'overrideRest':
    case 'missed':
    case 'none':
      // All four "nothing to show as today's plan" kinds are disambiguated
      // by the caller via resolvedToday.kind — see buildWidgetPayload.
      return null;
  }
}

function exerciseMeta(exercises: Array<{ target_sets: number; rest_seconds: number | null }>): string | null {
  if (exercises.length === 0) return null;
  const minutes = estimateWorkoutMinutes(exercises.map(e => ({ targetSets: e.target_sets, restSeconds: e.rest_seconds })));
  const exerciseCount = `${exercises.length} exercise${exercises.length === 1 ? '' : 's'}`;
  return minutes ? `${exerciseCount} · ~${minutes} min` : exerciseCount;
}

/** Scans forward (today's data is already loaded for this whole range on
 * every screen that would call this) for the first day worth calling
 * "Next" — used only when today itself is a rest day or has nothing
 * planned, so the widget isn't stuck saying "rest" all day when there's a
 * perfectly good answer to "what's next" one tap away. */
function findNextPlannedDay(params: {
  today: Date;
  program: ProgramTree | null | undefined;
  weeklySchedule: WeeklyScheduleEntry[] | null | undefined;
  scheduledWorkouts: ScheduledWorkoutLike[] | null | undefined;
  workoutLogs: WorkoutLogSummary[] | null | undefined;
}): WidgetPlan | null {
  const { today, program, weeklySchedule, scheduledWorkouts, workoutLogs } = params;
  for (let offset = 1; offset <= PEEK_AHEAD_DAYS; offset++) {
    const candidateDate = addDays(today, offset);
    const resolved = resolveDayPlan({ date: candidateDate, program, weeklySchedule, scheduledWorkouts, workoutLogs });
    const candidatePlan = planFromResolved(resolved, workoutLogs);
    // A future day can't actually be 'completed' in practice, but guard it
    // anyway rather than ever presenting "Next" pointing at a done workout.
    if (candidatePlan && candidatePlan.kind !== 'completed') {
      return { ...candidatePlan, label: 'Next', meta: format(candidateDate, 'EEEE') };
    }
  }
  return null;
}

export type BuildWidgetPayloadParams = {
  today: Date;
  /** Same three fields AiSummaryCard renders — this function doesn't
   * recompute any of the coaching logic, just packages it. */
  todayFocusSummary: { headline: string; summary: string; band: ReadinessBand | null };
  /** Same boolean TodayScreen already passes to AiSummaryCard as
   * `isRestDay={todayPlan.kind === 'rest_day'}`. */
  isRestDay: boolean;
  program: ProgramTree | null | undefined;
  weeklySchedule: WeeklyScheduleEntry[] | null | undefined;
  scheduledWorkouts: ScheduledWorkoutLike[] | null | undefined;
  /** Needs to cover today at minimum; peek-ahead reads from the same array,
   * so a range covering the next week too avoids an extra query. */
  workoutLogs: WorkoutLogSummary[] | null | undefined;
  sessionsThisWeek: number | null;
  weeklyTarget: number | null;
  /** Optional — every existing caller keeps working unchanged, and a caller
   * with nothing to report for one of these just omits it rather than
   * threading a literal null through. */
  readinessScore?: number | null;
  streak?: number;
  caloriesLogged?: number | null;
  calorieTarget?: number | null;
};

/** Deep-links straight into Arnold with the input focused and ready — see
 * ChatScreen's own handling of the `openFoodLog` route param — rather than
 * prefilling literal text a photo/typed description will replace anyway.
 * One fixed constant so both native widgets and this builder agree on the
 * exact URL without duplicating it. */
export const WIDGET_LOG_FOOD_DEEP_LINK = 'soset://chat?openFoodLog=1';

export function buildWidgetPayload(params: BuildWidgetPayloadParams): WidgetPayload {
  const {
    today,
    todayFocusSummary,
    isRestDay,
    program,
    weeklySchedule,
    scheduledWorkouts,
    workoutLogs,
    sessionsThisWeek,
    weeklyTarget,
    readinessScore,
    streak,
    caloriesLogged,
    calorieTarget,
  } = params;

  const resolvedToday = resolveDayPlan({ date: today, program, weeklySchedule, scheduledWorkouts, workoutLogs });
  // A day_overrides 'Rest'/'Missed' override on today shadows any
  // weekly_schedule/program assignment the same way it does on the Training
  // tab — resolvedToday.kind already reflects that, so this just has to
  // read it rather than re-derive it.
  const isRestToday = resolvedToday.kind === 'programRest' || resolvedToday.kind === 'overrideRest';
  const isMissedToday = resolvedToday.kind === 'missed';
  const plan =
    planFromResolved(resolvedToday, workoutLogs) ??
    findNextPlannedDay({ today, program, weeklySchedule, scheduledWorkouts, workoutLogs }) ?? {
      kind: isRestToday ? 'rest' : 'none',
      label: 'Today',
      title: isRestToday ? 'Rest day' : isMissedToday ? 'Missed' : null,
      meta: isRestToday || isMissedToday ? null : 'Tap to add a workout',
    };

  return {
    updatedAt: new Date().toISOString(),
    dateKey: dateKey(today),
    headline: todayFocusSummary.headline,
    summary: todayFocusSummary.summary,
    band: todayFocusSummary.band,
    isRestDay,
    plan,
    sessionsThisWeek: sessionsThisWeek ?? null,
    weeklyTarget: weeklyTarget ?? null,
    readinessScore: readinessScore ?? null,
    streak: streak ?? 0,
    caloriesLogged: caloriesLogged ?? null,
    calorieTarget: calorieTarget ?? null,
    logFoodDeepLink: WIDGET_LOG_FOOD_DEEP_LINK,
  };
}
