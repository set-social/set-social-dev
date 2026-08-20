import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { PrForecastCard } from './PrForecastCard';
import type { PrPrediction } from '../../services/coaching';
import type { UnitPreference } from '../../types/database';

type StatsRailProps = {
  prediction: PrPrediction | null;
  unitPref: UnitPreference;
};

/** Home's stats tier — the PR forecast card, still owning its own gating.
 * Used to also carry the merged weight/consistency/streak vitals card (see
 * VitalsTile) — that's moved into MoreForYouCard's row list instead, so
 * this only ever renders one card now. Kept as its own component rather
 * than inlining PrForecastCard directly into TodayScreen, since it's still
 * a meaningful "Home's stats tier" grouping a future stat could rejoin. */
export function StatsRail({ prediction, unitPref }: StatsRailProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <PrForecastCard prediction={prediction} unitPref={unitPref} />
    </View>
  );
}
