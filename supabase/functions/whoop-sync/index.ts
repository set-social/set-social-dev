// GymBee - whoop-sync Edge Function
//
// Called by the app (Stats tab, on focus) once it already knows the user is
// connected to WHOOP — see useIntegrationConnections in
// src/services/api/queries/integrations.ts. Pulls the latest cycle (for
// strain), recovery, and sleep records from the WHOOP v2 API using the
// caller's stored tokens, refreshing the access token first if it's expired,
// and upserts the result into whoop_metrics (migration 0025) keyed on
// (user_id, cycle_date). Returns the synced row directly so the client can
// update its UI without a second round-trip, but the primary read path is
// the cheap direct table read in useWhoopMetrics — this function only needs
// to succeed in the background; a stale cached row is a fine fallback if it
// doesn't.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "whoop-sync" -> paste this whole file -> Deploy. Requires the same
// WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET secrets as the other whoop-*
// functions. Unlike whoop-oauth-callback, this one is invoked by the app
// itself (supabase.functions.invoke), so it keeps the platform default
// verify_jwt = true — no config.toml entry needed.
//
// WHOOP_TOKEN_URL / WHOOP_API_BASE and the endpoint paths below reflect
// WHOOP's v2 API as of this writing — confirm against your WHOOP Developer
// Dashboard / API docs before relying on this, and update if they've
// changed. In particular: this assumes each collection endpoint returns
// `{ records: [...] }` sorted newest-first, and that a Cycle/Recovery/Sleep
// record's `score` object carries `strain` / `recovery_score` /
// `sleep_performance_percentage` respectively — verify field names live.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const WHOOP_CLIENT_ID = Deno.env.get('WHOOP_CLIENT_ID')!;
const WHOOP_CLIENT_SECRET = Deno.env.get('WHOOP_CLIENT_SECRET')!;

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2';
// A token this close to expiring is refreshed proactively rather than risking
// a 401 mid-request — the sync round-trip (refresh + 3 fetches + upsert) can
// take a few seconds, so a bare `now()` check could still race an expiry.
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

function roundOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value);
}

/** WHOOP reports sleep-stage/debt durations in milliseconds; every consumer
 * of this data (the UI, the DB columns) wants whole minutes. */
function millisToMinutesOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value / 60000);
}

/** decimal(4,1)-shaped columns (respiratory_rate, spo2_pct,
 * skin_temp_celsius) — one decimal place is what the UI actually displays,
 * and WHOOP's own precision well exceeds anything meaningful past that. */
function roundToOneDecimalOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return typeof err === 'string' ? err : JSON.stringify(err);
}

type WhoopTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  // See whoop-oauth-callback for why this is logged: it's the scopes WHOOP
  // actually granted, which can be a subset of what was requested.
  scope?: string;
};

type WhoopCollection<T> = { records: T[] };

type WhoopCycle = {
  id: number | string;
  start: string;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: { strain?: number };
};

