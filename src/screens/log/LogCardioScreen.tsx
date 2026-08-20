import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
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
  Button,
  Header,
  TextField,
  SelectableCard,
  SegmentedControl,
  LoadingState,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useCardioActivities,
  useSaveCardioLog,
} from '../../services/api/queries/cardioLogs';
import {
  useLatestBodyWeight,
  useLogBodyMetric,
} from '../../services/api/queries/bodyMetrics';
import { useProfile } from '../../services/api/queries/profiles';
import {
  estimateCardioCalories,
  type CardioActivityKey,
  type CardioEffort,
} from '../../utils/cardioCalories';
import type {
  ProgramsStackParamList,
  RootStackParamList,
} from '../../navigation/types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;
type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type Route = RouteProp<ProgramsStackParamList, 'LogCardio'>;

type EntryMode = 'manual' | 'live';

/** Only outdoor, GPS-trackable activities offer live tracking — a
 * treadmill/bike/rower/stairmaster session happens indoors, where GPS is
 * meaningless. See docs/gps-cardio.md's "Entry point" section. */
function supportsLiveTracking(key: CardioActivityKey | null): boolean {
  return key === 'run' || key === 'walk' || key === 'bike';
}

/** Maps the seeded cardio exercise-library rows (see migration 0040) to the
 * calorie utility's activity key — name-based since there's no dedicated
 * column for it and eight rows doesn't justify one. An exercise that isn't
 * in this map (a future user-created custom cardio exercise, say) still
 * works: it just estimates like 'custom'. */
const ACTIVITY_KEY_BY_NAME: Record<string, CardioActivityKey> = {
  Treadmill: 'treadmill',
  'Stationary Bike': 'bike',
  Elliptical: 'elliptical',
  'Rowing Machine': 'row',
  Stairmaster: 'stairmaster',
  'Outdoor Run': 'run',
  'Outdoor Walk': 'walk',
  Swimming: 'swim',
};

const EFFORT_OPTIONS: { value: CardioEffort; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'hard', label: 'Hard' },
];

const ENTRY_MODE_OPTIONS: { value: EntryMode; label: string }[] = [
  { value: 'manual', label: 'Enter Manually' },
  { value: 'live', label: 'Track Live' },
];

function showsInclineSpeed(key: CardioActivityKey | null): boolean {
  return key === 'treadmill';
}
function showsDistance(key: CardioActivityKey | null): boolean {
  return key === 'run' || key === 'walk' || key === 'bike' || key === 'row';
}
function showsEffort(key: CardioActivityKey | null): boolean {
  return key != null && key !== 'treadmill';
}

function parseNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Turns a 'yyyy-MM-dd' route param into a timestamp that lands on that
 * calendar date locally — noon avoids any DST-boundary edge cases that
 * midnight could hit. */
function completedAtForDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

