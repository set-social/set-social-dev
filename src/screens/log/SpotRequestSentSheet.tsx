import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Avatar, Button, BottomSheet, Icon, LoadingState } from '../../components/core';
import {
  useSpotRequest,
  useCancelSpotRequest,
  useResponderProfile,
} from '../../services/api/queries/spotRequests';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight } from '../../utils/units';

type SpotRequestSentSheetProps = {
  visible: boolean;
  onClose: () => void;
  requestId: string | null;
  exerciseName: string;
  setNumber: number | null;
  loadKg: number | null;
};

// Exported — ActiveExerciseScreen's own pill button shows this same
// countdown once a request is active, even while this sheet is closed (see
// its "OK" button below), so both need the identical format.
export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Opens the moment "Request a Spot" is tapped (ActiveExerciseScreen) and
 * stays open through the whole lifecycle in place — no separate navigation
 * for "someone accepted", it just flips this same sheet's content once
 * useSpotRequest's poll picks up the status change. Closing early (Cancel,
 * or the backdrop) is always safe: the request itself is either already
 * resolved (nothing to cancel) or gets deleted (see useCancelSpotRequest).
 */
export function SpotRequestSentSheet({
  visible,
  onClose,
  requestId,
  exerciseName,
  setNumber,
  loadKg,
}: SpotRequestSentSheetProps) {
  const theme = useTheme();
  const unitPref = useUnitPreference();
  const { data: request, isLoading } = useSpotRequest(requestId, { poll: visible });
  const cancelRequest = useCancelSpotRequest();
  const { data: responder } = useResponderProfile(
    request?.status === 'accepted' ? request.responderId : null,
  );

  // Local re-render driver for the countdown — expiresAt itself never
  // changes, but the "time remaining" label needs to tick.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!visible || request?.status !== 'pending') return;
    const interval = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [visible, request?.status]);

  const onCancel = () => {
    if (requestId) cancelRequest.mutate(requestId);
    onClose();
  };

  const exerciseLabel = setNumber != null ? `Set ${setNumber}` : exerciseName;
  const weightLabel = loadKg != null ? formatWeight(loadKg, unitPref) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {isLoading || !request ? (
        <LoadingState fill={false} />
      ) : request.status === 'accepted' ? (
        <View style={{ alignItems: 'center', gap: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              borderRadius: theme.radii.pill,
              backgroundColor: theme.colors.accent.subtle,
            }}
          >
            <Text variant="label" style={{ color: theme.colors.accent.primary }}>
              SPOT CONFIRMED
            </Text>
          </View>

          <View>
            <Avatar uri={responder?.avatar_url} focalX={responder?.avatar_focal_x} focalY={responder?.avatar_focal_y} size={72} />
            <View
              style={{
                position: 'absolute',
                bottom: -2,
                right: -2,
                width: 26,
                height: 26,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.accent.primary,
                borderWidth: 3,
                borderColor: theme.colors.bg.surfaceElevated,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size="sm" color={theme.colors.text.onAccent} strokeWidth={3} />
            </View>
          </View>

          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Text variant="title">{responder?.display_name ?? 'An athlete'}</Text>
            <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
              is on the way to spot your {exerciseLabel}
            </Text>
          </View>

          <Button label="Got it" onPress={onClose} style={{ width: '100%' }} />
        </View>
      ) : (
        <View style={{ alignItems: 'center', gap: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: theme.radii.pill,
              backgroundColor: theme.colors.accent.subtle,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="dumbbell" size="lg" color={theme.colors.accent.primary} />
          </View>

          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Text variant="title">Spot request sent</Text>
            <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
              Nearby athletes who've opted in were notified.
            </Text>
          </View>

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
              {exerciseName}
            </Text>
            {setNumber != null || weightLabel != null ? (
              <>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.text.tertiary }} />
                <Text variant="caption" color="secondary">
                  {[setNumber != null ? `Set ${setNumber}` : null, weightLabel].filter(Boolean).join(' · ')}
                </Text>
              </>
            ) : null}
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              borderRadius: theme.radii.pill,
              backgroundColor: theme.colors.bg.base,
              borderWidth: 1,
              borderColor: theme.colors.border.default,
            }}
          >
            <Icon name="clock" size="sm" color={theme.colors.text.secondary} />
            <Text variant="caption" color="secondary">
              Expires in {formatCountdown(new Date(request.expiresAt).getTime() - Date.now())}
            </Text>
          </View>

          {/* Dismisses without canceling — the request stays pending in the
              background; ActiveExerciseScreen's own "Request a Spot" button
              swaps to a live countdown and re-opens this same sheet if
              tapped again (see its onSpotButtonPress). onClose here is
              exactly that "just hide it" action, same as the backdrop/drag
              dismiss already do — OK just makes it discoverable as a real
              button instead of relying on either of those. */}
          <Button label="OK" onPress={onClose} style={{ width: '100%' }} />

          <Button
            label="Cancel Request"
            variant="secondary"
            onPress={onCancel}
            loading={cancelRequest.isPending}
            style={{ width: '100%' }}
          />
        </View>
      )}
    </BottomSheet>
  );
}
