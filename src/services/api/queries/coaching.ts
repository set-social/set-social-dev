import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';
import { useActiveProgramTree } from './programs';
import { walkScheduledDays } from '../../../utils/trainingScheduleWalk';
import { useWorkoutLogsInRange } from './workoutLogs';
import { useLoggedSets, estimateOneRepMax } from './progress';
import { useWhoopMetrics } from './whoop';
import { useOuraMetrics } from './oura';
import { coachingEngine } from '../../coaching';
import { featureFlags } from '../../../config/featureFlags';
import type {
  AdaptationChange,
  ExerciseSubstitution,
  ReadinessCheckinInput,
  ReadinessInputs,
  SetRecommendation,
} from '../../coaching';

type ReadinessCheckinRow = Database['public']['Tables']['readiness_checkins']['Row'];
type WorkoutAdaptationRow = Database['public']['Tables']['workout_adaptations']['Row'];
type WorkoutAdaptationInsert = Database['public']['Tables']['workout_adaptations']['Insert'];
type SetRecommendationInsert = Database['public']['Tables']['set_recommendations']['Insert'];
type ExerciseSubstitutionInsert = Database['public']['Tables']['exercise_substitutions']['Insert'];

const HISTORY_LOOKBACK_DAYS = 35;
const MISSED_WINDOW_DAYS = 14;

function todayKey(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// Local calendar date, not `isoString.slice(0, 10)` — that substring is the
// *UTC* date, which silently disagrees with the athlete's own local day near
// midnight in any negative-UTC-offset timezone. Same convention as
// TodayScreen/WeekTimeline/dayPlan's own `dateKey`.
function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// Readiness check-ins
// ---------------------------------------------------------------------------

async function fetchReadinessCheckin(userId: string, checkinDate: string): Promise<ReadinessCheckinRow | null> {
  const { data, error } = await supabase
    .from('readiness_checkins')
    .select('*')
    .eq('user_id', userId)
    .eq('checkin_date', checkinDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function useReadinessCheckin(userId: string | null, checkinDate: string) {
  return useQuery({
    queryKey: ['readinessCheckin', userId, checkinDate],
    queryFn: () => fetchReadinessCheckin(userId as string, checkinDate),
    enabled: userId != null,
  });
}

export function useSubmitReadinessCheckin(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      sleepHours?: number | null;
      sleepQuality?: number | null;
      soreness?: number | null;
      stress?: number | null;
      hasPain?: boolean;
      painNotes?: string | null;
      notes?: string | null;
    }) => {
      if (!userId) throw new Error('Not signed in');
      const checkinDate = todayKey();
      const { data, error } = await supabase
        .from('readiness_checkins')
        .upsert(
          {
            user_id: userId,
            checkin_date: checkinDate,
            sleep_hours: params.sleepHours ?? null,
            sleep_quality: params.sleepQuality ?? null,
            soreness: params.soreness ?? null,
            stress: params.stress ?? null,
            has_pain: params.hasPain ?? false,
            pain_notes: params.painNotes ?? null,
            notes: params.notes ?? null,
          },
          { onConflict: 'user_id,checkin_date' },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: data => {
      queryClient.setQueryData(['readinessCheckin', userId, data.checkin_date], data);
    },
  });
}

function checkinRowToInput(row: ReadinessCheckinRow | null | undefined): ReadinessCheckinInput {
  if (!row) return null;
  return {
    sleepHours: row.sleep_hours,
    sleepQuality: row.sleep_quality,
    soreness: row.soreness,
    stress: row.stress,
    hasPain: row.has_pain,
    painNotes: row.pain_notes,
    notes: row.notes,
  };
}

async function fetchReadinessCheckinsInRange(
  userId: string,
  from: string,
  to: string,
): Promise<ReadinessCheckinRow[]> {
  const { data, error } = await supabase
    .from('readiness_checkins')
    .select('*')
    .eq('user_id', userId)
    .gte('checkin_date', from)
    .lte('checkin_date', to)
    .order('checkin_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export function useReadinessCheckinsInRange(userId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['readinessCheckinsInRange', userId, from, to],
    queryFn: () => fetchReadinessCheckinsInRange(userId as string, from, to),
    enabled: userId != null,
  });
}

