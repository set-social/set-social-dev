import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Header,
  ListRow,
  Avatar,
  LoadingState,
  EmptyState,
} from '../../components/core';
import { useFriendsList } from '../../services/api/queries/community';
import type {
  CommunityStackParamList,
  ProfileStackParamList,
  RootStackParamList,
} from '../../navigation/types';

type Route = RouteProp<
  CommunityStackParamList | ProfileStackParamList,
  'FriendsList'
>;

/** Followers and Following both land here — the app's relationship model is
 * mutual "Friends" (see fetchFriendIds), so the two lists are identical;
 * `params.title` only changes the header label. This screen is registered
 * in both CommunityStack and ProfileStack (own profile can link here too),
 * but FriendProfile only exists in CommunityStackParamList — every row
 * always routes through the root navigator to Community's FriendProfile
 * rather than a local stack navigate, so it works regardless of which stack
 * this screen was actually pushed from (same pattern ProfileScreen uses to
 * reach UploadPhotoPost from outside CommunityStack). */
export function FriendsListScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<Route>();
  const { data: friends, isLoading, refetch } = useFriendsList(params.userId);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const goToFriendProfile = (friendId: string) => {
    rootNavigation.navigate('MainTabs', {
      screen: 'CommunityTab',
      params: { screen: 'FriendProfile', params: { userId: friendId } },
    });
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title={params.title} />
      {isLoading ? (
        <LoadingState />
      ) : friends != null && friends.length > 0 ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            paddingBottom: theme.spacing.lg + tabBarHeight,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent.primary}
            />
          }
        >
          {friends.map(friend => (
            <ListRow
              key={friend.id}
              leading={
                <Avatar
                  uri={friend.avatar_url}
                  focalX={friend.avatar_focal_x}
                  focalY={friend.avatar_focal_y}
                  size={40}
                />
              }
              title={friend.display_name ?? 'Athlete'}
              subtitle={friend.handle ? `@${friend.handle}` : undefined}
              showChevron
              onPress={() => goToFriendProfile(friend.id)}
            />
          ))}
        </ScrollView>
      ) : (
        <EmptyState icon="users" title="No friends yet" />
      )}
    </SafeAreaView>
  );
}
