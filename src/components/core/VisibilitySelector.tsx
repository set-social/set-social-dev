import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { SegmentedControl } from './SegmentedControl';
import type { PostVisibility } from '../../types/database';

type VisibilitySelectorProps = {
  value: PostVisibility;
  onChange: (value: PostVisibility) => void;
};

const OPTIONS: { value: PostVisibility; label: string }[] = [
  { value: 'friends', label: '👥 Friends' },
  { value: 'private', label: '🔒 Private' },
];

/** The one visibility control for photo uploads — Progress Photo and Before & After both use this. */
export function VisibilitySelector({ value, onChange }: VisibilitySelectorProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" color="secondary">
        VISIBILITY
      </Text>
      <SegmentedControl options={OPTIONS} value={value} onChange={onChange} />
      <Text variant="caption" color="secondary">
        {value === 'friends' ? 'Your friends can see this.' : 'Only you can see this.'}
      </Text>
    </View>
  );
}
