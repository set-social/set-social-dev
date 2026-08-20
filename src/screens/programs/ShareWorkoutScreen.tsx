import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView } from 'react-native';
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
import { useAuthStore } from '../../store/authStore';
import { useFriendsList } from '../../services/api/queries/community';
import { useStartConversation } from '../../services/api/queries/directMessages';
import { useCreateWorkoutShare } from '../../services/api/queries/workoutShares';
import type {
  ProgramsStackParamList,
  RootStackParamList,
} from '../../navigation/types';

type Route = RouteProp<ProgramsStackParamList, 'ShareWorkout'>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Recipient picker for sending a workout/weekly-plan share — the first
 * "pick a friend to message" UI anywhere in this app (every existing DM
 * entry point already knows who it's messaging, e.g. FriendProfileScreen's
 * "Message" button goes straight to useStartConversation). Rendered the
 * same way FriendsListScreen already lists friends (Avatar + ListRow),
 * since there's no reusable picker component yet to import.
 *
 * Registered on ProgramsStack (reached from a workout screen or Calendar),
 * but lands the athlete in the resulting DM via the ROOT navigator —
 * Conversation only exists on CommunityStack, a different tab.
 */
export function ShareWorkoutScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const rootNavigation = useNavigation<RootNav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const { data: friends, isLoading } = useFriendsList(userId);
  const startConversation = useStartConversation();
  const createShare = useCreateWorkoutShare();
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const onShareWith = async (friendId: string) => {
    if (!userId || sendingTo) return;
    setSendingTo(friendId);
    try {
      const conversation = await startConversation.mutateAsync({
        userId,
        otherUserId: friendId,
      });
      await createShare.mutateAsync({
        conversationId: conversation.id,
        senderId: userId,
        recipientId: friendId,
        shareType: params.shareType,
        title: params.title,
        payload: params.payload,
      });
      rootNavigation.navigate('MainTabs', {
        screen: 'CommunityTab',
        params: {
          screen: 'Conversation',
          params: { conversationId: conversation.id },
        },
      });
    } catch (err) {
      setSendingTo(null);
      Alert.alert(
        'Could not share workout',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title={`Share "${params.title}"`} />
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
              trailing={
                sendingTo === friend.id ? (
                  <ActivityIndicator color={theme.colors.accent.primary} />
                ) : undefined
              }
              onPress={sendingTo ? undefined : () => onShareWith(friend.id)}
            />
          ))}
        </ScrollView>
      ) : (
        <EmptyState
          icon="users"
          title="No friends yet"
          description="Add friends to share workouts with them."
        />
      )}
    </SafeAreaView>
  );
}
