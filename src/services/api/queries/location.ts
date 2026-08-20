import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchPublicProfiles, type PublicProfile } from './community';
import type { Coordinates } from '../../location/currentLocation';

/** A check-in is good for at most this long — a hard ceiling filtered at
 * read time (useMyCheckin, nearby_checkins()), same as before. In practice
 * most check-ins end sooner than this via
 * auto_checkout_idle_gym_checkins() (0053_gym_checkin_idle_timeout.sql), a
 * cron sweep that deletes the row once an hour passes with no new set
 * logged — this constant just bounds how long a check-in can live if
 * that idle check somehow never fires. */
const CHECKIN_DURATION_HOURS = 4;
const DEFAULT_RADIUS_METERS = 150;

export type GymCheckin = {
  checkedInAt: string;
  expiresAt: string;
};

async function fetchMyCheckin(userId: string): Promise<GymCheckin | null> {
  const { data, error } = await supabase
    .from('gym_checkins')
    .select('checked_in_at, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Not yet cleaned up server-side, but expired all the same — reads as
  // "not checked in" everywhere else, so it should here too.
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return { checkedInAt: data.checked_in_at, expiresAt: data.expires_at };
}

export function useMyCheckin(userId: string | null) {
  return useQuery({
    queryKey: ['myCheckin', userId],
    queryFn: () => fetchMyCheckin(userId as string),
    enabled: userId != null,
  });
}

function invalidateCheckinQueries(queryClient: ReturnType<typeof useQueryClient>, userId: string | null) {
  queryClient.invalidateQueries({ queryKey: ['myCheckin', userId] });
  // Prefix match — catches ['nearbyCheckins', radiusMeters] regardless of
  // which radius is currently in view.
  queryClient.invalidateQueries({ queryKey: ['nearbyCheckins'] });
}

export function useCheckIn(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (coords: Coordinates) => {
      if (!userId) throw new Error('Not signed in');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CHECKIN_DURATION_HOURS * 60 * 60 * 1000);
      const { error } = await supabase.from('gym_checkins').upsert(
        {
          user_id: userId,
          latitude: coords.latitude,
          longitude: coords.longitude,
          checked_in_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidateCheckinQueries(queryClient, userId),
  });
}

export function useCheckOut(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase.from('gym_checkins').delete().eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => invalidateCheckinQueries(queryClient, userId),
  });
}

export type NearbyAthlete = PublicProfile & { distanceMeters: number };

/** nearby_checkins() isn't in the generated Database['public']['Functions']
 * type (see the comment above Functions in database.ts — populating it
 * breaks unrelated embedded-relationship inference elsewhere), so this RPC
 * call is typed locally, same pattern SignUpScreen uses for is_handle_taken.
 * Casts `supabase` itself, not an extracted `.rpc` reference — supabase-js's
 * rpc() relies on `this` internally, so pulling it out first drops that
 * binding and throws at runtime despite type-checking fine. */
type NearbyCheckinRow = { user_id: string; distance_meters: number };

async function fetchNearbyAthletes(radiusMeters: number): Promise<NearbyAthlete[]> {
  const client = supabase as unknown as {
    rpc: (
      fn: 'nearby_checkins',
      args: { p_radius_meters: number },
    ) => Promise<{ data: NearbyCheckinRow[] | null; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc('nearby_checkins', { p_radius_meters: radiusMeters });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const profiles = await fetchPublicProfiles(rows.map(row => row.user_id));
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));

  // rows is already distance-sorted by the RPC — preserve that order rather
  // than whatever order fetchPublicProfiles' `.in()` happened to return.
  return rows
    .map(row => {
      const profile = profileById.get(row.user_id);
      return profile ? { ...profile, distanceMeters: row.distance_meters } : null;
    })
    .filter((row): row is NearbyAthlete => row != null);
}

/** Only meaningful once the caller has an active check-in of their own —
 * nearby_checkins() derives "nearby" from the caller's own last check-in
 * location server-side, so `enabled` should reflect useMyCheckin's result,
 * not just whether userId is known. */
export function useNearbyCheckins(enabled: boolean, radiusMeters: number = DEFAULT_RADIUS_METERS) {
  return useQuery({
    queryKey: ['nearbyCheckins', radiusMeters],
    queryFn: () => fetchNearbyAthletes(radiusMeters),
    enabled,
    // A minute-old "who's nearby" list is fine — this isn't a chat, and
    // repolling faster just churns the query for no visible benefit.
    staleTime: 60_000,
  });
}
