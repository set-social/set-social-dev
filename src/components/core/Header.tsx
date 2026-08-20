import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { IconButton } from './IconButton';

type HeaderProps = {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
};

/** Standard screen header: centered title, optional back button, optional
 * trailing action — replaces per-screen hand-built header rows. */
export function Header({ title, showBack = true, onBack, right }: HeaderProps) {
  const theme = useTheme();
  const navigation = useNavigation();
  const canGoBack = showBack && (onBack != null || navigation.canGoBack());

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        gap: theme.spacing.sm,
      }}
    >
      <View style={{ width: theme.sizes.iconButton }}>
        {canGoBack ? (
          <IconButton
            name="chevronLeft"
            variant="ghost"
            accessibilityLabel="Back"
            onPress={onBack ?? (() => navigation.goBack())}
          />
        ) : null}
      </View>
      <Text variant="subtitle" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
        {title}
      </Text>
      <View style={{ minWidth: theme.sizes.iconButton, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}
