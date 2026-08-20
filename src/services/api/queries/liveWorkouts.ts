import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchPublicProfiles, type PublicProfile } from './community';

const POLL_MS = 30_000;

export type LiveFriendWorkout = {
  friend: PublicProfile;
  workoutLogId: string;
  startedAt: string;
  workoutTitle: string;
  exerciseId: string;
  exerciseName: string;
  setsDone: number;
  bestLoadKg: number | null;
  bestReps: number | null;
  prLoadKg: number | null;
  prReps: number | null;
  atYourGym: boolean;
};

/** live_friend_workouts() isn't in the generated Database['public']['Functions']
 * type (see the comment above Functions in database.ts), so this RPC call is
 * typed locally — same pattern nearby_checkins() uses in location.ts. Casts
 * `supabase` itself, not an extracted `.rpc` reference, for the same reason
 * documented there (rpc() needs `this` bound to the client). */
type LiveWorkoutRow = {
  friend_id: string;
  workout_log_id: string;
  started_at: string;
  workout_title: string;
  exercise_id: string;
  exercise_name: string;
  sets_done: number;
  best_load_kg: number | null;
  best_reps: number | null;
  pr_load_kg: number | null;
  pr_reps: number | null;
  at_your_gym: boolean;
};

async function fetchLiveFriendWorkouts(): Promise<LiveFriendWorkout[]> {
  const client = supabase as unknown as {
    rpc: (fn: 'live_friend_workouts') => Promise<{ data: LiveWorkoutRow[] | null; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc('live_friend_workouts');
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const profiles = await fetchPublicProfiles(rows.map(row => row.friend_id));
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));

  return rows
    .map(row => {
      const friend = profileById.get(row.friend_id);
      if (!friend) return null;
      return {
        friend,
        workoutLogId: row.workout_log_id,
        startedAt: row.started_at,
        workoutTitle: row.workout_title,
        exerciseId: row.exercise_id,
        exerciseName: row.exercise_name,
        setsDone: row.sets_done,
        bestLoadKg: row.best_load_kg,
        bestReps: row.best_reps,
        prLoadKg: row.pr_load_kg,
        prReps: row.pr_reps,
        atYourGym: row.at_your_gym,
      } satisfies LiveFriendWorkout;
    })
    .filter((row): row is LiveFriendWorkout => row != null)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function useLiveFriendWorkouts(userId: string | null) {
  return useQuery({
    queryKey: ['liveFriendWorkouts', userId],
    queryFn: fetchLiveFriendWorkouts,
    enabled: userId != null,
    refetchInterval: userId != null ? POLL_MS : false,
  });
}
