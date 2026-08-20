import { useQuery } from '@tanstack/react-query';
import {
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subYears,
  differenceInCalendarDays,
} from 'date-fns';
import { supabase } from '../supabaseClient';

export type LoggedSet = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  reps: number;
  loadKg: number | null;
  loggedAt: string;
};

type LoggedSetRow = {
  id: string;
  reps: number;
  load_kg: number | null;
  logged_at: string;
  exercise_id: string;
  exercises: { name: string } | null;
};

// RLS on workout_log_sets already scopes rows to the caller (via a join back
// to workout_logs.user_id), the same way program_days/program_exercises rely
// on RLS instead of an explicit user_id filter — there's no user_id column
// on this table to filter by directly.
async function fetchLoggedSets(): Promise<LoggedSet[]> {
  const { data, error } = await supabase
    .from('workout_log_sets')
    .select('id, reps, load_kg, logged_at, exercise_id, exercises ( name )')
    .eq('completed', true)
    .eq('is_warmup', false)
    .order('logged_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as unknown as LoggedSetRow[];
  return rows.map(row => ({
    id: row.id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercises?.name ?? 'Exercise',
    reps: row.reps,
    loadKg: row.load_kg,
    loggedAt: row.logged_at,
  }));
}

export function useLoggedSets(userId: string | null) {
  return useQuery({
    queryKey: ['loggedSets', userId],
    queryFn: fetchLoggedSets,
    enabled: userId != null,
  });
}

/** Epley estimated one-rep max. */
export function estimateOneRepMax(loadKg: number, reps: number): number {
  return loadKg * (1 + reps / 30);
}

export type PrEvent = {
  exerciseId: string;
  exerciseName: string;
  loadKg: number;
  reps: number;
  e1rm: number;
  loggedAt: string;
};

/**
 * Walks each exercise's sets in chronological order and flags every set that
 * beat that exercise's prior best estimated 1RM — i.e. every PR moment.
 */
export function computePrEvents(sets: LoggedSet[]): PrEvent[] {
  const bestByExercise = new Map<string, number>();
  const events: PrEvent[] = [];
  for (const set of sets) {
    if (set.loadKg == null || set.loadKg <= 0) continue;
    const e1rm = estimateOneRepMax(set.loadKg, set.reps);
    const best = bestByExercise.get(set.exerciseId) ?? 0;
    if (e1rm > best) {
      bestByExercise.set(set.exerciseId, e1rm);
      events.push({
        exerciseId: set.exerciseId,
        exerciseName: set.exerciseName,
        loadKg: set.loadKg,
        reps: set.reps,
        e1rm,
        loggedAt: set.loggedAt,
      });
    }
  }
  return events;
}

export type ExerciseE1rmPoint = { date: string; e1rm: number };
export type ExerciseE1rmHistory = { exerciseId: string; exerciseName: string; points: ExerciseE1rmPoint[] };

/**
 * Per exercise, one point per calendar day holding that day's best estimated
 * 1RM (multiple sets the same day collapse to their max, so a same-day
 * cluster of sets doesn't skew a trend fit over these points), chronological.
 */
export function computeE1rmHistories(sets: LoggedSet[]): ExerciseE1rmHistory[] {
  const byExercise = new Map<string, { exerciseName: string; byDate: Map<string, number> }>();
  for (const set of sets) {
    if (set.loadKg == null || set.loadKg <= 0) continue;
    const e1rm = estimateOneRepMax(set.loadKg, set.reps);
    // Local calendar date, not `.slice(0, 10)` — that substring is the UTC
    // date, which can silently bucket a late-night local set onto the wrong
    // day (or split one local day's sets across two buckets) depending on
    // the athlete's timezone.
    const dateKey = format(new Date(set.loggedAt), 'yyyy-MM-dd');
    const bucket = byExercise.get(set.exerciseId) ?? { exerciseName: set.exerciseName, byDate: new Map() };
    bucket.byDate.set(dateKey, Math.max(bucket.byDate.get(dateKey) ?? 0, e1rm));
    byExercise.set(set.exerciseId, bucket);
  }
  return [...byExercise.entries()].map(([exerciseId, { exerciseName, byDate }]) => ({
    exerciseId,
    exerciseName,
    points: [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, e1rm]) => ({ date, e1rm })),
  }));
}

