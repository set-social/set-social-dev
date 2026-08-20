import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';

export type PublicProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_focal_x: number;
  avatar_focal_y: number;
  handle: string | null;
  bio: string | null;
  hide_stats_from_friends: boolean;
  hide_photos_from_friends: boolean;
  is_private: boolean;
  is_premium: boolean;
};

export type LeaderboardEntry = PublicProfile & {
  volumeThisMonth: number;
  workoutsThisMonth: number;
  isSelf: boolean;
};

/** Reused outside this file by feed.ts/posts.ts for the same "batch profile lookup" need. */
export async function fetchPublicProfiles(ids: string[]): Promise<PublicProfile[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('public_profiles').select('*').in('id', ids);
  if (error) throw error;
  return data;
}

/** Every id bidirectionally blocked-with this user — reused by every filtering point below, one shared implementation. */
async function fetchBlockedIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('blocked_users')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
  if (error) throw error;
  return new Set(data.map(row => (row.blocker_id === userId ? row.blocked_id : row.blocker_id)));
}

// ---------------------------------------------------------------------------
// Friend relationships — friend_requests (pending/accepted/declined) is the
// one relationship model the app reads from; the older `follows` table is
// left in the schema, unused, rather than dropped.
// ---------------------------------------------------------------------------

/** Accepted-friend ids, blocking already excluded — reused outside this file by feed.ts for feed scoping. */
export async function fetchFriendIds(userId: string): Promise<string[]> {
  const [{ data, error }, blockedIds] = await Promise.all([
    supabase
      .from('friend_requests')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    fetchBlockedIds(userId),
  ]);
  if (error) throw error;
  return data
    .map(row => (row.requester_id === userId ? row.addressee_id : row.requester_id))
    .filter(id => !blockedIds.has(id));
}

export type FriendRequestState = 'none' | 'outgoing' | 'incoming' | 'friends';

export type FriendRelationships = {
  friendIds: Set<string>;
  /** addresseeId -> request id, for requests this user sent that are still pending. */
  outgoingByAddressee: Map<string, string>;
  /** requesterId -> request id, for requests this user received that are still pending. */
  incomingByRequester: Map<string, string>;
};

async function fetchFriendRelationships(userId: string): Promise<FriendRelationships> {
  const [{ data, error }, blockedIds] = await Promise.all([
    supabase
      .from('friend_requests')
      .select('id, requester_id, addressee_id, status')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    fetchBlockedIds(userId),
  ]);
  if (error) throw error;

  const friendIds = new Set<string>();
  const outgoingByAddressee = new Map<string, string>();
  const incomingByRequester = new Map<string, string>();

  for (const row of data) {
    const otherId = row.requester_id === userId ? row.addressee_id : row.requester_id;
    if (blockedIds.has(otherId)) continue;
    if (row.status === 'accepted') {
      friendIds.add(otherId);
    } else if (row.status === 'pending') {
      if (row.requester_id === userId) {
        outgoingByAddressee.set(row.addressee_id, row.id);
      } else {
        incomingByRequester.set(row.requester_id, row.id);
      }
    }
  }
  return { friendIds, outgoingByAddressee, incomingByRequester };
}

export function useFriendRelationships(userId: string | null) {
  return useQuery({
    queryKey: ['friendRelationships', userId],
    queryFn: () => fetchFriendRelationships(userId as string),
    enabled: userId != null,
  });
}

/** Derives one profile's relationship state from a single useFriendRelationships() call — no per-row hooks needed in a list. */
export function resolveFriendRequestState(
  relationships: FriendRelationships | undefined,
  otherUserId: string,
): { state: FriendRequestState; requestId: string | null } {
  if (!relationships) return { state: 'none', requestId: null };
  if (relationships.friendIds.has(otherUserId)) return { state: 'friends', requestId: null };
  const outgoingId = relationships.outgoingByAddressee.get(otherUserId);
  if (outgoingId) return { state: 'outgoing', requestId: outgoingId };
  const incomingId = relationships.incomingByRequester.get(otherUserId);
  if (incomingId) return { state: 'incoming', requestId: incomingId };
  return { state: 'none', requestId: null };
}

/** Followers/following are shown as the same list under two labels — the
 * relationship model is mutual "Friends", not an asymmetric follow graph
 * (see fetchFriendIds's own comment above). */
export function useFriendCount(userId: string | null) {
  return useQuery({
    queryKey: ['friendCount', userId],
    queryFn: async () => (await fetchFriendIds(userId as string)).length,
    enabled: userId != null,
  });
}

async function fetchFriendsList(userId: string): Promise<PublicProfile[]> {
  const friendIds = await fetchFriendIds(userId);
  return fetchPublicProfiles(friendIds);
}

