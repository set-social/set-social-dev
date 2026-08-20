import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from './types';
import { SettingsScreen } from '../screens/profile/SettingsScreen';
import { NotificationSettingsScreen } from '../screens/profile/NotificationSettingsScreen';
import { AccountScreen } from '../screens/profile/AccountScreen';
import { PrivacyScreen } from '../screens/profile/PrivacyScreen';
import { BlockedUsersScreen } from '../screens/profile/BlockedUsersScreen';
import { IntegrationsScreen } from '../screens/profile/IntegrationsScreen';
import { EquipmentScreen } from '../screens/profile/EquipmentScreen';
import { PostDetailScreen } from '../screens/community/PostDetailScreen';
import { FriendsListScreen } from '../screens/community/FriendsListScreen';
import { FriendProfileScreen } from '../screens/community/FriendProfileScreen';
import { ConversationScreen } from '../screens/community/ConversationScreen';
import { SharedWorkoutReviewScreen } from '../screens/community/SharedWorkoutReviewScreen';
import { AvatarPositionScreen } from '../screens/community/AvatarPositionScreen';
import { UploadPhotoPostScreen } from '../screens/community/UploadPhotoPostScreen';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
  return (
    <Stack.Navigator initialRouteName="Settings" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
      <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
      <Stack.Screen name="Integrations" component={IntegrationsScreen} />
      <Stack.Screen name="Equipment" component={EquipmentScreen} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
      <Stack.Screen name="FriendsList" component={FriendsListScreen} />
      {/* These five exist only so PostDetail's comment-avatar tap (and every
          screen it can lead to, including FriendProfile's own self-view
          actions) work when PostDetail itself is reached from the Profile
          tab, not the Community tab — see the doc comment on
          ProfileStackParamList in navigation/types.ts. */}
      <Stack.Screen name="FriendProfile" component={FriendProfileScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
      <Stack.Screen name="SharedWorkoutReview" component={SharedWorkoutReviewScreen} />
      <Stack.Screen name="AvatarPosition" component={AvatarPositionScreen} options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="UploadPhotoPost" component={UploadPhotoPostScreen} options={{ presentation: 'fullScreenModal' }} />
    </Stack.Navigator>
  );
}
