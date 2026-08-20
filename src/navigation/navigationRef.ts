import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';
import type { PushNotificationPayload } from '../services/push/pushNotifications';

/** Lets code outside the component tree (the push notification event
 * listeners in usePushNotifications, which fire from a native event, not a
 * screen) drive navigation — nothing else in the app has needed this yet,
 * see RootNavigator's `linking` prop for the one other deep-link path
 * (WHOOP/Spotify OAuth callbacks), which goes through a URL instead. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Maps a push notification's abstract `{screen, params}` (see send-push's
 * ResolvedNotification) onto the actual nested navigation call — every
 * target today lives inside CommunityTab or ProgramsTab, one level under
 * MainTabs, so this is the only place that needs to know that nesting. */
export function navigateToPushDestination(payload: PushNotificationPayload, attempt = 0): void {
  if (!navigationRef.isReady()) {
    // Cold launch (app opened by tapping a killed-state notification):
    // usePushNotifications reads the initial notification as soon as
    // `userId` is set, which happens before RootNavigator clears its
    // splash/bootstrap gate and mounts NavigationContainer — the native
    // side has already consumed launchNotification by this point, so the
    // payload can't be re-fetched, and dropping it here would lose the
    // deep link for good. Retry instead of bailing; ~10s covers even a
    // slow bootstrap comfortably, well past MIN_DISPLAY_DURATION_MS.
    if (attempt >= 100) return;
    setTimeout(() => navigateToPushDestination(payload, attempt + 1), 100);
    return;
  }
  const params = payload.params ?? {};

  switch (payload.screen) {
    case 'Today':
      // Used by streak_risk_nudge/meal_gap_nudge already, and now by
      // morning_brief/recovery_nudge too — previously unhandled here (fell
      // through to `default`, a silent no-op on tap), fixed alongside the
      // new types since both now depend on it actually working.
      navigationRef.navigate('MainTabs', { screen: 'TodayTab', params: { screen: 'Today' } });
      return;
    case 'Conversation':
      navigationRef.navigate('MainTabs', {
        screen: 'CommunityTab',
        params: { screen: 'Conversation', params: { conversationId: params.conversationId as string } },
      });
      return;
    case 'FriendsList':
      navigationRef.navigate('MainTabs', {
        screen: 'CommunityTab',
        params: { screen: 'FriendsList', params: { userId: params.userId as string, title: 'Friends' } },
      });
      return;
    case 'FriendProfile':
      navigationRef.navigate('MainTabs', {
        screen: 'CommunityTab',
        params: { screen: 'FriendProfile', params: { userId: params.userId as string } },
      });
      return;
    case 'PostDetail':
      navigationRef.navigate('MainTabs', {
        screen: 'CommunityTab',
        params: { screen: 'PostDetail', params: { postId: params.postId as string } },
      });
      return;
    case 'ProgramDetail':
      if (!params.programId) {
        navigationRef.navigate('MainTabs', { screen: 'ProgramsTab', params: { screen: 'Calendar' } });
        return;
      }
      navigationRef.navigate('MainTabs', {
        screen: 'ProgramsTab',
        params: { screen: 'ProgramDetail', params: { programId: params.programId as string } },
      });
      return;
    case 'PRDetail':
      if (!params.exerciseId) return;
      navigationRef.navigate('MainTabs', {
        screen: 'ProgressTab',
        params: { screen: 'PRDetail', params: { exerciseId: params.exerciseId as string } },
      });
      return;
    case 'SpotRequest':
      if (!params.requestId) return;
      navigationRef.navigate('SpotRequest', { requestId: params.requestId as string });
      return;
    default:
      // Unknown/future screen name — nothing to navigate to yet; the app
      // still opens normally, just without the deep link.
      return;
  }
}
