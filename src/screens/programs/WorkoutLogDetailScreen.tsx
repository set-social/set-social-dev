import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { isSameDay } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Header,
  Icon,
  TextField,
  StatTile,
  LoadingState,
  KeyboardAvoider,
} from '../../components/core';
import {
  useWorkoutLogDetail,
  useUpdateSet,
  useDeleteSet,
  useDeleteWorkoutLog,
  type WorkoutLogSetDetail,
} from '../../services/api/queries/workoutLogs';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight, parseWeightInput, unitLabel } from '../../utils/units';
import { formatPace } from '../../utils/routeMetrics';
import type { UnitPreference } from '../../types/database';
import type {
  ProgramsStackParamList,
  RootStackParamList,
} from '../../navigation/types';

type Route = RouteProp<ProgramsStackParamList, 'WorkoutLogDetail'>;
type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The editable detail behind a completed day's "Edit Workout" button
 * (see CompletedWorkoutCard, which shows a read-only summary and sends the
 * user here for anything destructive) — per-set edits and deletes, plus
 * deleting the whole workout, all live only on this Training-tab screen.
 */
export function WorkoutLogDetailScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<RootNav>();
  const { params } = useRoute<Route>();
  const unitPref = useUnitPreference();

  // Reached by CompletedWorkoutCard via a cross-tab `rootNavigation.navigate`
  // (Today -> MainTabs -> ProgramsTab -> WorkoutLogDetail) — that makes this
  // the Programs stack's *only* entry, so navigation.canGoBack() is false
  // and Header would otherwise render with no way back at all. Falling back
  // to Today explicitly (where this screen is always reachable from) keeps
  // the back arrow working regardless of which stack got here first.
  const onBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      rootNavigation.navigate('MainTabs', {
        screen: 'TodayTab',
        params: { screen: 'Today' },
      });
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title={params.title ?? 'Workout'} onBack={onBack} />
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
          {params.dateLabel ? (
            <Text variant="body" color="secondary">
              {params.dateLabel}
            </Text>
          ) : null}
          {params.workoutLogIds.map(id => (
            <WorkoutLogSection
              key={id}
              workoutLogId={id}
              unitPref={unitPref}
              onDeleted={() => {
                // If that was the only workout logged for the day, nothing's
                // left to show here — back out to wherever the user came from.
                if (params.workoutLogIds.length === 1) navigation.goBack();
              }}
            />
          ))}
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

/** One workout_log's full breakdown — most days this is the only section,
 * but more than one workout completed the same day each gets its own. */
function WorkoutLogSection({
  workoutLogId,
  unitPref,
  onDeleted,
}: {
  workoutLogId: string;
  unitPref: UnitPreference;
  onDeleted: () => void;
}) {
  const theme = useTheme();
  const { data: detail, isLoading } = useWorkoutLogDetail(workoutLogId);
  const updateSet = useUpdateSet();
  const deleteSet = useDeleteSet();
  const deleteWorkoutLog = useDeleteWorkoutLog();

  const onDeleteWorkout = () => {
    Alert.alert(
      'Delete this workout?',
      "This can't be undone — every set in it will be deleted too.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteWorkoutLog.mutateAsync(workoutLogId);
              onDeleted();
            } catch (err) {
              Alert.alert(
                'Could not delete workout',
                err instanceof Error ? err.message : 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  if (isLoading || !detail) {
    return <LoadingState fill={false} />;
  }

  // Once local midnight has passed since a workout was completed, it's
  // locked in — sets/notes read-only, no deleting it or any set in it. Kept
  // as a plain render-time check (not a schedule/timer) since the screen is
  // only ever open for a bounded session; the boundary just needs to be
  // right whenever the athlete happens to open this screen, not tick live.
  const isLocked =
    detail.completedAt != null &&
    !isSameDay(new Date(detail.completedAt), new Date());

  const exerciseOrder: string[] = [];
  const setsByExercise = new Map<string, WorkoutLogSetDetail[]>();
  for (const setRow of detail.sets) {
    if (!setsByExercise.has(setRow.exerciseId)) {
      exerciseOrder.push(setRow.exerciseId);
      setsByExercise.set(setRow.exerciseId, []);
    }
    setsByExercise.get(setRow.exerciseId)!.push(setRow);
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="subtitle">{detail.title}</Text>
      {isLocked ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            backgroundColor: theme.colors.bg.surface,
            borderRadius: theme.radii.sm,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
          }}
        >
          <Icon name="lock" size="sm" color={theme.colors.text.secondary} />
          <Text variant="caption" color="secondary" style={{ flex: 1 }}>
            This workout is from a previous day and can no longer be edited.
          </Text>
        </View>
      ) : null}
      {detail.cardio ? (
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <StatTile label="Duration" value={`${detail.cardio.durationMinutes} min`} />
            </View>
            {detail.cardio.distanceKm != null ? (
              <View style={{ flex: 1 }}>
                <StatTile label="Distance" value={`${detail.cardio.distanceKm.toFixed(2)} km`} />
              </View>
            ) : null}
            {detail.cardio.avgPaceSecPerKm != null ? (
              <View style={{ flex: 1 }}>
                <StatTile label="Avg Pace" value={`${formatPace(detail.cardio.avgPaceSecPerKm)}/km`} />
              </View>
            ) : null}
          </View>
          <Text variant="body" color="secondary">
            {detail.cardio.estimatedCalories} calories burned
            {detail.cardio.effort ? ` · ${detail.cardio.effort} effort` : ''}
          </Text>
          {detail.cardio.hasRoute ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
              }}
            >
              <Icon name="mapPin" size="sm" color={theme.colors.accent.orange} />
              <Text variant="caption" color="secondary">
                Route recorded
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        exerciseOrder.map(exerciseId => {
          const sets = setsByExercise.get(exerciseId)!;
          const isTimed = sets[0].durationSeconds != null;
          return (
            <View key={exerciseId} style={{ gap: theme.spacing.xs }}>
              <Text variant="body" color="secondary">
                {sets[0].exerciseName}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                }}
              >
                <View style={{ width: 20 }} />
                <Text variant="label" color="secondary" style={{ flex: 1 }}>
                  REPS
                </Text>
                <Text variant="label" color="secondary" style={{ flex: 1 }}>
                  {isTimed ? 'SEC' : unitLabel(unitPref).toUpperCase()}
                </Text>
                <Text variant="label" color="secondary" style={{ flex: 1 }}>
                  RPE
                </Text>
                <View style={{ width: 44 }} />
              </View>
              {sets.map(setRow => (
                <HistoricalSetRow
                  key={setRow.id}
                  setRow={setRow}
                  unitPref={unitPref}
                  readOnly={isLocked}
                  onSave={patch => updateSet.mutate({ id: setRow.id, ...patch })}
                  onDelete={() => deleteSet.mutate(setRow.id)}
                />
              ))}
            </View>
          );
        })
      )}
      {isLocked ? null : (
        <Pressable
          onPress={onDeleteWorkout}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <Icon name="trash" size="sm" color={theme.colors.semantic.danger} />
          <Text variant="body" style={{ color: theme.colors.semantic.danger }}>
            Delete Workout
          </Text>
        </Pressable>
      )}
    </View>
  );
}

