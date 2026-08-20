import { renderHook, act } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { usePasswordChangeDeepLink } from '../usePasswordChangeDeepLink';
import { useAuthStore } from '../../store/authStore';

const mockSignOut = jest.fn();
jest.mock('../../services/api/supabaseClient', () => ({
  supabase: { auth: { signOut: (...args: unknown[]) => mockSignOut(...args) } },
}));

describe('usePasswordChangeDeepLink', () => {
  let urlListener: ((event: { url: string }) => void) | null = null;

  beforeEach(() => {
    mockSignOut.mockReset();
    urlListener = null;
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
    jest.spyOn(Linking, 'addEventListener').mockImplementation((_event, listener) => {
      urlListener = listener as (event: { url: string }) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof Linking.addEventListener>;
    });
    useAuthStore.setState({
      isAuthenticated: true,
      userId: 'user-1',
      onboardingCompleted: true,
      hydrated: true,
      passwordChangeResult: null,
    });
  });

  // Regression test: this used to only call supabase.auth.signOut() and wait
  // for AuthProvider's onAuthStateChange listener to eventually notice and
  // flip authStore — RootNavigator branches on authStore.isAuthenticated
  // directly, so a slow/delayed SDK event meant the app opened but never
  // actually redirected to Sign In.
  it('signs the user out of authStore immediately (not just via the async supabase.auth.signOut round-trip) on a success redirect', async () => {
    await renderHook(() => usePasswordChangeDeepLink());

    await act(async () => {
      urlListener?.({ url: 'soset://password-changed?status=success' });
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().userId).toBe(null);
    expect(useAuthStore.getState().passwordChangeResult).toBe('success');
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('records the result without signing out for a non-success status', async () => {
    await renderHook(() => usePasswordChangeDeepLink());

    await act(async () => {
      urlListener?.({ url: 'soset://password-changed?status=expired' });
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().passwordChangeResult).toBe('expired');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('ignores urls unrelated to password-changed', async () => {
    await renderHook(() => usePasswordChangeDeepLink());

    await act(async () => {
      urlListener?.({ url: 'soset://something-else' });
    });

    expect(useAuthStore.getState().passwordChangeResult).toBe(null);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
