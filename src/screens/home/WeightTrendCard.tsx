import React from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, Text } from '../../components/core';
import { useWeightTrend } from './useWeightTrend';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight, unitLabel } from '../../utils/units';
import type { RootStackParamList } from '../../navigation/types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;

const SPARKLINE_POINTS = 10;
const SPARKLINE_WIDTH = 72;
const SPARKLINE_HEIGHT = 32;
const TREND_WINDOW_DAYS = 30;

/** Body-weight trend has its own full-history screen (BodyMetricsScreen) but
 * zero presence on Home — this surfaces the same useWeightTrend data
 * (windowed to the last 30 days) as a small card, same tap target/nav as
 * BodyMetricsScreen. Home's compact vitals summary (StatsRail) reads the
 * same hook directly rather than rendering this card, since it needs the
 * value without the sparkline. */
export function WeightTrendCard({ userId }: { userId: string | null }) {
  const theme = useTheme();
  const rootNavigation = useNavigation<RootNav>();
  const unitPref = useUnitPreference();
  const trend = useWeightTrend(userId);

  if (!trend) return null;

  const { latestWeightKg, deltaKg, windowed } = trend;

  const points = windowed.slice(-SPARKLINE_POINTS);
  const values = points.map(p => p.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const svgPoints = points
    .map((p, index) => {
      const x = points.length > 1 ? (index / (points.length - 1)) * SPARKLINE_WIDTH : SPARKLINE_WIDTH / 2;
      const y = SPARKLINE_HEIGHT - ((p.weightKg - min) / range) * SPARKLINE_HEIGHT;
      return `${x},${y}`;
    })
    .join(' ');

  const deltaLabel =
    deltaKg === 0
      ? 'No change'
      : `${deltaKg > 0 ? '+' : '-'}${formatWeight(Math.abs(deltaKg), unitPref)} ${unitLabel(unitPref)} / ${TREND_WINDOW_DAYS}d`;

  const goToBodyMetrics = () =>
    rootNavigation.navigate('MainTabs', { screen: 'ProgressTab', params: { screen: 'BodyMetrics' } });

  return (
    <Pressable onPress={goToBodyMetrics} accessibilityRole="button">
      <Card variant="elevated" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Svg width={SPARKLINE_WIDTH} height={SPARKLINE_HEIGHT} viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}>
          <Polyline points={svgPoints} fill="none" stroke={theme.colors.accent.primary} strokeWidth={2.5} />
        </Svg>
        <View style={{ flex: 1 }}>
          <Text variant="subtitle">
            {formatWeight(latestWeightKg, unitPref)} {unitLabel(unitPref)}
          </Text>
          <Text variant="caption" color="secondary">
            {deltaLabel}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}
