import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import { useTabBarScrollHandler } from '../../navigation/tabBarScroll';
import {
  Text,
  StatTile,
  Card,
  TrendChart,
  SegmentedControl,
  ListRow,
  LoadingState,
  LockedFeatureCard,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import {
  useLoggedSets,
  computePrEvents,
  computeStrengthTrend,
  computeE1rmTrend,
  computeE1rmHistories,
  previousPeriodWindow,
  totalVolumeInWindow,
  bestE1rmInWindow,
  totalVolumeThisMonth,
  prsThisMonth,
  type StrengthTrendRange,
} from '../../services/api/queries/progress';
import { coachingEngine } from '../../services/coaching';
import { featureFlags } from '../../config/featureFlags';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatVolume, formatWeight, unitLabel } from '../../utils/units';
import type {
  ProgressStackParamList,
  RootStackParamList,
} from '../../navigation/types';
import { useIntegrationConnections } from '../../services/api/queries/integrations';
import { useSyncWhoopMetrics } from '../../services/api/queries/whoop';
import { useSyncOuraMetrics } from '../../services/api/queries/oura';
import { WhoopMetricsSection } from './WhoopMetricsSection';
import { OuraMetricsSection } from './OuraMetricsSection';
import { MuscleHeatMap } from './MuscleHeatMap';

type Nav = NativeStackNavigationProp<ProgressStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

const STRENGTH_TREND_RANGE_OPTIONS: {
  value: StrengthTrendRange;
  label: string;
}[] = [
  { value: '1w', label: '1W' },
  { value: '2w', label: '2W' },
  { value: '1m', label: '1M' },
  { value: 'ytd', label: 'YTD' },
];

type StrengthMetric = 'volume' | 'e1rm';

const STRENGTH_METRIC_OPTIONS: { value: StrengthMetric; label: string }[] = [
  { value: 'volume', label: 'Volume' },
  { value: 'e1rm', label: 'Est. 1RM' },
];

const STRENGTH_TREND_RANGE_LABEL: Record<StrengthTrendRange, string> = {
  '1w': 'last 7 days',
  '2w': 'last 14 days',
  '1m': 'last 30 days',
  ytd: 'year to date',
};

const STRENGTH_TREND_DELTA_LABEL: Record<StrengthTrendRange, string> = {
  '1w': 'vs previous 7 days',
  '2w': 'vs previous 14 days',
  '1m': 'vs previous 30 days',
  ytd: 'vs this time last year',
};

