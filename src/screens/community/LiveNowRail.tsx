import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Avatar, Icon, BottomSheet } from '../../components/core';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight, unitLabel } from '../../utils/units';
import { estimateOneRepMax } from '../../services/api/queries/progress';
import type { LiveFriendWorkout } from '../../services/api/queries/liveWorkouts';
import type { UnitPreference } from '../../types/database';

const CARD_WIDTH = 172;

/** "Live · 24m" — started a few minutes ago reads as "just started" rather
 * than "Live · 0m", which read like a stale/broken timestamp in review. */
function elapsedLabel(startedAt: string): string {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000),
  );
  return minutes < 1 ? 'Live · just started' : `Live · ${minutes}m`;
}

function setLabel(
  loadKg: number | null,
  reps: number | null,
  unitPref: UnitPreference,
): string {
  if (loadKg == null || reps == null) return '—';
  return `${formatWeight(loadKg, unitPref)}${unitLabel(unitPref)}×${reps}`;
}

/** True once the session's best set this session matches or beats the
 * friend's own all-time best for the exercise — same e1RM comparison
 * PRDetailScreen uses, just applied to a friend's pair of sets instead of
 * one athlete's history. */
function bestMatchesOrBeatsPr(workout: LiveFriendWorkout): boolean {
  if (workout.bestLoadKg == null || workout.bestReps == null) return false;
  if (workout.prLoadKg == null || workout.prReps == null) return false;
  return (
    estimateOneRepMax(workout.bestLoadKg, workout.bestReps) >=
    estimateOneRepMax(workout.prLoadKg, workout.prReps)
  );
}

function GymBadge({ centered }: { centered?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: centered ? 'center' : 'flex-start',
        marginTop: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 3,
        borderRadius: theme.radii.pill,
        backgroundColor: `${theme.colors.accent.teal}24`,
        borderWidth: 1,
        borderColor: `${theme.colors.accent.teal}4D`,
      }}
    >
      <Icon name="mapPin" size={10} color={theme.colors.accent.teal} />
      <Text
        variant="caption"
        style={{
          color: theme.colors.accent.teal,
          fontWeight: '700',
          fontSize: 10.5,
        }}
      >
        At your gym!
      </Text>
    </View>
  );
}

