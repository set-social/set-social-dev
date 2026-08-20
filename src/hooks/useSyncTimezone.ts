import { useEffect } from 'react';
import { supabase } from '../services/api/supabaseClient';

/**
 * Syncs the device's own IANA timezone to profiles.timezone once per
 * signed-in session — the proactive-coach cron sweep is the first thing
 * that ever needs a user's local time server-side, and there's no other
 * source for it. Fire-and-forget, same "never block the app" contract as
 * registerPushToken: a failed sync just means the sweep treats this user as
 * UTC until the next successful one.
 */
export function useSyncTimezone(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    supabase
      .from('profiles')
      .update({ timezone })
      .eq('id', userId)
      .then(({ error }) => {
        if (error) console.warn('useSyncTimezone failed', error);
      });
  }, [userId]);
}
