import { resolveDayPlan, getOneOffBaseline } from '../dayPlan';
import type { ProgramTree } from '../../services/api/queries/programs';
import type { WeeklyScheduleEntry } from '../../services/api/queries/weeklySchedule';
import type { WorkoutLogSummary } from '../../services/api/queries/workoutLogs';
import type { DayOverride } from '../../services/api/queries/dayOverrides';
import type { ScheduledWorkoutLike } from '../dayPlan';

// Local-time constructor — avoids the UTC-midnight-parse shift that
// ISO date-only strings are subject to, same convention as
// trainingScheduleWalk.test.ts.
const wednesday = new Date(2024, 0, 3); // Jan 3 2024 is a Wednesday
const wednesdayKey = '2024-01-03';
const thursdayKey = '2024-01-04';

function buildProgram(
  dayOfWeek: number,
  isRestDay: boolean,
  title = 'Push Day',
  dayType?: 'training' | 'rest' | 'cardio',
): ProgramTree {
  return {
    id: 'program-1',
    start_date: '2024-01-01',
    weeks_count: 12,
    program_weeks: [
      {
        id: 'week-1',
        week_number: 1,
        program_days: [
          {
            id: 'day-1',
            day_of_week: dayOfWeek,
            is_rest_day: isRestDay,
            day_type: dayType ?? (isRestDay ? 'rest' : 'training'),
            title,
            program_exercises: [],
          },
        ],
      },
    ],
  } as unknown as ProgramTree;
}

function buildWeeklyEntry(
  dayOfWeek: number,
  name = 'Pull Day',
  dayType: 'training' | 'cardio' = 'training',
): WeeklyScheduleEntry {
  return {
    id: 'ws-1',
    day_of_week: dayOfWeek,
    workout_template_id: dayType === 'training' ? 'template-1' : null,
    day_type: dayType,
    workout_templates:
      dayType === 'training' ? { id: 'template-1', name, workout_template_exercises: [{ order_index: 0 }] } : null,
  } as unknown as WeeklyScheduleEntry;
}

function buildScheduled(dateStr: string, name = 'Recovery Mobility Flow'): ScheduledWorkoutLike {
  return { id: 'sw-1', name, scheduled_date: dateStr };
}

function buildOverride(dateStr: string, status: 'rest' | 'missed'): DayOverride {
  return { id: 'override-1', user_id: 'user-1', date: dateStr, status, created_at: '' };
}

function buildLog(dateStr: string): WorkoutLogSummary {
  return {
    id: 'log-1',
    programDayId: null,
    scheduledWorkoutId: null,
    startedAt: '',
    completedAt: `${dateStr}T12:00:00.000Z`,
    cardio: null,
    estimatedCalories: null,
  };
}