function LiveNowCard({
  workout,
  unitPref,
  onPress,
}: {
  workout: LiveFriendWorkout;
  unitPref: UnitPreference;
  onPress: () => void;
}) {
  const theme = useTheme();
  const beat = bestMatchesOrBeatsPr(workout);

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${
        workout.friend.display_name ?? 'Athlete'
      }, live now on ${workout.exerciseName}`}
      style={{
        width: CARD_WIDTH,
        backgroundColor: theme.colors.bg.surface,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        borderRadius: theme.radii.lg,
        padding: theme.spacing.md,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          marginBottom: 2,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 2,
            borderColor: theme.colors.accent.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Avatar
            uri={workout.friend.avatar_url}
            focalX={workout.friend.avatar_focal_x}
            focalY={workout.friend.avatar_focal_y}
            size={38}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            variant="body"
            numberOfLines={1}
            style={{ fontWeight: '700', fontSize: 13.5 }}
          >
            {workout.friend.display_name ?? 'Athlete'}
          </Text>
          <Text
            variant="caption"
            style={{ color: theme.colors.accent.primary, fontWeight: '600' }}
          >
            {elapsedLabel(workout.startedAt)}
          </Text>
        </View>
      </View>

      <Text
        variant="caption"
        color="secondary"
        style={{ marginTop: 4 }}
        numberOfLines={1}
      >
        {workout.workoutTitle}
      </Text>
      <Text
        variant="body"
        numberOfLines={1}
        style={{ fontWeight: '600', fontSize: 13.5, marginTop: 2 }}
      >
        {workout.exerciseName}
      </Text>

      {workout.atYourGym ? <GymBadge /> : null}

      <View
        style={{
          marginTop: theme.spacing.sm,
          paddingTop: theme.spacing.sm,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border.subtle,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <Text
          variant="caption"
          color="tertiary"
          style={{ fontWeight: '700', fontSize: 10 }}
        >
          CURRENT
        </Text>
        <Text
          variant="caption"
          style={{
            fontWeight: '700',
            color: beat
              ? theme.colors.accent.primary
              : theme.colors.text.primary,
          }}
        >
          {setLabel(workout.bestLoadKg, workout.bestReps, unitPref)}
        </Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 2,
        }}
      >
        <Text
          variant="caption"
          color="tertiary"
          style={{ fontWeight: '700', fontSize: 10 }}
        >
          THEIR PR
        </Text>
        <Text variant="caption" style={{ fontWeight: '700' }}>
          {setLabel(workout.prLoadKg, workout.prReps, unitPref)}
        </Text>
      </View>
    </Pressable>
  );
}

function LiveNowDetailSheet({
  workout,
  unitPref,
  onClose,
  onViewProfile,
}: {
  workout: LiveFriendWorkout | null;
  unitPref: UnitPreference;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
}) {
  const theme = useTheme();
  const beat = workout ? bestMatchesOrBeatsPr(workout) : false;

  return (
    <BottomSheet
      visible={workout != null}
      onClose={onClose}
      title={
        workout
          ? `${workout.friend.display_name ?? 'Athlete'}'s session`
          : undefined
      }
    >
      {workout ? (
        <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Pressable
            onPress={() => {
              onClose();
              onViewProfile(workout.friend.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={`View ${
              workout.friend.display_name ?? 'athlete'
            }'s profile`}
            style={{ alignItems: 'center' }}
          >
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                borderWidth: 3,
                borderColor: theme.colors.accent.primary,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: theme.spacing.xs,
              }}
            >
              <Avatar
                uri={workout.friend.avatar_url}
                focalX={workout.friend.avatar_focal_x}
                focalY={workout.friend.avatar_focal_y}
                size={78}
              />
            </View>
            <Text variant="subtitle" style={{ fontWeight: '700' }}>
              {workout.friend.display_name ?? 'Athlete'}
            </Text>
          </Pressable>
          <Text
            variant="caption"
            style={{ color: theme.colors.accent.primary, fontWeight: '600' }}
          >
            {elapsedLabel(workout.startedAt)}
          </Text>
          <Text variant="body" color="secondary">
            {workout.workoutTitle}
          </Text>

          {workout.atYourGym ? <GymBadge centered /> : null}

          <View
            style={{
              width: '100%',
              marginTop: theme.spacing.md,
              padding: theme.spacing.md,
              backgroundColor: theme.colors.bg.surfaceElevated,
              borderRadius: theme.radii.md,
            }}
          >
            <Text
              variant="caption"
              color="tertiary"
              style={{ fontWeight: '700', letterSpacing: 0.3 }}
            >
              CURRENTLY ON
            </Text>
            <Text
              variant="subtitle"
              style={{ fontWeight: '700', marginTop: 2 }}
            >
              {workout.exerciseName}
            </Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
              {workout.setsDone} set{workout.setsDone === 1 ? '' : 's'} done
              this exercise
            </Text>
          </View>

          <View
            style={{
              width: '100%',
              flexDirection: 'row',
              gap: theme.spacing.sm,
              marginTop: theme.spacing.sm,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: theme.colors.bg.surfaceElevated,
                borderRadius: theme.radii.md,
                padding: theme.spacing.md,
                alignItems: 'center',
              }}
            >
              <Text
                variant="caption"
                color="tertiary"
                style={{ fontWeight: '700', fontSize: 10 }}
              >
                BEST SET TODAY
              </Text>
              <Text
                variant="subtitle"
                style={{
                  fontWeight: '800',
                  marginTop: 4,
                  color: beat
                    ? theme.colors.accent.primary
                    : theme.colors.text.primary,
                }}
              >
                {setLabel(workout.bestLoadKg, workout.bestReps, unitPref)}
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                backgroundColor: theme.colors.bg.surfaceElevated,
                borderRadius: theme.radii.md,
                padding: theme.spacing.md,
                alignItems: 'center',
              }}
            >
              <Text
                variant="caption"
                color="tertiary"
                style={{ fontWeight: '700', fontSize: 10 }}
              >
                ALL-TIME PR
              </Text>
              <Text
                variant="subtitle"
                style={{ fontWeight: '800', marginTop: 4 }}
              >
                {setLabel(workout.prLoadKg, workout.prReps, unitPref)}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}

type LiveNowRailProps = {
  workouts: LiveFriendWorkout[];
  onViewProfile: (userId: string) => void;
};

/** Only visible when at least one friend is mid-workout — the Social tab
 * otherwise looks exactly as it did before this feature shipped. */
export function LiveNowRail({ workouts, onViewProfile }: LiveNowRailProps) {
  const theme = useTheme();
  const unitPref = useUnitPreference();
  const [selected, setSelected] = useState<LiveFriendWorkout | null>(null);

  if (workouts.length === 0) return null;

  return (
    <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          marginHorizontal: theme.spacing.lg,
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.colors.accent.primary,
          }}
        />
        <Text variant="body" style={{ fontWeight: '700' }}>
          Live Now
        </Text>
        <View
          style={{
            backgroundColor: theme.colors.accent.primary,
            borderRadius: theme.radii.pill,
            paddingHorizontal: 7,
            paddingVertical: 1,
          }}
        >
          <Text
            variant="caption"
            style={{ color: theme.colors.text.onAccent, fontWeight: '700' }}
          >
            {workouts.length}
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
        }}
      >
        {workouts.map(workout => (
          <LiveNowCard
            key={workout.workoutLogId}
            workout={workout}
            unitPref={unitPref}
            onPress={() => setSelected(workout)}
          />
        ))}
      </ScrollView>

      <LiveNowDetailSheet
        workout={selected}
        unitPref={unitPref}
        onClose={() => setSelected(null)}
        onViewProfile={onViewProfile}
      />
    </View>
  );
}
