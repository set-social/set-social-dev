import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, StatTileBody } from '../../components/core';
import { useWeightTrend } from './useWeightTrend';
import { useFriendConsistencyPercentile } from '../../services/api/queries/community';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight, unitLabel } from '../../utils/units';
import type { RootStackParamList } from '../../navigation/types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;

const TREND_WINDOW_DAYS = 30;

type VitalsTileProps = {
  userId: string | null;
  streak: number;
  /** Renders as a bare row inside MoreForYouCard instead of its own Card,
   * for Home's "collapse everything into one card" layout — same
   * asRow/onVisibilityChange contract RecoveryStoryLine/GymProximityPill/
   * WeeklyReviewTeaserCard already use. */
  asRow?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
};

/** Weight, friend consistency, and streak used to be three separate
 * fixed-width StatTile chips in StatsRail — same shape, but each in its own
 * bordered/shadowed card, which reads as uneven and cluttered side by side.
 * This merges them into one row as evenly flexed columns divided by hairline
 * rules, including only whichever of the three actually have data today
 * (skipping the whole tile only if none do — e.g. a brand new account with
 * no weight logs, no friends, and no streak yet). */
export function VitalsTile({ userId, streak, asRow, onVisibilityChange }: VitalsTileProps) {
  const theme = useTheme();
  const rootNavigation = useNavigation<RootNav>();
  const unitPref = useUnitPreference();
  const trend = useWeightTrend(userId);
  const { data: percentile } = useFriendConsistencyPercentile(userId);

  const goToBodyMetrics = () =>
    rootNavigation.navigate('MainTabs', { screen: 'ProgressTab', params: { screen: 'BodyMetrics' } });

  const segments: { key: string; content: React.ReactNode }[] = [];

  if (trend) {
    const deltaLabel =
      trend.deltaKg === 0
        ? 'No change'
        : `${trend.deltaKg > 0 ? '+' : '-'}${formatWeight(Math.abs(trend.deltaKg), unitPref)} ${unitLabel(unitPref)} / ${TREND_WINDOW_DAYS}d`;
    segments.push({
      key: 'weight',
      content: (
        <Pressable onPress={goToBodyMetrics} accessibilityRole="button" style={{ flex: 1 }}>
          <StatTileBody
            label="Weight"
            value={`${formatWeight(trend.latestWeightKg, unitPref)} ${unitLabel(unitPref)}`}
            trend={{ direction: trend.deltaKg > 0 ? 'up' : trend.deltaKg < 0 ? 'down' : 'flat', label: deltaLabel }}
          />
        </Pressable>
      ),
    });
  }

  if (percentile != null) {
    segments.push({
      key: 'consistency',
      content: (
        <View style={{ flex: 1 }}>
          <StatTileBody label="Consistency" value={`${percentile}%`} trend={{ direction: 'flat', label: 'vs. friends' }} />
        </View>
      ),
    });
  }

  if (streak > 0) {
    segments.push({
      key: 'streak',
      content: (
        <View style={{ flex: 1 }}>
          <StatTileBody label="Streak" value={`${streak} day${streak === 1 ? '' : 's'}`} />
        </View>
      ),
    });
  }

  useEffect(() => {
    onVisibilityChange?.(segments.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.length > 0]);

  if (segments.length === 0) return null;

  const row = (
    <>
      {segments.map((segment, index) => (
        <React.Fragment key={segment.key}>
          {index > 0 ? (
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.colors.border.subtle }} />
          ) : null}
          {segment.content}
        </React.Fragment>
      ))}
    </>
  );

  if (asRow) {
    return <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>{row}</View>;
  }

  return <Card variant="elevated" style={{ flexDirection: 'row', alignItems: 'flex-start' }}>{row}</Card>;
}
