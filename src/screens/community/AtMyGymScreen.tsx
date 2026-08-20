import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Button,
  Header,
  ListRow,
  Avatar,
  EmptyState,
  LoadingState,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useMyCheckin,
  useCheckIn,
  useCheckOut,
  useNearbyCheckins,
  type NearbyAthlete,
} from '../../services/api/queries/location';
import { getCurrentLocation } from '../../services/location/currentLocation';
import type { CommunityStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<CommunityStackParamList>;

/** Supabase/PostgREST errors are plain `{ message, details, hint, code }`
 * objects, not real Error instances — a bare `err instanceof Error` check
 * silently collapses them to a useless generic message and hides exactly
 * what's wrong (missing table, RLS denial, bad column, ...). Same reasoning
 * as the edge functions' own errorMessage() helper. */
function errorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message;
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string'
  ) {
    return err.message;
  }
  return null;
}

const FEET_PER_METER = 3.28084;
const FEET_PER_MILE = 5280;

function formatDistance(meters: number): string {
  const feet = meters * FEET_PER_METER;
  if (feet < FEET_PER_MILE) return `${Math.round(feet)}ft away`;
  return `${(feet / FEET_PER_MILE).toFixed(1)}mi away`;
}

/**
 * Manual, expiring "I'm at the gym" check-in (see migration
 * 0037_gym_checkins.sql) plus the list of other athletes currently checked
 * in nearby. Deliberately thin: tapping a nearby athlete just opens
 * FriendProfileScreen, which already knows how to send/request based on
 * that athlete's own public/private setting and how to start a DM — this
 * screen only needs to be the discovery list, not a second copy of that logic.
 */
export function AtMyGymScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore(state => state.userId);
  const [checkingIn, setCheckingIn] = useState(false);

  const {
    data: myCheckin,
    isLoading: myCheckinLoading,
    refetch: refetchMyCheckin,
  } = useMyCheckin(userId);
  const checkIn = useCheckIn(userId);
  const checkOut = useCheckOut(userId);
  const isCheckedIn = myCheckin != null;
  const {
    data: nearby,
    isLoading: nearbyLoading,
    refetch: refetchNearby,
  } = useNearbyCheckins(isCheckedIn);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchMyCheckin(), refetchNearby()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchMyCheckin, refetchNearby]);

  const onCheckIn = async () => {
    setCheckingIn(true);
    try {
      const coords = await getCurrentLocation();
      await checkIn.mutateAsync(coords);
    } catch (err) {
      Alert.alert(
        'Could not check in',
        errorMessage(err) ?? 'Please try again.',
      );
    } finally {
      setCheckingIn(false);
    }
  };

  const onCheckOut = () => {
    Alert.alert(
      'Check out?',
      "You'll no longer show up as nearby to other athletes.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Check Out',
          style: 'destructive',
          onPress: () => checkOut.mutate(),
        },
      ],
    );
  };

  const renderAthlete = (athlete: NearbyAthlete) => (
    <ListRow
      key={athlete.id}
      title={athlete.display_name ?? 'Athlete'}
      subtitle={formatDistance(athlete.distanceMeters)}
      leading={
        <Avatar
          uri={athlete.avatar_url}
          focalX={athlete.avatar_focal_x}
          focalY={athlete.avatar_focal_y}
          size={40}
        />
      }
      showChevron
      onPress={() =>
        navigation.navigate('FriendProfile', { userId: athlete.id })
      }
    />
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title="At My Gym" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent.primary}
          />
        }
      >
        {myCheckinLoading ? (
          <LoadingState fill={false} />
        ) : !isCheckedIn ? (
          <Card
            variant="elevated"
            style={{
              alignItems: 'center',
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.xl,
            }}
          >
            <Text variant="subtitle">Let others know you're here</Text>
            <Text
              variant="body"
              color="secondary"
              style={{ textAlign: 'center' }}
            >
              Check in to see other athletes nearby right now. Your exact
              location is never shared — only that you're close by. Check-ins
              expire on their own after a few hours.
            </Text>
            <Button
              label="Check In"
              onPress={onCheckIn}
              loading={checkingIn || checkIn.isPending}
            />
          </Card>
        ) : (
          <>
            <Card
              variant="elevated"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="body" style={{ fontWeight: '700' }}>
                  You're checked in
                </Text>
                <Text variant="caption" color="secondary">
                  Visible to nearby athletes until{' '}
                  {format(new Date(myCheckin.expiresAt), 'h:mm a')}
                </Text>
              </View>
              <Button
                label="Check Out"
                variant="secondary"
                size="sm"
                onPress={onCheckOut}
                loading={checkOut.isPending}
              />
            </Card>

            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="label" color="secondary">
                NEARBY NOW
              </Text>
              {nearbyLoading ? (
                <LoadingState fill={false} />
              ) : !nearby || nearby.length === 0 ? (
                <EmptyState
                  icon="mapPin"
                  title="No one else checked in nearby"
                  description="You'll show up here for other athletes at your gym right now, too."
                />
              ) : (
                <Card variant="elevated" style={{ gap: 0 }}>
                  {nearby.map((athlete, index) => (
                    <View
                      key={athlete.id}
                      style={
                        index > 0
                          ? {
                              borderTopWidth: 1,
                              borderTopColor: theme.colors.border.subtle,
                            }
                          : undefined
                      }
                    >
                      {renderAthlete(athlete)}
                    </View>
                  ))}
                </Card>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