describe('resolveDayPlan', () => {
  it('resolves none when program, weeklySchedule, and scheduledWorkouts are all empty', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: null,
      weeklySchedule: [],
      scheduledWorkouts: [],
      workoutLogs: [],
    });
    expect(resolved).toEqual({ kind: 'none' });
  });

  it('is null-safe when program and weeklySchedule are undefined (loading state)', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: undefined,
      weeklySchedule: undefined,
      scheduledWorkouts: undefined,
      workoutLogs: undefined,
    });
    expect(resolved).toEqual({ kind: 'none' });
  });

  it('resolves programRest vs programTraining correctly when weeklySchedule is empty', () => {
    const restProgram = buildProgram(wednesday.getDay(), true);
    expect(
      resolveDayPlan({ date: wednesday, program: restProgram, weeklySchedule: [], scheduledWorkouts: [], workoutLogs: [] }),
    ).toMatchObject({ kind: 'programRest' });

    const trainingProgram = buildProgram(wednesday.getDay(), false);
    expect(
      resolveDayPlan({ date: wednesday, program: trainingProgram, weeklySchedule: [], scheduledWorkouts: [], workoutLogs: [] }),
    ).toMatchObject({ kind: 'programTraining' });
  });

  it('weeklyRecurring beats program, whether the program day is training or rest', () => {
    const weeklySchedule = [buildWeeklyEntry(wednesday.getDay())];

    const resolvedVsTraining = resolveDayPlan({
      date: wednesday,
      program: buildProgram(wednesday.getDay(), false),
      weeklySchedule,
      scheduledWorkouts: [],
      workoutLogs: [],
    });
    expect(resolvedVsTraining).toMatchObject({ kind: 'weeklyRecurring' });

    const resolvedVsRest = resolveDayPlan({
      date: wednesday,
      program: buildProgram(wednesday.getDay(), true),
      weeklySchedule,
      scheduledWorkouts: [],
      workoutLogs: [],
    });
    expect(resolvedVsRest).toMatchObject({ kind: 'weeklyRecurring' });
  });

  it('an ad-hoc scheduled workout beats both weeklyRecurring and program', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: buildProgram(wednesday.getDay(), false),
      weeklySchedule: [buildWeeklyEntry(wednesday.getDay())],
      scheduledWorkouts: [buildScheduled(wednesdayKey)],
      workoutLogs: [],
    });
    expect(resolved).toMatchObject({ kind: 'scheduled', scheduledWorkout: { name: 'Recovery Mobility Flow' } });
  });

  it('a completed workout beats everything, including scheduled/weekly/program for the same date', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: buildProgram(wednesday.getDay(), false),
      weeklySchedule: [buildWeeklyEntry(wednesday.getDay())],
      scheduledWorkouts: [buildScheduled(wednesdayKey)],
      workoutLogs: [buildLog(wednesdayKey)],
    });
    expect(resolved.kind).toBe('completed');
  });

  describe('completed title fallback chain', () => {
    it('prefers the scheduled workout name when present', () => {
      const resolved = resolveDayPlan({
        date: wednesday,
        program: buildProgram(wednesday.getDay(), false),
        weeklySchedule: [buildWeeklyEntry(wednesday.getDay())],
        scheduledWorkouts: [buildScheduled(wednesdayKey, 'Recovery Mobility Flow')],
        workoutLogs: [buildLog(wednesdayKey)],
      });
      expect(resolved).toMatchObject({ kind: 'completed', title: 'Recovery Mobility Flow' });
    });

    it('falls back to the weekly template name when no scheduled workout exists', () => {
      const resolved = resolveDayPlan({
        date: wednesday,
        program: buildProgram(wednesday.getDay(), false),
        weeklySchedule: [buildWeeklyEntry(wednesday.getDay(), 'Pull Day')],
        scheduledWorkouts: [],
        workoutLogs: [buildLog(wednesdayKey)],
      });
      expect(resolved).toMatchObject({ kind: 'completed', title: 'Pull Day' });
    });

    it('falls back to the program day title when neither scheduled nor weekly exist', () => {
      const resolved = resolveDayPlan({
        date: wednesday,
        program: buildProgram(wednesday.getDay(), false, 'Push Day'),
        weeklySchedule: [],
        scheduledWorkouts: [],
        workoutLogs: [buildLog(wednesdayKey)],
      });
      expect(resolved).toMatchObject({ kind: 'completed', title: 'Push Day' });
    });

    it('is null when nothing at all is present besides the log', () => {
      const resolved = resolveDayPlan({
        date: wednesday,
        program: null,
        weeklySchedule: [],
        scheduledWorkouts: [],
        workoutLogs: [buildLog(wednesdayKey)],
      });
      expect(resolved).toMatchObject({ kind: 'completed', title: null });
    });
  });

  it('resolves programCardio when the program day is day_type=cardio', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: buildProgram(wednesday.getDay(), false, 'Push Day', 'cardio'),
      weeklySchedule: [],
      scheduledWorkouts: [],
      workoutLogs: [],
    });
    expect(resolved).toMatchObject({ kind: 'programCardio' });
  });

  it('resolves weeklyCardio when the weekly entry is day_type=cardio, beating program either way', () => {
    const weeklySchedule = [buildWeeklyEntry(wednesday.getDay(), 'Pull Day', 'cardio')];

    const vsTraining = resolveDayPlan({
      date: wednesday,
      program: buildProgram(wednesday.getDay(), false),
      weeklySchedule,
      scheduledWorkouts: [],
      workoutLogs: [],
    });
    expect(vsTraining).toMatchObject({ kind: 'weeklyCardio' });

    const vsNone = resolveDayPlan({
      date: wednesday,
      program: null,
      weeklySchedule,
      scheduledWorkouts: [],
      workoutLogs: [],
    });
    expect(vsNone).toMatchObject({ kind: 'weeklyCardio' });
  });

  it('an ad-hoc scheduled workout beats weeklyCardio and programCardio too', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: buildProgram(wednesday.getDay(), false, 'Push Day', 'cardio'),
      weeklySchedule: [buildWeeklyEntry(wednesday.getDay(), 'Pull Day', 'cardio')],
      scheduledWorkouts: [buildScheduled(wednesdayKey)],
      workoutLogs: [],
    });
    expect(resolved).toMatchObject({ kind: 'scheduled' });
  });

  it('a completed workout beats a cardio day too', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: buildProgram(wednesday.getDay(), false, 'Push Day', 'cardio'),
      weeklySchedule: [],
      scheduledWorkouts: [],
      workoutLogs: [buildLog(wednesdayKey)],
    });
    expect(resolved.kind).toBe('completed');
  });

  it('does not match a scheduled workout or completed log on an adjacent date', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: null,
      weeklySchedule: [],
      scheduledWorkouts: [buildScheduled(thursdayKey)],
      workoutLogs: [buildLog(thursdayKey)],
    });
    expect(resolved).toEqual({ kind: 'none' });
  });

  describe('dayOverrides', () => {
    it('an override beats a weeklyCardio/programTraining/scheduled plan for the same date', () => {
      const asRest = resolveDayPlan({
        date: wednesday,
        program: buildProgram(wednesday.getDay(), false),
        weeklySchedule: [buildWeeklyEntry(wednesday.getDay(), 'Pull Day', 'cardio')],
        scheduledWorkouts: [buildScheduled(wednesdayKey)],
        workoutLogs: [],
        dayOverrides: [buildOverride(wednesdayKey, 'rest')],
      });
      expect(asRest).toEqual({ kind: 'overrideRest' });

      const asMissed = resolveDayPlan({
        date: wednesday,
        program: buildProgram(wednesday.getDay(), false),
        weeklySchedule: [buildWeeklyEntry(wednesday.getDay())],
        scheduledWorkouts: [],
        workoutLogs: [],
        dayOverrides: [buildOverride(wednesdayKey, 'missed')],
      });
      expect(asMissed).toEqual({ kind: 'missed' });
    });

    it('a completed workout still beats an override for the same date', () => {
      const resolved = resolveDayPlan({
        date: wednesday,
        program: null,
        weeklySchedule: [buildWeeklyEntry(wednesday.getDay(), 'Pull Day', 'cardio')],
        scheduledWorkouts: [],
        workoutLogs: [buildLog(wednesdayKey)],
        dayOverrides: [buildOverride(wednesdayKey, 'missed')],
      });
      expect(resolved.kind).toBe('completed');
    });

    it('an override on a different date has no effect', () => {
      const resolved = resolveDayPlan({
        date: wednesday,
        program: null,
        weeklySchedule: [buildWeeklyEntry(wednesday.getDay(), 'Pull Day', 'cardio')],
        scheduledWorkouts: [],
        workoutLogs: [],
        dayOverrides: [buildOverride(thursdayKey, 'rest')],
      });
      expect(resolved).toMatchObject({ kind: 'weeklyCardio' });
    });
  });
});

