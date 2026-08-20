import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { syncOuraMetrics } from '../edgeFunctions';
import type { Database } from '../../../types/database';

type OuraMetricsRow = Database['public']['Tables']['oura_metrics']['Row'];

export async function fetchLatestOuraMetrics(userId: string): Promise<OuraMetricsRow | null> {
  const { data, error } = await supabase
    .from('oura_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('metric_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Cheap direct read of the last-synced row — this is the primary path the
 * Stats screen renders from, so a visit never blocks on a live Oura API
 * round-trip. Pair with useSyncOuraMetrics to refresh it in the background.
 */
export function useOuraMetrics(userId: string | null) {
  return useQuery({
    queryKey: ['ouraMetrics', userId],
    queryFn: () => fetchLatestOuraMetrics(userId as string),
    enabled: userId != null,
    staleTime: 2 * 60 * 1000,
  });
}

async function fetchOuraMetricsRange(userId: string, from: string, to: string): Promise<OuraMetricsRow[]> {
  const { data, error } = await supabase
    .from('oura_metrics')
    .select('*')
    .eq('user_id', userId)
    .gte('metric_date', from)
    .lte('metric_date', to)
    .order('metric_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * A trailing window of raw rows, same range-query shape as
 * useWhoopMetricsRange / fetchReadinessCheckinsInRange (coaching.ts).
 * useOuraMetrics above only ever reads the single latest row.
 */
export function useOuraMetricsRange(userId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['ouraMetrics', 'range', userId, from, to],
    queryFn: () => fetchOuraMetricsRange(userId as string, from, to),
    enabled: userId != null,
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Triggers a live Oura sync (token refresh + API fetch + upsert) and
 * invalidates useOuraMetrics's cache on success so the cheap read picks up
 * the fresh row. Meant to run in the background (e.g. on screen focus) — a
 * failure here should never block rendering, since a cached row is already
 * showing.
 */
export function useSyncOuraMetrics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => syncOuraMetrics().then(result => ({ userId, result })),
    onSuccess: ({ userId }) => {
      queryClient.invalidateQueries({ queryKey: ['ouraMetrics', userId] });
    },
  });
}