export function computeWeeklyVolume(
  sets: LoggedSet[],
  weeks = 8,
): { weekStart: string; volume: number }[] {
  const buckets = new Map<string, number>();
  for (const set of sets) {
    if (set.loadKg == null) continue;
    const weekStart = format(startOfWeek(new Date(set.loggedAt), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    buckets.set(weekStart, (buckets.get(weekStart) ?? 0) + set.loadKg * set.reps);
  }
  const sortedWeeks = Array.from(buckets.keys()).sort();
  return sortedWeeks.slice(-weeks).map(weekStart => ({ weekStart, volume: buckets.get(weekStart) ?? 0 }));
}

/**
 * Per-day volume — the Strength Trend chart's fallback for an account whose
 * history doesn't yet span two calendar weeks. computeWeeklyVolume needs at
 * least two week-buckets to draw a line; a handful of real sessions logged
 * within the same week would otherwise render as a single point (i.e. no
 * line at all) despite having genuine data to show.
 */
export function computeDailyVolume(
  sets: LoggedSet[],
  days = 14,
): { date: string; volume: number }[] {
  const buckets = new Map<string, number>();
  for (const set of sets) {
    if (set.loadKg == null) continue;
    const dateKey = format(new Date(set.loggedAt), 'yyyy-MM-dd');
    buckets.set(dateKey, (buckets.get(dateKey) ?? 0) + set.loadKg * set.reps);
  }
  const sortedDates = Array.from(buckets.keys()).sort();
  return sortedDates.slice(-days).map(date => ({ date, volume: buckets.get(date) ?? 0 }));
}

export type StrengthTrendRange = '1w' | '2w' | '1m' | 'ytd';

/** Shared by every Stats tab card with a 1W/2W/1M/YTD range control (Strength
 * Trend, Muscle Heat Map, ...) so "2W" always means the same rolling window
 * everywhere on the tab. */
export function trainingRangeStart(range: StrengthTrendRange, now: Date): Date {
  switch (range) {
    case '1w':
      return subDays(now, 6);
    case '2w':
      return subDays(now, 13);
    case '1m':
      return subDays(now, 29);
    case 'ytd':
      return startOfYear(now);
  }
}

/**
 * Strength Trend chart data for the Stats tab's user-selectable time range.
 * '1w'/'2w'/'1m' bucket by calendar day (few enough points to stay readable);
 * 'ytd' buckets by calendar week instead, since a day-by-day trend over up to
 * a year would be far too many points to read as a line.
 */
export function computeStrengthTrend(
  sets: LoggedSet[],
  range: StrengthTrendRange,
  now = new Date(),
): { date: string; volume: number }[] {
  const start = startOfDay(trainingRangeStart(range, now));
  const bucketByWeek = range === 'ytd';
  const buckets = new Map<string, number>();
  for (const set of sets) {
    if (set.loadKg == null) continue;
    const loggedAt = new Date(set.loggedAt);
    if (loggedAt < start) continue;
    const key = bucketByWeek
      ? format(startOfWeek(loggedAt, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      : format(loggedAt, 'yyyy-MM-dd');
    buckets.set(key, (buckets.get(key) ?? 0) + set.loadKg * set.reps);
  }
  return Array.from(buckets.keys())
    .sort()
    .map(date => ({ date, volume: buckets.get(date) ?? 0 }));
}

/**
 * Same bucketing as computeStrengthTrend, but tracks the best estimated
 * one-rep max per bucket instead of summed volume — the Stats tab's
 * Strength Trend chart toggles between the two without changing its date
 * range logic.
 */
export function computeE1rmTrend(
  sets: LoggedSet[],
  range: StrengthTrendRange,
  now = new Date(),
): { date: string; e1rm: number }[] {
  const start = startOfDay(trainingRangeStart(range, now));
  const bucketByWeek = range === 'ytd';
  const buckets = new Map<string, number>();
  for (const set of sets) {
    if (set.loadKg == null) continue;
    const loggedAt = new Date(set.loggedAt);
    if (loggedAt < start) continue;
    const key = bucketByWeek
      ? format(startOfWeek(loggedAt, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      : format(loggedAt, 'yyyy-MM-dd');
    const e1rm = estimateOneRepMax(set.loadKg, set.reps);
    buckets.set(key, Math.max(buckets.get(key) ?? 0, e1rm));
  }
  return Array.from(buckets.keys())
    .sort()
    .map(date => ({ date, e1rm: buckets.get(date) ?? 0 }));
}

/**
 * The comparison window "vs previous period" means for each Strength Trend
 * range — the same length of time immediately before the current window,
 * except 'ytd', where an arbitrary N-day lookback before Jan 1 wouldn't mean
 * much: "this year so far vs the same stretch last year" is the comparison
 * that actually reads as a trend.
 */
export function previousPeriodWindow(range: StrengthTrendRange, now: Date): { start: Date; end: Date } {
  const currentStart = trainingRangeStart(range, now);
  if (range === 'ytd') {
    return { start: startOfYear(subYears(now, 1)), end: subYears(now, 1) };
  }
  const periodDays = differenceInCalendarDays(startOfDay(now), startOfDay(currentStart)) + 1;
  return { start: subDays(currentStart, periodDays), end: currentStart };
}

export function totalVolumeInWindow(sets: LoggedSet[], start: Date, end: Date): number {
  return sets
    .filter(s => s.loadKg != null && new Date(s.loggedAt) >= start && new Date(s.loggedAt) < end)
    .reduce((sum, s) => sum + (s.loadKg as number) * s.reps, 0);
}

export function bestE1rmInWindow(sets: LoggedSet[], start: Date, end: Date): number {
  let best = 0;
  for (const set of sets) {
    if (set.loadKg == null) continue;
    const loggedAt = new Date(set.loggedAt);
    if (loggedAt < start || loggedAt >= end) continue;
    const e1rm = estimateOneRepMax(set.loadKg, set.reps);
    if (e1rm > best) best = e1rm;
  }
  return best;
}

export function totalVolumeThisMonth(sets: LoggedSet[]): number {
  const monthStart = startOfMonth(new Date());
  return sets
    .filter(s => s.loadKg != null && new Date(s.loggedAt) >= monthStart)
    .reduce((sum, s) => sum + (s.loadKg as number) * s.reps, 0);
}

export function prsThisMonth(events: PrEvent[]): number {
  const monthStart = startOfMonth(new Date());
  return events.filter(e => new Date(e.loggedAt) >= monthStart).length;
}
