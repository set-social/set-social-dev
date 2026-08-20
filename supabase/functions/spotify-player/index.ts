// GymBee - spotify-player Edge Function
//
// Called by the app (e.g. a "now playing" widget on an active workout
// screen) once it already knows the user is connected to Spotify — see
// useIntegrationConnections in src/services/api/queries/integrations.ts.
// Proxies a small set of Spotify Web API playback calls using the caller's
// stored tokens, refreshing the access token first if it's expired — same
// shape as whoop-sync, but request/response driven instead of an
// upsert-into-a-table sync, since "what's playing right now" has no
// meaningful history to store.
//
// Body: { action: 'now_playing' | 'play' | 'pause' | 'next' | 'previous' },
// defaults to 'now_playing' if omitted. The client never sees the Spotify
// access token itself — every call goes through this function.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "spotify-player" -> paste this whole file -> Deploy. Requires the
// same SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET secrets as the other
// spotify-* functions. Invoked by the app itself (supabase.functions.invoke),
// so it keeps the platform default verify_jwt = true — no config.toml entry
// needed.
//
// SPOTIFY_TOKEN_URL / SPOTIFY_API_BASE and the endpoint paths below reflect
// Spotify's Web API as of this writing — confirm against your Spotify
// Developer Dashboard / Web API docs before relying on this, and update if
// they've changed. In particular: playback control (play/pause/next/previous)
// requires Spotify Premium and an active device — both surface as ordinary
// non-2xx responses from Spotify (403 / 404 respectively), passed through
// here rather than treated as unexpected errors.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID')!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
// A token this close to expiring is refreshed proactively rather than
// risking a 401 mid-request. Same reasoning/value as whoop-sync's
// TOKEN_REFRESH_BUFFER_MS.
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

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

type SpotifyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

type PlayerAction = 'now_playing' | 'play' | 'pause' | 'next' | 'previous';

function isPlayerAction(value: unknown): value is PlayerAction {
  return (
    value === 'now_playing' ||
    value === 'play' ||
    value === 'pause' ||
    value === 'next' ||
    value === 'previous'
  );
}

/** Thrown by callSpotify so callers can tell an expired/revoked access token
 * (401 — worth a refresh-and-retry) apart from every other failure (e.g. 403
 * Premium-required, 404 no active device — both legitimate end states the
 * client needs to render, not bugs). */
class SpotifyApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Exchanges the stored refresh_token for a new access_token and persists
 * the result, returning the new access_token. Throws (never returns a stale
 * token) if Spotify rejects the refresh_token itself — that means the
 * connection needs a full reconnect, not another retry. Mirrors
 * refreshAccessToken in whoop-sync, but Spotify's token endpoint takes
 * client credentials via HTTP Basic Auth rather than in the body — same
 * difference already noted in spotify-oauth-callback. */
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
  console.log('Spotify token refresh granted scopes:', refreshed.scope ?? '(not present in response)');
  const { error: updateError } = await admin
    .from('integration_connections')
    .update({
      access_token: refreshed.access_token,
      // Spotify's refresh grant can omit refresh_token (it's only rotated
      // sometimes) — keep the existing one rather than nulling it out.
      refresh_token: refreshed.refresh_token ?? refreshToken,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'spotify');
  if (updateError) throw updateError;
  return refreshed.access_token;
}

/** One Spotify Web API call. Returns parsed JSON, or `null` for a 204 (every
 * playback-control endpoint's success response, and /player itself when
 * nothing is currently playing on any device). */
async function callSpotify(path: string, method: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const bodyText = await res.text();
    throw new SpotifyApiError(res.status, `Spotify API ${path} failed: ${res.status} ${bodyText}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // An ok, non-204 response that isn't valid JSON — seen in practice on
    // play/pause/next/previous, whose documented success response is a bare
    // 204 with no body, so callers never read `result` for these anyway.
    // Degrade to null rather than throwing a raw SyntaxError that would
    // otherwise leak the (possibly truncated/binary) response body straight
    // to the end user (see the top-level catch below).
    console.error(`Spotify API ${path} returned a non-JSON ok response`, res.status, text.slice(0, 200));
    return null;
  }
}

const ACTION_REQUEST: Record<PlayerAction, { path: string; method: string }> = {
  now_playing: { path: '/me/player', method: 'GET' },
  play: { path: '/me/player/play', method: 'PUT' },
  pause: { path: '/me/player/pause', method: 'PUT' },
  next: { path: '/me/player/next', method: 'POST' },
  previous: { path: '/me/player/previous', method: 'POST' },
};

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

    let action: PlayerAction = 'now_playing';
    try {
      const body = await req.json();
      if (isPlayerAction(body?.action)) action = body.action;
    } catch {
      // No/invalid JSON body — action stays at its 'now_playing' default.
    }

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

    const { path, method } = ACTION_REQUEST[action];

    // Our stored token_expires_at is a best guess, not the source of truth —
    // Spotify can invalidate an access token before that deadline. Rather
    // than fail on a 401 the local clock didn't see coming, force one
    // refresh-and-retry before giving up. Same pattern as whoop-sync.
    let result: unknown;
    try {
      result = await callSpotify(path, method, accessToken);
    } catch (err) {
      if (err instanceof SpotifyApiError && err.status === 401 && connection.refresh_token) {
        accessToken = await refreshAccessToken(admin, userData.user.id, connection.refresh_token);
        result = await callSpotify(path, method, accessToken);
      } else {
        throw err;
      }
    }

    return json({ action, result }, 200);
  } catch (err) {
    console.error(err);
    // Only a SpotifyApiError's message is meant to be end-user-safe (403
    // Premium-required, 404 no active device, etc.) — anything else (a bug,
    // a network hiccup, an unexpected exception type) gets a generic message
    // on the client while the real detail stays in the function logs above,
    // rather than leaking raw exception text (e.g. a JSON parse error's
    // message, which literally is a fragment of unrelated response data).
    if (err instanceof SpotifyApiError) {
      return json({ error: err.message }, err.status);
    }
    return json({ error: 'Something went wrong talking to Spotify. Please try again.' }, 500);
  }
});
