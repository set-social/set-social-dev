import React, { useEffect, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, Text, Icon, ListRow } from '../../components/core';
import { useWhoopMetricsRange } from '../../services/api/queries/whoop';

const BASELINE_WINDOW_DAYS = 30;
// Baseline day count, not counting the latest day being compared against it
// — below this, a "vs. your baseline" claim isn't backed by enough history
// to say anything meaningful.
const MIN_BASELINE_POINTS = 5;

type RecoveryStoryLineProps = {
  userId: string | null;
  /** Renders as a ListRow inside MoreForYouCard instead of the standalone
   * card, for Home's "collapse everything into one card" layout. */
  asRow?: boolean;
  /** Fired whenever this decides to show or hide itself — see
   * GymProximityPill's identical prop for why. */
  onVisibilityChange?: (visible: boolean) => void;
};

/** The one place hrv_ms actually gets read anywhere in this app — every
 * Whoop sync captures it into whoop_metrics and nothing has ever displayed
 * it (see whoop.ts). Compares the most recent scored day's HRV against the
 * average of the rest of the trailing 30-day window. Home's only Whoop
 * surface — the full recovery/sleep/strain rings (WhoopMetricsSection) live
 * on the Progress tab, not here. */
export function RecoveryStoryLine({ userId, asRow, onVisibilityChange }: RecoveryStoryLineProps) {
  const theme = useTheme();
  const today = useMemo(() => new Date(), []);
  const from = useMemo(() => format(subDays(today, BASELINE_WINDOW_DAYS), 'yyyy-MM-dd'), [today]);
  const to = useMemo(() => format(today, 'yyyy-MM-dd'), [today]);
  const { data: rows } = useWhoopMetricsRange(userId, from, to);

  const story = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const scored = rows.filter(row => row.score_state === 'SCORED' && row.hrv_ms != null);
    if (scored.length < MIN_BASELINE_POINTS + 1) return null;

    const latest = scored[scored.length - 1];
    const baseline = scored.slice(0, -1);
    const baselineAvg = baseline.reduce((sum, row) => sum + (row.hrv_ms ?? 0), 0) / baseline.length;
    if (baselineAvg <= 0 || latest.hrv_ms == null) return null;

    const pctChange = ((latest.hrv_ms - baselineAvg) / baselineAvg) * 100;
    const roundedPct = Math.round(Math.abs(pctChange));
    if (roundedPct === 0) return null;
    const isUp = pctChange > 0;

    return {
      isUp,
      text: isUp
        ? `HRV up ${roundedPct}% vs your ${BASELINE_WINDOW_DAYS}-day baseline — your body's adapting well to this block.`
        : `HRV down ${roundedPct}% vs your ${BASELINE_WINDOW_DAYS}-day baseline — might be worth an easier session today.`,
    };
  }, [rows]);

  useEffect(() => {
    onVisibilityChange?.(story != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story != null]);

  if (!story) return null;

  const icon = story.isUp ? 'trendingUp' : 'trendingDown';
  const color = story.isUp ? theme.colors.accent.primary : theme.colors.semantic.warning;

  if (asRow) {
    return (
      <ListRow
        leading={<Icon name={icon} size="sm" color={color} />}
        title={story.text}
      />
    );
  }

  return (
    <Card variant="elevated" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
      <Icon name={icon} size="sm" color={color} />
      <Text variant="caption" color="secondary" style={{ flex: 1 }}>
        {story.text}
      </Text>
    </Card>
  );
}
