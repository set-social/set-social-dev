import React from 'react';
import { View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Avatar, Button, LoadingState, EmptyState } from '../../components/core';
import { useSpotRequest, useRespondToSpotRequest } from '../../services/api/queries/spotRequests';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight } from '../../utils/units';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SpotRequest'>;

function formatDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 5280) return `${Math.round(feet)}ft away`;
  return `${(feet / 5280).toFixed(1)}mi away`;
}

function exerciseLabel(exerciseName: string, setNumber: number | null): string {
  return setNumber != null ? `${exerciseName} — Set ${setNumber}` : exerciseName;
}

/**
 * The push-notification landing screen for a spot request — a nearby,
 * opted-in athlete taps "Mike needs a spot on Bench Press" and lands here to
 * accept or decline. Reached only via navigateToPushDestination's
 * 'SpotRequest' case (see RootNavigator/navigationRef); not linked to from
 * anywhere in-app, same as the request itself only ever making sense in
 * response to a push. `get_spot_request` returning nothing covers three
 * distinct real cases (never authorized, already resolved by someone else,
 * expired) uniformly — see its own migration comment for why those aren't
 * told apart here either.
 */
export function SpotRequestScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const unitPref = useUnitPreference();

  const { data: request, isLoading } = useSpotRequest(params.requestId);
  const respond = useRespondToSpotRequest();

  const onClose = () => navigation.goBack();

  const onRespond = async (accept: boolean) => {
    const ok = await respond.mutateAsync({ requestId: params.requestId, accept });
    if (!ok) {
      // Someone else already responded, or it expired — nothing left to do
      // but let the athlete know and close; useSpotRequest's own refetch
      // (invalidated on settle either way) will show the resolved state to
      // anyone else still looking at this same request.
    }
    navigation.goBack();
  };

  const expired = request != null && new Date(request.expiresAt).getTime() <= Date.now();
  const unavailable = !isLoading && (request == null || request.status !== 'pending' || expired);

  return (
    <View style={{ flex: 1 }}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
        onPress={onClose}
        accessibilityLabel="Dismiss"
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: theme.colors.bg.surfaceElevated,
          borderTopLeftRadius: theme.radii.xl,
          borderTopRightRadius: theme.radii.xl,
          ...theme.shadows.lg,
        }}
      >
        <SafeAreaView edges={['bottom']}>
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: theme.radii.pill,
              backgroundColor: theme.colors.border.default,
              alignSelf: 'center',
              marginTop: theme.spacing.sm,
            }}
          />

          <View style={{ padding: theme.spacing.xl, gap: theme.spacing.lg, alignItems: 'center' }}>
            {isLoading ? (
              <LoadingState fill={false} />
            ) : unavailable ? (
              <>
                <EmptyState
                  icon="clock"
                  title="This request isn't available"
                  description="It may have already been answered, or it expired."
                />
                <Button label="Close" variant="secondary" onPress={onClose} style={{ width: '100%' }} />
              </>
            ) : (
              <>
                <Avatar
                  uri={request!.requesterAvatarUrl}
                  focalX={request!.requesterAvatarFocalX}
                  focalY={request!.requesterAvatarFocalY}
                  size={72}
                />

                <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                  <Text variant="title">{request!.requesterDisplayName ?? 'An athlete'}</Text>
                  <Text variant="body" color="secondary">
                    {request!.distanceMeters != null ? `${formatDistance(request!.distanceMeters)} · ` : ''}
                    checked in now
                  </Text>
                </View>

                <Text variant="subtitle" style={{ textAlign: 'center' }}>
                  needs a spot!
                </Text>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radii.pill,
                    backgroundColor: theme.colors.bg.base,
                    borderWidth: 1,
                    borderColor: theme.colors.border.default,
                  }}
                >
                  <Text variant="caption" style={{ fontWeight: '700' }}>
                    {exerciseLabel(request!.exerciseName, request!.setNumber)}
                  </Text>
                  {request!.loadKg != null ? (
                    <>
                      <View
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: theme.colors.text.tertiary,
                        }}
                      />
                      <Text variant="caption" color="secondary">
                        {formatWeight(request!.loadKg, unitPref)}
                      </Text>
                    </>
                  ) : null}
                </View>

                <View style={{ flexDirection: 'row', gap: theme.spacing.md, width: '100%' }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Decline"
                      variant="secondary"
                      onPress={() => onRespond(false)}
                      loading={respond.isPending}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Accept" onPress={() => onRespond(true)} loading={respond.isPending} />
                  </View>
                </View>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}