export function ProgressDashboardScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<RootNav>();
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const isPremium = profile?.is_premium ?? false;
  const { data: sets, isLoading, refetch } = useLoggedSets(userId);
  const unitPref = useUnitPreference();
  const { data: integrationConnections } = useIntegrationConnections(userId);
  const isWhoopConnected =
    integrationConnections?.some(
      c => c.provider === 'whoop' && c.access_token != null,
    ) ?? false;
  const isOuraConnected =
    integrationConnections?.some(
      c => c.provider === 'oura' && c.access_token != null,
    ) ?? false;
  const syncWhoopMetrics = useSyncWhoopMetrics();
  const syncOuraMetrics = useSyncOuraMetrics();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Fire-and-forget, same as WhoopMetricsSection/OuraMetricsSection's own
    // focus-triggered sync — a slow or failed wearable round-trip shouldn't
    // hold up the rest of the pull-to-refresh. Each mutation's onSuccess
    // invalidates its own query, which the matching section reads from.
    if (isWhoopConnected && userId) {
      syncWhoopMetrics.mutate(userId);
    }
    if (isOuraConnected && userId) {
      syncOuraMetrics.mutate(userId);
    }
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [
    refetch,
    isWhoopConnected,
    isOuraConnected,
    userId,
    syncWhoopMetrics,
    syncOuraMetrics,
  ]);

  const events = useMemo(() => (sets ? computePrEvents(sets) : []), [sets]);
  const [strengthTrendRange, setStrengthTrendRange] =
    useState<StrengthTrendRange>('1w');
  const [strengthMetric, setStrengthMetric] = useState<StrengthMetric>('volume');

  const volumeTrend = useMemo(
    () => (sets ? computeStrengthTrend(sets, strengthTrendRange) : []),
    [sets, strengthTrendRange],
  );
  const e1rmTrend = useMemo(
    () => (sets ? computeE1rmTrend(sets, strengthTrendRange) : []),
    [sets, strengthTrendRange],
  );
  const strengthTrendDates =
    strengthMetric === 'volume' ? volumeTrend.map(w => w.date) : e1rmTrend.map(w => w.date);
  const strengthTrendPoints =
    strengthMetric === 'volume' ? volumeTrend.map(w => w.volume) : e1rmTrend.map(w => w.e1rm);

  // "vs previous period" needs the *whole* set history, not just the points
  // already bucketed for the visible window — this is a fresh scan of
  // `sets` over the immediately-preceding window (or the same YTD range
  // last year), computed independently of what's currently on screen.
  const strengthTrendDelta = useMemo(() => {
    if (!sets) return null;
    const now = new Date();
    const { start: prevStart, end: prevEnd } = previousPeriodWindow(strengthTrendRange, now);
    if (strengthMetric === 'volume') {
      const current = volumeTrend.reduce((sum, w) => sum + w.volume, 0);
      const previous = totalVolumeInWindow(sets, prevStart, prevEnd);
      if (current === 0 && previous === 0) return null;
      return { current, previous, label: STRENGTH_TREND_DELTA_LABEL[strengthTrendRange] };
    }
    const current = e1rmTrend.reduce((max, w) => Math.max(max, w.e1rm), 0);
    const previous = bestE1rmInWindow(sets, prevStart, prevEnd);
    if (current === 0 && previous === 0) return null;
    return { current, previous, label: STRENGTH_TREND_DELTA_LABEL[strengthTrendRange] };
  }, [sets, strengthTrendRange, strengthMetric, volumeTrend, e1rmTrend]);

  const volumeThisMonth = sets ? totalVolumeThisMonth(sets) : 0;
  const prCountThisMonth = prsThisMonth(events);
  const recentPrs = [...events].reverse().slice(0, 5);

  const topPrediction = useMemo(() => {
    if (!sets) return null;
    const predictions = coachingEngine.predictPersonalRecords({
      exerciseHistories: computeE1rmHistories(sets),
      asOf: format(new Date(), 'yyyy-MM-dd'),
      unitPref,
    });
    return predictions[0] ?? null;
  }, [sets, unitPref]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        {...tabBarScrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent.primary}
          />
        }
      >
        <Text variant="title">Stats</Text>

        <WhoopMetricsSection userId={userId} />
        <OuraMetricsSection userId={userId} />

        {isLoading ? (
          <LoadingState fill={false} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <StatTile
                  label="Volume This Month"
                  value={`${formatVolume(
                    volumeThisMonth,
                    unitPref,
                  )} ${unitLabel(unitPref)}`}
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatTile label="PRs This Month" value={prCountThisMonth} />
              </View>
            </View>

            <MuscleHeatMap />

            {isPremium ? (
              <Card variant="elevated">
                <Text variant="subtitle">Strength trend</Text>
                <Text
                  variant="caption"
                  color="secondary"
                  style={{ marginTop: 2 }}
                >
                  {strengthMetric === 'volume' ? 'Training volume' : 'Estimated 1-rep max'},{' '}
                  {STRENGTH_TREND_RANGE_LABEL[strengthTrendRange]}
                </Text>
                <View style={{ marginTop: theme.spacing.sm, gap: theme.spacing.xs }}>
                  <SegmentedControl
                    options={STRENGTH_TREND_RANGE_OPTIONS}
                    value={strengthTrendRange}
                    onChange={setStrengthTrendRange}
                  />
                  <SegmentedControl
                    options={STRENGTH_METRIC_OPTIONS}
                    value={strengthMetric}
                    onChange={setStrengthMetric}
                  />
                </View>
                <View style={{ marginTop: theme.spacing.md }}>
                  <TrendChart
                    points={strengthTrendPoints}
                    dates={strengthTrendDates}
                    deltaVsPrevious={strengthTrendDelta}
                    valueFormatter={value =>
                      strengthMetric === 'volume'
                        ? `${formatVolume(value, unitPref)} ${unitLabel(unitPref)}`
                        : `${formatWeight(value, unitPref)} ${unitLabel(unitPref)}`
                    }
                    emptyLabel="Log a few workouts to see your trend"
                  />
                </View>
              </Card>
            ) : (
              <LockedFeatureCard
                title="Strength trend"
                description="See your training volume trend over time."
                onUpgrade={() =>
                  rootNavigation.navigate('Paywall', { trigger: 'analytics' })
                }
              />
            )}

            <Card variant="elevated" style={{ gap: 0 }}>
              <Text
                variant="subtitle"
                style={{ marginBottom: theme.spacing.xs }}
              >
                Recent PRs
              </Text>
              {recentPrs.length === 0 ? (
                <Text variant="body" color="secondary">
                  No PRs yet — log some heavy sets to see them here.
                </Text>
              ) : (
                recentPrs.map((event, index) => (
                  <ListRow
                    key={`${event.exerciseId}-${event.loggedAt}`}
                    title={event.exerciseName}
                    subtitle={format(new Date(event.loggedAt), 'MMM d')}
                    trailing={
                      <Text variant="body" color="secondary">
                        {formatWeight(event.loadKg, unitPref)}
                        {unitLabel(unitPref)} × {event.reps}
                      </Text>
                    }
                    onPress={() =>
                      navigation.navigate('PRDetail', {
                        exerciseId: event.exerciseId,
                      })
                    }
                    style={
                      index > 0
                        ? {
                            borderTopWidth: 1,
                            borderTopColor: theme.colors.border.subtle,
                          }
                        : undefined
                    }
                  />
                ))
              )}
            </Card>

            {topPrediction ? (
              <Card variant="elevated" style={{ gap: theme.spacing.xs }}>
                <ListRow
                  title="Future You"
                  subtitle={topPrediction.summary}
                  showChevron
                  onPress={() =>
                    navigation.navigate('PRDetail', {
                      exerciseId: topPrediction.exerciseId,
                    })
                  }
                />
              </Card>
            ) : null}

            <Card variant="elevated" style={{ gap: 0 }}>
              <ListRow
                title="Body Metrics"
                showChevron
                onPress={() => navigation.navigate('BodyMetrics')}
              />
              <ListRow
                title="Progress Timeline"
                icon={isPremium ? undefined : 'lock'}
                showChevron
                onPress={() =>
                  isPremium
                    ? navigation.navigate('ProgressTimeline')
                    : rootNavigation.navigate('Paywall', {
                        trigger: 'analytics',
                      })
                }
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              />
              {featureFlags.coachingHistory ? (
                <ListRow
                  title="Coaching History"
                  icon={isPremium ? undefined : 'lock'}
                  showChevron
                  onPress={() =>
                    isPremium
                      ? navigation.navigate('CoachingHistory')
                      : rootNavigation.navigate('Paywall', {
                          trigger: 'analytics',
                        })
                  }
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border.subtle,
                  }}
                />
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
