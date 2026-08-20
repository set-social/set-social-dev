import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

type ListRowProps = {
  title: string | React.ReactNode;
  subtitle?: string | React.ReactNode;
  icon?: IconName;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  showChevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
};

/** Leading icon/avatar + title/subtitle + trailing content — shared row for
 * list-heavy screens (leaderboard, activity feed, exercise picker, settings). */
export function ListRow({
  title,
  subtitle,
  icon,
  leading,
  trailing,
  showChevron,
  onPress,
  onLongPress,
  style,
}: ListRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          opacity: pressed && onPress ? 0.7 : 1,
        },
        style,
      ]}
    >
      {leading ??
        (icon ? (
          <View
            style={{
              width: theme.sizes.iconButton,
              height: theme.sizes.iconButton,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.bg.surfaceElevated,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={icon} size="sm" color={theme.colors.text.secondary} />
          </View>
        ) : null)}
      <View style={{ flex: 1 }}>
        {typeof title === 'string' ? <Text variant="body">{title}</Text> : title}
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <Text variant="caption" color="secondary">
              {subtitle}
            </Text>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {trailing}
      {showChevron ? <Icon name="chevronRight" size="sm" color={theme.colors.text.tertiary} /> : null}
    </Pressable>
  );
}
