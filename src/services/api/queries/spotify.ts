import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { spotifyPlayerAction, type SpotifyPlayerAction, type SpotifyPlayerResult } from '../edgeFunctions';

const NOW_PLAYING_QUERY_KEY = ['spotifyNowPlaying'];
// Spotify has no realtime "now playing changed" push this app subscribes
// to, so a plain interval is the only way to reflect track changes that
// happen outside our own play/pause/previous buttons (e.g. the user skips
// from the Spotify app itself, or the current track just ends).
const NOW_PLAYING_POLL_MS = 5000;

/**
 * Polls the caller's current Spotify playback state — see
 * supabase/functions/spotify-player. Only call with `enabled: true` once the
 * user is already known to be connected (see useIntegrationConnections).
 */
export function useSpotifyNowPlaying(enabled: boolean) {
  return useQuery({
    queryKey: NOW_PLAYING_QUERY_KEY,
    queryFn: () => spotifyPlayerAction('now_playing'),
    enabled,
    refetchInterval: enabled ? NOW_PLAYING_POLL_MS : false,
    // Without this, every poll briefly clears `data` while refetching,
    // flashing the bar's "nothing playing" state every 5s even when a track
    // is actively playing.
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * Play/pause/previous — see supabase/functions/spotify-player. These
 * endpoints return no updated playback state (a bare 204), so success
 * invalidates the now-playing query to pull the new state immediately
 * rather than waiting for the next poll tick.
 */
export function useSpotifyPlaybackControl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: Exclude<SpotifyPlayerAction, 'now_playing'>) => spotifyPlayerAction(action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOW_PLAYING_QUERY_KEY });
    },
  });
}

export type { SpotifyPlayerResult };
