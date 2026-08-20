import { useEffect } from 'react';
import { Linking } from 'react-native';
import { supabase } from '../services/api/supabaseClient';
import { useAuthStore } from '../store/authStore';

/**
 * Catches soset://password-changed?status=success|expired|error — the
 * redirect supabase/functions/confirm-password-change sends the browser to
 * once the athlete taps the confirmation link mailed by
 * request-password-change. Doesn't go through RootNavigator's declarative
 * `linking.config.screens` map (the way the WHOOP/Spotify/Oura callbacks
 * do) because this needs to force a local sign-out and land on SignIn
 * regardless of which stack — Auth or the authenticated tree — happens to
 * be mounted when the link is tapped; the server has already invalidated
 * the session via revoke_all_sessions, this just makes the client catch up
 * immediately instead of waiting for a failed token refresh.
 *
 * Mount once near the root (RootNavigator), same lifetime as AuthProvider.
 */
export function usePasswordChangeDeepLink() {
  const setPasswordChangeResult = useAuthStore(state => state.setPasswordChangeResult);
  const signOutLocal = useAuthStore(state => state.signOutLocal);

  useEffect(() => {
    const handleUrl = (url: string) => {
      if (!url.includes('password-changed')) return;
      const status = new URL(url).searchParams.get('status');
      if (status !== 'success' && status !== 'expired' && status !== 'error') return;
      setPasswordChangeResult(status);
      // scope: 'local' only clears this device's stored session — the
      // server-side sessions were already revoked by confirm-password-change
      // regardless of `status` reaching this device at all.
      if (status === 'success') {
        // Flip authStore directly and synchronously rather than relying
        // solely on supabase.auth.signOut() below to eventually round-trip
        // through AuthProvider's onAuthStateChange listener — RootNavigator
        // branches on authStore.isAuthenticated alone (no extra gate), so
        // this is what actually makes the redirect land on Sign In the
        // instant this deep link is handled, instead of only whenever (and
        // if) the SDK's SIGNED_OUT event happens to fire, which isn't
        // guaranteed to be prompt right as a deep link cold-starts the app.
        // signOut() below still runs, for AuthProvider's own
        // queryClient.clear() on that same SIGNED_OUT event.
        signOutLocal();
        supabase.auth.signOut({ scope: 'local' });
      }
    };

    Linking.getInitialURL().then(url => {
      if (url) handleUrl(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, [setPasswordChangeResult, signOutLocal]);
}
