import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { Icon } from './Icon';

type SelectableCardProps = {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
};

export function SelectableCard({ label, description, selected, onPress }: SelectableCardProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: selected ? theme.colors.accent.subtle : theme.colors.bg.surface,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent.primary : theme.colors.border.subtle,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        gap: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="subtitle">{label}</Text>
        {description ? (
          <Text variant="caption" color="secondary">
            {description}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: theme.radii.pill,
          borderWidth: selected ? 0 : 2,
          borderColor: theme.colors.border.default,
          backgroundColor: selected ? theme.colors.accent.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Icon name="check" size={14} color={theme.colors.text.onAccent} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}
