// GymBee - oura-sync Edge Function
//
// Called by the app (Stats tab, on focus; Home pull-to-refresh) once it
// already knows the user is connected to Oura — see
// useIntegrationConnections in src/services/api/queries/integrations.ts.
// Pulls the most recent daily_readiness, daily_sleep, and daily_activity
// summaries from the Oura v2 API using the caller's stored tokens,
// refreshing the access token first if it's expired, and upserts the
// result into oura_metrics (migration 0066) keyed on (user_id,
// metric_date). Returns the synced row directly so the client can update
// its UI without a second round-trip, but the primary read path is the
// cheap direct table read in useOuraMetrics — this function only needs to
// succeed in the background; a stale cached row is a fine fallback if it
// doesn't.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "oura-sync" -> paste this whole file -> Deploy. Requires the same
// OURA_CLIENT_ID / OURA_CLIENT_SECRET secrets as the other oura-*
// functions. Unlike oura-oauth-callback, this one is invoked by the app
// itself (supabase.functions.invoke), so it keeps the platform default
// verify_jwt = true — no config.toml entry needed.
//
// OURA_TOKEN_URL / OURA_API_BASE and the endpoint paths below reflect
// Oura's v2 API as of this writing — confirm against the Oura Developer
// Portal / API docs before relying on this, and update if they've changed.
// In particular: this assumes each usercollection endpoint returns
// `{ data: [...] }` with `day` (YYYY-MM-DD) and a top-level `score` (0-100)
// per item, filtered by `start_date`/`end_date` query params — verify
// field names live.
//
// CRITICAL deviation from whoop-sync: Oura refresh tokens are single-use —
// every refresh response's `refresh_token` MUST replace the stored one. A
// refresh response missing `refresh_token` is treated as a hard failure
// here (unlike whoop-sync's `refreshed.refresh_token ?? refreshToken`
// fallback, which would silently keep an already-invalidated token and
// break every sync after the next expiry).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const OURA_CLIENT_ID = Deno.env.get('OURA_CLIENT_ID')!;
const OURA_CLIENT_SECRET = Deno.env.get('OURA_CLIENT_SECRET')!;

const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const OURA_API_BASE = 'https://api.ouraring.com/v2/usercollection';
// A token this close to expiring is refreshed proactively rather than risking
// a 401 mid-request — the sync round-trip (refresh + 3 fetches + upsert) can
// take a few seconds, so a bare `now()` check could still race an expiry.
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
// Oura's endpoints have no `limit=1`/"latest" shortcut — a small trailing
// window is requested instead and the most recent day within it is taken.
// 3 days covers the normal case (today not yet scored, fall back to
// yesterday) with margin for a day the ring didn't sync.
const WINDOW_DAYS = 3;

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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type OuraTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type OuraDailySummary = { day: string; score: number | null };
type OuraCollection<T> = { data: T[] };

/** Thrown by fetchLatest so callers can tell an expired/revoked access token
 * (401 — worth a refresh-and-retry) apart from every other failure. */
class OuraApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function fetchLatest<T extends OuraDailySummary>(
  path: string,
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<T | null> {
  const url = `${OURA_API_BASE}${path}?start_date=${startDate}&end_date=${endDate}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const wwwAuthenticate = res.headers.get('www-authenticate');
    const bodyText = await res.text();
    console.error(`Oura ${path} error detail`, { status: res.status, wwwAuthenticate, bodyText });
    throw new OuraApiError(res.status, `Oura API ${path} failed: ${res.status} ${bodyText}`);
  }
  const body = (await res.json()) as OuraCollection<T>;
  if (body.data.length === 0) return null;
  // Not documented as guaranteed-sorted, so pick the max `day` explicitly
  // rather than trusting array order the way whoop-sync trusts `records[0]`.
  return body.data.reduce((latest, item) => (item.day > latest.day ? item : latest));
}

/** Fetches all three collections without letting one's failure hide the
 * others — same rationale as whoop-sync's fetchAllSettled: a single
 * endpoint's rejection (e.g. this Oura app not actually granted the scope
 * one resource needs) shouldn't produce one opaque error with no
 * visibility into whether the other two succeeded. */
async function fetchAllSettled(accessToken: string, startDate: string, endDate: string) {
  const paths = ['/daily_readiness', '/daily_sleep', '/daily_activity'] as const;
  const [readinessResult, sleepResult, activityResult] = await Promise.allSettled([
    fetchLatest<OuraDailySummary>(paths[0], accessToken, startDate, endDate),
    fetchLatest<OuraDailySummary>(paths[1], accessToken, startDate, endDate),
    fetchLatest<OuraDailySummary>(paths[2], accessToken, startDate, endDate),
  ]);
  [readinessResult, sleepResult, activityResult].forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Oura ${paths[i]} fetch failed`, errorMessage(result.reason));
    }
  });
  return { readinessResult, sleepResult, activityResult };
}

