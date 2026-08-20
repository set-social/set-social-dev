import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Icon, ListRow } from '../../components/core';
import { useMyCheckin, useNearbyCheckins } from '../../services/api/queries/location';
import type { RootStackParamList } from '../../navigation/types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;

type GymProximityPillProps = {
  userId: string | null;
  /** Renders as a ListRow inside MoreForYouCard instead of the standalone
   * pill, for Home's "collapse everything into one card" layout. */
  asRow?: boolean;
  /** Fired whenever this decides to show or hide itself — MoreForYouCard
   * can't know that synchronously (this owns its own hooks/gating), so it
   * listens here to decide whether its own wrapping card has anything to show. */
  onVisibilityChange?: (visible: boolean) => void;
};

/** A slim, easy-to-miss-on-purpose pill under the week strip — only ever
 * appears for the narrow slice of athletes who are both checked in
 * themselves and have a friend nearby right now. Mirrors AtMyGymScreen's own
 * gating exactly: nearby_checkins() derives "nearby" from the caller's own
 * active check-in server-side, so there's nothing to show without one. */
export function GymProximityPill({ userId, asRow, onVisibilityChange }: GymProximityPillProps) {
  const theme = useTheme();
  const rootNavigation = useNavigation<RootNav>();
  const { data: myCheckin } = useMyCheckin(userId);
  const isCheckedIn = myCheckin != null;
  const { data: nearby } = useNearbyCheckins(isCheckedIn);
  const visible = isCheckedIn && !!nearby && nearby.length > 0;

  useEffect(() => {
    onVisibilityChange?.(visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const goToAtMyGym = () =>
    rootNavigation.navigate('MainTabs', { screen: 'CommunityTab', params: { screen: 'AtMyGym' } });
  const label = `${nearby.length} friend${nearby.length === 1 ? '' : 's'} checked in nearby`;

  if (asRow) {
    return <ListRow icon="mapPin" title={label} showChevron onPress={goToAtMyGym} />;
  }

  return (
    <Pressable
      onPress={goToAtMyGym}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.bg.surface,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
      }}
    >
      <Icon name="mapPin" size="sm" color={theme.colors.accent.teal} />
      <Text variant="caption" color="secondary">
        {label}
      </Text>
    </Pressable>
  );
}
