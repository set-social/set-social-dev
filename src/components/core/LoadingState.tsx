import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';

type LoadingStateProps = {
  label?: string;
  /** Fills available space via flex:1 — set false when nesting inline. */
  fill?: boolean;
};

/** Centered, lime-tinted loading indicator with a consistent container. */
export function LoadingState({ label, fill = true }: LoadingStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: fill ? 1 : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        padding: theme.spacing.xl,
      }}
    >
      <ActivityIndicator color={theme.colors.accent.primary} />
      {label ? (
        <Text variant="caption" color="secondary">
          {label}
        </Text>
      ) : null}
    </View>
  );
}
