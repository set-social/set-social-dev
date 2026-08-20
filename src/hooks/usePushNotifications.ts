import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  pushEvents,
  registerPushToken,
  getInitialPushNotification,
  parsePushNotificationEvent,
} from '../services/push/pushNotifications';
import { navigateToPushDestination } from '../navigation/navigationRef';

/**
 * The app-wide push notification wiring: registers whatever device token
 * the native side hands back, and turns both a cold-launch tap and a
 * live tap-while-running into the same navigateToPushDestination call.
 * Mounted once, from RootNavigator, for the athlete's whole signed-in
 * session — `userId` goes null across sign-out, which tears the
 * listeners down (there's nothing to register a token *to* while signed
 * out).
 */
export function usePushNotifications(userId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId || !pushEvents) return;

    const subscriptions = [
      pushEvents.addListener('pushTokenReceived', (token: string) => {
        registerPushToken(userId, token);
      }),
      pushEvents.addListener('pushTokenRegistrationFailed', (message: string) => {
        console.warn('Push token registration failed', message);
      }),
      pushEvents.addListener('pushNotificationOpened', (userInfo: Record<string, unknown>) => {
        const payload = parsePushNotificationEvent(userInfo);
        if (payload) navigateToPushDestination(payload);
      }),
      // Arrived while foregrounded — the badge dots (Messages/Friends/
      // Activity on the Social tab, see useNotificationBadges) are the only
      // thing in the app that could otherwise go stale until their next
      // natural refetch.
      pushEvents.addListener('pushNotificationReceived', () => {
        queryClient.invalidateQueries({ queryKey: ['hasUnreadMessages'] });
        queryClient.invalidateQueries({ queryKey: ['hasUnseenActivity'] });
        queryClient.invalidateQueries({ queryKey: ['incomingFriendRequests'] });
      }),
    ];

    getInitialPushNotification().then(payload => {
      if (payload) navigateToPushDestination(payload);
    });

    return () => {
      subscriptions.forEach(sub => sub.remove());
    };
  }, [userId, queryClient]);
}
