import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';

type StepProgressProps = {
  step: number;
  total: number;
};

/** Thin segmented progress bar + "STEP X OF N" label, shared across onboarding. */
export function StepProgress({ step, total }: StepProgressProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label" color="secondary">
        STEP {step} OF {total}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.xxs }}>
        {Array.from({ length: total }).map((_, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: 4,
              borderRadius: theme.radii.pill,
              backgroundColor: index < step ? theme.colors.accent.primary : theme.colors.border.subtle,
            }}
          />
        ))}
      </View>
    </View>
  );
}
