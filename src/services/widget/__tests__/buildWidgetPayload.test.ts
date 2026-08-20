import { buildWidgetPayload } from '../buildWidgetPayload';
import type { ProgramTree } from '../../api/queries/programs';
import type { WeeklyScheduleEntry } from '../../api/queries/weeklySchedule';
import type { WorkoutLogSummary } from '../../api/queries/workoutLogs';
import type { ScheduledWorkoutLike } from '../../../utils/dayPlan';

// Local-time constructor, same convention as dayPlan.test.ts — avoids the
// UTC-midnight-parse shift an ISO date-only string would be subject to.
const wednesday = new Date(2024, 0, 3); // Jan 3 2024 is a Wednesday
const wednesdayKey = '2024-01-03';
const thursdayKey = '2024-01-04';

const FOCUS_SUMMARY = { headline: 'Ready to train', summary: 'Aim for RPE 7-8 today.', band: 'high' as const };

function buildProgram(
  dayOfWeek: number,
  dayType: 'training' | 'rest' | 'cardio',
  opts: { title?: string; exercises?: Array<{ target_sets: number; rest_seconds: number | null }> } = {},
): ProgramTree {
  return {
    id: 'program-1',
    start_date: '2024-01-01',
    weeks_count: 12,
    days_per_week: 4,
    program_weeks: [
      {
        id: 'week-1',
        week_number: 1,
        program_days: [
          {
            id: 'day-1',
            day_of_week: dayOfWeek,
            is_rest_day: dayType === 'rest',
            day_type: dayType,
            title: opts.title ?? 'Push Day',
            program_exercises: opts.exercises ?? [],
          },
        ],
      },
    ],
  } as unknown as ProgramTree;
}

function buildWeeklyEntry(dayOfWeek: number, name = 'Pull Day', exerciseCount = 5): WeeklyScheduleEntry {
  return {
    id: 'ws-1',
    day_of_week: dayOfWeek,
    workout_template_id: 'template-1',
    day_type: 'training',
    workout_templates: {
      id: 'template-1',
      name,
      workout_template_exercises: Array.from({ length: exerciseCount }, (_, i) => ({ order_index: i })),
    },
  } as unknown as WeeklyScheduleEntry;
}

function buildScheduled(dateStr: string, name = 'Recovery Mobility Flow'): ScheduledWorkoutLike {
  return { id: 'sw-1', name, scheduled_date: dateStr };
}

function buildLog(dateStr: string, id = 'log-1', time = '12:00:00.000Z'): WorkoutLogSummary {
  return {
    id,
    programDayId: null,
    scheduledWorkoutId: null,
    startedAt: '',
    completedAt: `${dateStr}T${time}`,
    cardio: null,
    estimatedCalories: null,
  };
}

const emptyDeps = { weeklySchedule: [], scheduledWorkouts: [], workoutLogs: [] };