// ---------------------------------------------------------------------------
// Aggregated readiness context — everything evaluateReadiness() needs, built
// from data this app already fetches elsewhere (loggedSets, workout logs,
// the active program) plus today's check-in. The screen calls
// coachingEngine.evaluateReadiness(inputs) itself; this hook only aggregates.
// ---------------------------------------------------------------------------

export function useReadinessContext(userId: string | null) {
  // Memoized once per mount rather than recomputed every render — keeps
  // `inputs` below referentially stable across renders that don't actually
  // change the underlying query data, which callers rely on for their own
  // useMemo/useEffect dependency arrays (e.g. re-evaluating readiness only
  // when it actually changes, not on every keystroke elsewhere on screen).
  const today = useMemo(() => new Date(), []);
  const from = format(addDays(today, -HISTORY_LOOKBACK_DAYS), 'yyyy-MM-dd');
  const to = format(today, 'yyyy-MM-dd');

  const { data: program, isLoading: programLoading } = useActiveProgramTree(userId);
  const { data: workoutLogs, isLoading: logsLoading } = useWorkoutLogsInRange(userId, { from, to });
  const { data: loggedSets, isLoading: setsLoading } = useLoggedSets(userId);
  const { data: checkin, isLoading: checkinLoading } = useReadinessCheckin(userId, todayKey());
  const { data: recentCheckins, isLoading: recentCheckinsLoading } = useReadinessCheckinsInRange(userId, from, to);
  const { data: whoopMetrics, isLoading: whoopLoading } = useWhoopMetrics(userId);
  const { data: ouraMetrics, isLoading: ouraLoading } = useOuraMetrics(userId);

  const isLoading =
    programLoading || logsLoading || setsLoading || checkinLoading || recentCheckinsLoading || whoopLoading || ouraLoading;

  const inputs = useMemo<ReadinessInputs>(() => {
    const completedDates = new Set((workoutLogs ?? []).map(log => dateKey(new Date(log.completedAt))));

    let daysSinceLastWorkout: number | null = null;
    for (const log of workoutLogs ?? []) {
      // Calendar-day difference, not a raw duration-in-ms/86_400_000 floor —
      // a workout completed yesterday evening is still <24h ago at 9am
      // today, which would floor to 0 ("today") under duration math even
      // though it's a different calendar day.
      const days = differenceInCalendarDays(today, new Date(log.completedAt));
      if (daysSinceLastWorkout == null || days < daysSinceLastWorkout) {
        daysSinceLastWorkout = days;
      }
    }

    // Only counts missed *program* training days (matches the Today screen's
    // existing "missed yesterday" logic) — ad-hoc scheduled workouts have no
    // implied cadence to fall behind on.
    const missedWorkoutsLast14Days = walkScheduledDays(
      program,
      completedDates,
      addDays(today, -MISSED_WINDOW_DAYS),
      addDays(today, -1),
    ).filter(day => day.isTrainingDay && !day.completed).length;

    const trainingLoad = coachingEngine.calculateTrainingLoad(loggedSets ?? [], today);

    // Today excluded — this is the baseline today's own rating gets compared
    // against, not a number that should include today's rating itself.
    const priorSorenessValues = (recentCheckins ?? [])
      .filter(row => row.checkin_date < to && row.soreness != null)
      .map(row => row.soreness as number);
    const priorAverageSoreness =
      priorSorenessValues.length > 0
        ? priorSorenessValues.reduce((sum, v) => sum + v, 0) / priorSorenessValues.length
        : null;

    const whoopReady =
      featureFlags.wearableIntegrations && whoopMetrics?.score_state === 'SCORED' && whoopMetrics.recovery_score != null
        ? {
            source: 'whoop' as const,
            recoveryScore: whoopMetrics.recovery_score,
            sleepPerformancePct: whoopMetrics.sleep_performance_pct,
            strain: whoopMetrics.strain,
            date: whoopMetrics.cycle_date,
            hrvMs: whoopMetrics.hrv_ms,
            restingHeartRate: whoopMetrics.resting_heart_rate,
            sleepEfficiencyPct: whoopMetrics.sleep_efficiency_pct,
            sleepConsistencyPct: whoopMetrics.sleep_consistency_pct,
            respiratoryRate: whoopMetrics.respiratory_rate,
            remSleepMinutes: whoopMetrics.rem_sleep_minutes,
            deepSleepMinutes: whoopMetrics.deep_sleep_minutes,
            lightSleepMinutes: whoopMetrics.light_sleep_minutes,
            awakeMinutes: whoopMetrics.awake_minutes,
            sleepDebtMinutes: whoopMetrics.sleep_debt_minutes,
            spo2Pct: whoopMetrics.spo2_pct,
            skinTempCelsius: whoopMetrics.skin_temp_celsius,
          }
        : null;
    const ouraReady =
      featureFlags.wearableIntegrations && ouraMetrics?.readiness_score != null
        ? {
            source: 'oura' as const,
            recoveryScore: ouraMetrics.readiness_score,
            sleepPerformancePct: ouraMetrics.sleep_score,
            strain: null,
            date: ouraMetrics.metric_date,
          }
        : null;
    // Precedence when both are connected and have data for around today:
    // prefer whichever has the more recent date, tie-break to Whoop. This is
    // a genuine edge case (most athletes only connect one wearable) — easy
    // to revisit if that assumption stops holding.
    let wearable: ReadinessInputs['wearable'] = null;
    if (whoopReady && ouraReady) {
      wearable = ouraReady.date > whoopReady.date ? ouraReady : whoopReady;
    } else {
      wearable = whoopReady ?? ouraReady;
    }

    return {
      checkin: checkinRowToInput(checkin),
      wearable,
      trainingLoad,
      daysSinceLastWorkout,
      missedWorkoutsLast14Days,
      priorAverageSoreness,
    };
  }, [workoutLogs, program, loggedSets, checkin, recentCheckins, whoopMetrics, ouraMetrics, today, to]);

  return { isLoading, inputs, hasCheckin: checkin != null, checkinId: checkin?.id ?? null };
}

