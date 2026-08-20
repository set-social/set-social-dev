// GymBee - spotify-playlists Edge Function
//
// Called by the app (a future "attach a playlist to this workout" picker on
// the template editor) once it already knows the user is connected to
// Spotify — see useIntegrationConnections in
// src/services/api/queries/integrations.ts. Proxies GET /me/playlists using
// the caller's stored tokens, refreshing the access token first if it's
// expired, and returns a trimmed-down list (id/name/image/track count) —
// the client only needs enough to render a picker row, not Spotify's full
// playlist object. Same token-refresh shape as spotify-player/whoop-sync;
// see spotify-player's header comment for why that logic is duplicated here
// rather than shared — this repo's edge functions are each a standalone
// deploy unit, same as the existing whoop-* functions.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "spotify-playlists" -> paste this whole file -> Deploy. Requires the
// same SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET secrets as the other
// spotify-* functions. Invoked by the app itself, so it keeps the platform
// default verify_jwt = true — no config.toml entry needed.
//
// SPOTIFY_API_BASE and the /me/playlists response shape below reflect
// Spotify's Web API as of this writing — confirm against your Spotify
// Developer Dashboard / Web API docs before relying on this, and update if
// they've changed.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID')!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
// One page is plenty for a picker list — pagination can be added later if a
// user with more playlists than this actually complains.
const PLAYLISTS_LIMIT = 50;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return typeof err === 'string' ? err : JSON.stringify(err);
}

type SpotifyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

type SpotifyPlaylistImage = { url: string };

type SpotifyPlaylist = {
  id: string;
  name: string;
  images: SpotifyPlaylistImage[] | null;
  tracks: { total: number };
  owner: { display_name?: string };
};

type SpotifyPlaylistsResponse = { items: SpotifyPlaylist[] };

export type PlaylistSummary = {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  ownerName: string | null;
};

class SpotifyApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** See spotify-player's refreshAccessToken — identical logic, duplicated per
 * this repo's one-file-per-function convention. */
async function refreshAccessToken(admin: SupabaseClient, userId: string, refreshToken: string): Promise<string> {
  const refreshResponse = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!refreshResponse.ok) {
    console.error('Spotify token refresh failed', refreshResponse.status, await refreshResponse.text());
    throw new SpotifyApiError(401, 'Spotify connection expired. Please reconnect from the app.');
  }
  const refreshed = (await refreshResponse.json()) as SpotifyTokenResponse;
  const { error: updateError } = await admin
    .from('integration_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? refreshToken,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'spotify');
  if (updateError) throw updateError;
  return refreshed.access_token;
}

async function fetchPlaylists(accessToken: string): Promise<SpotifyPlaylistsResponse> {
  const res = await fetch(`${SPOTIFY_API_BASE}/me/playlists?limit=${PLAYLISTS_LIMIT}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new SpotifyApiError(res.status, `Spotify API /me/playlists failed: ${res.status} ${bodyText}`);
  }
  return (await res.json()) as SpotifyPlaylistsResponse;
}

function summarize(playlist: SpotifyPlaylist): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    imageUrl: playlist.images?.[0]?.url ?? null,
    trackCount: playlist.tracks.total,
    ownerName: playlist.owner.display_name ?? null,
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: connection, error: connectionError } = await admin
      .from('integration_connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', userData.user.id)
      .eq('provider', 'spotify')
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.access_token) {
      return json({ error: 'not_connected' }, 400);
    }

    let accessToken = connection.access_token;
    const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS) {
      if (!connection.refresh_token) {
        return json({ error: 'Spotify connection expired. Please reconnect from the app.' }, 401);
      }
      accessToken = await refreshAccessToken(admin, userData.user.id, connection.refresh_token);
    }

    let response: SpotifyPlaylistsResponse;
    try {
      response = await fetchPlaylists(accessToken);
    } catch (err) {
      if (err instanceof SpotifyApiError && err.status === 401 && connection.refresh_token) {
        accessToken = await refreshAccessToken(admin, userData.user.id, connection.refresh_token);
        response = await fetchPlaylists(accessToken);
      } else {
        throw err;
      }
    }

    return json({ playlists: response.items.map(summarize) }, 200);
  } catch (err) {
    console.error(err);
    const status = err instanceof SpotifyApiError ? err.status : 500;
    return json({ error: errorMessage(err) }, status);
  }
});
