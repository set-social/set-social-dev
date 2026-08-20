import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { fetchProfile } from '../services/api/queries/profiles';
import {
  fetchScheduledWorkouts,
  TODAY_RANGE_PAST_DAYS,
  TODAY_RANGE_FUTURE_DAYS,
} from '../services/api/queries/scheduledWorkouts';
import { fetchWorkoutTemplates } from '../services/api/queries/workoutTemplates';
import { fetchFriendsPosts } from '../services/api/queries/posts';
import { fetchIntegrationConnections } from '../services/api/queries/integrations';
import { fetchLatestWhoopMetrics } from '../services/api/queries/whoop';
import { fetchLatestOuraMetrics } from '../services/api/queries/oura';

// Above this, a slow/offline network would strand someone on the splash
// screen — better to let them into the app and have each screen's own
// useQuery fetch (or retry) normally than to block indefinitely.
const BOOTSTRAP_TIMEOUT_MS = 4000;

function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Warms the query cache for what Today's screen (and friends) need, while
 * RootNavigator keeps LoadingScreen up — so the home screen mounts with data
 * already in place instead of showing its own per-section loading states.
 * Only meaningful once a user is authenticated and onboarded; pass
 * `enabled: false` for every other navigation state (Auth/Onboarding), where
 * it no-ops and reports ready immediately.
 */
export function useAppBootstrap({
  enabled,
  userId,
  timeoutMs = BOOTSTRAP_TIMEOUT_MS,
}: {
  enabled: boolean;
  userId: string | null;
  /** Overridable so tests can exercise the timeout fallback without waiting BOOTSTRAP_TIMEOUT_MS in real time. */
  timeoutMs?: number;
}): {
  ready: boolean;
} {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled || !userId) {
      setReady(!enabled);
      return;
    }

    let cancelled = false;
    const today = new Date();
    const rangeFrom = format(addDays(today, -TODAY_RANGE_PAST_DAYS), 'yyyy-MM-dd');
    const rangeTo = format(addDays(today, TODAY_RANGE_FUTURE_DAYS), 'yyyy-MM-dd');

    const prefetchIntegrations = async () => {
      const connections = await queryClient.fetchQuery({
        queryKey: ['integrationConnections', userId],
        queryFn: () => fetchIntegrationConnections(userId),
      });
      const whoopConnected = connections.some(connection => connection.provider === 'whoop');
      if (whoopConnected) {
        await queryClient.prefetchQuery({
          queryKey: ['whoopMetrics', userId],
          queryFn: () => fetchLatestWhoopMetrics(userId),
        });
      }
      const ouraConnected = connections.some(connection => connection.provider === 'oura');
      if (ouraConnected) {
        await queryClient.prefetchQuery({
          queryKey: ['ouraMetrics', userId],
          queryFn: () => fetchLatestOuraMetrics(userId),
        });
      }
    };

    const work = Promise.allSettled([
      queryClient.prefetchQuery({ queryKey: ['profile', userId], queryFn: () => fetchProfile(userId) }),
      queryClient.prefetchQuery({
        queryKey: ['scheduledWorkouts', userId, rangeFrom, rangeTo],
        queryFn: () => fetchScheduledWorkouts(userId, rangeFrom, rangeTo),
      }),
      queryClient.prefetchQuery({
        queryKey: ['workoutTemplates', userId, ''],
        queryFn: () => fetchWorkoutTemplates(userId, ''),
      }),
      queryClient.prefetchQuery({ queryKey: ['friendsPosts', userId], queryFn: () => fetchFriendsPosts(userId) }),
      prefetchIntegrations(),
    ]);

    Promise.race([work, timeout(timeoutMs)]).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, userId, queryClient, timeoutMs]);

  return { ready };
}
