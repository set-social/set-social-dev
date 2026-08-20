import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchPublicProfiles } from './community';
import type { SpotRequestStatus } from '../../../types/database';

/** Matches the migration's expires_at = created_at + this — see
 * 0084_spot_requests.sql's file header for why a spot request is
 * deliberately short-lived (it's only useful while the athlete is still
 * mid-set, not a general standing ask). */
export const SPOT_REQUEST_DURATION_SECONDS = 120;

export type SpotRequestDetail = {
  id: string;
  requesterId: string;
  requesterDisplayName: string | null;
  requesterAvatarUrl: string | null;
  requesterAvatarFocalX: number;
  requesterAvatarFocalY: number;
  exerciseName: string;
  setNumber: number | null;
  loadKg: number | null;
  status: SpotRequestStatus;
  responderId: string | null;
  createdAt: string;
  expiresAt: string;
  /** Null when the caller has no active check-in of their own (e.g. the
   * requester viewing their own sent request) — get_spot_request() only
   * computes this between two active check-ins. */
  distanceMeters: number | null;
};

/** get_spot_request/respond_to_spot_request aren't in the generated
 * Database['public']['Functions'] type (see database.ts's own comment on
 * Functions — populating it breaks unrelated embedded-relationship
 * inference elsewhere), so these RPC calls are typed locally, same pattern
 * location.ts's fetchNearbyAthletes already established. Casts `supabase`
 * itself, not an extracted `.rpc` reference — supabase-js's rpc() relies on
 * `this` internally. */
type GetSpotRequestRow = {
  id: string;
  requester_id: string;
  requester_display_name: string | null;
  requester_avatar_url: string | null;
  requester_avatar_focal_x: number;
  requester_avatar_focal_y: number;
  exercise_name: string;
  set_number: number | null;
  load_kg: number | null;
  status: SpotRequestStatus;
  responder_id: string | null;
  created_at: string;
  expires_at: string;
  distance_meters: number | null;
};

function toDetail(row: GetSpotRequestRow): SpotRequestDetail {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterDisplayName: row.requester_display_name,
    requesterAvatarUrl: row.requester_avatar_url,
    requesterAvatarFocalX: row.requester_avatar_focal_x,
    requesterAvatarFocalY: row.requester_avatar_focal_y,
    exerciseName: row.exercise_name,
    setNumber: row.set_number,
    loadKg: row.load_kg,
    status: row.status,
    responderId: row.responder_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    distanceMeters: row.distance_meters,
  };
}

async function fetchSpotRequest(requestId: string): Promise<SpotRequestDetail | null> {
  const client = supabase as unknown as {
    rpc: (
      fn: 'get_spot_request',
      args: { p_request_id: string },
    ) => Promise<{ data: GetSpotRequestRow[] | null; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc('get_spot_request', { p_request_id: requestId });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return row ? toDetail(row) : null;
}

/** Still-pending, still-fresh means the athlete responding (or the athlete
 * who sent it, watching for a response) benefits from staying live — polled
 * lightly rather than left to go stale, since nothing in this codebase uses
 * Supabase Realtime yet and a request's whole lifetime is ~2 minutes anyway.
 * Stops polling the moment it resolves or expires (no point ticking a dead
 * request), or when the caller says not to poll at all (e.g. a screen that's
 * backgrounded). */
export function useSpotRequest(requestId: string | null, options?: { poll?: boolean }) {
  const poll = options?.poll ?? true;
  return useQuery({
    queryKey: ['spotRequest', requestId],
    queryFn: () => fetchSpotRequest(requestId as string),
    enabled: requestId != null,
    refetchInterval: query => {
      if (!poll) return false;
      const detail = query.state.data;
      if (!detail) return 3000;
      if (detail.status !== 'pending') return false;
      if (new Date(detail.expiresAt).getTime() <= Date.now()) return false;
      return 3000;
    },
  });
}

/** get_spot_request only ever returns the *requester's* profile fields
 * (that's the one side every caller — the requester themselves, or a
 * prospective responder deciding whether to help — needs to identify) —
 * once a request is accepted, the requester's own sent-sheet additionally
 * needs to show *who* accepted, which this looks up separately via the
 * same public_profiles view every other cross-user profile lookup in this
 * app already reads from. */
export function useResponderProfile(responderId: string | null) {
  return useQuery({
    queryKey: ['spotRequestResponder', responderId],
    queryFn: async () => {
      const profiles = await fetchPublicProfiles([responderId as string]);
      return profiles[0] ?? null;
    },
    enabled: responderId != null,
  });
}

export type RequestSpotParams = {
  userId: string;
  workoutLogId: string | null;
  exerciseName: string;
  setNumber: number | null;
  loadKg: number | null;
};

/** Inserted row's own `expires_at` (not just `now() + duration` computed
 * client-side) is what every consumer — the sent sheet's countdown, the
 * responder's own view — treats as authoritative, since it's the value
 * respond_to_spot_request() itself checks server-side. */
export function useRequestSpot() {
  return useMutation({
    mutationFn: async (params: RequestSpotParams) => {
      const expiresAt = new Date(Date.now() + SPOT_REQUEST_DURATION_SECONDS * 1000).toISOString();
      const { data, error } = await supabase
        .from('spot_requests')
        .insert({
          requester_id: params.userId,
          workout_log_id: params.workoutLogId,
          exercise_name: params.exerciseName,
          set_number: params.setNumber,
          load_kg: params.loadKg,
          expires_at: expiresAt,
        })
        .select('id, expires_at')
        .single();
      if (error) throw error;
      return { id: data.id as string, expiresAt: data.expires_at as string };
    },
  });
}

/** Requester-only cancel — a plain delete under spot_requests_delete_requester
 * (0084_spot_requests.sql), same "cancel is a delete, not a status
 * transition" convention friend_requests already established. */
export function useCancelSpotRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.from('spot_requests').delete().eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: (_data, requestId) => {
      queryClient.invalidateQueries({ queryKey: ['spotRequest', requestId] });
    },
  });
}

/** Accept/decline — always via the respond_to_spot_request() RPC, never a
 * direct .update() (there is no client update path for this table; see
 * database.ts's Update: never on spot_requests). `respond_to_spot_request`
 * returns `setof` (see its own migration comment), so a successful-but-
 * unavailable response is a genuine zero-row array here, not a null/empty
 * object — resolves to `false` uniformly, which the caller should treat as
 * "this request is no longer available", not retry. */
export function useRespondToSpotRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { requestId: string; accept: boolean }): Promise<boolean> => {
      const client = supabase as unknown as {
        rpc: (
          fn: 'respond_to_spot_request',
          args: { p_request_id: string; p_accept: boolean },
        ) => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
      };
      const { data, error } = await client.rpc('respond_to_spot_request', {
        p_request_id: params.requestId,
        p_accept: params.accept,
      });
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['spotRequest', params.requestId] });
    },
  });
}
