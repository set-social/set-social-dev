import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfWeek, format, startOfWeek, subWeeks } from 'date-fns';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';
import { useActiveProgramTree } from './programs';
import { useWorkoutLogsInRange } from './workoutLogs';
import { useReadinessCheckinsInRange } from './coaching';
import { walkScheduledDays } from '../../../utils/trainingScheduleWalk';
import type {
  DetectTrainingPatternsParams,
  ExerciseRpeTrendInput,
  MissedWeekdayInput,
  TrainingPattern,
  WeeklyPatternSnapshot,
} from '../../coaching';

export type TrainingPatternRow = Database['public']['Tables']['training_patterns']['Row'];

const LOOKBACK_WEEKS = 6;

// ---------------------------------------------------------------------------
// RPE history — a dedicated raw workout_log_sets query, kept separate from
// progress.ts's LoggedSet (which has no rpe field) rather than widening that
// shared type and touching every existing call site.
// ---------------------------------------------------------------------------

type ExerciseRpeRow = {
  exercise_id: string;
  load_kg: number | null;
  rpe: number | null;
  logged_at: string;
  exercises: { name: string } | null;
};

async function fetchExerciseRpeHistory(from: string): Promise<ExerciseRpeRow[]> {
  const { data, error } = await supabase
    .from('workout_log_sets')
    .select('exercise_id, load_kg, rpe, logged_at, exercises ( name )')
    .eq('completed', true)
    .eq('is_warmup', false)
    .not('rpe', 'is', null)
    .gte('logged_at', from)
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ExerciseRpeRow[];
}

function useExerciseRpeHistory(userId: string | null, from: string) {
  return useQuery({
    queryKey: ['exerciseRpeHistory', userId, from],
    queryFn: () => fetchExerciseRpeHistory(from),
    enabled: userId != null,
  });
}

// ---------------------------------------------------------------------------
// Persisted pattern rows — the "memory": survives across sessions, and a
// dismissal is permanent for that pattern key.
// ---------------------------------------------------------------------------

