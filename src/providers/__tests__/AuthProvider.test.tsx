import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { AuthProvider } from '../AuthProvider';
import { useAuthStore } from '../../store/authStore';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSingle = jest.fn();

jest.mock('../../services/api/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: (...args: unknown[]) => mockSingle(...args),
        }),
      }),
    }),
  },
}));

jest.mock('../../services/purchases/revenueCat', () => ({
  configureRevenueCat: jest.fn(),
  identifyRevenueCatUser: jest.fn(),
  resetRevenueCatUser: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: jest.fn() }),
}));

const SESSION = { user: { id: 'user-1' } };

beforeEach(() => {
  mockGetSession.mockReset();
  mockOnAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  mockSingle.mockReset().mockResolvedValue({ data: { onboarding_completed: true }, error: null });
  useAuthStore.setState({
    isAuthenticated: false,
    userId: null,
    onboardingCompleted: false,
    hydrated: false,
    passwordChangeResult: null,
  });
});

describe('AuthProvider', () => {
  it('authenticates normally from a real getSession() session when there is no pending password change', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION } });

    await render(
      <AuthProvider>
        <></>
      </AuthProvider>,
    );

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    expect(useAuthStore.getState().userId).toBe('user-1');
  });

  // Regression test: two independent async reads (this effect's own
  // getSession(), and usePasswordChangeDeepLink's sign-out) race on cold
  // start with no guaranteed ordering. Simulated here by seeding
  // passwordChangeResult BEFORE mount, the same state a deep link that won
  // the race first would leave behind — getSession() must not be allowed to
  // re-authenticate over it even though it resolves with a real-looking
  // session (a stale one, not yet cleared from local storage).
  it('never re-authenticates from a stale session when a password-change sign-out is locked in', async () => {
    useAuthStore.setState({ passwordChangeResult: 'success' });
    mockGetSession.mockResolvedValue({ data: { session: SESSION } });

    await render(
      <AuthProvider>
        <></>
      </AuthProvider>,
    );

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    // Give the stale-session branch a chance to run if the bug were present.
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().userId).toBe(null);
  });

  it('signs out normally when there is no session at all', async () => {
    useAuthStore.setState({ isAuthenticated: true, userId: 'user-1' });
    mockGetSession.mockResolvedValue({ data: { session: null } });

    await render(
      <AuthProvider>
        <></>
      </AuthProvider>,
    );

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
  });
});
