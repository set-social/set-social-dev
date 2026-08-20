import { useMemo } from 'react';
import { useBodyMetrics } from '../../services/api/queries/bodyMetrics';

const TREND_WINDOW_DAYS = 30;

export type WeightTrendPoint = { weightKg: number; loggedAt: string };

export type WeightTrend = {
  latestWeightKg: number;
  deltaKg: number;
  /** Last SPARKLINE_POINTS-worth of windowed readings, oldest first — kept
   * here (not just latest/delta) so a sparkline renderer doesn't need its
   * own copy of the same 30-day windowing logic. */
  windowed: WeightTrendPoint[];
};

/** Shared windowing/delta math behind both the full trend card
 * (WeightTrendCard) and Home's compact vitals summary (StatsRail) — one
 * source of truth for "what counts as the current trend" so the two
 * surfaces can't drift apart. Returns null when there's fewer than two
 * readings in the last 30 days, same threshold both surfaces gate on. */
export function useWeightTrend(userId: string | null): WeightTrend | null {
  const { data: metrics } = useBodyMetrics(userId);

  return useMemo(() => {
    if (!metrics || metrics.length === 0) return null;
    const cutoff = Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const windowed = metrics
      .filter(m => new Date(m.logged_at).getTime() >= cutoff)
      .map(m => ({ weightKg: m.weight_kg, loggedAt: m.logged_at }));
    if (windowed.length < 2) return null;

    const latest = windowed[windowed.length - 1];
    const first = windowed[0];

    return { latestWeightKg: latest.weightKg, deltaKg: latest.weightKg - first.weightKg, windowed };
  }, [metrics]);
}
