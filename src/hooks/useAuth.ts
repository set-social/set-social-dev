import { useState, useCallback } from 'react';
import { supabase } from '../services/api/supabaseClient';
import { requestPasswordChange as requestPasswordChangeApi } from '../services/api/edgeFunctions';

type AuthResult = { error: string | null };
/** hasSession is false when the Supabase project still requires email
 * confirmation before a session is issued — signUp succeeds either way, but
 * only an active session lets AuthProvider's onAuthStateChange listener pick
 * the new user up and route them into onboarding automatically.
 * userId is returned directly (rather than making callers wait on
 * useAuthStore to pick it up via that same listener) so a caller that needs
 * to write a profiles row right after signing up — see SignUpScreen — isn't
 * racing RootNavigator's own auth-state-driven navigation swap. */
type SignUpResult = AuthResult & { hasSession: boolean; userId: string | null };

/** Thin wrapper around supabase.auth mutations with local loading/error state. */
export function useAuth() {
  const [loading, setLoading] = useState(false);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    return { error: error?.message ?? null, hasSession: data.session != null, userId: data.user?.id ?? null };
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async (): Promise<AuthResult> => {
    setLoading(true);
    const { error } = await supabase.auth.signOut();
    setLoading(false);
    return { error: error?.message ?? null };
  }, []);

  // Doesn't apply the password itself — see edgeFunctions.requestPasswordChange.
  // The athlete gets a confirmation email from support@setsocial.app and has
  // to log back in with the new password once they tap it.
  const requestPasswordChange = useCallback(async (password: string): Promise<AuthResult> => {
    setLoading(true);
    try {
      await requestPasswordChangeApi(password);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not send confirmation email.' };
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, signIn, signUp, resetPassword, signOut, requestPasswordChange };
}
