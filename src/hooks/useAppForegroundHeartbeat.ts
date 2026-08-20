import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../services/api/supabaseClient';

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Writes profiles.last_foreground_at once on foregrounding and again every
 * ~60s while the app stays foregrounded, then simply stops on backgrounding
 * — server-side (send-push's isActiveInApp) treats anything older than
 * ~90s as "not active", so there's no separate background write needed and
 * no risk of getting stuck "active" if the app is killed outright. This is
 * what lets the newer proactive-coach pushes (morning brief, PR alerts,
 * recovery nudges, friend-live) skip anyone currently looking at the app.
 * Fire-and-forget, same posture as useSyncTimezone.
 */
export function useAppForegroundHeartbeat(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const beat = () => {
      supabase
        .from('profiles')
        .update({ last_foreground_at: new Date().toISOString() })
        .eq('id', userId)
        .then(({ error }) => {
          if (error) console.warn('useAppForegroundHeartbeat failed', error);
        });
    };

    const startHeartbeat = () => {
      if (intervalId) return;
      beat();
      intervalId = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    };

    const stopHeartbeat = () => {
      if (!intervalId) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    if (AppState.currentState === 'active') startHeartbeat();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') startHeartbeat();
      else stopHeartbeat();
    });

    return () => {
      stopHeartbeat();
      subscription.remove();
    };
  }, [userId]);
}
