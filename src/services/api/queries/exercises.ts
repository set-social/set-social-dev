import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { classifyExerciseMuscles } from '../edgeFunctions';
import type { ExerciseDefaultMetric } from '../../../types/database';

/** Best-effort: classifies one just-created exercise's muscle group and
 * writes it over the 'Custom' placeholder — run detached (not awaited) from
 * useCreateExercise's onSuccess so "Add Exercise" never waits on an LLM
 * round-trip. A failure here just leaves the exercise as 'Custom' for the
 * next useBackfillCustomExerciseMuscles pass to pick up. */
async function classifyAndApplyMuscle(exerciseId: string, name: string, queryClient: QueryClient) {
  try {
    const { classifications } = await classifyExerciseMuscles([name]);
    const match = classifications.find(c => c.index === 0);
    if (!match) return;
    const { data, error } = await supabase
      .from('exercises')
      .update({ primary_muscle: match.primaryMuscle })
      .eq('id', exerciseId)
      .select()
      .single();
    if (error) throw error;
    queryClient.setQueryData(['exercise', exerciseId], data);
    queryClient.invalidateQueries({ queryKey: ['exercises'] });
  } catch (err) {
    console.warn('Could not classify custom exercise muscle group', err);
  }
}

async function fetchExercises(search: string) {
  let query = supabase.from('exercises').select('*').order('name');
  if (search.trim()) {
    query = query.ilike('name', `%${search.trim()}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function useExercises(search: string) {
  return useQuery({
    queryKey: ['exercises', search],
    queryFn: () => fetchExercises(search),
  });
}

async function fetchExercise(exerciseId: string) {
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
    .eq('id', exerciseId)
    .single();
  if (error) throw error;
  return data;
}

export function useExercise(exerciseId: string) {
  return useQuery({
    queryKey: ['exercise', exerciseId],
    queryFn: () => fetchExercise(exerciseId),
    enabled: !!exerciseId,
  });
}

/** Custom exercises only need a name + tracked unit + optional demo video
 * from the user — the rest of the (DB-required) library fields get a
 * generic default since they only drive filtering/discovery for the
 * curated library, not a user's own private exercise. */
export function useCreateExercise(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      name: string;
      defaultMetric: ExerciseDefaultMetric;
      demoMediaUrl: string | null;
    }) => {
      if (!userId) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('exercises')
        .insert({
          name: params.name,
          category: 'full_body',
          primary_muscle: 'Custom',
          equipment: 'other',
          is_custom: true,
          created_by: userId,
          default_metric: params.defaultMetric,
          demo_media_url: params.demoMediaUrl,
          demo_media_type: params.demoMediaUrl ? 'video' : null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: created => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      void classifyAndApplyMuscle(created.id, created.name, queryClient);
    },
  });
}

// Module-level (not per-component-instance) so it throttles real network
// calls to classify-exercise-muscle app-wide, not per screen. MuscleHeatMap
// fires this same hook's mutation on every screen focus — with no cooldown,
// normal tab-switching (Stats <-> Training <-> back) could call it a dozen+
// times in a few minutes, which is
// enough to exhaust the edge function's own guardrail
// (AI_CLASSIFY_MUSCLE_RATE_LIMIT_USER_PER_HOUR, default 30/user/hour — see
// supabase/functions/classify-exercise-muscle/index.ts). Once that guardrail
// rejects a call, the mutation just fails silently (no onError before this
// change) and the same up-to-30 rows keep getting re-selected and re-failing
// every focus for the rest of the hour, which reads to the athlete as
// classification being permanently stuck rather than rate-limited.
const BACKFILL_COOLDOWN_MS = 5 * 60 * 1000;
let lastBackfillAttemptAt = 0;

/** Finds this user's custom exercises still sitting on the 'Custom'
 * placeholder and classifies them in one batch call via AI
 * (classify-exercise-muscle) — the backfill path for exercises created
 * before auto-classification existed, or ones whose creation-time classify
 * (see useCreateExercise) failed. Meant to run as a fire-and-forget
 * background pass on screen focus (MuscleHeatMap), same non-blocking shape
 * as WhoopMetricsSection's background sync — throttled by
 * BACKFILL_COOLDOWN_MS so repeated focus events don't hammer the endpoint. */
export function useBackfillCustomExerciseMuscles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      if (Date.now() - lastBackfillAttemptAt < BACKFILL_COOLDOWN_MS) return;
      lastBackfillAttemptAt = Date.now();

      const { data: pending, error } = await supabase
        .from('exercises')
        .select('id, name')
        .eq('created_by', userId)
        .eq('is_custom', true)
        .eq('primary_muscle', 'Custom')
        .limit(30);
      if (error) throw error;
      if (!pending || pending.length === 0) return;

      const { classifications } = await classifyExerciseMuscles(pending.map(p => p.name));
      const updates = classifications
        .map(c => ({ row: pending[c.index], primaryMuscle: c.primaryMuscle }))
        .filter((u): u is { row: { id: string; name: string }; primaryMuscle: string } => u.row != null);

      await Promise.all(
        updates.map(({ row, primaryMuscle }) =>
          supabase.from('exercises').update({ primary_muscle: primaryMuscle }).eq('id', row.id),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
    },
    // Was previously silent — a rate-limit or edge-function failure looked
    // identical to "hasn't run yet" from the UI's side, with nothing in the
    // console to tell a developer which one it actually was.
    onError: err => {
      console.warn('Custom exercise muscle backfill failed', err);
    },
  });
}

/** Owner-only edit of a custom exercise (RLS: `exercises_update_own_custom`). */
export function useUpdateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      exerciseId: string;
      name: string;
      defaultMetric: ExerciseDefaultMetric;
      demoMediaUrl: string | null;
    }) => {
      const { data, error } = await supabase
        .from('exercises')
        .update({
          name: params.name,
          default_metric: params.defaultMetric,
          demo_media_url: params.demoMediaUrl,
          demo_media_type: params.demoMediaUrl ? 'video' : null,
        })
        .eq('id', params.exerciseId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: updated => {
      queryClient.setQueryData(['exercise', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
    },
  });
}