type HistoricalSetRowProps = {
  setRow: WorkoutLogSetDetail;
  unitPref: UnitPreference;
  /** True once the workout this set belongs to is locked (past local
   * midnight since it was completed) — inputs go read-only and the delete
   * action disappears rather than silently no-op, so it's obvious why. */
  readOnly: boolean;
  onSave: (patch: {
    reps?: number;
    load_kg?: number | null;
    rpe?: number | null;
    duration_seconds?: number | null;
  }) => void;
  onDelete: () => void;
};

/** Persists on blur rather than per keystroke — these sets are already
 * completed and stored, unlike the active-logging screen's draft-then-
 * confirm flow, so there's no separate "save" action to hang a mutation
 * off of. */
function HistoricalSetRow({
  setRow,
  unitPref,
  readOnly,
  onSave,
  onDelete,
}: HistoricalSetRowProps) {
  const theme = useTheme();
  const isTimed = setRow.durationSeconds != null;

  // Both already rounded for display (formatWeight), so comparing the raw
  // text back against this on blur tells "did the athlete actually change
  // it" apart from "the kg<->lb round-trip just landed on a different
  // decimal" — comparing converted-back kg values instead would spuriously
  // treat an untouched field as edited any time the display rounding
  // (nearest 0.5 lb, ~0.23kg) doesn't reproduce the original kg exactly.
  const initialLoadDisplay = isTimed
    ? setRow.durationSeconds != null
      ? String(setRow.durationSeconds)
      : ''
    : formatWeight(setRow.loadKg, unitPref);

  const [reps, setReps] = useState(String(setRow.reps));
  const [loadOrDuration, setLoadOrDuration] = useState(initialLoadDisplay);
  const [rpe, setRpe] = useState(setRow.rpe != null ? String(setRow.rpe) : '');

  const onRepsBlur = () => {
    const parsed = parseInt(reps, 10);
    if (!Number.isNaN(parsed) && parsed !== setRow.reps)
      onSave({ reps: parsed });
  };
  const onLoadOrDurationBlur = () => {
    if (loadOrDuration === initialLoadDisplay) return;
    if (isTimed) {
      const parsed =
        loadOrDuration.trim() === '' ? null : parseInt(loadOrDuration, 10);
      onSave({
        duration_seconds: Number.isNaN(parsed as number) ? null : parsed,
      });
    } else {
      onSave({ load_kg: parseWeightInput(loadOrDuration, unitPref) });
    }
  };
  const onRpeBlur = () => {
    const parsed = rpe.trim() === '' ? null : parseFloat(rpe);
    if (parsed !== setRow.rpe)
      onSave({ rpe: Number.isNaN(parsed as number) ? null : parsed });
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        opacity: readOnly ? 0.6 : 1,
      }}
    >
      <Text variant="caption" color="tertiary" style={{ width: 20 }}>
        {setRow.setNumber}
      </Text>
      <View style={{ flex: 1 }}>
        <TextField
          keyboardType="number-pad"
          value={reps}
          onChangeText={setReps}
          onBlur={onRepsBlur}
          placeholder="Reps"
          editable={!readOnly}
        />
      </View>
      <View style={{ flex: 1 }}>
        <TextField
          keyboardType={isTimed ? 'number-pad' : 'decimal-pad'}
          value={loadOrDuration}
          onChangeText={setLoadOrDuration}
          onBlur={onLoadOrDurationBlur}
          placeholder={isTimed ? 'sec' : unitLabel(unitPref)}
          editable={!readOnly}
        />
      </View>
      <View style={{ flex: 1 }}>
        <TextField
          keyboardType="decimal-pad"
          value={rpe}
          onChangeText={setRpe}
          onBlur={onRpeBlur}
          placeholder="RPE"
          editable={!readOnly}
        />
      </View>
      {readOnly ? (
        <View style={{ width: 44, height: 44 }} />
      ) : (
        <Pressable
          onPress={onDelete}
          accessibilityLabel={`Remove set ${setRow.setNumber}`}
          style={{
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="trash" size="sm" color={theme.colors.semantic.danger} />
        </Pressable>
      )}
    </View>
  );
}
