import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  StatTile,
  TrendChart,
  Header,
  LoadingState,
  LockedFeatureCard,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import {
  useLoggedSets,
  computePrEvents,
  computeE1rmHistories,
} from '../../services/api/queries/progress';
import { coachingEngine } from '../../services/coaching';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight, unitLabel } from '../../utils/units';
import type {
  ProgressStackParamList,
  RootStackParamList,
} from '../../navigation/types';

type Route = RouteProp<ProgressStackParamList, 'PRDetail'>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

export function PRDetailScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const rootNavigation = useNavigation<RootNav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const isPremium = profile?.is_premium ?? false;
  const { data: sets, isLoading } = useLoggedSets(userId);
  const unitPref = useUnitPreference();

  const exerciseEvents = useMemo(() => {
    if (!sets) return [];
    return computePrEvents(sets).filter(
      e => e.exerciseId === params.exerciseId,
    );
  }, [sets, params.exerciseId]);

  const prediction = useMemo(() => {
    if (!sets) return null;
    const predictions = coachingEngine.predictPersonalRecords({
      exerciseHistories: computeE1rmHistories(sets),
      asOf: format(new Date(), 'yyyy-MM-dd'),
      unitPref,
    });
    return predictions.find(p => p.exerciseId === params.exerciseId) ?? null;
  }, [sets, params.exerciseId, unitPref]);

  const exerciseName = exerciseEvents[0]?.exerciseName ?? 'Exercise';
  const current = exerciseEvents[exerciseEvents.length - 1];

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title={exerciseName} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
        }}
      >
        {isLoading ? (
          <LoadingState fill={false} />
        ) : !current ? (
          <Card variant="elevated">
            <Text variant="body" color="secondary">
              No recorded sets with weight for this exercise yet.
            </Text>
          </Card>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <StatTile
                  label="Best Est. 1RM"
                  value={`${formatWeight(current.e1rm, unitPref)} ${unitLabel(
                    unitPref,
                  )}`}
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatTile
                  label="Best Set"
                  value={`${formatWeight(current.loadKg, unitPref)}${unitLabel(
                    unitPref,
                  )}×${current.reps}`}
                />
              </View>
            </View>

            {isPremium ? (
              <Card variant="elevated">
                <Text variant="subtitle">Est. 1RM progression</Text>
                <View style={{ marginTop: theme.spacing.md }}>
                  <TrendChart points={exerciseEvents.map(e => e.e1rm)} />
                </View>
              </Card>
            ) : (
              <LockedFeatureCard
                title="Est. 1RM progression"
                description="See how this lift has trended over time."
                onUpgrade={() =>
                  rootNavigation.navigate('Paywall', { trigger: 'analytics' })
                }
              />
            )}

            {prediction ? (
              <Card variant="elevated" style={{ gap: theme.spacing.xs }}>
                <Text variant="subtitle">Future You</Text>
                <Text variant="body" color="secondary">
                  {prediction.summary}
                </Text>
              </Card>
            ) : null}

            {isPremium ? (
              <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
                <Text variant="subtitle">PR history</Text>
                {[...exerciseEvents].reverse().map((event, index) => (
                  <View
                    key={`${event.loggedAt}-${index}`}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: theme.spacing.xs,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: theme.colors.border.subtle,
                    }}
                  >
                    <Text variant="body" color="secondary">
                      {format(new Date(event.loggedAt), 'MMM d, yyyy')}
                    </Text>
                    <Text variant="body">
                      {formatWeight(event.loadKg, unitPref)}
                      {unitLabel(unitPref)} × {event.reps} (
                      {formatWeight(event.e1rm, unitPref)} {unitLabel(unitPref)}{' '}
                      e1RM)
                    </Text>
                  </View>
                ))}
              </Card>
            ) : (
              <LockedFeatureCard
                title="Full PR history"
                description="Every recorded PR for this exercise, not just your current best."
                onUpgrade={() =>
                  rootNavigation.navigate('Paywall', { trigger: 'analytics' })
                }
              />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
