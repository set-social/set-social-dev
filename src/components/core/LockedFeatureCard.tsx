import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { Icon } from './Icon';
import { Button } from './Button';

type LockedFeatureCardProps = {
  title: string;
  description: string;
  onUpgrade: () => void;
};

/** Drop-in replacement for a Card's content wherever a feature is gated
 * behind SetSocial Pro — the strength trend chart, PR history/timeline,
 * Weekly Review — so every gate reads as the same "this exists, here's why
 * it's hidden, here's the one action" pattern rather than each screen
 * inventing its own. */
export function LockedFeatureCard({ title, description, onUpgrade }: LockedFeatureCardProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: `${theme.gradients.premium[1]}66`,
        backgroundColor: theme.colors.bg.surfaceElevated,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radii.pill,
          backgroundColor: `${theme.gradients.premium[1]}24`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="lock" size="sm" color={theme.gradients.premium[1]} />
      </View>
      <Text variant="body" style={{ fontWeight: '600', textAlign: 'center' }}>
        {title}
      </Text>
      <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
        {description}
      </Text>
      <Button
        label="Unlock with Pro"
        size="sm"
        onPress={onUpgrade}
        gradientColors={theme.gradients.premium}
        style={{ marginTop: theme.spacing.xs }}
      />
    </View>
  );
}
