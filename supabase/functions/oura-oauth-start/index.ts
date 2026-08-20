// GymBee - oura-oauth-start Edge Function
//
// Step 1 of the Oura OAuth connection flow — line-for-line the same shape as
// whoop-oauth-start (see that file's own comment for the full rationale).
// Called by the app (with the user's session) when they tap "Connect Oura"
// on the Integrations screen. Mints a one-time state token bound to the
// caller's user id (stored in oauth_states via the service-role key — see
// migration 0024), then returns the full Oura authorization URL for the app
// to open in the system browser. Oura redirects back to oura-oauth-callback
// once the user approves (or denies) access, carrying that same state token.
//
// The client never sees OURA_CLIENT_ID or OURA_CLIENT_SECRET — both stay
// server-side, read from Edge Function secrets.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "oura-oauth-start" -> paste this whole file -> Deploy. Then set
// secrets: Dashboard -> Edge Functions -> Secrets -> OURA_CLIENT_ID and
// OURA_CLIENT_SECRET (the second is only read by oura-oauth-callback/
// oura-sync, but setting both now saves a step). Register
// https://<project-ref>.supabase.co/functions/v1/oura-oauth-callback as the
// Redirect URI in the Oura Developer Portal.
//
// OURA_AUTHORIZE_URL and OURA_SCOPES below reflect Oura's OAuth 2.0
// Authorization Code flow (API v2) as of this writing — confirm against the
// Oura Developer Portal / API docs before relying on this, and update the
// constants below if they've changed.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const OURA_CLIENT_ID = Deno.env.get('OURA_CLIENT_ID')!;

const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
// A single 'daily' scope covers all daily summaries (readiness, sleep,
// activity) — Oura doesn't split scopes per-endpoint the way one might
// assume from Whoop's more granular read:recovery/read:sleep/read:cycles.
const OURA_SCOPES = 'daily';
// Must exactly match the Redirect URI registered in the Oura Developer
// Portal for this app — and oura-oauth-callback's own deployed URL.
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/oura-oauth-callback`;

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

/** Postgrest/Supabase errors (e.g. from a failed insert) are plain
 * `{ message, details, hint, code }` objects, not `Error` instances — a bare
 * `err instanceof Error` check would silently collapse them to a useless
 * "Unknown error" and hide exactly what's wrong (missing table, RLS denial,
 * bad enum value, etc). */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return typeof err === 'string' ? err : JSON.stringify(err);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    // Scoped to the caller's own JWT — used only to verify who's asking.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);

    // Service-role client: oauth_states has no client-facing RLS policies at
    // all, so minting a state row is only possible through this function.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: stateRow, error: insertError } = await admin
      .from('oauth_states')
      .insert({ user_id: userData.user.id, provider: 'oura' })
      .select('state')
      .single();
    if (insertError) throw insertError;

    const authorizeUrl = new URL(OURA_AUTHORIZE_URL);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', OURA_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authorizeUrl.searchParams.set('scope', OURA_SCOPES);
    authorizeUrl.searchParams.set('state', stateRow.state);

    return json({ url: authorizeUrl.toString() }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: errorMessage(err) }, 500);
  }
});
