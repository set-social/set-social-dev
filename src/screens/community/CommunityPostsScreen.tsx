import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import { useTabBarScrollHandler } from '../../navigation/tabBarScroll';
import {
  Header,
  IconButton,
  Icon,
  type IconName,
  Text,
  TextField,
  ListRow,
  LoadingState,
  FriendRequestButton,
  Avatar,
  Badge,
  ReportBlockSheet,
  ProBadge,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useSearchProfiles,
  normalizedSearchTerm,
  MIN_SEARCH_LENGTH,
  useFriendRelationships,
  resolveFriendRequestState,
  useIncomingFriendRequests,
  useOutgoingFriendRequests,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useRemoveFriendRequest,
} from '../../services/api/queries/community';
import {
  useFriendsPosts,
  useSignedPhotoUrls,
  postPhotoPaths,
  type FriendPost,
} from '../../services/api/queries/posts';
import { useLikeCounts } from '../../services/api/queries/likes';
import { useCommentCounts } from '../../services/api/queries/comments';
import { useProfile } from '../../services/api/queries/profiles';
import { useLiveFriendWorkouts } from '../../services/api/queries/liveWorkouts';
import {
  useNotificationBadges,
  useMarkMessagesSeen,
  useMarkActivitySeen,
} from '../../services/api/queries/notifications';
import { EditorialFeed } from './EditorialFeed';
import { LiveNowRail } from './LiveNowRail';
import { NotificationPrimerSheet } from '../../components/push/NotificationPrimerSheet';
import { getErrorMessage } from '../../utils/errors';
import type {
  CommunityStackParamList,
  RootStackParamList,
} from '../../navigation/types';

type Nav = NativeStackNavigationProp<CommunityStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

type HubTileProps = {
  icon: IconName;
  label: string;
  tint: string;
  dotVisible?: boolean;
  onPress: () => void;
};

/** One destination in the Social tab's hub — a named, color-coded tile
 * rather than a bare icon, so "where do I go" reads at a glance instead of
 * needing to decode a row of unlabeled glyphs (see the At My Gym /
 * Messages / Leaderboard row this replaced). */
// friend_requests mutations fire-and-forget via .mutate() — without this,
// a failure (e.g. a blocked user, a network drop) left the button just
// sitting there with no visible change, indistinguishable from "the button
// doesn't work" (see 0045_friend_request_resend.sql for the bug this
// surfaced).
const onFriendActionError = (err: unknown) =>
  Alert.alert(
    'Something went wrong',
    getErrorMessage(err, 'Please try again.'),
  );

