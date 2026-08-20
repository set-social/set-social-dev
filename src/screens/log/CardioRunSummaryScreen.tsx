import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { MAP_PROVIDER } from '../../utils/mapProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import { Text, Card, Button, Numeral } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useActiveCardioStore, computeElapsedSeconds } from '../../store/activeCardioStore';
import { useCardioActivities, useSaveCardioLog } from '../../services/api/queries/cardioLogs';
import { useLatestBodyWeight } from '../../services/api/queries/bodyMetrics';
import { useProfile } from '../../services/api/queries/profiles';
import { estimateCardioCalories } from '../../utils/cardioCalories';
import {
  computeDistanceKm,
  computePaceSecPerKm,
  computeSplits,
  bestSplit,
  formatDuration,
  formatPace,
} from '../../utils/routeMetrics';
import type { ProgramsStackParamList, RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

/** Reads entirely from activeCardioStore — same "screen reads the active
 * session store, no route params" pattern WorkoutSummaryScreen uses for
 * store.exercises. Save flows into the exact same useSaveCardioLog
 * mutation LogCardioScreen's manual form uses, just with a `route` payload
 * attached — see docs/gps-cardio.md's "Post-run screen" section. */
export function CardioRunSummaryScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<RootNav>();
  const userId = useAuthStore(state => state.userId);

  const source = useActiveCardioStore(state => state.source);
  const activityKey = useActiveCardioStore(state => state.activityKey);
  const exerciseId = useActiveCardioStore(state => state.exerciseId);
  const customActivityName = useActiveCardioStore(state => state.customActivityName);
  const points = useActiveCardioStore(state => state.points);
  const startedAt = useActiveCardioStore(state => state.startedAt);
  const pausedAt = useActiveCardioStore(state => state.pausedAt);
  const pausedMs = useActiveCardioStore(state => state.pausedMs);
  const finishedAt = useActiveCardioStore(state => state.finishedAt);
  const reset = useActiveCardioStore(state => state.reset);
  const discardSession = useActiveCardioStore(state => state.discardSession);

  const { data: activities } = useCardioActivities();
  const { data: latestWeightKg } = useLatestBodyWeight(userId);
  const { data: profile } = useProfile(userId);
  const saveCardioLog = useSaveCardioLog();
  const [sharing, setSharing] = useState(false);

  const activityLabel =
    customActivityName ?? activities?.find(a => a.id === exerciseId)?.name ?? 'Outdoor Run';

  const durationSeconds = computeElapsedSeconds({ startedAt, pausedAt, pausedMs, finishedAt });
  const distanceKm = computeDistanceKm(points);
  const avgPaceSecPerKm = computePaceSecPerKm(distanceKm, durationSeconds);
  const splits = useMemo(() => computeSplits(points, 1), [points]);
  const fastestSplit = bestSplit(splits);

  const estimatedCalories = useMemo(() => {
    if (!activityKey || !latestWeightKg || durationSeconds <= 0) return null;
    return estimateCardioCalories({
      activity: activityKey,
      durationMinutes: durationSeconds / 60,
      weightKg: latestWeightKg,
      sex: profile?.sex,
    });
  }, [activityKey, durationSeconds, latestWeightKg, profile?.sex]);

  const canSave = userId != null && activityKey != null && durationSeconds > 0 && estimatedCalories != null;

  const onDiscard = () => {
    Alert.alert('Discard this run?', 'Your route and stats will not be saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          discardSession();
          navigation.popToTop();
        },
      },
    ]);
  };

  const onSave = async () => {
    if (!canSave || !userId || !activityKey || estimatedCalories == null) return;
    try {
      await saveCardioLog.mutateAsync({
        userId,
        programDayId: source?.programDayId ?? null,
        exerciseId,
        customActivityName,
        durationMinutes: durationSeconds / 60,
        distanceKm,
        estimatedCalories,
        completedAt: source?.date
          ? new Date(`${source.date}T12:00:00`).toISOString()
          : undefined,
        route: {
          points,
          avgPaceSecPerKm,
          bestPaceSecPerKm: fastestSplit?.paceSecPerKm ?? null,
        },
      });
      reset();
      rootNavigation.navigate('MainTabs', { screen: 'TodayTab', params: { screen: 'Today' } });
    } catch (err) {
      Alert.alert('Could not save run', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  const onShare = () => {
    // Reuses the existing DM workout-share flow rather than a new post
    // type — see docs/gps-cardio.md's "Sharing" section for why a
    // Community route-post is deferred to Phase 3.
    if (sharing) return;
    setSharing(true);
    rootNavigation.navigate('MainTabs', {
      screen: 'ProgramsTab',
      params: {
        screen: 'ShareWorkout',
        params: {
          shareType: 'single_workout',
          title: activityLabel,
          payload: {
            workout: {
              name: activityLabel,
              notes: `${distanceKm.toFixed(2)} km · ${formatDuration(durationSeconds)} · ${formatPace(avgPaceSecPerKm)}/km`,
              estimatedDurationMinutes: Math.round(durationSeconds / 60),
              exercises: [],
            },
          },
        },
      },
    });
    setSharing(false);
  };

  const region =
    points.length > 0
      ? { latitude: points[0].latitude, longitude: points[0].longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }
      : { latitude: 0, longitude: 0, latitudeDelta: 0.01, longitudeDelta: 0.01 };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
        }}
      >
        <Text variant="title">Run Summary</Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
        }}
      >
        <View
          style={{
            height: 200,
            borderRadius: theme.radii.lg,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.border.subtle,
          }}
          testID="summary-map-container"
        >
          <MapView style={{ flex: 1 }} provider={MAP_PROVIDER} initialRegion={region} scrollEnabled={false} zoomEnabled={false}>
            {points.length > 1 ? (
              <Polyline
                coordinates={points.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
                strokeColor={theme.colors.accent.primary}
                strokeWidth={4}
              />
            ) : null}
            {points.length > 0 ? (
              <>
                <Marker coordinate={{ latitude: points[0].latitude, longitude: points[0].longitude }} title="Start" />
                <Marker
                  coordinate={{
                    latitude: points[points.length - 1].latitude,
                    longitude: points[points.length - 1].longitude,
                  }}
                  title="Finish"
                  pinColor={theme.colors.accent.orange}
                />
              </>
            ) : null}
          </MapView>
        </View>

        <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
          <Text variant="label" color="secondary">
            SESSION STATS
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Numeral value={distanceKm.toFixed(2)} size="md" />
              <Text variant="caption" color="tertiary">
                Km
              </Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Numeral value={formatDuration(durationSeconds)} size="md" />
              <Text variant="caption" color="tertiary">
                Duration
              </Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Numeral value={formatPace(avgPaceSecPerKm)} size="md" />
              <Text variant="caption" color="tertiary">
                Avg /km
              </Text>
            </View>
          </View>
        </Card>

        {splits.length > 0 ? (
          <Card variant="elevated" style={{ gap: theme.spacing.xs }}>
            <Text variant="label" color="secondary">
              SPLITS
            </Text>
            {splits.map(split => (
              <View
                key={split.index}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: theme.spacing.xs,
                  borderBottomWidth: split.index === splits.length ? 0 : 1,
                  borderBottomColor: theme.colors.border.subtle,
                }}
              >
                <Text variant="body" color="secondary">
                  {split.index}
                </Text>
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {formatPace(split.paceSecPerKm)}
                </Text>
                {fastestSplit != null && split.index === fastestSplit.index ? (
                  <Text variant="caption" style={{ color: theme.colors.accent.primary, fontWeight: '700' }}>
                    BEST
                  </Text>
                ) : (
                  <View />
                )}
              </View>
            ))}
          </Card>
        ) : null}

        {estimatedCalories != null ? (
          <Card
            variant="elevated"
            style={{ alignItems: 'center', gap: theme.spacing.xs, paddingVertical: theme.spacing.lg }}
          >
            <Text variant="label" color="secondary">
              ARNOLD'S ESTIMATE
            </Text>
            <Text variant="display">{estimatedCalories}</Text>
            <Text variant="body" color="secondary">
              calories burned
            </Text>
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Button label="Share" variant="secondary" onPress={onShare} style={{ flex: 1 }} />
          <Button label="Save Session" onPress={onSave} disabled={!canSave} loading={saveCardioLog.isPending} style={{ flex: 1 }} />
        </View>
        <Button label="Discard" variant="ghost" onPress={onDiscard} />
      </ScrollView>
    </SafeAreaView>
  );
}

