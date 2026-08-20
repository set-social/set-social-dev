import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, StatTile, IconButton } from '../../components/core';
import {
  useActiveWorkoutStore,
  type WorkoutStats,
} from '../../store/activeWorkoutStore';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatVolume, unitLabel } from '../../utils/units';

/** Ticks a live mm:ss elapsed label from the workout's start timestamp
 * rather than a screen-level counter, so it reads correctly regardless of
 * how long the screen has been mounted (survives navigation, backgrounding). */
function useElapsedLabel(startedAt: number | null): string {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const interval = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  if (!startedAt) return '0:00';
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - startedAt) / 1000),
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type ActiveWorkoutHeaderProps = {
  title: string;
  dateLabel: string;
  startedAt: number | null;
  stats: WorkoutStats;
  onOptionsPress: () => void;
};

/** Sticky-feeling header for the workout overview: name/date/active state up
 * top, then a horizontally-scrolling stat strip (elapsed time first — the
 * one figure that must keep ticking across every navigation in this flow). */
export function ActiveWorkoutHeader({
  title,
  dateLabel,
  startedAt,
  stats,
  onOptionsPress,
}: ActiveWorkoutHeaderProps) {
  const theme = useTheme();
  const unitPref = useUnitPreference();
  const elapsedLabel = useElapsedLabel(startedAt);
  const restRunning = useActiveWorkoutStore(state => state.restRunning);
  const restSecondsRemaining = useActiveWorkoutStore(
    state => state.restSecondsRemaining,
  );

  return (
    <View
      style={{
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.sm,
        gap: theme.spacing.sm,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ flex: 1, gap: theme.spacing.xxs }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.accent.primary,
              }}
              accessibilityLabel="Workout in progress"
            />
            <Text variant="label" color="secondary">
              ACTIVE · {dateLabel}
            </Text>
          </View>
          <Text variant="title" numberOfLines={1}>
            {title}
          </Text>
          {restRunning ? (
            <Text
              variant="caption"
              style={{ color: theme.colors.accent.primary, fontWeight: '600' }}
            >
              Resting — {Math.floor(restSecondsRemaining / 60)}:
              {(restSecondsRemaining % 60).toString().padStart(2, '0')}
            </Text>
          ) : null}
        </View>
        <IconButton
          name="moreVertical"
          variant="ghost"
          accessibilityLabel="Workout options"
          onPress={onOptionsPress}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ width: 92 }}>
          <StatTile label="Elapsed" value={elapsedLabel} />
        </View>
        <View style={{ width: 92 }}>
          <StatTile
            label="Exercises"
            value={`${stats.completedExercises}/${stats.totalExercises}`}
          />
        </View>
        <View style={{ width: 72 }}>
          <StatTile label="Sets" value={stats.totalSets} />
        </View>
        <View style={{ width: 72 }}>
          <StatTile label="Reps" value={stats.totalReps} />
        </View>
        <View style={{ width: 104 }}>
          <StatTile
            label="Volume"
            value={`${formatVolume(stats.totalVolumeKg, unitPref)} ${unitLabel(
              unitPref,
            )}`}
          />
        </View>
      </ScrollView>
    </View>
  );
}