// ---------------------------------------------------------------------------
// Workout adaptations
// ---------------------------------------------------------------------------

async function fetchWorkoutAdaptationsForToday(
  userId: string,
  source: { programDayId?: string; scheduledWorkoutId?: string },
): Promise<WorkoutAdaptationRow[]> {
  const base = supabase
    .from('workout_adaptations')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', `${todayKey()}T00:00:00.000Z`);

  const { data, error } = source.programDayId
    ? await base.eq('program_day_id', source.programDayId)
    : await base.eq('scheduled_workout_id', source.scheduledWorkoutId as string);
  if (error) throw error;
  return data ?? [];
}

export function useWorkoutAdaptations(
  userId: string | null,
  source: { programDayId?: string; scheduledWorkoutId?: string },
) {
  return useQuery({
    queryKey: ['workoutAdaptations', userId, source.programDayId ?? null, source.scheduledWorkoutId ?? null],
    queryFn: () => fetchWorkoutAdaptationsForToday(userId as string, source),
    enabled: userId != null && (source.programDayId != null || source.scheduledWorkoutId != null),
  });
}

export function useSaveWorkoutAdaptations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      userId: string;
      programDayId?: string | null;
      scheduledWorkoutId?: string | null;
      readinessCheckinId: string | null;
      decisions: Array<{ change: AdaptationChange; accepted: boolean }>;
    }) => {
      if (params.decisions.length === 0) return [];
      const rows: WorkoutAdaptationInsert[] = params.decisions.map(({ change, accepted }) => ({
        user_id: params.userId,
        program_day_id: params.programDayId ?? null,
        scheduled_workout_id: params.scheduledWorkoutId ?? null,
        readiness_checkin_id: params.readinessCheckinId,
        target_exercise_id: change.targetExerciseId,
        adaptation_type: change.adaptationType,
        field_changed: change.fieldChanged,
        original_value: change.originalValue,
        updated_value: change.updatedValue,
        reason: change.reason,
        confidence: change.confidence,
        source: change.source,
        status: accepted ? 'accepted' : 'rejected',
        resolved_at: new Date().toISOString(),
      }));
      const { data, error } = await supabase.from('workout_adaptations').insert(rows).select();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({
        queryKey: ['workoutAdaptations', params.userId, params.programDayId ?? null, params.scheduledWorkoutId ?? null],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Previous exercise performance — "last time you did this" for the live
// workout screen. No equivalent existed anywhere in the app before Phase 3.
// ---------------------------------------------------------------------------

export type PreviousExerciseSet = {
  setNumber: number;
  reps: number;
  loadKg: number | null;
  rpe: number | null;
};

export type PreviousExercisePerformance = {
  loggedAt: string;
  sets: PreviousExerciseSet[];
  bestSet: PreviousExerciseSet | null;
};

async function fetchPreviousExercisePerformance(
  exerciseId: string,
  excludeWorkoutLogId: string | null,
): Promise<PreviousExercisePerformance | null> {
  const { data, error } = await supabase
    .from('workout_log_sets')
    .select('workout_log_id, set_number, reps, load_kg, rpe, logged_at')
    .eq('exercise_id', exerciseId)
    .eq('completed', true)
    .eq('is_warmup', false)
    .order('logged_at', { ascending: false })
    .limit(30);
  if (error) throw error;

  // Fetch a recent batch and group client-side rather than a second query —
  // this table has no per-row "session" boundary column to filter on directly.
  const rows = (data ?? []).filter(row => row.workout_log_id !== excludeWorkoutLogId);
  if (rows.length === 0) return null;

  const lastWorkoutLogId = rows[0].workout_log_id;
  const lastSessionRows = rows
    .filter(row => row.workout_log_id === lastWorkoutLogId)
    .sort((a, b) => a.set_number - b.set_number);

  const sets: PreviousExerciseSet[] = lastSessionRows.map(row => ({
    setNumber: row.set_number,
    reps: row.reps,
    loadKg: row.load_kg,
    rpe: row.rpe,
  }));

  const bestSet = sets.reduce<PreviousExerciseSet | null>((best, current) => {
    if (current.loadKg == null) return best;
    if (best == null || (best.loadKg ?? 0) < current.loadKg) return current;
    return best;
  }, null);

  return { loggedAt: lastSessionRows[0].logged_at, sets, bestSet };
}

export function usePreviousExercisePerformance(
  exerciseId: string | null,
  excludeWorkoutLogId: string | null,
) {
  return useQuery({
    queryKey: ['previousExercisePerformance', exerciseId, excludeWorkoutLogId],
    queryFn: () => fetchPreviousExercisePerformance(exerciseId as string, excludeWorkoutLogId),
    enabled: exerciseId != null,
  });
}

export type PreviousPerformanceSummary = { volumeKg: number; bestE1rm: number };

/** Batched version of the above for the post-workout summary, which needs
 * "last time" data for every exercise in the just-finished session at once —
 * hooks can't be called in a loop, so this is one query instead of N. */
async function fetchPreviousPerformanceForExercises(
  exerciseIds: string[],
  excludeWorkoutLogId: string | null,
): Promise<Record<string, PreviousPerformanceSummary>> {
  if (exerciseIds.length === 0) return {};

  const { data, error } = await supabase
    .from('workout_log_sets')
    .select('workout_log_id, exercise_id, reps, load_kg, logged_at')
    .in('exercise_id', exerciseIds)
    .eq('completed', true)
    .eq('is_warmup', false)
    .order('logged_at', { ascending: false })
    .limit(300);
  if (error) throw error;

  const rows = (data ?? []).filter(row => row.workout_log_id !== excludeWorkoutLogId);

  const lastWorkoutLogIdByExercise = new Map<string, string>();
  for (const row of rows) {
    if (!lastWorkoutLogIdByExercise.has(row.exercise_id)) {
      lastWorkoutLogIdByExercise.set(row.exercise_id, row.workout_log_id);
    }
  }

  const result: Record<string, PreviousPerformanceSummary> = {};
  for (const [exerciseId, workoutLogId] of lastWorkoutLogIdByExercise) {
    const sessionRows = rows.filter(row => row.exercise_id === exerciseId && row.workout_log_id === workoutLogId);
    const volumeKg = sessionRows.reduce((sum, row) => sum + (row.load_kg ?? 0) * row.reps, 0);
    const bestE1rm = sessionRows.reduce(
      (best, row) => (row.load_kg != null ? Math.max(best, estimateOneRepMax(row.load_kg, row.reps)) : best),
      0,
    );
    result[exerciseId] = { volumeKg, bestE1rm };
  }
  return result;
}

export function usePreviousPerformanceForExercises(
  exerciseIds: string[],
  excludeWorkoutLogId: string | null,
) {
  const key = [...exerciseIds].sort().join(',');
  return useQuery({
    queryKey: ['previousPerformanceForExercises', key, excludeWorkoutLogId],
    queryFn: () => fetchPreviousPerformanceForExercises(exerciseIds, excludeWorkoutLogId),
    enabled: exerciseIds.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Set recommendations
// ---------------------------------------------------------------------------

export function useSaveSetRecommendation() {
  return useMutation({
    mutationFn: async (params: {
      userId: string;
      workoutLogId: string;
      exerciseId: string;
      afterSetNumber: number;
      recommendation: SetRecommendation;
      accepted: boolean;
    }) => {
      const insert: SetRecommendationInsert = {
        user_id: params.userId,
        workout_log_id: params.workoutLogId,
        exercise_id: params.exerciseId,
        after_set_number: params.afterSetNumber,
        recommendation_type: params.recommendation.type,
        recommended_reps: params.recommendation.recommendedReps,
        recommended_load_kg: params.recommendation.recommendedLoadKg,
        recommended_rpe: params.recommendation.recommendedRpe,
        recommended_rest_seconds: params.recommendation.recommendedRestSeconds,
        reason: params.recommendation.reason,
        confidence: params.recommendation.confidence,
        source: params.recommendation.source,
        status: params.accepted ? 'accepted' : 'rejected',
        resolved_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('set_recommendations').insert(insert).select().single();
      if (error) throw error;
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Exercise substitutions
// ---------------------------------------------------------------------------

export function useSaveExerciseSubstitution() {
  return useMutation({
    mutationFn: async (params: {
      userId: string;
      workoutLogId: string | null;
      originalExerciseId: string;
      substitution: ExerciseSubstitution;
      scope: 'workout_only' | 'permanent';
    }) => {
      const insert: ExerciseSubstitutionInsert = {
        user_id: params.userId,
        workout_log_id: params.workoutLogId,
        original_exercise_id: params.originalExerciseId,
        substitute_exercise_id: params.substitution.exerciseId,
        reason: params.substitution.reason,
        confidence: params.substitution.confidence,
        scope: params.scope,
      };
      const { data, error } = await supabase.from('exercise_substitutions').insert(insert).select().single();
      if (error) throw error;
      return data;
    },
  });
}
