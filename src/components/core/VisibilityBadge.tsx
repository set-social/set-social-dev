import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import type { PostVisibility } from '../../types/database';

type VisibilityBadgeProps = { visibility: PostVisibility };

/** Small pill shown on the owner's own posts — never on a post viewed by someone else, since a friend can only ever receive a friends-visible post in the first place. */
export function VisibilityBadge({ visibility }: VisibilityBadgeProps) {
  const theme = useTheme();
  const isPrivate = visibility === 'private';
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xxs,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.bg.surfaceElevated,
      }}
    >
      <Text
        variant="caption"
        color="secondary"
        accessibilityLabel={isPrivate ? 'Private post' : 'Visible to friends'}
      >
        {isPrivate ? '🔒 Private' : '👥 Friends'}
      </Text>
    </View>
  );
}