describe('buildWidgetPayload', () => {
  it('passes the coach summary fields and top-level metadata straight through', () => {
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: FOCUS_SUMMARY,
      isRestDay: false,
      program: null,
      sessionsThisWeek: 3,
      weeklyTarget: 4,
      ...emptyDeps,
    });

    expect(payload.headline).toBe('Ready to train');
    expect(payload.summary).toBe('Aim for RPE 7-8 today.');
    expect(payload.band).toBe('high');
    expect(payload.isRestDay).toBe(false);
    expect(payload.dateKey).toBe(wednesdayKey);
    expect(payload.sessionsThisWeek).toBe(3);
    expect(payload.weeklyTarget).toBe(4);
    expect(new Date(payload.updatedAt).toString()).not.toBe('Invalid Date');
  });

  it('resolves a program training day, with an exercise-count + duration meta line', () => {
    const program = buildProgram(wednesday.getDay(), 'training', {
      title: 'Push Day',
      exercises: [
        { target_sets: 3, rest_seconds: 90 },
        { target_sets: 3, rest_seconds: 90 },
      ],
    });
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: FOCUS_SUMMARY,
      isRestDay: false,
      program,
      sessionsThisWeek: 0,
      weeklyTarget: 4,
      ...emptyDeps,
    });

    expect(payload.plan).toEqual({
      kind: 'training',
      label: 'Today',
      title: 'Push Day',
      meta: expect.stringMatching(/^2 exercises · ~\d+ min$/),
    });
  });

  it('resolves a weekly-recurring day as a count only, with no duration estimate', () => {
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: FOCUS_SUMMARY,
      isRestDay: false,
      program: null,
      weeklySchedule: [buildWeeklyEntry(wednesday.getDay(), 'Pull Day', 5)],
      scheduledWorkouts: [],
      workoutLogs: [],
      sessionsThisWeek: 0,
      weeklyTarget: 4,
    });

    expect(payload.plan).toEqual({ kind: 'training', label: 'Today', title: 'Pull Day', meta: '5 exercises' });
  });

  it('resolves an ad-hoc scheduled workout by name, with no meta line', () => {
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: FOCUS_SUMMARY,
      isRestDay: false,
      program: null,
      weeklySchedule: [],
      scheduledWorkouts: [buildScheduled(wednesdayKey, 'Recovery Mobility Flow')],
      workoutLogs: [],
      sessionsThisWeek: 0,
      weeklyTarget: 4,
    });

    expect(payload.plan).toEqual({ kind: 'training', label: 'Today', title: 'Recovery Mobility Flow', meta: null });
  });

  it('resolves a cardio day (program or weekly) as its own kind', () => {
    const program = buildProgram(wednesday.getDay(), 'cardio');
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: FOCUS_SUMMARY,
      isRestDay: false,
      program,
      sessionsThisWeek: 0,
      weeklyTarget: 4,
      ...emptyDeps,
    });

    expect(payload.plan).toEqual({ kind: 'cardio', label: 'Today', title: 'Cardio Day', meta: null });
  });

  it('resolves a completed day, tagging it Done with the earliest log time', () => {
    const program = buildProgram(wednesday.getDay(), 'training', { title: 'Push Day' });
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: FOCUS_SUMMARY,
      isRestDay: false,
      program,
      weeklySchedule: [],
      scheduledWorkouts: [],
      workoutLogs: [buildLog(wednesdayKey, 'log-2', '13:00:00.000Z'), buildLog(wednesdayKey, 'log-1', '07:42:00.000Z')],
      sessionsThisWeek: 1,
      weeklyTarget: 4,
    });

    expect(payload.plan.kind).toBe('completed');
    expect(payload.plan.label).toBe('Today · Done');
    expect(payload.plan.title).toBe('Push Day');
    expect(payload.plan.meta).toMatch(/^Logged \d{1,2}:42 [AP]M$/);
  });

  it('peeks ahead to the next planned day when today is a program rest day', () => {
    const restProgram = buildProgram(wednesday.getDay(), 'rest');
    const weeklySchedule = [buildWeeklyEntry(new Date(2024, 0, 4).getDay(), 'Pull Day', 4)]; // Thursday
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: { headline: 'Rest day', summary: 'Recovery is part of the plan.', band: null },
      isRestDay: true,
      program: restProgram,
      weeklySchedule,
      scheduledWorkouts: [],
      workoutLogs: [],
      sessionsThisWeek: 2,
      weeklyTarget: 4,
    });

    expect(payload.plan).toEqual({ kind: 'training', label: 'Next', title: 'Pull Day', meta: 'Thursday' });
  });

  it('falls back to a plain "Rest day" plan when nothing is planned within a week', () => {
    const restProgram = buildProgram(wednesday.getDay(), 'rest');
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: { headline: 'Rest day', summary: 'Recovery is part of the plan.', band: null },
      isRestDay: true,
      program: restProgram,
      sessionsThisWeek: 2,
      weeklyTarget: 4,
      ...emptyDeps,
    });

    expect(payload.plan).toEqual({ kind: 'rest', label: 'Today', title: 'Rest day', meta: null });
  });

  it('falls back to a "nothing planned" plan when there is no program or schedule at all', () => {
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: { headline: 'Today', summary: 'Nothing is scheduled on today’s calendar.', band: null },
      isRestDay: false,
      program: null,
      sessionsThisWeek: 0,
      weeklyTarget: 0,
      ...emptyDeps,
    });

    expect(payload.plan).toEqual({ kind: 'none', label: 'Today', title: null, meta: 'Tap to add a workout' });
  });

  it('picks up an adjacent-date scheduled workout via peek-ahead as "Next", not as today’s own plan', () => {
    const restProgram = buildProgram(wednesday.getDay(), 'rest');
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: { headline: 'Rest day', summary: 'Recovery is part of the plan.', band: null },
      isRestDay: true,
      program: restProgram,
      weeklySchedule: [],
      scheduledWorkouts: [buildScheduled(thursdayKey, 'One-off Mobility')],
      workoutLogs: [],
      sessionsThisWeek: 0,
      weeklyTarget: 4,
    });

    expect(payload.plan).toEqual({ kind: 'training', label: 'Next', title: 'One-off Mobility', meta: 'Thursday' });
  });

  it('carries readiness/streak/calorie metrics through when the caller provides them, and always includes the Log Food deep link', () => {
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: FOCUS_SUMMARY,
      isRestDay: false,
      program: null,
      sessionsThisWeek: 2,
      weeklyTarget: 4,
      readinessScore: 78,
      streak: 5,
      caloriesLogged: 1450,
      calorieTarget: 2200,
      ...emptyDeps,
    });

    expect(payload.readinessScore).toBe(78);
    expect(payload.streak).toBe(5);
    expect(payload.caloriesLogged).toBe(1450);
    expect(payload.calorieTarget).toBe(2200);
    expect(payload.logFoodDeepLink).toBe('soset://chat?openFoodLog=1');
  });

  it('defaults the new metrics to null/0 for a caller that omits them, rather than throwing', () => {
    const payload = buildWidgetPayload({
      today: wednesday,
      todayFocusSummary: FOCUS_SUMMARY,
      isRestDay: false,
      program: null,
      sessionsThisWeek: 0,
      weeklyTarget: 0,
      ...emptyDeps,
    });

    expect(payload.readinessScore).toBeNull();
    expect(payload.streak).toBe(0);
    expect(payload.caloriesLogged).toBeNull();
    expect(payload.calorieTarget).toBeNull();
    expect(payload.logFoodDeepLink).toBe('soset://chat?openFoodLog=1');
  });
});
