import React from 'react';
import { View, ViewProps } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

type CardVariant = 'flat' | 'elevated' | 'subtle';

type CardProps = ViewProps & {
  /** @deprecated use variant="elevated" */
  elevated?: boolean;
  variant?: CardVariant;
};

export function Card({ elevated, variant, style, children, ...rest }: CardProps) {
  const theme = useTheme();
  const resolvedVariant: CardVariant = variant ?? (elevated ? 'elevated' : 'flat');

  const backgroundColor =
    resolvedVariant === 'elevated' ? theme.colors.bg.surfaceElevated : theme.colors.bg.surface;
  const shadow = resolvedVariant === 'elevated' ? theme.shadows.md : theme.shadows.sm;

  return (
    <View
      style={[
        {
          backgroundColor,
          borderRadius: theme.radii.lg,
          borderWidth: resolvedVariant === 'subtle' ? 0 : 1,
          borderColor: theme.colors.border.subtle,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
        },
        resolvedVariant !== 'subtle' ? shadow : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
