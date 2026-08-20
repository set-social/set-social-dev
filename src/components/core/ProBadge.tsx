import React from 'react';
import { StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';

type ProBadgeProps = {
  size?: number;
};

/** Small "PRO" text pip shown next to a display name wherever one already
 * renders for a SetSocial Pro athlete — leaderboard rows, feed post authors,
 * search results, profile headers. Purely decorative (no press target); the
 * caller decides whether to render it at all based on `profile.is_premium`. */
export function ProBadge({ size = 15 }: ProBadgeProps) {
  const theme = useTheme();
  const fontSize = Math.round(size * 0.6);
  return (
    <View
      style={{
        height: size,
        marginLeft: theme.spacing.xs,
        paddingHorizontal: size * 0.45,
        borderRadius: theme.radii.xs,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityLabel="SetSocial Pro"
    >
      <LinearGradient
        colors={[...theme.gradients.premium]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Text
        style={{
          fontSize,
          fontWeight: '800',
          letterSpacing: 0.3,
          lineHeight: fontSize + 1,
          color: theme.colors.bg.base,
        }}
      >
        PRO
      </Text>
    </View>
  );
}
