import React from 'react';
import { View, Pressable } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Numeral, Icon } from '../../components/core';
import { useActiveWorkoutStore } from '../../store/activeWorkoutStore';
import { useRestTimerPreferenceStore } from '../../store/restTimerPreferenceStore';

const REST_PRESETS_SECONDS = [60, 90, 120];

/**
 * Rest control for the exercise currently in view. The countdown itself
 * ticks in activeWorkoutStore (a single, store-owned interval) rather than
 * here — this component only displays state and dispatches start/skip, so
 * navigating away and back never spins up a second ticker.
 */
export function RestTimerBanner() {
  const theme = useTheme();
  const restTimerEnabled = useRestTimerPreferenceStore(state => state.restTimerEnabled);
  const restRunning = useActiveWorkoutStore(state => state.restRunning);
  const restSecondsRemaining = useActiveWorkoutStore(state => state.restSecondsRemaining);
  const startRestTimer = useActiveWorkoutStore(state => state.startRestTimer);
  const skipRestTimer = useActiveWorkoutStore(state => state.skipRestTimer);

  // activeWorkoutStore's own startRestTimer already no-ops the countdown
  // itself when this preference is off (see its own comment) — this guard
  // is what stops the manual preset buttons below from rendering and
  // silently doing nothing when tapped.
  if (!restTimerEnabled) return null;

  if (!restRunning) {
    return (
      <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
        {REST_PRESETS_SECONDS.map(seconds => (
          <Pressable
            key={seconds}
            onPress={() => startRestTimer(seconds)}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xxs,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radii.sm,
              backgroundColor: theme.colors.bg.surface,
            }}
          >
            <Icon name="timer" size="sm" color={theme.colors.text.secondary} />
            <Text variant="caption" color="secondary">
              {seconds}s
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  const minutes = Math.floor(restSecondsRemaining / 60);
  const seconds = restSecondsRemaining % 60;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: theme.colors.accent.subtle,
        borderRadius: theme.radii.md,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Icon name="timer" size="md" color={theme.colors.accent.primary} />
        <View>
          <Text variant="label" color="secondary">
            RESTING
          </Text>
          <Numeral value={`${minutes}:${seconds.toString().padStart(2, '0')}`} size="md" />
        </View>
      </View>
      <Pressable
        onPress={skipRestTimer}
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xxs }}
      >
        <Text variant="subtitle" style={{ color: theme.colors.accent.primary }}>
          Skip
        </Text>
        <Icon name="skipForward" size="sm" color={theme.colors.accent.primary} />
      </Pressable>
    </View>
  );
}