describe('getOneOffBaseline', () => {
  it('returns null for any kind other than scheduled', () => {
    expect(getOneOffBaseline({ kind: 'none' }, null)).toBeNull();
    expect(getOneOffBaseline({ kind: 'completed', title: null, workoutLogIds: [] }, null)).toBeNull();
  });

  it('returns "Rest" when a scheduled override falls on a day with no weekly baseline', () => {
    const resolved = resolveDayPlan({
      date: wednesday,
      program: null,
      weeklySchedule: [],
      scheduledWorkouts: [buildScheduled(wednesdayKey)],
      workoutLogs: [],
    });
    expect(getOneOffBaseline(resolved, null)).toBe('Rest');
  });

  it("returns the weekly template's name when a scheduled override replaces a normal training day", () => {
    const baseline = buildWeeklyEntry(wednesday.getDay(), 'Pull Day');
    const resolved = resolveDayPlan({
      date: wednesday,
      program: null,
      weeklySchedule: [baseline],
      scheduledWorkouts: [buildScheduled(wednesdayKey)],
      workoutLogs: [],
    });
    expect(getOneOffBaseline(resolved, baseline)).toBe('Pull Day');
  });

  it('returns "Cardio Day" when a scheduled override replaces what is normally a cardio day', () => {
    const baseline = buildWeeklyEntry(wednesday.getDay(), 'Pull Day', 'cardio');
    const resolved = resolveDayPlan({
      date: wednesday,
      program: null,
      weeklySchedule: [baseline],
      scheduledWorkouts: [buildScheduled(wednesdayKey)],
      workoutLogs: [],
    });
    expect(getOneOffBaseline(resolved, baseline)).toBe('Cardio Day');
  });
});