function HubTile({ icon, label, tint, dotVisible, onPress }: HubTileProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        flex: 1,
        alignItems: 'center',
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.xs,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radii.md,
          backgroundColor: `${tint}1F`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size="md" color={tint} />
        <Badge visible={!!dotVisible} />
      </View>
      <Text
        variant="caption"
        color="secondary"
        style={{ fontWeight: '600', textAlign: 'center' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function CommunityPostsScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const navigation = useNavigation<Nav>();
  // Settings/Account lives on the root stack, not CommunityStack — same
  // cross-stack pattern TodayScreen uses for its own top-right avatar.
  const rootNavigation = useNavigation<RootNav>();
  const userId = useAuthStore(state => state.userId);
  const [search, setSearch] = useState('');
  const [reportingPost, setReportingPost] = useState<FriendPost | null>(null);

  const {
    data: posts,
    isLoading,
    refetch: refetchPosts,
  } = useFriendsPosts(userId);
  const { data: searchResults, isLoading: searching } = useSearchProfiles(
    search,
    userId,
  );
  const { data: relationships, refetch: refetchRelationships } =
    useFriendRelationships(userId);
  const { data: incomingRequests, refetch: refetchIncomingRequests } =
    useIncomingFriendRequests(userId);
  const { data: outgoingRequests, refetch: refetchOutgoingRequests } =
    useOutgoingFriendRequests(userId);
  const sendRequest = useSendFriendRequest(userId);
  const acceptRequest = useAcceptFriendRequest(userId);
  const declineRequest = useDeclineFriendRequest(userId);
  const removeRequest = useRemoveFriendRequest(userId);

  const { data: profile } = useProfile(userId);
  const { data: liveWorkouts } = useLiveFriendWorkouts(userId);
  const { hasUnreadMessages, hasUnseenActivity } = useNotificationBadges(
    userId,
    {
      messagesSeenAt: profile?.messages_seen_at,
      activitySeenAt: profile?.activity_seen_at,
    },
  );
  const markMessagesSeen = useMarkMessagesSeen(userId);
  const markActivitySeen = useMarkActivitySeen(userId);

  // Fires once per athlete, the first time they land on the Social tab with
  // a loaded profile that's never seen the primer — see push_primer_shown_at
  // (0043_push_notifications.sql) and the reviewed design spec's opt-in flow.
  const [showNotificationPrimer, setShowNotificationPrimer] = useState(false);
  useEffect(() => {
    if (profile && !profile.push_primer_shown_at)
      setShowNotificationPrimer(true);
  }, [profile]);

  const actionLoading =
    sendRequest.isPending ||
    acceptRequest.isPending ||
    declineRequest.isPending ||
    removeRequest.isPending;

  const incomingCount = incomingRequests?.length ?? 0;
  const outgoingCount = outgoingRequests?.length ?? 0;
  const friendRequestsSummary =
    incomingCount > 0 && outgoingCount > 0
      ? `${incomingCount} new · ${outgoingCount} sent`
      : incomingCount > 0
      ? `${incomingCount} new request${incomingCount === 1 ? '' : 's'}`
      : outgoingCount > 0
      ? `${outgoingCount} sent`
      : 'No pending requests';

  // Stable references — passed down into EditorialFeed's FlatList, which
  // forwards them to memoized FeedPostCards. An inline arrow here would be
  // recreated every render, defeating that memoization for every card.
  const onPressPost = useCallback(
    (postId: string) => navigation.navigate('PostDetail', { postId }),
    [navigation],
  );
  const onPressAuthor = useCallback(
    (authorUserId: string) =>
      navigation.navigate('FriendProfile', { userId: authorUserId }),
    [navigation],
  );

  const onOpenMessages = () => {
    navigation.navigate('Messages');
    if (hasUnreadMessages) markMessagesSeen.mutate();
  };

  const onOpenOwnProfile = () => {
    if (!userId) return;
    navigation.navigate('FriendProfile', { userId });
    if (hasUnseenActivity) markActivitySeen.mutate();
  };

  const photoPaths = useMemo(
    () => (posts ?? []).flatMap(postPhotoPaths),
    [posts],
  );
  const { data: photoUrls, refetch: refetchPhotoUrls } =
    useSignedPhotoUrls(photoPaths);

  const postIds = useMemo(() => (posts ?? []).map(p => p.id), [posts]);
  const { data: likeCounts, refetch: refetchLikeCounts } =
    useLikeCounts(postIds);
  const { data: commentCounts, refetch: refetchCommentCounts } =
    useCommentCounts(postIds);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchPosts(),
        refetchRelationships(),
        refetchIncomingRequests(),
        refetchOutgoingRequests(),
        refetchPhotoUrls(),
        refetchLikeCounts(),
        refetchCommentCounts(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    refetchPosts,
    refetchRelationships,
    refetchIncomingRequests,
    refetchOutgoingRequests,
    refetchPhotoUrls,
    refetchLikeCounts,
    refetchCommentCounts,
  ]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <KeyboardAvoider>
        <Header
          title="Social"
          showBack={false}
          right={
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
              }}
            >
              <IconButton
                name="plus"
                variant="ghost"
                accessibilityLabel="Post a photo"
                onPress={() =>
                  navigation.navigate('UploadPhotoPost', { mode: 'progress' })
                }
              />
              <IconButton
                name="menu"
                variant="ghost"
                accessibilityLabel="Settings"
                onPress={() =>
                  rootNavigation.navigate('Profile', { screen: 'Settings' })
                }
              />
            </View>
          }
        />

        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.sm,
          }}
        >
          <TextField
            placeholder="Find athletes by name or @handle"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            marginHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.md,
            backgroundColor: theme.colors.bg.surface,
            borderRadius: theme.radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.border.subtle,
            padding: theme.spacing.sm,
          }}
        >
          <HubTile
            icon="messageCircle"
            label="Messages"
            tint={theme.colors.accent.blue}
            dotVisible={hasUnreadMessages}
            onPress={onOpenMessages}
          />
          <HubTile
            icon="trophy"
            label="Leaderboard"
            tint={theme.colors.accent.purple}
            onPress={() => navigation.navigate('Leaderboard')}
          />
          <HubTile
            icon="mapPin"
            label="At My Gym"
            tint={theme.colors.accent.teal}
            onPress={() => navigation.navigate('AtMyGym')}
          />
          <HubTile
            icon="user"
            label="My Profile"
            tint={theme.colors.accent.primary}
            dotVisible={hasUnseenActivity}
            onPress={onOpenOwnProfile}
          />
        </View>

        {search.trim() ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            {...tabBarScrollHandler}
            scrollEventThrottle={16}
            contentContainerStyle={{
              padding: theme.spacing.lg,
              paddingTop: 0,
              paddingBottom: theme.spacing.lg + tabBarHeight,
              gap: theme.spacing.xs,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {normalizedSearchTerm(search).length < MIN_SEARCH_LENGTH ? (
              <Text variant="body" color="secondary">
                Keep typing to search…
              </Text>
            ) : searching ? (
              <LoadingState fill={false} />
            ) : searchResults?.length === 0 ? (
              <Text variant="body" color="secondary">
                No athletes found.
              </Text>
            ) : (
              searchResults?.map(profile => {
                const { state, requestId } = resolveFriendRequestState(
                  relationships,
                  profile.id,
                );
                return (
                  <ListRow
                    key={profile.id}
                    title={
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.xs,
                        }}
                      >
                        <Text variant="body">
                          {profile.display_name ?? 'Athlete'}
                        </Text>
                        {profile.is_premium ? <ProBadge /> : null}
                      </View>
                    }
                    subtitle={profile.handle ? `@${profile.handle}` : undefined}
                    leading={
                      <Avatar
                        uri={profile.avatar_url}
                        focalX={profile.avatar_focal_x}
                        focalY={profile.avatar_focal_y}
                        size={40}
                      />
                    }
                    onPress={() =>
                      navigation.navigate('FriendProfile', {
                        userId: profile.id,
                      })
                    }
                    trailing={
                      <FriendRequestButton
                        state={state}
                        displayName={profile.display_name ?? 'this athlete'}
                        loading={actionLoading}
                        onSend={() =>
                          sendRequest.mutate(profile.id, {
                            onError: onFriendActionError,
                          })
                        }
                        onAccept={() =>
                          requestId &&
                          acceptRequest.mutate(requestId, {
                            onError: onFriendActionError,
                          })
                        }
                        onDecline={() =>
                          requestId &&
                          declineRequest.mutate(requestId, {
                            onError: onFriendActionError,
                          })
                        }
                        onRemove={() =>
                          requestId &&
                          removeRequest.mutate(requestId, {
                            onError: onFriendActionError,
                          })
                        }
                      />
                    }
                  />
                );
              })
            )}
          </ScrollView>
        ) : (
          <EditorialFeed
            posts={posts ?? []}
            photoUrls={photoUrls ?? {}}
            likeCounts={likeCounts ?? {}}
            commentCounts={commentCounts ?? {}}
            isLoading={isLoading}
            emptyTitle="No posts yet"
            emptyDescription="Add friends to see their posts here."
            onPressPost={onPressPost}
            onPressAuthor={onPressAuthor}
            onPressMenu={setReportingPost}
            onScroll={tabBarScrollHandler.onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{
              gap: theme.spacing.lg,
              paddingBottom: tabBarHeight,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.accent.primary}
              />
            }
            ListHeaderComponent={
              <View style={{ gap: theme.spacing.lg }}>
                <Pressable
                  onPress={() => navigation.navigate('FriendRequests')}
                  accessibilityLabel={`Friend Requests, ${friendRequestsSummary}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    marginHorizontal: theme.spacing.lg,
                    padding: theme.spacing.md,
                    backgroundColor: theme.colors.bg.surface,
                    borderWidth: 1,
                    borderColor: theme.colors.border.subtle,
                    borderRadius: theme.radii.lg,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radii.md,
                      backgroundColor: `${theme.colors.accent.blue}1F`,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="users" size="md" color={theme.colors.accent.blue} />
                    <Badge
                      visible={!!incomingRequests && incomingRequests.length > 0}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" style={{ fontWeight: '600' }}>
                      Friend Requests
                    </Text>
                    <Text variant="caption" color="secondary">
                      {friendRequestsSummary}
                    </Text>
                  </View>
                  <Icon
                    name="chevronRight"
                    size="sm"
                    color={theme.colors.text.tertiary}
                  />
                </Pressable>

                <LiveNowRail
                  workouts={liveWorkouts ?? []}
                  onViewProfile={targetUserId =>
                    navigation.navigate('FriendProfile', { userId: targetUserId })
                  }
                />
              </View>
            }
          />
        )}
      </KeyboardAvoider>

      <ReportBlockSheet
        visible={reportingPost != null}
        onClose={() => setReportingPost(null)}
        currentUserId={userId}
        targetType="post"
        targetId={reportingPost?.id ?? ''}
        reportedUserId={reportingPost?.user_id ?? ''}
        reportedUserName={reportingPost?.displayName ?? undefined}
        onBlocked={() => setReportingPost(null)}
      />

      <NotificationPrimerSheet
        visible={showNotificationPrimer}
        userId={userId}
        onClose={() => setShowNotificationPrimer(false)}
      />
    </SafeAreaView>
  );
}
