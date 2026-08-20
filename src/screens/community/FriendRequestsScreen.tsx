import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatDistanceToNow } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Header,
  SegmentedControl,
  ListRow,
  Avatar,
  LoadingState,
  EmptyState,
  FriendRequestButton,
  Text,
  ProBadge,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { getErrorMessage } from '../../utils/errors';
import {
  useIncomingFriendRequests,
  useOutgoingFriendRequests,
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useRemoveFriendRequest,
} from '../../services/api/queries/community';
import type { CommunityStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<CommunityStackParamList>;

type Tab = 'received' | 'sent';

// friend_requests mutations fire-and-forget via .mutate() — without this, a
// failure left the button just sitting there with no visible change (see
// 0045_friend_request_resend.sql / CommunityPostsScreen's onFriendActionError
// for the bug this pattern was added to catch).
const onFriendActionError = (err: unknown) =>
  Alert.alert(
    'Something went wrong',
    getErrorMessage(err, 'Please try again.'),
  );

/** Dedicated home for both directions of a pending friend request —
 * previously incoming requests only surfaced as a card wedged into the
 * Social feed, and sent requests had nowhere to live at all (the
 * "Requested" state only ever appeared transiently in search results). */
export function FriendRequestsScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore(state => state.userId);
  const [tab, setTab] = useState<Tab>('received');

  const {
    data: incoming,
    isLoading: incomingLoading,
    refetch: refetchIncoming,
  } = useIncomingFriendRequests(userId);
  const {
    data: outgoing,
    isLoading: outgoingLoading,
    refetch: refetchOutgoing,
  } = useOutgoingFriendRequests(userId);
  const acceptRequest = useAcceptFriendRequest(userId);
  const declineRequest = useDeclineFriendRequest(userId);
  const removeRequest = useRemoveFriendRequest(userId);

  const actionLoading =
    acceptRequest.isPending ||
    declineRequest.isPending ||
    removeRequest.isPending;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchIncoming(), refetchOutgoing()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchIncoming, refetchOutgoing]);

  const goToProfile = (id: string) =>
    navigation.navigate('FriendProfile', { userId: id });

  const isLoading = tab === 'received' ? incomingLoading : outgoingLoading;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title="Friend Requests" />

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
        }}
      >
        <SegmentedControl
          options={[
            { value: 'received', label: `Received (${incoming?.length ?? 0})` },
            { value: 'sent', label: `Sent (${outgoing?.length ?? 0})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {isLoading ? (
        <LoadingState />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            paddingBottom: theme.spacing.lg + tabBarHeight,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent.primary}
            />
          }
        >
          {tab === 'received' ? (
            incoming && incoming.length > 0 ? (
              incoming.map((request, index) => (
                <ListRow
                  key={request.requestId}
                  title={
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: theme.spacing.xs,
                      }}
                    >
                      <Text variant="body">
                        {request.display_name ?? 'Athlete'}
                      </Text>
                      {request.is_premium ? <ProBadge /> : null}
                    </View>
                  }
                  subtitle={`${
                    request.handle ? `@${request.handle} · ` : ''
                  }${formatDistanceToNow(new Date(request.createdAt), {
                    addSuffix: true,
                  })}`}
                  leading={
                    <Avatar
                      uri={request.avatar_url}
                      focalX={request.avatar_focal_x}
                      focalY={request.avatar_focal_y}
                      size={44}
                    />
                  }
                  onPress={() => goToProfile(request.id)}
                  trailing={
                    <FriendRequestButton
                      state="incoming"
                      displayName={request.display_name ?? 'this athlete'}
                      loading={actionLoading}
                      onSend={() => {}}
                      onAccept={() =>
                        acceptRequest.mutate(request.requestId, {
                          onError: onFriendActionError,
                        })
                      }
                      onDecline={() =>
                        declineRequest.mutate(request.requestId, {
                          onError: onFriendActionError,
                        })
                      }
                      onRemove={() => {}}
                    />
                  }
                  style={
                    index > 0
                      ? {
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border.subtle,
                        }
                      : undefined
                  }
                />
              ))
            ) : (
              <EmptyState
                icon="users"
                title="No pending requests"
                description="Requests other athletes send you will show up here."
              />
            )
          ) : outgoing && outgoing.length > 0 ? (
            outgoing.map((request, index) => (
              <ListRow
                key={request.requestId}
                title={
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.xs,
                    }}
                  >
                    <Text variant="body">
                      {request.display_name ?? 'Athlete'}
                    </Text>
                    {request.is_premium ? <ProBadge /> : null}
                  </View>
                }
                subtitle={`${
                  request.handle ? `@${request.handle} · ` : ''
                }Requested ${formatDistanceToNow(new Date(request.createdAt), {
                  addSuffix: true,
                })}`}
                leading={
                  <Avatar
                    uri={request.avatar_url}
                    focalX={request.avatar_focal_x}
                    focalY={request.avatar_focal_y}
                    size={44}
                  />
                }
                onPress={() => goToProfile(request.id)}
                trailing={
                  <FriendRequestButton
                    state="outgoing"
                    displayName={request.display_name ?? 'this athlete'}
                    loading={actionLoading}
                    onSend={() => {}}
                    onAccept={() => {}}
                    onDecline={() => {}}
                    onRemove={() =>
                      removeRequest.mutate(request.requestId, {
                        onError: onFriendActionError,
                      })
                    }
                  />
                }
                style={
                  index > 0
                    ? {
                        borderTopWidth: 1,
                        borderTopColor: theme.colors.border.subtle,
                      }
                    : undefined
                }
              />
            ))
          ) : (
            <EmptyState
              icon="users"
              title="No sent requests"
              description="Requests you send from search will show up here."
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
