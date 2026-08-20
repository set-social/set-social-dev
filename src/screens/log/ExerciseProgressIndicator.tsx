import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../../components/core';

type ExerciseProgressIndicatorProps = {
  completedSets: number;
  totalSets: number;
  size?: number;
};

/** Small ring showing completed/total sets — a checkmark once full, a filled
 * arc mid-progress, an empty outline at zero. Used on both the overview row
 * and the focused screen's header. */
export function ExerciseProgressIndicator({ completedSets, totalSets, size = 32 }: ExerciseProgressIndicatorProps) {
  const theme = useTheme();
  const complete = totalSets > 0 && completedSets >= totalSets;
  const started = completedSets > 0;

  if (complete) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.accent.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="check" size="sm" color={theme.colors.text.onAccent} strokeWidth={3} />
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radii.pill,
        borderWidth: 2,
        borderColor: started ? theme.colors.accent.primary : theme.colors.border.default,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: started ? theme.colors.accent.subtle : 'transparent',
      }}
    >
      <Icon
        name="dumbbell"
        size="sm"
        color={started ? theme.colors.accent.primary : theme.colors.text.tertiary}
      />
    </View>
  );
}
