import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import type { Database, CardioEffort } from '../../../types/database';
import type { RoutePoint } from '../../../utils/routeMetrics';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

async function fetchCardioActivities(): Promise<ExerciseRow[]> {
  const { data, error } = await supabase.from('exercises').select('*').eq('category', 'cardio').order('name');
  if (error) throw error;
  return data ?? [];
}

/** The activity picker's source — seeded library rows (Treadmill, Bike,
 * ...) plus any user-created custom cardio exercises. A one-off activity
 * doesn't need to go through this at all — see `useSaveCardioLog`'s
 * `customActivityName` path, which skips the exercise library entirely. */
export function useCardioActivities() {
  return useQuery({
    queryKey: ['exercises', 'cardio'],
    queryFn: fetchCardioActivities,
  });
}

/**
 * One-shot save — creates and completes the workout_logs row in the same
 * mutation, rather than an in-progress row created on mount and finished
 * later the way strength sessions work. A cardio log has no multi-step
 * interior state worth resuming, and this sidesteps the whole
 * delete-then-resurrect bug class strength sessions needed real guards for
 * (see ActiveWorkoutOverviewScreen) by construction — there's never a
 * window where a route target outlives the row it pointed to.
 */
/** The route data a GPS-tracked session (LiveCardioTrackingScreen ->
 * CardioRunSummaryScreen) adds on top of what a manual entry already
 * fills in — see docs/gps-cardio.md's data-model section. Optional: a
 * manual entry passes no `route` at all, and every field below stays
 * exactly as it was before this pass. */
export type CardioRoutePayload = {
  points: RoutePoint[];
  avgPaceSecPerKm: number | null;
  bestPaceSecPerKm: number | null;
};

export function useSaveCardioLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      userId: string;
      programDayId?: string | null;
      exerciseId?: string | null;
      customActivityName?: string | null;
      durationMinutes: number;
      inclinePct?: number | null;
      speedKmh?: number | null;
      distanceKm?: number | null;
      effort?: CardioEffort | null;
      estimatedCalories: number;
      /** ISO timestamp for the day this session actually happened on —
       * defaults to now. Needed so logging a past day's cardio (e.g. from
       * the Training tab's weekly calendar) doesn't get stamped with
       * today's date. */
      completedAt?: string;
      /** Present only for a live-tracked session — see CardioRoutePayload. */
      route?: CardioRoutePayload;
    }) => {
      const completedAt = params.completedAt ?? new Date().toISOString();
      const { data: workoutLog, error: workoutLogError } = await supabase
        .from('workout_logs')
        .insert({
          user_id: params.userId,
          program_day_id: params.programDayId ?? null,
          started_at: completedAt,
          completed_at: completedAt,
        })
        .select()
        .single();
      if (workoutLogError) throw workoutLogError;

      const { data: cardioEntry, error: cardioError } = await supabase
        .from('cardio_log_entries')
        .insert({
          user_id: params.userId,
          workout_log_id: workoutLog.id,
          exercise_id: params.exerciseId ?? null,
          custom_activity_name: params.customActivityName ?? null,
          duration_minutes: params.durationMinutes,
          incline_pct: params.inclinePct ?? null,
          speed_kmh: params.speedKmh ?? null,
          distance_km: params.distanceKm ?? null,
          effort: params.effort ?? null,
          estimated_calories: params.estimatedCalories,
          has_route: params.route != null,
          avg_pace_sec_per_km: params.route?.avgPaceSecPerKm ?? null,
          best_pace_sec_per_km: params.route?.bestPaceSecPerKm ?? null,
        })
        .select()
        .single();
      if (cardioError) throw cardioError;

      if (params.route != null && params.route.points.length > 0) {
        const { error: routeError } = await supabase.from('cardio_route_points').insert(
          params.route.points.map((point, seq) => ({
            cardio_log_entry_id: cardioEntry.id,
            seq,
            latitude: point.latitude,
            longitude: point.longitude,
            recorded_at: new Date(point.recordedAt).toISOString(),
            elevation_meters: point.elevationMeters ?? null,
          })),
        );
        if (routeError) throw routeError;
      }

      return workoutLog;
    },
    onSuccess: () => {
      // Same key useCompleteWorkoutLog invalidates — Today/streak/Progress
      // all resolve "is this day done" from useWorkoutLogsInRange, matched
      // by completed_at's calendar date, not by table/kind.
      queryClient.invalidateQueries({ queryKey: ['workoutLogs'] });
    },
  });
}