type WhoopRecovery = {
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: {
    recovery_score?: number;
    hrv_rmssd_milli?: number;
    resting_heart_rate?: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
};

type WhoopSleep = {
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: {
    sleep_performance_percentage?: number;
    sleep_efficiency_percentage?: number;
    sleep_consistency_percentage?: number;
    respiratory_rate?: number;
    stage_summary?: {
      total_awake_time_milli?: number;
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
    };
    sleep_needed?: {
      need_from_sleep_debt_milli?: number;
    };
  };
};

/** Thrown by fetchLatest so callers can tell an expired/revoked access token
 * (401 — worth a refresh-and-retry) apart from every other failure. */
class WhoopApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function fetchLatest<T>(path: string, accessToken: string): Promise<T | null> {
  const res = await fetch(`${WHOOP_API_BASE}${path}?limit=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Scope was confirmed granted (see whoop-oauth-callback's scope log),
    // so a 401 here is unexplained by anything visible in our own code path
    // — log the bits an OAuth Bearer challenge normally carries (RFC 6750's
    // WWW-Authenticate error/error_description) so a genuinely different
    // failure reason (invalid_token vs insufficient_scope vs something
    // WHOOP-side) doesn't stay hidden behind one flat message.
    const wwwAuthenticate = res.headers.get('www-authenticate');
    const bodyText = await res.text();
    console.error(`WHOOP ${path} 401/error detail`, { wwwAuthenticate, bodyText });
    throw new WhoopApiError(res.status, `WHOOP API ${path} failed: ${res.status} ${bodyText}`);
  }
  const body = (await res.json()) as WhoopCollection<T>;
  return body.records[0] ?? null;
}

/** Fetches all three collections without letting one's failure hide the
 * others — Promise.all's fail-fast behavior meant a single endpoint 401
 * (e.g. this WHOOP app never actually being granted the scope one specific
 * resource needs) surfaced as one opaque error with no visibility into
 * whether the other two even succeeded. Logging every outcome here is what
 * tells a scope-specific failure (only /cycle rejects) apart from a
 * genuinely bad/expired token (all three reject). */
async function fetchAllSettled(accessToken: string) {
  const paths = ['/cycle', '/recovery', '/activity/sleep'] as const;
  const [cycleResult, recoveryResult, sleepResult] = await Promise.allSettled([
    fetchLatest<WhoopCycle>(paths[0], accessToken),
    fetchLatest<WhoopRecovery>(paths[1], accessToken),
    fetchLatest<WhoopSleep>(paths[2], accessToken),
  ]);
  [cycleResult, recoveryResult, sleepResult].forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`WHOOP ${paths[i]} fetch failed`, errorMessage(result.reason));
    }
  });
  return { cycleResult, recoveryResult, sleepResult };
}

/** Exchanges the stored refresh_token for a new access_token and persists
 * the result, returning the new access_token. Throws (never returns a stale
 * token) if WHOOP rejects the refresh_token itself — that means the
 * connection needs a full reconnect, not another retry. */
async function refreshAccessToken(admin: SupabaseClient, userId: string, refreshToken: string): Promise<string> {
  const refreshResponse = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
    }),
  });
  if (!refreshResponse.ok) {
    console.error('WHOOP token refresh failed', refreshResponse.status, await refreshResponse.text());
    throw new WhoopApiError(401, 'Whoop connection expired. Please reconnect from the app.');
  }
  const refreshed = (await refreshResponse.json()) as WhoopTokenResponse;
  console.log('WHOOP token refresh granted scopes:', refreshed.scope ?? '(not present in response)');
  const { error: updateError } = await admin
    .from('integration_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? refreshToken,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'whoop');
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
      .eq('provider', 'whoop')
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.access_token) {
      return json({ error: 'not_connected' }, 400);
    }

    let accessToken = connection.access_token;
    const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS) {
      if (!connection.refresh_token) {
        return json({ error: 'Whoop connection expired. Please reconnect from the app.' }, 401);
      }
      accessToken = await refreshAccessToken(admin, userData.user.id, connection.refresh_token);
    }

    // Our stored token_expires_at is a best guess, not the source of truth —
    // WHOOP can invalidate an access token before that deadline (rotation
    // from a concurrent sync, a manual reconnect, clock drift). Rather than
    // fail the whole sync on a 401 the local clock didn't see coming, force
    // one refresh-and-retry before giving up.
    let { cycleResult, recoveryResult, sleepResult } = await fetchAllSettled(accessToken);
    if (
      cycleResult.status === 'rejected' &&
      cycleResult.reason instanceof WhoopApiError &&
      cycleResult.reason.status === 401 &&
      connection.refresh_token
    ) {
      accessToken = await refreshAccessToken(admin, userData.user.id, connection.refresh_token);
      ({ cycleResult, recoveryResult, sleepResult } = await fetchAllSettled(accessToken));
    }

    // Cycle is the one collection every field of `row` below ultimately
    // depends on (cycle_date, whoop_cycle_id, score_state, strain) — if it
    // failed even after a fresh token, surface that specific error rather
    // than the generic 500 a rethrow of a plain Error would produce.
    if (cycleResult.status === 'rejected') {
      throw cycleResult.reason;
    }
    const cycle = cycleResult.value;
    // Recovery/sleep are supplementary — already optional-chained below —
    // so a failure fetching either shouldn't block strain from saving.
    const recovery = recoveryResult.status === 'fulfilled' ? recoveryResult.value : null;
    const sleep = sleepResult.status === 'fulfilled' ? sleepResult.value : null;

    if (!cycle) {
      return json({ error: 'No Whoop cycle data available yet' }, 404);
    }

    const row = {
      user_id: userData.user.id,
      cycle_date: cycle.start.slice(0, 10),
      whoop_cycle_id: String(cycle.id),
      score_state: cycle.score_state,
      // WHOOP returns these with decimal precision (e.g. 94.859886) — the
      // smallint columns they're stored in reject a non-integer string
      // outright ("invalid input syntax for type smallint"), so round here
      // rather than widen the schema for precision nothing downstream uses.
      recovery_score: roundOrNull(recovery?.score?.recovery_score),
      sleep_performance_pct: roundOrNull(sleep?.score?.sleep_performance_percentage),
      strain: cycle.score?.strain ?? null,
      hrv_ms: roundOrNull(recovery?.score?.hrv_rmssd_milli),
      resting_heart_rate: roundOrNull(recovery?.score?.resting_heart_rate),
      spo2_pct: roundToOneDecimalOrNull(recovery?.score?.spo2_percentage),
      skin_temp_celsius: roundToOneDecimalOrNull(recovery?.score?.skin_temp_celsius),
      sleep_efficiency_pct: roundOrNull(sleep?.score?.sleep_efficiency_percentage),
      sleep_consistency_pct: roundOrNull(sleep?.score?.sleep_consistency_percentage),
      respiratory_rate: roundToOneDecimalOrNull(sleep?.score?.respiratory_rate),
      rem_sleep_minutes: millisToMinutesOrNull(sleep?.score?.stage_summary?.total_rem_sleep_time_milli),
      deep_sleep_minutes: millisToMinutesOrNull(sleep?.score?.stage_summary?.total_slow_wave_sleep_time_milli),
      light_sleep_minutes: millisToMinutesOrNull(sleep?.score?.stage_summary?.total_light_sleep_time_milli),
      awake_minutes: millisToMinutesOrNull(sleep?.score?.stage_summary?.total_awake_time_milli),
      sleep_debt_minutes: millisToMinutesOrNull(sleep?.score?.sleep_needed?.need_from_sleep_debt_milli),
      synced_at: new Date().toISOString(),
    };

    const { error: upsertError } = await admin
      .from('whoop_metrics')
      .upsert(row, { onConflict: 'user_id,cycle_date' });
    if (upsertError) throw upsertError;

    return json(row, 200);
  } catch (err) {
    console.error(err);
    const status = err instanceof WhoopApiError ? err.status : 500;
    return json({ error: errorMessage(err) }, status);
  }
});