export function useFriendsList(userId: string | null) {
  return useQuery({
    queryKey: ['friendsList', userId],
    queryFn: () => fetchFriendsList(userId as string),
    enabled: userId != null,
  });
}

export type IncomingFriendRequest = PublicProfile & { requestId: string; createdAt: string };

async function fetchIncomingFriendRequests(userId: string): Promise<IncomingFriendRequest[]> {
  const [{ data, error }, blockedIds] = await Promise.all([
    supabase
      .from('friend_requests')
      .select('id, requester_id, created_at')
      .eq('addressee_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    fetchBlockedIds(userId),
  ]);
  if (error) throw error;
  const rows = data.filter(row => !blockedIds.has(row.requester_id));
  if (rows.length === 0) return [];

  const profiles = await fetchPublicProfiles(rows.map(row => row.requester_id));
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));

  const requests: IncomingFriendRequest[] = [];
  for (const row of rows) {
    const profile = profileById.get(row.requester_id);
    if (profile) requests.push({ ...profile, requestId: row.id, createdAt: row.created_at });
  }
  return requests;
}

export function useIncomingFriendRequests(userId: string | null) {
  return useQuery({
    queryKey: ['incomingFriendRequests', userId],
    queryFn: () => fetchIncomingFriendRequests(userId as string),
    enabled: userId != null,
  });
}

export type OutgoingFriendRequest = PublicProfile & { requestId: string; createdAt: string };

async function fetchOutgoingFriendRequests(userId: string): Promise<OutgoingFriendRequest[]> {
  const [{ data, error }, blockedIds] = await Promise.all([
    supabase
      .from('friend_requests')
      .select('id, addressee_id, created_at')
      .eq('requester_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    fetchBlockedIds(userId),
  ]);
  if (error) throw error;
  const rows = data.filter(row => !blockedIds.has(row.addressee_id));
  if (rows.length === 0) return [];

  const profiles = await fetchPublicProfiles(rows.map(row => row.addressee_id));
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));

  const requests: OutgoingFriendRequest[] = [];
  for (const row of rows) {
    const profile = profileById.get(row.addressee_id);
    if (profile) requests.push({ ...profile, requestId: row.id, createdAt: row.created_at });
  }
  return requests;
}

export function useOutgoingFriendRequests(userId: string | null) {
  return useQuery({
    queryKey: ['outgoingFriendRequests', userId],
    queryFn: () => fetchOutgoingFriendRequests(userId as string),
    enabled: userId != null,
  });
}

function invalidateFriendQueries(queryClient: QueryClient, userId: string | null) {
  queryClient.invalidateQueries({ queryKey: ['friendRelationships', userId] });
  queryClient.invalidateQueries({ queryKey: ['incomingFriendRequests', userId] });
  queryClient.invalidateQueries({ queryKey: ['outgoingFriendRequests', userId] });
  queryClient.invalidateQueries({ queryKey: ['leaderboard', userId] });
  queryClient.invalidateQueries({ queryKey: ['activityFeed', userId] });
}

/** Sends a request, or — if the other person already requested us — accepts theirs instead of inserting a duplicate/reverse row. */
export function useSendFriendRequest(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (addresseeId: string) => {
      if (!userId) throw new Error('Not signed in');

      const blockedIds = await fetchBlockedIds(userId);
      if (blockedIds.has(addresseeId)) {
        throw new Error("You can't send a request to this person.");
      }

      const { data: reverse, error: reverseError } = await supabase
        .from('friend_requests')
        .select('id')
        .eq('requester_id', addresseeId)
        .eq('addressee_id', userId)
        .eq('status', 'pending')
        .maybeSingle();
      if (reverseError) throw reverseError;

      if (reverse) {
        const { error } = await supabase
          .from('friend_requests')
          .update({ status: 'accepted', resolved_at: new Date().toISOString() })
          .eq('id', reverse.id);
        if (error) throw error;
        return;
      }

      // A row from an earlier request in this exact direction may already
      // exist — decline (unlike remove) leaves its row behind (status
      // 'declined') rather than deleting it, see 0045_friend_request_resend.
      // A second plain INSERT here would violate friend_requests'
      // unique(requester_id, addressee_id) and throw, which is exactly what
      // made "Add Friend" look like a no-op. Revive that row instead.
      const { data: existing, error: existingError } = await supabase
        .from('friend_requests')
        .select('id, status')
        .eq('requester_id', userId)
        .eq('addressee_id', addresseeId)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        if (existing.status !== 'declined') return; // already pending or accepted
        const { error } = await supabase
          .from('friend_requests')
          .update({ status: 'pending', resolved_at: null })
          .eq('id', existing.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from('friend_requests')
        .insert({ requester_id: userId, addressee_id: addresseeId });
      if (error) throw error;
    },
    onSuccess: () => invalidateFriendQueries(queryClient, userId),
  });
}

