import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, Icon } from '../../components/core';
import { ExerciseProgressIndicator } from './ExerciseProgressIndicator';
import { formatWeight, unitLabel } from '../../utils/units';
import { effectiveTotalSets, type ActiveExercise } from '../../store/activeWorkoutStore';
import type { UnitPreference } from '../../types/database';

type WorkoutExerciseRowProps = {
  exercise: ActiveExercise;
  order: number;
  isNext: boolean;
  unitPref: UnitPreference;
  // Takes the exerciseId rather than being pre-bound per row, so the parent
  // can pass one stable function reference for the whole list (via
  // useCallback) instead of a fresh closure per exercise per render — the
  // whole point of memo-wrapping this component above.
  onNavigate: (exerciseId: string) => void;
  /** True only for the row currently being dragged — ReorderableExerciseList
   * (the actual drag owner, via a Pan gesture wrapping this whole row) drives
   * this for the lifted visual treatment; the drag gesture itself lives
   * outside this component. */
  isDragging?: boolean;
};

function repsLabel(exercise: ActiveExercise): string | null {
  if (exercise.targetRepsMin == null) return null;
  if (exercise.targetRepsMax != null && exercise.targetRepsMax !== exercise.targetRepsMin) {
    return `${exercise.targetRepsMin}-${exercise.targetRepsMax} reps`;
  }
  return `${exercise.targetRepsMin} reps`;
}

/** Compact, scannable summary row for the workout overview — replaces
 * showing every exercise as a full editable card. Tapping opens the focused
 * ActiveExercise screen for just this exercise. Memoized since the overview
 * screen re-renders on every workout-store change (add/complete a set
 * anywhere) — without this, every row re-renders even when only one
 * exercise actually changed. */
export const WorkoutExerciseRow = React.memo(function WorkoutExerciseRow({ exercise, order, isNext, unitPref, onNavigate, isDragging }: WorkoutExerciseRowProps) {
  const theme = useTheme();
  const totalSets = effectiveTotalSets(exercise);
  const completedSets = exercise.sets.filter(s => s.completed).length;
  const complete = totalSets > 0 && completedSets >= totalSets;
  const reps = repsLabel(exercise);

  const setsWeights = exercise.sets
    .filter(s => s.completed && s.loadKg != null)
    .map(s => formatWeight(s.loadKg, unitPref))
    .join(', ');

  return (
    <Pressable
      onPress={() => onNavigate(exercise.exerciseId)}
      accessibilityRole="button"
      accessibilityLabel={`${exercise.exerciseName}, ${completedSets} of ${totalSets} sets complete`}
    >
      {({ pressed }) => (
        <Card
          variant={isNext || isDragging ? 'elevated' : 'flat'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            opacity: pressed ? 0.85 : 1,
            borderColor: isNext ? theme.colors.accent.primary : theme.colors.border.subtle,
            borderWidth: isNext ? 1.5 : 1,
            ...(isDragging ? { transform: [{ scale: 1.03 }], shadowOpacity: 0.25 } : null),
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: theme.radii.pill,
              backgroundColor: theme.colors.bg.surfaceElevated,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="caption" color="secondary" style={{ fontWeight: '700' }}>
              {order}
            </Text>
          </View>

          <View style={{ flex: 1, gap: theme.spacing.xxs }}>
            <Text variant="subtitle" numberOfLines={1}>
              {exercise.exerciseName}
            </Text>
            <Text variant="caption" color="secondary">
              {totalSets} set{totalSets === 1 ? '' : 's'}
              {reps ? ` · ${reps}` : ''}
            </Text>
            {setsWeights ? (
              <Text variant="caption" color="tertiary" numberOfLines={1}>
                {setsWeights} {unitLabel(unitPref)}
              </Text>
            ) : null}
            <Text
              variant="caption"
              style={{ color: complete ? theme.colors.accent.primary : theme.colors.text.secondary, fontWeight: '600' }}
            >
              {completedSets} of {totalSets} set{totalSets === 1 ? '' : 's'} complete
            </Text>
          </View>

          <ExerciseProgressIndicator completedSets={completedSets} totalSets={totalSets} />

          <Icon name="gripVertical" size="sm" color={theme.colors.text.tertiary} />
        </Card>
      )}
    </Pressable>
  );
});
