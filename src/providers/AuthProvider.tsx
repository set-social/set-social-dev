import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/api/supabaseClient';
import { useAuthStore } from '../store/authStore';
import { configureRevenueCat, identifyRevenueCatUser, resetRevenueCatUser } from '../services/purchases/revenueCat';
import type { Session } from '@supabase/supabase-js';

async function resolveOnboardingCompleted(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_completed')
    .eq('id', userId)
    .single();
  // A missing row (still being created by the handle_new_user trigger, or a
  // transient read error) is treated as "onboarding not complete" rather than
  // thrown — this only gates which stack renders, not real data access.
  if (error || !data) return false;
  return data.onboarding_completed;
}

/**
 * Subscribes to Supabase auth state for the lifetime of the app and mirrors
 * it into authStore, which RootNavigator branches on. Mount once at the root,
 * inside QueryClientProvider (sign-out clears the query cache).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const setSession = useAuthStore(state => state.setSession);
  const signOutLocal = useAuthStore(state => state.signOutLocal);

  useEffect(() => {
    let cancelled = false;

    const applySession = async (session: Session | null) => {
      // A confirmed password change just force-signed this device out for
      // security (see usePasswordChangeDeepLink) — but that handler and
      // this effect's own supabase.auth.getSession() below are two
      // independent async reads with no guaranteed ordering. If
      // getSession() happens to resolve after the sign-out flag is set but
      // reads a session that hadn't been cleared from local storage yet, it
      // would otherwise re-authenticate the athlete with a session the
      // server already revoked — the app looks signed in, but every real
      // request silently fails against that dead session (this is the
      // "blank profile" symptom). authStore.passwordChangeResult stays
      // 'success' until SignInScreen's own onSubmit clears it on a genuine
      // new login attempt, so it's a reliable lock regardless of how these
      // two races land — never let a session, stale-looking or not,
      // override it.
      if (useAuthStore.getState().passwordChangeResult === 'success') {
        if (!cancelled) signOutLocal();
        resetRevenueCatUser();
        return;
      }
      if (!session?.user) {
        if (!cancelled) signOutLocal();
        resetRevenueCatUser();
        return;
      }
      identifyRevenueCatUser(session.user.id);
      const onboardingCompleted = await resolveOnboardingCompleted(session.user.id);
      if (!cancelled) {
        setSession({ userId: session.user.id, onboardingCompleted });
      }
    };

    configureRevenueCat();
    supabase.auth.getSession().then(({ data }) => applySession(data.session));

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
      }
      applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
