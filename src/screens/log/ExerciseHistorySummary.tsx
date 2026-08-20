import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, Icon } from '../../components/core';
import { formatWeight, kgToLb, unitLabel } from '../../utils/units';
import type { ActiveExercise } from '../../store/activeWorkoutStore';
import type { PreviousExercisePerformance } from '../../services/api/queries/coaching';
import type { PrEvent } from '../../services/api/queries/progress';
import type { UnitPreference } from '../../types/database';

type ExerciseHistorySummaryProps = {
  exercise: ActiveExercise;
  previousPerformance: PreviousExercisePerformance | null | undefined;
  personalRecord: PrEvent | null | undefined;
  unitPref: UnitPreference;
};

/** Planned targets, last session's numbers, and the current all-time PR for
 * this exercise — every field is either the workout's own target data or
 * pulled from real logged sets; nothing here is placeholder data, so a field
 * simply doesn't render when there's nothing to show yet. */
export function ExerciseHistorySummary({
  exercise,
  previousPerformance,
  personalRecord,
  unitPref,
}: ExerciseHistorySummaryProps) {
  const theme = useTheme();

  const targetLabel =
    exercise.targetSets != null
      ? `${exercise.targetSets} × ${exercise.targetRepsMin ?? '?'}${
          exercise.targetRepsMax && exercise.targetRepsMax !== exercise.targetRepsMin
            ? `-${exercise.targetRepsMax}`
            : ''
        }${exercise.targetRpe ? ` @ RPE ${exercise.targetRpe}` : ''}`
      : null;

  const lastTimeSet = previousPerformance?.bestSet ?? previousPerformance?.sets[previousPerformance.sets.length - 1];
  const previousPerformanceLabel = lastTimeSet
    ? `${previousPerformance?.sets.length}×${lastTimeSet.reps}${
        lastTimeSet.loadKg != null ? ` @ ${formatWeight(lastTimeSet.loadKg, unitPref)}${unitLabel(unitPref)}` : ''
      }`
    : null;

  const prLabel = personalRecord
    ? `${formatWeight(personalRecord.loadKg, unitPref)}${unitLabel(unitPref)} × ${personalRecord.reps} (est. 1RM ${Math.round(
        unitPref === 'kg' ? personalRecord.e1rm : kgToLb(personalRecord.e1rm),
      )}${unitLabel(unitPref)})`
    : null;

  if (!targetLabel && !previousPerformanceLabel && !prLabel) return null;

  return (
    <Card variant="flat" style={{ gap: theme.spacing.sm }}>
      {targetLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Icon name="target" size="sm" color={theme.colors.text.secondary} />
          <Text variant="body" color="secondary">
            Target: {targetLabel}
          </Text>
        </View>
      ) : null}
      {previousPerformanceLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Icon name="clock" size="sm" color={theme.colors.text.secondary} />
          <Text variant="body" color="secondary">
            Last time: {previousPerformanceLabel}
          </Text>
        </View>
      ) : null}
      {prLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Icon name="trophy" size="sm" color={theme.colors.accent.primary} />
          <Text variant="body" color="secondary">
            Personal record: {prLabel}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
