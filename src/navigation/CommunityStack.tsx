import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { CommunityStackParamList } from './types';
import { LeaderboardScreen } from '../screens/community/LeaderboardScreen';
import { CommunityPostsScreen } from '../screens/community/CommunityPostsScreen';
import { FriendProfileScreen } from '../screens/community/FriendProfileScreen';
import { FriendRequestsScreen } from '../screens/community/FriendRequestsScreen';
import { PostDetailScreen } from '../screens/community/PostDetailScreen';
import { UploadPhotoPostScreen } from '../screens/community/UploadPhotoPostScreen';
import { FriendsListScreen } from '../screens/community/FriendsListScreen';
import { MessagesScreen } from '../screens/community/MessagesScreen';
import { ConversationScreen } from '../screens/community/ConversationScreen';
import { SharedWorkoutReviewScreen } from '../screens/community/SharedWorkoutReviewScreen';
import { AtMyGymScreen } from '../screens/community/AtMyGymScreen';
import { AvatarPositionScreen } from '../screens/community/AvatarPositionScreen';

const Stack = createNativeStackNavigator<CommunityStackParamList>();

export function CommunityStack() {
  return (
    <Stack.Navigator initialRouteName="Posts" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Posts" component={CommunityPostsScreen} />
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
      <Stack.Screen name="FriendProfile" component={FriendProfileScreen} />
      <Stack.Screen name="FriendRequests" component={FriendRequestsScreen} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
      <Stack.Screen name="UploadPhotoPost" component={UploadPhotoPostScreen} options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="FriendsList" component={FriendsListScreen} />
      <Stack.Screen name="Messages" component={MessagesScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
      <Stack.Screen name="SharedWorkoutReview" component={SharedWorkoutReviewScreen} />
      <Stack.Screen name="AtMyGym" component={AtMyGymScreen} />
      <Stack.Screen name="AvatarPosition" component={AvatarPositionScreen} options={{ presentation: 'fullScreenModal' }} />
    </Stack.Navigator>
  );
}