async function fetchTrainingPatternRows(userId: string): Promise<TrainingPatternRow[]> {
  const { data, error } = await supabase.from('training_patterns').select('*').eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

function useTrainingPatternRows(userId: string | null) {
  return useQuery({
    queryKey: ['trainingPatterns', userId],
    queryFn: () => fetchTrainingPatternRows(userId as string),
    enabled: userId != null,
  });
}

/**
 * Aggregates a 6-week lookback into everything detectTrainingPatterns()
 * needs. The screen calls coachingEngine.detectTrainingPatterns(params)
 * itself, then persists the result via useSyncTrainingPatterns — same
 * hook-aggregates/screen-calls-engine split as every other coaching phase.
 */
export function useTrainingPatterns(userId: string | null) {
  const today = useMemo(() => new Date(), []);
  const { weekStarts, rangeFrom, rangeTo } = useMemo(() => {
    const starts = Array.from({ length: LOOKBACK_WEEKS }, (_, i) =>
      startOfWeek(subWeeks(today, LOOKBACK_WEEKS - 1 - i), { weekStartsOn: 1 }),
    );
    return { weekStarts: starts, rangeFrom: starts[0], rangeTo: endOfWeek(today, { weekStartsOn: 1 }) };
  }, [today]);

  const from = format(rangeFrom, 'yyyy-MM-dd');
  const to = format(rangeTo, 'yyyy-MM-dd');

  const { data: program, isLoading: programLoading } = useActiveProgramTree(userId);
  const { data: workoutLogs, isLoading: logsLoading } = useWorkoutLogsInRange(userId, { from, to });
  const { data: checkinRows, isLoading: checkinsLoading } = useReadinessCheckinsInRange(userId, from, to);
  const { data: rpeRows, isLoading: rpeLoading } = useExerciseRpeHistory(userId, from);
  const { data: patternRows, isLoading: patternsLoading } = useTrainingPatternRows(userId);

  const isLoading = programLoading || logsLoading || checkinsLoading || rpeLoading || patternsLoading;

  const activePatterns = useMemo(
    () =>
      (patternRows ?? [])
        .filter(row => row.status === 'active')
        .sort((a, b) => b.confidence - a.confidence),
    [patternRows],
  );

  const params = useMemo<DetectTrainingPatternsParams | null>(() => {
    if (!workoutLogs || !checkinRows || !rpeRows || !patternRows) return null;

    // Local calendar date, not `.slice(0, 10)` — that substring is the UTC
    // date, which can silently misclassify a late-night local workout onto
    // the wrong weekday for walkScheduledDays below (it compares against
    // `format(cursor, 'yyyy-MM-dd')`, i.e. local dates).
    const completedDates = new Set(workoutLogs.map(log => format(new Date(log.completedAt), 'yyyy-MM-dd')));
    const walk = walkScheduledDays(program, completedDates, rangeFrom, rangeTo);

    const missedByWeekday = new Map<number, { opportunities: number; missed: number }>();
    for (const day of walk) {
      if (!day.isTrainingDay) continue;
      const bucket = missedByWeekday.get(day.weekday) ?? { opportunities: 0, missed: 0 };
      bucket.opportunities++;
      if (!day.completed) bucket.missed++;
      missedByWeekday.set(day.weekday, bucket);
    }
    const missedWeekdays: MissedWeekdayInput[] = [...missedByWeekday.entries()].map(([weekday, counts]) => ({
      weekday,
      ...counts,
    }));

    const weeklySnapshots: WeeklyPatternSnapshot[] = weekStarts.map(weekStart => {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const weekEndKey = format(weekEnd, 'yyyy-MM-dd');
      const weekStartKey = format(weekStart, 'yyyy-MM-dd');

      const trainingDaysInWeek = walk.filter(
        day => day.isTrainingDay && day.date >= weekStart && day.date <= weekEnd,
      );
      const consistencyPercent =
        trainingDaysInWeek.length > 0
          ? (trainingDaysInWeek.filter(d => d.completed).length / trainingDaysInWeek.length) * 100
          : null;

      const weekCheckins = checkinRows.filter(
        row => row.checkin_date >= weekStartKey && row.checkin_date <= weekEndKey,
      );
      const painReportCount = weekCheckins.filter(row => row.has_pain).length;
      const sleepValues = weekCheckins.map(row => row.sleep_hours).filter((v): v is number => v != null);
      const averageSleepHours =
        sleepValues.length > 0 ? sleepValues.reduce((sum, v) => sum + v, 0) / sleepValues.length : null;

      return { weekStart: weekStartKey, consistencyPercent, painReportCount, averageSleepHours };
    });

    const rpeByExercise = new Map<string, { exerciseName: string; sessions: Array<{ rpe: number; loadKg: number | null }> }>();
    for (const row of rpeRows) {
      if (row.rpe == null) continue;
      const bucket = rpeByExercise.get(row.exercise_id) ?? {
        exerciseName: row.exercises?.name ?? 'Exercise',
        sessions: [],
      };
      bucket.sessions.push({ rpe: row.rpe, loadKg: row.load_kg });
      rpeByExercise.set(row.exercise_id, bucket);
    }
    const exerciseRpeTrends: ExerciseRpeTrendInput[] = [...rpeByExercise.entries()].map(([exerciseId, bucket]) => ({
      exerciseId,
      exerciseName: bucket.exerciseName,
      sessions: bucket.sessions,
    }));

    const dismissedKeys = patternRows.filter(row => row.status === 'dismissed').map(row => row.pattern_key);

    return { weeklySnapshots, missedWeekdays, exerciseRpeTrends, dismissedKeys };
  }, [workoutLogs, checkinRows, rpeRows, patternRows, program, rangeFrom, rangeTo, weekStarts]);

  return { isLoading, activePatterns, params };
}

/**
 * Upserts the freshly-detected pattern list (confidence/detail/
 * last_detected_at refreshed on each run) and marks any previously-active
 * row whose key is no longer detected as 'resolved'. Dismissed rows are
 * never touched — a dismissal is permanent for that pattern key.
 */
export function useSyncTrainingPatterns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { userId: string; detected: TrainingPattern[]; activeRows: TrainingPatternRow[] }) => {
      const { userId, detected, activeRows } = params;

      if (detected.length > 0) {
        const upserts: Database['public']['Tables']['training_patterns']['Insert'][] = detected.map(pattern => ({
          user_id: userId,
          pattern_key: pattern.key,
          pattern_type: pattern.type,
          confidence: pattern.confidence,
          title: pattern.title,
          detail: pattern.detail,
          evidence_summary: pattern.evidenceSummary,
          status: 'active',
          last_detected_at: new Date().toISOString(),
        }));
        const { error } = await supabase.from('training_patterns').upsert(upserts, { onConflict: 'user_id,pattern_key' });
        if (error) throw error;
      }

      const detectedKeys = new Set(detected.map(p => p.key));
      const staleActiveIds = activeRows.filter(row => !detectedKeys.has(row.pattern_key)).map(row => row.id);
      if (staleActiveIds.length > 0) {
        const { error } = await supabase
          .from('training_patterns')
          .update({ status: 'resolved' })
          .in('id', staleActiveIds);
        if (error) throw error;
      }
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['trainingPatterns', params.userId] });
    },
  });
}

export function useDismissTrainingPattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; userId: string }) => {
      const { error } = await supabase
        .from('training_patterns')
        .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['trainingPatterns', params.userId] });
    },
  });
}
