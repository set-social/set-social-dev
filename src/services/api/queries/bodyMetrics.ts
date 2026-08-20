import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';

type BodyMetricRow = Database['public']['Tables']['body_metrics']['Row'];

async function fetchBodyMetrics(userId: string): Promise<BodyMetricRow[]> {
  const { data, error } = await supabase
    .from('body_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export function useBodyMetrics(userId: string | null) {
  return useQuery({
    queryKey: ['bodyMetrics', userId],
    queryFn: () => fetchBodyMetrics(userId as string),
    enabled: userId != null,
  });
}

async function fetchLatestBodyWeight(userId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('body_metrics')
    .select('weight_kg')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.weight_kg ?? null;
}

/** Just the one number LogCardioScreen's calorie estimate needs — a
 * dedicated query rather than reading the tail of useBodyMetrics' full
 * history, which BodyMetricsScreen actually needs for its trend chart. */
export function useLatestBodyWeight(userId: string | null) {
  return useQuery({
    queryKey: ['bodyMetrics', 'latest', userId],
    queryFn: () => fetchLatestBodyWeight(userId as string),
    enabled: userId != null,
  });
}

export function useLogBodyMetric(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { weightKg: number; notes?: string | null }) => {
      if (!userId) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('body_metrics')
        // One row per user per LOCAL day — logging again today overwrites
        // today's entry. Must be the device's calendar day, not UTC's:
        // toISOString() truncation would misfile an entry logged near
        // midnight local time onto the wrong side of the unique
        // (user_id, logged_at) constraint, silently overwriting a different
        // day's weight instead of creating a new one.
        .upsert(
          {
            user_id: userId,
            logged_at: format(new Date(), 'yyyy-MM-dd'),
            weight_kg: params.weightKg,
            notes: params.notes ?? null,
          },
          { onConflict: 'user_id,logged_at' },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bodyMetrics', userId] });
      // Not a prefix of the key above ('latest' sits where userId does not),
      // so it needs its own invalidation call.
      queryClient.invalidateQueries({ queryKey: ['bodyMetrics', 'latest', userId] });
    },
  });
}
