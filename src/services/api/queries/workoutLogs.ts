import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import type { CardioEffort, Database } from '../../../types/database';

type WorkoutLogInsert = Database['public']['Tables']['workout_logs']['Insert'];
type WorkoutLogSetInsert = Database['public']['Tables']['workout_log_sets']['Insert'];

export type CardioLogSummary = {
  activityName: string;
  durationMinutes: number;
  distanceKm: number | null;
  effort: CardioEffort | null;
  estimatedCalories: number;
  /** Present only for a GPS-tracked session (LiveCardioTrackingScreen) —
   * null for a manually-entered distance/duration. See docs/gps-cardio.md. */
  avgPaceSecPerKm: number | null;
  hasRoute: boolean;
};

export type WorkoutLogSummary = {
  id: string;
  programDayId: string | null;
  scheduledWorkoutId: string | null;
  startedAt: string;
  completedAt: string;
  /** Non-null when this log came from LogCardioScreen rather than a
   * strength session — see cardio_log_entries, a 1:1 side table keyed by
   * workout_log_id. */
  cardio: CardioLogSummary | null;
  /** Persisted once at completion time for a strength session (see
   * WorkoutSummaryScreen/useCompleteWorkoutLog) — null for a cardio session
   * (whose estimate lives on `cardio` instead) or a log saved before this
   * existed. Feeds computeDailyEnergyTotals's per-session strength burn. */
  estimatedCalories: number | null;
};

type WorkoutLogRangeRow = {
  id: string;
  program_day_id: string | null;
  scheduled_workout_id: string | null;
  started_at: string;
  completed_at: string;
  estimated_calories: number | null;
  cardio_log_entries: Array<{
    duration_minutes: number;
    distance_km: number | null;
    effort: CardioEffort | null;
    estimated_calories: number;
    custom_activity_name: string | null;
    avg_pace_sec_per_km: number | null;
    has_route: boolean;
    exercises: { name: string } | null;
  }>;
};

/** Completed workout_logs within a date range (inclusive), keyed by
 * completed_at — used by the Home calendar, streak, and weekly-consistency
 * ring so they all read from the same single fetch. */
async function fetchWorkoutLogsInRange(
  userId: string,
  from: string,
  to: string,
): Promise<WorkoutLogSummary[]> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select(
      `id, program_day_id, scheduled_workout_id, started_at, completed_at, estimated_calories,
      cardio_log_entries ( duration_minutes, distance_km, effort, estimated_calories, custom_activity_name, avg_pace_sec_per_km, has_route, exercises ( name ) )`,
    )
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', from)
    .lte('completed_at', to)
    .order('completed_at');

  if (error) throw error;
  return (data as unknown as WorkoutLogRangeRow[]).map(row => {
    const cardioEntry = row.cardio_log_entries[0] ?? null;
    return {
      id: row.id,
      programDayId: row.program_day_id,
      scheduledWorkoutId: row.scheduled_workout_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      cardio: cardioEntry
        ? {
            activityName: cardioEntry.custom_activity_name ?? cardioEntry.exercises?.name ?? 'Cardio',
            durationMinutes: cardioEntry.duration_minutes,
            distanceKm: cardioEntry.distance_km,
            effort: cardioEntry.effort,
            estimatedCalories: cardioEntry.estimated_calories,
            avgPaceSecPerKm: cardioEntry.avg_pace_sec_per_km,
            hasRoute: cardioEntry.has_route,
          }
        : null,
      estimatedCalories: row.estimated_calories,
    };
  });
}

export function useWorkoutLogsInRange(userId: string | null, range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['workoutLogs', 'range', userId, range.from, range.to],
    queryFn: () => fetchWorkoutLogsInRange(userId as string, range.from, range.to),
    enabled: userId != null,
  });
}

export type CompletedWorkoutLog = {
  id: string;
  completedAt: string;
  title: string;
  rating: number | null;
};

type WorkoutLogWithTitleRow = {
  id: string;
  completed_at: string;
  rating: number | null;
  program_days: { title: string | null } | null;
  scheduled_workouts: { name: string } | null;
};

/** Every completed workout_log ever, for the progress timeline — the only
 * other workout-log hook is range-bounded. Matches the "just fetch it all"
 * convention useLoggedSets/useBodyMetrics already use for all-time data. */
