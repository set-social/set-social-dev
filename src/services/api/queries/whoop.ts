import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { syncWhoopMetrics } from '../edgeFunctions';
import type { Database } from '../../../types/database';

type WhoopMetricsRow = Database['public']['Tables']['whoop_metrics']['Row'];

export async function fetchLatestWhoopMetrics(userId: string): Promise<WhoopMetricsRow | null> {
  const { data, error } = await supabase
    .from('whoop_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('cycle_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Cheap direct read of the last-synced row — this is the primary path the
 * Stats screen renders from, so a visit never blocks on a live Whoop API
 * round-trip. Pair with useSyncWhoopMetrics to refresh it in the background.
 */
export function useWhoopMetrics(userId: string | null) {
  return useQuery({
    queryKey: ['whoopMetrics', userId],
    queryFn: () => fetchLatestWhoopMetrics(userId as string),
    enabled: userId != null,
    staleTime: 2 * 60 * 1000,
  });
}

async function fetchWhoopMetricsRange(userId: string, from: string, to: string): Promise<WhoopMetricsRow[]> {
  const { data, error } = await supabase
    .from('whoop_metrics')
    .select('*')
    .eq('user_id', userId)
    .gte('cycle_date', from)
    .lte('cycle_date', to)
    .order('cycle_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * A trailing window of raw rows — the only reader of hrv_ms/resting_heart_rate
 * anywhere in the app (see RecoveryStoryLine, Home). useWhoopMetrics above
 * only ever reads the single latest row, which is all the Stats rings need;
 * a trend line needs the history behind it. Same range-query shape as
 * fetchReadinessCheckinsInRange (coaching.ts).
 */
export function useWhoopMetricsRange(userId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['whoopMetrics', 'range', userId, from, to],
    queryFn: () => fetchWhoopMetricsRange(userId as string, from, to),
    enabled: userId != null,
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Triggers a live Whoop sync (token refresh + API fetch + upsert) and
 * invalidates useWhoopMetrics's cache on success so the cheap read picks up
 * the fresh row. Meant to run in the background (e.g. on screen focus) — a
 * failure here should never block rendering, since a cached row is already
 * showing.
 */
export function useSyncWhoopMetrics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => syncWhoopMetrics().then(result => ({ userId, result })),
    onSuccess: ({ userId }) => {
      queryClient.invalidateQueries({ queryKey: ['whoopMetrics', userId] });
    },
  });
}
