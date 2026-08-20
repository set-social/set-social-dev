// GymBee - whoop-oauth-callback Edge Function
//
// Step 2 of the WHOOP OAuth connection flow, and the exact URL registered as
// this app's Redirect URI in the WHOOP Developer Dashboard. WHOOP redirects
// the user's browser here with either `code` + `state` (approved) or
// `error` (denied) — this is hit directly by a browser navigation, not
// called from the app, so it responds with an HTTP redirect rather than
// JSON (see below for why it's a redirect and not an HTML page).
//
// Looks up which user the `state` belongs to (minted by whoop-oauth-start),
// consumes it (one-time use), exchanges the code for tokens server-side —
// so WHOOP_CLIENT_SECRET never touches the mobile app — and stores the
// result in integration_connections. The response then hands off back to
// the app via a plain HTTP 302 redirect to the soset://whoop-callback deep
// link (registered in Info.plist / AndroidManifest.xml, handled by
// RootNavigator's `linking` config).
//
// This is a bare redirect rather than an HTML landing page on purpose: Edge
// Functions on the default *.supabase.co domain silently rewrite any
// `Content-Type: text/html` response to `text/plain` (+ `nosniff`) — a
// platform-level restriction, confirmed via supabase/discussions#35627, that
// makes the whole body inert (no rendering, no button, no <script>) no
// matter what the function sets. A 302's `Location` header isn't subject to
// that rewrite, and unlike a JS `window.location` assignment it isn't
// blocked by Safari's no-gesture heuristics either, so it's the reliable way
// to hand off on this domain. If SetSocial ever moves this function behind a
// custom domain (Supabase Pro), an HTML confirmation page becomes viable
// again.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "whoop-oauth-callback" -> paste this whole file -> Deploy. Requires
// the same WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET secrets as
// whoop-oauth-start. This function's deployed URL —
// https://<project-ref>.supabase.co/functions/v1/whoop-oauth-callback — is
// exactly what must be entered as the Redirect URI in the WHOOP Developer
// Dashboard.
//
// IMPORTANT — this function must have JWT verification turned OFF. WHOOP
// redirects the user's browser straight here with no Supabase session
// attached, so the platform's default JWT gate rejects every request with
// "UNAUTHORIZED_NO_AUTH_HEADER" before this file's own code ever runs.
// Dashboard: Edge Functions -> whoop-oauth-callback -> Details/Settings ->
// turn off "Enforce JWT Verification". CLI: see the
// [functions.whoop-oauth-callback] verify_jwt = false entry in
// supabase/config.toml — `supabase functions deploy` picks it up
// automatically; a Dashboard-deployed function needs the toggle set by hand.
//
// WHOOP_TOKEN_URL below reflects WHOOP's OAuth 2.0 token endpoint (API v2)
// as of this writing — confirm against your WHOOP Developer Dashboard / API
// docs before relying on this, and update the constant below if it's changed.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHOOP_CLIENT_ID = Deno.env.get('WHOOP_CLIENT_ID')!;
const WHOOP_CLIENT_SECRET = Deno.env.get('WHOOP_CLIENT_SECRET')!;

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/whoop-oauth-callback`;
// A state token this old is treated as abandoned rather than honored — the
// whole handshake (open browser, log into WHOOP, approve) should take well
// under this in normal use.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// The `status` param here is only ever logged server-side (see the
// `console.error` calls at each errorRedirect() call site) — the redirect
// itself is always an HTTP 302, since that's what makes the browser follow
// `Location`. Any distinct 4xx/5xx we'd otherwise want to surface can't ride
// along on a redirect response, so it isn't a parameter here.
function redirectToApp(status: 'success' | 'error', message?: string): Response {
  const url = new URL('soset://whoop-callback');
  url.searchParams.set('status', status);
  if (message) url.searchParams.set('message', message);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

function successRedirect() {
  return redirectToApp('success');
}

function errorRedirect(message: string) {
  return redirectToApp('error', message);
}

type WhoopTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  // WHOOP echoes back the scopes it actually granted here — which can be a
  // subset of what was requested if this app isn't cleared for one of them
  // in the WHOOP Developer Dashboard (already confirmed to happen for
  // read:profile on this app; see WHOOP_SCOPES in whoop-oauth-start). Logged
  // below so a 401 on a specific WHOOP endpoint later can be told apart from
  // a code bug: if its scope is missing here, that's a dashboard config
  // issue, not something fixable in this function.
  scope?: string;
};

Deno.serve(async req => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return errorRedirect('Whoop access wasn’t granted. You can try again from the app.');
    }
    if (!code || !state) {
      return errorRedirect('This link is missing required information. Try connecting again from the app.');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: stateRow } = await admin
      .from('oauth_states')
      .select('user_id, provider, created_at')
      .eq('state', state)
      .maybeSingle();

    // Consumed immediately regardless of what's found, so a replayed or
    // guessed state value can never be retried.
    await admin.from('oauth_states').delete().eq('state', state);

    if (!stateRow || stateRow.provider !== 'whoop') {
      return errorRedirect('This connection request has expired or was already used. Try again from the app.');
    }
    const isExpired = Date.now() - new Date(stateRow.created_at).getTime() > STATE_MAX_AGE_MS;
    if (isExpired) {
      return errorRedirect('This connection request has expired. Try again from the app.');
    }

    const tokenResponse = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('WHOOP token exchange failed', tokenResponse.status, await tokenResponse.text());
      return errorRedirect('Whoop couldn’t confirm the connection. Try again from the app.');
    }

    const tokens = (await tokenResponse.json()) as WhoopTokenResponse;
    console.log('WHOOP token exchange granted scopes:', tokens.scope ?? '(not present in response)');
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { error: upsertError } = await admin.from('integration_connections').upsert(
      {
        user_id: stateRow.user_id,
        provider: 'whoop',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        token_expires_at: tokenExpiresAt,
      },
      { onConflict: 'user_id,provider' },
    );
    if (upsertError) throw upsertError;

    return successRedirect();
  } catch (err) {
    console.error(err);
    return errorRedirect('Something unexpected happened. Try again from the app.');
  }
});