export function LogCardioScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const rootNavigation = useNavigation<RootNav>();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);

  const { data: activities, isLoading: activitiesLoading } =
    useCardioActivities();
  const { data: latestWeightKg, isLoading: weightLoading } =
    useLatestBodyWeight(userId);
  const { data: profile } = useProfile(userId);
  const logBodyMetric = useLogBodyMetric(userId);
  const saveCardioLog = useSaveCardioLog();

  const isLoggingPastDay =
    params?.date != null && params.date !== format(new Date(), 'yyyy-MM-dd');

  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [customActivityName, setCustomActivityName] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>('manual');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [inclinePct, setInclinePct] = useState('');
  const [speedKmh, setSpeedKmh] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [effort, setEffort] = useState<CardioEffort | null>(null);
  const [weightInput, setWeightInput] = useState('');

  const selectedActivity =
    (activities ?? []).find(a => a.id === exerciseId) ?? null;
  const activityKey: CardioActivityKey | null = isCustom
    ? 'custom'
    : selectedActivity
    ? ACTIVITY_KEY_BY_NAME[selectedActivity.name] ?? 'custom'
    : null;

  const durationValue = parseNumber(durationMinutes);
  const inclineValue = parseNumber(inclinePct);
  const speedValue = parseNumber(speedKmh);
  const distanceValue = parseNumber(distanceKm);

  const estimatedCalories = useMemo(() => {
    if (!activityKey || !durationValue || !latestWeightKg) return null;
    return estimateCardioCalories({
      activity: activityKey,
      durationMinutes: durationValue,
      inclinePct: inclineValue,
      speedKmh: speedValue,
      effort: effort ?? undefined,
      weightKg: latestWeightKg,
      sex: profile?.sex,
    });
  }, [
    activityKey,
    durationValue,
    inclineValue,
    speedValue,
    effort,
    latestWeightKg,
    profile?.sex,
  ]);

  const canSave =
    (isCustom ? customActivityName.trim().length > 0 : exerciseId != null) &&
    durationValue != null &&
    durationValue > 0 &&
    latestWeightKg != null &&
    estimatedCalories != null;

  const onSaveWeight = async () => {
    const parsed = parseNumber(weightInput);
    if (!parsed || parsed <= 0) return;
    try {
      await logBodyMetric.mutateAsync({ weightKg: parsed });
      setWeightInput('');
    } catch (err) {
      Alert.alert(
        'Could not save weight',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const onSave = async () => {
    if (
      !userId ||
      !canSave ||
      estimatedCalories == null ||
      durationValue == null
    )
      return;
    try {
      await saveCardioLog.mutateAsync({
        userId,
        programDayId: params?.programDayId,
        exerciseId: isCustom ? null : exerciseId,
        customActivityName: isCustom ? customActivityName.trim() : null,
        durationMinutes: durationValue,
        inclinePct: inclineValue ?? null,
        speedKmh: speedValue ?? null,
        distanceKm: distanceValue ?? null,
        effort,
        estimatedCalories,
        completedAt: params?.date ? completedAtForDate(params.date) : undefined,
      });
      rootNavigation.navigate('MainTabs', {
        screen: 'TodayTab',
        params: { screen: 'Today' },
      });
    } catch (err) {
      Alert.alert(
        'Could not save session',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const onStartTracking = () => {
    if (!activityKey || isCustom || exerciseId == null) return;
    navigation.navigate('LiveCardioTracking', {
      programDayId: params?.programDayId,
      date: params?.date,
      activityKey,
      exerciseId,
      customActivityName: null,
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Log Cardio" />
      <KeyboardAvoider>
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            paddingBottom: theme.spacing.lg + tabBarHeight,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {isLoggingPastDay && params?.date ? (
            <Text variant="caption" color="secondary">
              Logging for{' '}
              {format(new Date(completedAtForDate(params.date)), 'EEEE, MMM d')}
            </Text>
          ) : null}
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              ACTIVITY
            </Text>
            {activitiesLoading ? (
              <LoadingState fill={false} />
            ) : (
              <View style={{ gap: theme.spacing.xs }}>
                {(activities ?? []).map(activity => (
                  <SelectableCard
                    key={activity.id}
                    label={activity.name}
                    selected={!isCustom && exerciseId === activity.id}
                    onPress={() => {
                      setIsCustom(false);
                      setExerciseId(activity.id);
                    }}
                  />
                ))}
                <SelectableCard
                  label="Custom Activity"
                  selected={isCustom}
                  onPress={() => {
                    setIsCustom(true);
                    setExerciseId(null);
                  }}
                />
                {isCustom ? (
                  <TextField
                    placeholder="e.g. Hotel gym bike"
                    value={customActivityName}
                    onChangeText={setCustomActivityName}
                  />
                ) : null}
              </View>
            )}
          </View>

          {supportsLiveTracking(activityKey) ? (
            <SegmentedControl options={ENTRY_MODE_OPTIONS} value={entryMode} onChange={setEntryMode} />
          ) : null}

          {entryMode === 'live' && supportsLiveTracking(activityKey) ? (
            <>
              <Card
                variant="subtle"
                style={{ gap: theme.spacing.sm, alignItems: 'center', paddingVertical: theme.spacing.lg }}
              >
                <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
                  We'll track your route, pace, and distance live with GPS. Duration and distance
                  are filled in automatically — review everything before saving.
                </Text>
              </Card>
              <Button label="Start Tracking" onPress={onStartTracking} />
            </>
          ) : (
            <>
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color="secondary">
                  SESSION
                </Text>
                <TextField
                  label="Duration (min)"
                  keyboardType="number-pad"
                  value={durationMinutes}
                  onChangeText={setDurationMinutes}
                  placeholder="30"
                />
                {showsInclineSpeed(activityKey) ? (
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <TextField
                        label="Incline (%)"
                        keyboardType="decimal-pad"
                        value={inclinePct}
                        onChangeText={setInclinePct}
                        placeholder="0"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField
                        label="Speed (km/h)"
                        keyboardType="decimal-pad"
                        value={speedKmh}
                        onChangeText={setSpeedKmh}
                        placeholder="5.6"
                      />
                    </View>
                  </View>
                ) : null}
                {showsDistance(activityKey) ? (
                  <TextField
                    label="Distance (km, optional)"
                    keyboardType="decimal-pad"
                    value={distanceKm}
                    onChangeText={setDistanceKm}
                    placeholder="5"
                  />
                ) : null}
                {showsEffort(activityKey) ? (
                  <View style={{ gap: theme.spacing.xs }}>
                    <Text variant="label" color="secondary">
                      AVG EFFORT
                    </Text>
                    <SegmentedControl
                      options={EFFORT_OPTIONS}
                      value={effort ?? 'moderate'}
                      onChange={setEffort}
                    />
                  </View>
                ) : null}
              </View>

              {!weightLoading && latestWeightKg == null ? (
                <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
                  <Text variant="subtitle">Log your weight to get an estimate</Text>
                  <Text variant="body" color="secondary">
                    The calorie estimate needs a bodyweight — you haven't logged one
                    yet.
                  </Text>
                  <TextField
                    label="Weight (kg)"
                    keyboardType="decimal-pad"
                    value={weightInput}
                    onChangeText={setWeightInput}
                    placeholder="75"
                  />
                  <Button
                    label="Save Weight"
                    onPress={onSaveWeight}
                    loading={logBodyMetric.isPending}
                  />
                </Card>
              ) : null}

              {estimatedCalories != null ? (
                <Card
                  variant="elevated"
                  style={{
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    paddingVertical: theme.spacing.xl,
                  }}
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

              <Button
                label="Save Session"
                onPress={onSave}
                disabled={!canSave}
                loading={saveCardioLog.isPending}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}