/** Exchanges the stored refresh_token for a new access_token and persists
 * the result, returning the new access_token. Throws (never returns a stale
 * token) if Oura rejects the refresh_token itself, or if the response omits
 * a new refresh_token — Oura's refresh tokens are single-use, so a missing
 * one here means the old one is already invalidated and reusing it would
 * only break the next sync. Either way, a full reconnect is required. */
async function refreshAccessToken(admin: SupabaseClient, userId: string, refreshToken: string): Promise<string> {
  const refreshResponse = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OURA_CLIENT_ID,
      client_secret: OURA_CLIENT_SECRET,
    }),
  });
  if (!refreshResponse.ok) {
    console.error('Oura token refresh failed', refreshResponse.status, await refreshResponse.text());
    throw new OuraApiError(401, 'Oura connection expired. Please reconnect from the app.');
  }
  const refreshed = (await refreshResponse.json()) as OuraTokenResponse;
  if (!refreshed.refresh_token) {
    console.error('Oura token refresh response omitted a new refresh_token — treating as a hard failure');
    throw new OuraApiError(401, 'Oura connection expired. Please reconnect from the app.');
  }
  const { error: updateError } = await admin
    .from('integration_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'oura');
  if (updateError) throw updateError;
  return refreshed.access_token;
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
      .eq('provider', 'oura')
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.access_token) {
      return json({ error: 'not_connected' }, 400);
    }

    let accessToken = connection.access_token;
    const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS) {
      if (!connection.refresh_token) {
        return json({ error: 'Oura connection expired. Please reconnect from the app.' }, 401);
      }
      accessToken = await refreshAccessToken(admin, userData.user.id, connection.refresh_token);
    }

    const endDate = isoDate(new Date());
    const startDate = isoDate(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));

    // Our stored token_expires_at is a best guess, not the source of truth —
    // Oura can invalidate an access token before that deadline. Rather than
    // fail the whole sync on a 401 the local clock didn't see coming, force
    // one refresh-and-retry before giving up.
    let { readinessResult, sleepResult, activityResult } = await fetchAllSettled(accessToken, startDate, endDate);
    if (
      readinessResult.status === 'rejected' &&
      readinessResult.reason instanceof OuraApiError &&
      readinessResult.reason.status === 401 &&
      connection.refresh_token
    ) {
      accessToken = await refreshAccessToken(admin, userData.user.id, connection.refresh_token);
      ({ readinessResult, sleepResult, activityResult } = await fetchAllSettled(accessToken, startDate, endDate));
    }

    // Readiness is the anchor every field of `row` below is keyed against
    // (metric_date), same role cycle plays in whoop-sync — if it failed even
    // after a fresh token, surface that specific error rather than the
    // generic 500 a rethrow of a plain Error would produce.
    if (readinessResult.status === 'rejected') {
      throw readinessResult.reason;
    }
    const readiness = readinessResult.value;
    // Sleep/activity are supplementary — already optional-chained below —
    // so a failure fetching either shouldn't block readiness from saving.
    const sleep = sleepResult.status === 'fulfilled' ? sleepResult.value : null;
    const activity = activityResult.status === 'fulfilled' ? activityResult.value : null;

    if (!readiness) {
      return json({ error: 'No Oura data available yet' }, 404);
    }

    const row = {
      user_id: userData.user.id,
      metric_date: readiness.day,
      readiness_score: readiness.score,
      sleep_score: sleep?.score ?? null,
      activity_score: activity?.score ?? null,
      synced_at: new Date().toISOString(),
    };

    const { error: upsertError } = await admin
      .from('oura_metrics')
      .upsert(row, { onConflict: 'user_id,metric_date' });
    if (upsertError) throw upsertError;

    return json(row, 200);
  } catch (err) {
    console.error(err);
    const status = err instanceof OuraApiError ? err.status : 500;
    return json({ error: errorMessage(err) }, status);
  }
});
