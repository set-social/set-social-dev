import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

type BadgeProps = { count?: number; visible?: boolean; size?: number };

/** Small dot/count badge — used for the chat FAB's unread indicator. */
export function Badge({ count, visible = true, size = 10 }: BadgeProps) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: count ? size + 4 : size,
        height: count ? size + 4 : size,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.semantic.danger,
        borderWidth: 2,
        borderColor: theme.colors.bg.base,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    />
  );
}
