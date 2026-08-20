import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppBootstrap } from '../useAppBootstrap';

jest.mock('../../services/api/queries/profiles', () => ({
  fetchProfile: jest.fn(() => new Promise(() => {})),
}));
jest.mock('../../services/api/queries/scheduledWorkouts', () => ({
  fetchScheduledWorkouts: jest.fn(() => new Promise(() => {})),
  TODAY_RANGE_PAST_DAYS: 91,
  TODAY_RANGE_FUTURE_DAYS: 21,
}));
jest.mock('../../services/api/queries/workoutTemplates', () => ({
  fetchWorkoutTemplates: jest.fn(() => new Promise(() => {})),
}));
jest.mock('../../services/api/queries/posts', () => ({
  fetchFriendsPosts: jest.fn(() => new Promise(() => {})),
}));
jest.mock('../../services/api/queries/integrations', () => ({
  fetchIntegrationConnections: jest.fn(() => new Promise(() => {})),
}));
jest.mock('../../services/api/queries/whoop', () => ({
  fetchLatestWhoopMetrics: jest.fn(() => new Promise(() => {})),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  // gcTime: 0 so prefetched (observer-less) cache entries don't leave a
  // pending 5-minute garbage-collection setTimeout open after each test —
  // that dangling handle is what keeps Jest's process alive past the test run.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAppBootstrap', () => {
  it('is immediately ready and fetches nothing when disabled', async () => {
    const { fetchProfile } = jest.requireMock('../../services/api/queries/profiles');
    const { result } = await renderHook(() => useAppBootstrap({ enabled: false, userId: null }), { wrapper });

    expect(result.current.ready).toBe(true);
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it('becomes ready once every prefetch settles', async () => {
    const profiles = jest.requireMock('../../services/api/queries/profiles');
    const scheduled = jest.requireMock('../../services/api/queries/scheduledWorkouts');
    const templates = jest.requireMock('../../services/api/queries/workoutTemplates');
    const posts = jest.requireMock('../../services/api/queries/posts');
    const integrations = jest.requireMock('../../services/api/queries/integrations');
    profiles.fetchProfile.mockResolvedValueOnce({ id: 'user-1' });
    scheduled.fetchScheduledWorkouts.mockResolvedValueOnce([]);
    templates.fetchWorkoutTemplates.mockResolvedValueOnce([]);
    posts.fetchFriendsPosts.mockResolvedValueOnce([]);
    integrations.fetchIntegrationConnections.mockResolvedValueOnce([]);

    // A short timeoutMs here too, just so the race's losing setTimeout
    // doesn't linger as an open handle after the test finishes.
    const { result } = await renderHook(() => useAppBootstrap({ enabled: true, userId: 'user-1', timeoutMs: 50 }), {
      wrapper,
    });

    // renderHook already flushes pending effects/microtasks before resolving,
    // and every prefetch here resolves synchronously-ish (mockResolvedValueOnce
    // with no delay), so `ready` can already be true by this point.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.ready).toBe(true);
  });

  it('becomes ready after the timeout even if a prefetch never resolves', async () => {
    const { result } = await renderHook(() => useAppBootstrap({ enabled: true, userId: 'user-1', timeoutMs: 20 }), {
      wrapper,
    });
    expect(result.current.ready).toBe(false);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    });

    expect(result.current.ready).toBe(true);
  });
});
