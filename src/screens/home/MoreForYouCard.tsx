import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, Text, Icon, IconButton, ListRow, ProgressRing, type IconName } from '../../components/core';
import type { TrainingPatternRow } from '../../services/api/queries/coachingMemory';
import type { TrainingPatternType } from '../../services/coaching';
import type { LiveFriendWorkout } from '../../services/api/queries/liveWorkouts';
import { GymProximityPill } from './GymProximityPill';
import { RecoveryStoryLine } from './RecoveryStoryLine';
import { VitalsTile } from './VitalsTile';

const PATTERN_ICON: Record<TrainingPatternType, IconName> = {
  inconsistent_weekday: 'calendar',
  declining_consistency: 'trendingDown',
  recurring_pain: 'circleAlert',
  rpe_creep: 'trendingUp',
  low_sleep_pattern: 'moon',
};

const MAX_INSIGHTS_SHOWN = 2;

type MoreForYouCardProps = {
  userId: string | null;
  focusModeEnabled: boolean;
  isWhoopConnected: boolean;

  activePatterns: TrainingPatternRow[];
  onDismissPattern: (patternId: string) => void;

  hasProgram: boolean;
  sessionsThisWeek: number;
  weeklyTarget: number;
  streak: number;

  liveFriendWorkouts: LiveFriendWorkout[];
  onViewLiveNow: () => void;

  friendsPostsCount: number;
  friendsPostsLoading: boolean;
  friendsPostsError: boolean;
  onFriendsActivityViewAll: () => void;
};

/** One row (or, for Coach Insight, a small group of rows) in the card below.
 * `visible` drives divider placement and the "does this card have anything
 * to show at all" check — `content` always mounts regardless, since the
 * self-gating blocks (gym/recovery/vitals) need to be mounted to report
 * their own visibility in the first place (see their `asRow` +
 * `onVisibilityChange` props); they render `null` internally exactly when
 * `visible` is false, so mounting them unconditionally costs nothing. */
type Block = { key: string; visible: boolean; content: React.ReactNode };

/** Everything on Home that isn't today's plan, collapsed into one card of
 * compact rows instead of a dozen separate full-width cards — Coach Insight,
 * weekly progress, weight/consistency/streak vitals, gym proximity, Whoop
 * recovery, and one-line summaries of Live Now / Friends Activity (their
 * full horizontal-scroll/multi-post experience stays on the Community tab).
 *
 * GymProximityPill/RecoveryStoryLine/VitalsTile each own their own
 * data-fetching and null-gating (see their `asRow` prop) — this card can't
 * know synchronously whether they'll render anything, so it tracks their
 * reported visibility via `onVisibilityChange` and treats that the same as
 * any other block's `visible` flag. */
export function MoreForYouCard({
  userId,
  focusModeEnabled,
  isWhoopConnected,
  activePatterns,
  onDismissPattern,
  hasProgram,
  sessionsThisWeek,
  weeklyTarget,
  streak,
  liveFriendWorkouts,
  onViewLiveNow,
  friendsPostsCount,
  friendsPostsLoading,
  friendsPostsError,
  onFriendsActivityViewAll,
}: MoreForYouCardProps) {
  const theme = useTheme();
  const [gymPillVisible, setGymPillVisible] = useState(false);
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [vitalsVisible, setVitalsVisible] = useState(false);

  const showInsights = activePatterns.length > 0;
  const sessionsLeft = Math.max(weeklyTarget - sessionsThisWeek, 0);
  const weeklyProgress = weeklyTarget > 0 ? Math.min(1, sessionsThisWeek / weeklyTarget) : 0;
  const showLiveNow = !focusModeEnabled && liveFriendWorkouts.length > 0;
  const [firstLive, ...restLive] = liveFriendWorkouts;
  const showFriendsActivity = !focusModeEnabled && !friendsPostsLoading && !friendsPostsError && friendsPostsCount > 0;

  const blocks: Block[] = [
    {
      key: 'insights',
      visible: showInsights,
      content: activePatterns.slice(0, MAX_INSIGHTS_SHOWN).map((pattern, index) => (
        <View key={pattern.id} style={index > 0 ? { paddingTop: theme.spacing.sm } : undefined}>
          <ListRow
            leading={<Icon name={PATTERN_ICON[pattern.pattern_type]} size="sm" color={theme.colors.accent.primary} />}
            title={pattern.title}
            subtitle={pattern.detail}
            trailing={
              <IconButton
                name="x"
                variant="ghost"
                size={28}
                accessibilityLabel="Dismiss insight"
                onPress={() => onDismissPattern(pattern.id)}
              />
            }
          />
        </View>
      )),
    },
    {
      key: 'weekly-progress',
      visible: hasProgram,
      content: (
        <ListRow
          leading={<ProgressRing progress={weeklyProgress} size={36} strokeWidth={4} />}
          title={sessionsThisWeek >= weeklyTarget && weeklyTarget > 0 ? 'Week complete' : 'On track this week'}
          subtitle={`${sessionsLeft} session${sessionsLeft === 1 ? '' : 's'} left${streak > 0 ? ` · ${streak} day streak` : ''}`}
        />
      ),
    },
    {
      key: 'vitals',
      visible: vitalsVisible,
      content: <VitalsTile userId={userId} streak={streak} asRow onVisibilityChange={setVitalsVisible} />,
    },
    {
      key: 'gym-proximity',
      visible: !focusModeEnabled && gymPillVisible,
      content: focusModeEnabled ? null : <GymProximityPill userId={userId} asRow onVisibilityChange={setGymPillVisible} />,
    },
    {
      key: 'recovery',
      visible: isWhoopConnected && recoveryVisible,
      content: isWhoopConnected ? <RecoveryStoryLine userId={userId} asRow onVisibilityChange={setRecoveryVisible} /> : null,
    },
    {
      key: 'live-now',
      visible: showLiveNow,
      content: showLiveNow ? (
        <ListRow
          leading={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent.primary }} />}
          title={`${firstLive.friend.display_name ?? 'A friend'} is training live`}
          subtitle={restLive.length > 0 ? `+${restLive.length} more` : firstLive.workoutTitle}
          showChevron
          onPress={onViewLiveNow}
        />
      ) : null,
    },
    {
      key: 'friends-activity',
      visible: showFriendsActivity,
      content: showFriendsActivity ? (
        <ListRow
          icon="users"
          title={`${friendsPostsCount} new post${friendsPostsCount === 1 ? '' : 's'} from friends`}
          showChevron
          onPress={onFriendsActivityViewAll}
        />
      ) : null,
    },
  ];

  const hasAnyRow = blocks.some(block => block.visible);
  let seenVisible = false;

  return (
    <View style={{ display: hasAnyRow ? 'flex' : 'none', gap: theme.spacing.sm }}>
      <Text variant="subtitle">More for you</Text>
      <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
        {blocks.map(block => {
          const showDivider = block.visible && seenVisible;
          if (block.visible) seenVisible = true;
          return (
            <React.Fragment key={block.key}>
              {showDivider ? <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border.subtle }} /> : null}
              {block.content}
            </React.Fragment>
          );
        })}
      </Card>
    </View>
  );
}