async function fetchAllWorkoutLogs(userId: string): Promise<CompletedWorkoutLog[]> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('id, completed_at, rating, program_days ( title ), scheduled_workouts ( name )')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as WorkoutLogWithTitleRow[];
  return rows.map(row => ({
    id: row.id,
    completedAt: row.completed_at,
    title: row.program_days?.title ?? row.scheduled_workouts?.name ?? 'Workout',
    rating: row.rating,
  }));
}

export function useAllWorkoutLogs(userId: string | null) {
  return useQuery({
    queryKey: ['workoutLogs', 'all', userId],
    queryFn: () => fetchAllWorkoutLogs(userId as string),
    enabled: userId != null,
  });
}

export type WorkoutLogSetDetail = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  reps: number;
  loadKg: number | null;
  rpe: number | null;
  durationSeconds: number | null;
  isWarmup: boolean;
};

export type WorkoutLogDetail = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  title: string;
  sets: WorkoutLogSetDetail[];
  /** Non-null when this log is a cardio session (LogCardioScreen /
   * LiveCardioTrackingScreen) rather than a strength one — `sets` is always
   * `[]` in that case. See "Add a Run" (docs/mockups/day-plus-run.html):
   * a day can have one workout_log of each kind, and this is what lets
   * WorkoutLogSection/WorkoutLogSummarySection render the cardio one as a
   * run card instead of an empty exercise list. */
  cardio: CardioLogSummary | null;
};

type WorkoutLogDetailRow = {
  id: string;
  started_at: string;
  completed_at: string | null;
  program_days: { title: string | null } | null;
  scheduled_workouts: { name: string } | null;
  workout_log_sets: Array<{
    id: string;
    exercise_id: string;
    exercises: { name: string } | null;
    set_number: number;
    reps: number;
    load_kg: number | null;
    rpe: number | null;
    duration_seconds: number | null;
    is_warmup: boolean;
  }>;
  cardio_log_entries: Array<{
    duration_minutes: number;
    distance_km: number | null;
    effort: CardioEffort | null;
    estimated_calories: number;
    custom_activity_name: string | null;
    avg_pace_sec_per_km: number | null;
    has_route: boolean;
    exercises: { name: string } | null;
  }>;
};

/** Full per-exercise/per-set breakdown for a single workout_log — the "lean
 * list, full detail by id" split this codebase uses everywhere else
 * (templates, programs): useWorkoutLogsInRange already gives Today the
 * day's workout_log id(s); this is the detail fetch once a completed-day
 * card is actually opened. */
async function fetchWorkoutLogDetail(workoutLogId: string): Promise<WorkoutLogDetail> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select(
      `id, started_at, completed_at,
      program_days ( title ),
      scheduled_workouts ( name ),
      workout_log_sets (
        id, exercise_id, set_number, reps, load_kg, rpe, duration_seconds, is_warmup,
        exercises ( name )
      ),
      cardio_log_entries (
        duration_minutes, distance_km, effort, estimated_calories, custom_activity_name,
        avg_pace_sec_per_km, has_route, exercises ( name )
      )`,
    )
    .eq('id', workoutLogId)
    .order('set_number', { foreignTable: 'workout_log_sets' })
    .single();
  if (error) throw error;

  const row = data as unknown as WorkoutLogDetailRow;
  const cardioEntry = row.cardio_log_entries[0] ?? null;
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    title:
      row.program_days?.title ??
      row.scheduled_workouts?.name ??
      (cardioEntry ? cardioEntry.custom_activity_name ?? cardioEntry.exercises?.name ?? 'Cardio' : 'Workout'),
    sets: row.workout_log_sets.map(s => ({
      id: s.id,
      exerciseId: s.exercise_id,
      exerciseName: s.exercises?.name ?? 'Exercise',
      setNumber: s.set_number,
      reps: s.reps,
      loadKg: s.load_kg,
      rpe: s.rpe,
      durationSeconds: s.duration_seconds,
      isWarmup: s.is_warmup,
    })),
    cardio: cardioEntry
      ? {
          activityName: cardioEntry.custom_activity_name ?? cardioEntry.exercises?.name ?? 'Cardio',
          durationMinutes: cardioEntry.duration_minutes,
          distanceKm: cardioEntry.distance_km,
          effort: cardioEntry.effort,
          estimatedCalories: cardioEntry.estimated_calories,
          avgPaceSecPerKm: cardioEntry.avg_pace_sec_per_km,
          hasRoute: cardioEntry.has_route,
        }
      : null,
  };
}

