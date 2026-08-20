import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';

type EmptyStateProps = {
  icon?: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Icon + title + subtitle + optional CTA, for screens/sections with nothing to show yet. */
export function EmptyState({ icon = 'info', title, description, actionLabel, onAction }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        padding: theme.spacing.xl,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: theme.radii.lg,
          backgroundColor: theme.colors.bg.surfaceElevated,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: theme.spacing.xs,
        }}
      >
        <Icon name={icon} size="lg" color={theme.colors.text.secondary} />
      </View>
      <Text variant="subtitle" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {description ? (
        <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button label={actionLabel} variant="secondary" size="sm" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
