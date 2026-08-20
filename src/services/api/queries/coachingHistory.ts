import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import type { PostWorkoutSummaryResult } from '../../coaching';

// Coaching History, Phase 1 — see docs/coaching-history.md. Persists exactly
// the PostWorkoutSummaryResult WorkoutSummaryScreen already computes and
// shows once at completion — no dedicated test file here, same precedent
// whoop.ts/oura.ts/integrations.ts already set (thin query-layer files;
// coverage comes through the screens that use them instead).

export type CoachingSummaryRow = {
  id: string;
  workoutLogId: string;
  createdAt: string;
  summary: PostWorkoutSummaryResult;
};

function toCoachingSummaryRow(row: {
  id: string;
  workout_log_id: string;
  created_at: string;
  summary: unknown;
}): CoachingSummaryRow {
  return {
    id: row.id,
    workoutLogId: row.workout_log_id,
    createdAt: row.created_at,
    summary: row.summary as PostWorkoutSummaryResult,
  };
}

/** Write-once — `workout_log_id` is unique in the schema, so a second call
 * for the same workout throws rather than silently duplicating. Called
 * from WorkoutSummaryScreen's onSave, right after completeWorkoutLog
 * succeeds; never blocks navigation away from that screen on failure (see
 * the call site's own comment) — a missed write here just means that one
 * workout has no history entry, not a broken save. */
export function useSaveCoachingSummary() {
  return useMutation({
    mutationFn: async (params: { userId: string; workoutLogId: string; summary: PostWorkoutSummaryResult }) => {
      const { error } = await supabase.from('coaching_summaries').insert({
        user_id: params.userId,
        workout_log_id: params.workoutLogId,
        summary: params.summary,
      });
      if (error) throw error;
    },
  });
}

/** All-time, newest first, no pagination — same convention
 * ProgressTimelineScreen already uses at this app's data scale (see
 * docs/ai-coaching.md), flagged there to revisit if it ever becomes a real
 * problem; same posture here. */
export function useCoachingSummaries(userId: string | null) {
  return useQuery({
    queryKey: ['coachingSummaries', userId],
    queryFn: async (): Promise<CoachingSummaryRow[]> => {
      const { data, error } = await supabase
        .from('coaching_summaries')
        .select('id, workout_log_id, created_at, summary')
        .eq('user_id', userId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toCoachingSummaryRow);
    },
    enabled: userId != null,
  });
}

/** Single persisted summary for CoachingSummaryDetailScreen, keyed by the
 * workout it belongs to (workout_log_id is unique, so this is always at
 * most one row). */
export function useCoachingSummary(workoutLogId: string | null) {
  return useQuery({
    queryKey: ['coachingSummary', workoutLogId],
    queryFn: async (): Promise<CoachingSummaryRow | null> => {
      const { data, error } = await supabase
        .from('coaching_summaries')
        .select('id, workout_log_id, created_at, summary')
        .eq('workout_log_id', workoutLogId as string)
        .maybeSingle();
      if (error) throw error;
      return data ? toCoachingSummaryRow(data) : null;
    },
    enabled: workoutLogId != null,
  });
}