export function useAcceptFriendRequest(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('friend_requests')
        .update({ status: 'accepted', resolved_at: new Date().toISOString() })
        .eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: () => invalidateFriendQueries(queryClient, userId),
  });
}

export function useDeclineFriendRequest(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('friend_requests')
        .update({ status: 'declined', resolved_at: new Date().toISOString() })
        .eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: () => invalidateFriendQueries(queryClient, userId),
  });
}

/** Deletes a friend_requests row — cancels a pending outgoing request, or removes ("unfriends") an accepted one. Either participant may call this. */
export function useRemoveFriendRequest(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.from('friend_requests').delete().eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: () => invalidateFriendQueries(queryClient, userId),
  });
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

async function fetchBlockedUsers(userId: string): Promise<PublicProfile[]> {
  const { data, error } = await supabase.from('blocked_users').select('blocked_id').eq('blocker_id', userId);
  if (error) throw error;
  if (data.length === 0) return [];
  return fetchPublicProfiles(data.map(row => row.blocked_id));
}

/** Profiles the *current* user has blocked (not bidirectional — you can only unblock your own blocks). */
export function useBlockedUsers(userId: string | null) {
  return useQuery({
    queryKey: ['blockedUsers', userId],
    queryFn: () => fetchBlockedUsers(userId as string),
    enabled: userId != null,
  });
}

async function fetchIsBlocked(userId: string, otherId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('blocked_users')
    .select('blocker_id')
    .or(
      `and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`,
    )
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/** Bidirectional — true if either user has blocked the other. */
export function useIsBlocked(userId: string | null, otherId: string | null) {
  return useQuery({
    queryKey: ['isBlocked', userId, otherId],
    queryFn: () => fetchIsBlocked(userId as string, otherId as string),
    enabled: userId != null && otherId != null,
  });
}

function invalidateBlockQueries(queryClient: QueryClient, userId: string | null) {
  queryClient.invalidateQueries({ queryKey: ['blockedUsers', userId] });
  queryClient.invalidateQueries({ queryKey: ['isBlocked'] });
  queryClient.invalidateQueries({ queryKey: ['searchProfiles'] });
  invalidateFriendQueries(queryClient, userId);
}

/** Blocking always severs any existing/pending friend relationship first, then records the block. */
export function useBlockUser(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blockedId: string) => {
      if (!userId) throw new Error('Not signed in');

      const { error: deleteError } = await supabase
        .from('friend_requests')
        .delete()
        .or(
          `and(requester_id.eq.${userId},addressee_id.eq.${blockedId}),and(requester_id.eq.${blockedId},addressee_id.eq.${userId})`,
        );
      if (deleteError) throw deleteError;

      const { error } = await supabase.from('blocked_users').insert({ blocker_id: userId, blocked_id: blockedId });
      if (error) throw error;
    },
    onSuccess: () => invalidateBlockQueries(queryClient, userId),
  });
}

export function useUnblockUser(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blockedId: string) => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase
        .from('blocked_users')
        .delete()
        .eq('blocker_id', userId)
        .eq('blocked_id', blockedId);
      if (error) throw error;
    },
    onSuccess: () => invalidateBlockQueries(queryClient, userId),
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Strips characters with special meaning in PostgREST's `.or()` filter
 * syntax (comma, parens) plus ilike wildcards, so raw user input can never
 * inject extra filter clauses or wildcards into the query below. */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%_]/g, '');
}

/** A leading "@" signals "search by handle" (e.g. "@sam") but matches
 * display name too either way — someone typing "@sam" almost certainly
 * still wants a display-name match named Sam if no handle matches. Shared
 * between the query and the screen's "keep typing" gate so they can't drift
 * out of sync on what counts toward the minimum length. */
export function normalizedSearchTerm(search: string): string {
  return sanitizeSearchTerm(search.trim().replace(/^@/, ''));
}

/** Below this, don't search at all — a couple of characters matches too
 * many unrelated athletes to be useful. Prefix matching (below) then means
 * results only appear once typing is close to someone's actual name/handle,
 * and naturally narrow toward a single athlete as more is typed, rather than
 * showing the whole user base from the first keystroke. */
export const MIN_SEARCH_LENGTH = 3;

