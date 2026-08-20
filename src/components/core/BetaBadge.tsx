import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';

/** Small "BETA" text pip — same shape as ProBadge (a colored pill next to a
 * name), but flat warning-tinted rather than the Pro gradient, so it reads
 * as "still settling in" rather than "premium". Purely decorative (no press
 * target); the caller decides whether to render it at all. */
export function BetaBadge() {
  const theme = useTheme();
  return (
    <View
      style={{
        marginLeft: theme.spacing.xs,
        paddingHorizontal: theme.spacing.xs,
        paddingVertical: 1,
        borderRadius: theme.radii.xs,
        backgroundColor: `${theme.colors.semantic.warning}26`,
      }}
      accessibilityLabel="Beta"
    >
      <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.3, color: theme.colors.semantic.warning }}>
        BETA
      </Text>
    </View>
  );
}
