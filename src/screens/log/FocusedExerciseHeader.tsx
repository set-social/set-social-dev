import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, IconButton } from '../../components/core';
import { ExerciseProgressIndicator } from './ExerciseProgressIndicator';

type FocusedExerciseHeaderProps = {
  exerciseName: string;
  exerciseNumber: number;
  totalExercises: number;
  completedSets: number;
  totalSets: number;
  onBack: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onOptionsPress: () => void;
};

/** Header for the focused single-exercise screen. The down-chevron always
 * returns to the workout overview — it never cancels, finishes, or resets
 * the workout, since the active session lives in shared store state that
 * outlives this screen's mount. */
export function FocusedExerciseHeader({
  exerciseName,
  exerciseNumber,
  totalExercises,
  completedSets,
  totalSets,
  onBack,
  onPrevious,
  onNext,
  onOptionsPress,
}: FocusedExerciseHeaderProps) {
  const theme = useTheme();

  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton
          name="chevronDown"
          variant="ghost"
          accessibilityLabel="Back to workout overview"
          onPress={onBack}
        />
        <Text variant="label" color="secondary">
          EXERCISE {exerciseNumber} OF {totalExercises}
        </Text>
        <IconButton
          name="moreVertical"
          variant="ghost"
          accessibilityLabel="Exercise options"
          onPress={onOptionsPress}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <IconButton
          name="chevronLeft"
          variant="ghost"
          accessibilityLabel="Previous exercise"
          onPress={onPrevious ?? (() => {})}
          disabled={!onPrevious}
        />
        <View style={{ flex: 1, alignItems: 'center', gap: theme.spacing.xs }}>
          <Text variant="title" numberOfLines={1} style={{ textAlign: 'center' }}>
            {exerciseName}
          </Text>
          <ExerciseProgressIndicator completedSets={completedSets} totalSets={totalSets} size={24} />
        </View>
        <IconButton
          name="chevronRight"
          variant="ghost"
          accessibilityLabel="Next exercise"
          onPress={onNext ?? (() => {})}
          disabled={!onNext}
        />
      </View>
    </View>
  );
}