export function useWorkoutLogDetail(workoutLogId: string | undefined) {
  return useQuery({
    queryKey: ['workoutLogDetail', workoutLogId],
    queryFn: () => fetchWorkoutLogDetail(workoutLogId as string),
    enabled: workoutLogId != null,
  });
}

export function useStartWorkoutLog() {
  return useMutation({
    mutationFn: async (params: {
      userId: string;
      programDayId?: string | null;
      scheduledWorkoutId?: string | null;
      variantType?: Database['public']['Tables']['workout_logs']['Row']['variant_type'];
    }) => {
      const insert: WorkoutLogInsert = {
        user_id: params.userId,
        program_day_id: params.programDayId ?? null,
        scheduled_workout_id: params.scheduledWorkoutId ?? null,
        variant_type: params.variantType ?? null,
      };
      const { data, error } = await supabase
        .from('workout_logs')
        .insert(insert)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useLogSet() {
  return useMutation({
    mutationFn: async (set: WorkoutLogSetInsert) => {
      const { data, error } = await supabase
        .from('workout_log_sets')
        .insert(set)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  });
}

/** During an in-progress workout (ActiveExerciseScreen) callers don't need
 * this invalidation — Zustand state drives that screen, not the query cache
 * — but editing a *past* workout's sets (the completed-day flip card) reads
 * this same data from the cache, so it needs to be kept fresh. Harmless for
 * the in-progress case: an extra background refetch of already-correct data. */
export function useUpdateSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      reps?: number;
      load_kg?: number | null;
      rpe?: number | null;
      duration_seconds?: number | null;
      completed?: boolean;
    }) => {
      const { id, ...patch } = params;
      const { data, error } = await supabase
        .from('workout_log_sets')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loggedSets'] });
      queryClient.invalidateQueries({ queryKey: ['workoutLogDetail'] });
    },
  });
}

export function useDeleteSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workout_log_sets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loggedSets'] });
      queryClient.invalidateQueries({ queryKey: ['workoutLogDetail'] });
    },
  });
}

export function useCompleteWorkoutLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      workoutLogId: string;
      overallRpe?: number;
      notes?: string;
      rating?: number;
      /** From estimateStrengthSessionCalories, computed by the caller
       * (WorkoutSummaryScreen) off this session's actual duration/volume and
       * the athlete's body stats — persisted as-is so it's reused verbatim
       * everywhere this session's burn is counted (see
       * computeDailyEnergyTotals's StrengthSessionEnergyInput). Omitted for
       * a cardio session, whose estimate already lives on cardio_log_entries. */
      estimatedCalories?: number | null;
    }) => {
      const { data, error } = await supabase
        .from('workout_logs')
        .update({
          completed_at: new Date().toISOString(),
          overall_rpe: params.overallRpe,
          notes: params.notes,
          rating: params.rating,
          estimated_calories: params.estimatedCalories,
        })
        .eq('id', params.workoutLogId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    // Every screen that shows "is today done" or a completed-day summary
    // (Today, streak/weekly-progress, Progress) reads from these two query
    // families with a 30s staleTime — without invalidating them here, a
    // freshly-completed workout doesn't visibly appear as done until that
    // window lapses or something else happens to trigger a refetch.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutLogs'] });
      queryClient.invalidateQueries({ queryKey: ['loggedSets'] });
      // Own device's "Live Now" read (a friend viewing themselves in the
      // rail isn't a real scenario, but this keeps the cache honest either
      // way) — friends on other devices pick up the completion via
      // liveFriendWorkouts' own 30s poll instead, since invalidating a
      // local cache key can't reach another device.
      queryClient.invalidateQueries({ queryKey: ['liveFriendWorkouts'] });
      // leaderboard_stats aggregates off workout_logs.completed_at — without
      // this, your own volume/workout count on the Leaderboard stays frozen
      // at whatever it was on last screen mount until the 30s staleTime lapses.
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}

/** Cascades to workout_log_sets/exercise_substitutions/set_recommendations
 * (all `on delete cascade` from workout_logs.id) — no manual cleanup needed.
 * Same invalidation set as useCompleteWorkoutLog, for the same reason: Today/
 * streak/Progress all read from these two query families. */
export function useDeleteWorkoutLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workout_logs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutLogs'] });
      queryClient.invalidateQueries({ queryKey: ['loggedSets'] });
      queryClient.invalidateQueries({ queryKey: ['liveFriendWorkouts'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}