async function searchProfiles(search: string, excludeUserId: string): Promise<PublicProfile[]> {
  const term = normalizedSearchTerm(search);
  if (term.length < MIN_SEARCH_LENGTH) return [];

  const [{ data, error }, blockedIds] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('*')
      // Prefix match, not "contains anywhere" — otherwise a short query
      // matches unrelated athletes with that substring buried mid-name.
      .or(`display_name.ilike.${term}%,handle.ilike.${term}%`)
      .neq('id', excludeUserId)
      .limit(20),
    fetchBlockedIds(excludeUserId),
  ]);
  if (error) throw error;

  // Rank the closest matches first: an exact name/handle match beats a
  // prefix match, and among prefix matches a shorter name is a tighter fit
  // to what's been typed so far (e.g. "Sam" over "Samantha" for query "sam")
  // — so the list keeps narrowing toward one athlete as typing continues.
  const lowerTerm = term.toLowerCase();
  const closeness = (profile: PublicProfile): number => {
    const name = profile.display_name?.toLowerCase() ?? '';
    const handle = profile.handle?.toLowerCase() ?? '';
    if (name === lowerTerm || handle === lowerTerm) return 0;
    return Math.min(name.startsWith(lowerTerm) ? name.length : Infinity, handle.startsWith(lowerTerm) ? handle.length : Infinity);
  };

  return data.filter(profile => !blockedIds.has(profile.id)).sort((a, b) => closeness(a) - closeness(b));
}

export function useSearchProfiles(search: string, excludeUserId: string | null) {
  return useQuery({
    queryKey: ['searchProfiles', search, excludeUserId],
    queryFn: () => searchProfiles(search, excludeUserId as string),
    enabled: excludeUserId != null && normalizedSearchTerm(search).length >= MIN_SEARCH_LENGTH,
  });
}

// ---------------------------------------------------------------------------
// Leaderboard / activity feed — scoped to accepted friends (+ self)
// ---------------------------------------------------------------------------

async function fetchLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
  const friendIds = await fetchFriendIds(userId);
  const ids = Array.from(new Set([userId, ...friendIds]));

  const [{ data: stats, error: statsError }, profiles] = await Promise.all([
    supabase.from('leaderboard_stats').select('*').in('user_id', ids),
    fetchPublicProfiles(ids),
  ]);
  if (statsError) throw statsError;

  const statsByUserId = new Map(stats.map(row => [row.user_id, row]));
  const entries = profiles.map(profile => ({
    ...profile,
    volumeThisMonth: statsByUserId.get(profile.id)?.volume_this_month ?? 0,
    workoutsThisMonth: statsByUserId.get(profile.id)?.workouts_this_month ?? 0,
    isSelf: profile.id === userId,
  }));
  return entries.sort((a, b) => b.volumeThisMonth - a.volumeThisMonth);
}

export function useLeaderboard(userId: string | null) {
  return useQuery({
    queryKey: ['leaderboard', userId],
    queryFn: () => fetchLeaderboard(userId as string),
    enabled: userId != null,
  });
}

/** friend_consistency_percentile() isn't in the generated
 * Database['public']['Functions'] type (see nearby_checkins' own comment in
 * location.ts for why), so this RPC call is typed locally the same way.
 * Casts `supabase` itself, not an extracted `.rpc` reference, for the same
 * `this`-binding reason documented there. Returns null when the caller has
 * no eligible friends to compare against yet — the function itself never
 * returns a per-friend row, only the caller's own percentile. */
async function fetchFriendConsistencyPercentile(): Promise<number | null> {
  const client = supabase as unknown as {
    rpc: (fn: 'friend_consistency_percentile') => Promise<{ data: number | null; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc('friend_consistency_percentile');
  if (error) throw new Error(error.message);
  return data;
}

export function useFriendConsistencyPercentile(userId: string | null) {
  return useQuery({
    queryKey: ['friendConsistencyPercentile', userId],
    queryFn: fetchFriendConsistencyPercentile,
    enabled: userId != null,
    staleTime: 60_000,
  });
}

async function fetchActivityFeed(userId: string) {
  const friendIds = await fetchFriendIds(userId);
  if (friendIds.length === 0) return [];
  const { data, error } = await supabase
    .from('activity_feed')
    .select('*')
    .in('user_id', friendIds)
    .order('completed_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data;
}

export function useActivityFeed(userId: string | null) {
  return useQuery({
    queryKey: ['activityFeed', userId],
    queryFn: () => fetchActivityFeed(userId as string),
    enabled: userId != null,
  });
}

async function fetchFriendProfile(targetUserId: string) {
  const [{ data: profile, error: profileError }, { data: stats, error: statsError }] =
    await Promise.all([
      supabase.from('public_profiles').select('*').eq('id', targetUserId).single(),
      supabase.from('leaderboard_stats').select('*').eq('user_id', targetUserId).maybeSingle(),
    ]);
  if (profileError) throw profileError;
  if (statsError) throw statsError;
  return {
    ...profile,
    volumeThisMonth: stats?.volume_this_month ?? 0,
    workoutsThisMonth: stats?.workouts_this_month ?? 0,
  };
}

export function useFriendProfile(targetUserId: string | null) {
  return useQuery({
    queryKey: ['friendProfile', targetUserId],
    queryFn: () => fetchFriendProfile(targetUserId as string),
    enabled: targetUserId != null,
  });
}
