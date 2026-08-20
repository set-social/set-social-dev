// GymBee - oura-oauth-callback Edge Function
//
// Step 2 of the Oura OAuth connection flow, and the exact URL registered as
// this app's Redirect URI in the Oura Developer Portal. Oura redirects the
// user's browser here with either `code` + `state` (approved) or `error`
// (denied) — this is hit directly by a browser navigation, not called from
// the app, so it responds with an HTTP redirect rather than JSON. See
// whoop-oauth-callback's own comment for the full "why a 302 and not an
// HTML page" rationale (Content-Type: text/html gets silently downgraded to
// text/plain on the default *.supabase.co domain).
//
// Looks up which user the `state` belongs to (minted by oura-oauth-start),
// consumes it (one-time use), exchanges the code for tokens server-side —
// so OURA_CLIENT_SECRET never touches the mobile app — and stores the
// result in integration_connections. The response then hands off back to
// the app via a plain HTTP 302 redirect to the soset://oura-callback deep
// link (RootNavigator's `linking` config already has this path aliased
// alongside whoop-callback/spotify-callback).
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "oura-oauth-callback" -> paste this whole file -> Deploy. Requires
// the same OURA_CLIENT_ID / OURA_CLIENT_SECRET secrets as oura-oauth-start.
// This function's deployed URL —
// https://<project-ref>.supabase.co/functions/v1/oura-oauth-callback — is
// exactly what must be entered as the Redirect URI in the Oura Developer
// Portal.
//
// IMPORTANT — this function must have JWT verification turned OFF. Oura
// redirects the user's browser straight here with no Supabase session
// attached, so the platform's default JWT gate rejects every request with
// "UNAUTHORIZED_NO_AUTH_HEADER" before this file's own code ever runs.
// Dashboard: Edge Functions -> oura-oauth-callback -> Details/Settings ->
// turn off "Enforce JWT Verification". CLI: see the
// [functions.oura-oauth-callback] verify_jwt = false entry in
// supabase/config.toml — `supabase functions deploy` picks it up
// automatically; a Dashboard-deployed function needs the toggle set by hand.
//
// OURA_TOKEN_URL below reflects Oura's OAuth 2.0 token endpoint (API v2) as
// of this writing — confirm against the Oura Developer Portal / API docs
// before relying on this, and update the constant below if it's changed.
// Note this function only performs the *initial* code exchange, so the
// single-use-refresh-token behavior (every refresh must store the new
// refresh_token, never fall back to reusing the old one) applies to
// oura-sync, not here — this file just stores whatever refresh_token Oura
// hands back the first time.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OURA_CLIENT_ID = Deno.env.get('OURA_CLIENT_ID')!;
const OURA_CLIENT_SECRET = Deno.env.get('OURA_CLIENT_SECRET')!;

const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/oura-oauth-callback`;
// A state token this old is treated as abandoned rather than honored — the
// whole handshake (open browser, log into Oura, approve) should take well
// under this in normal use.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// The `status` param here is only ever logged server-side (see the
// `console.error` calls at each errorRedirect() call site) — the redirect
// itself is always an HTTP 302, since that's what makes the browser follow
// `Location`. Any distinct 4xx/5xx we'd otherwise want to surface can't ride
// along on a redirect response, so it isn't a parameter here.
function redirectToApp(status: 'success' | 'error', message?: string): Response {
  const url = new URL('soset://oura-callback');
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

type OuraTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
};

Deno.serve(async req => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return errorRedirect('Oura access wasn’t granted. You can try again from the app.');
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

    if (!stateRow || stateRow.provider !== 'oura') {
      return errorRedirect('This connection request has expired or was already used. Try again from the app.');
    }
    const isExpired = Date.now() - new Date(stateRow.created_at).getTime() > STATE_MAX_AGE_MS;
    if (isExpired) {
      return errorRedirect('This connection request has expired. Try again from the app.');
    }

    const tokenResponse = await fetch(OURA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: OURA_CLIENT_ID,
        client_secret: OURA_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('Oura token exchange failed', tokenResponse.status, await tokenResponse.text());
      return errorRedirect('Oura couldn’t confirm the connection. Try again from the app.');
    }

    const tokens = (await tokenResponse.json()) as OuraTokenResponse;
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { error: upsertError } = await admin.from('integration_connections').upsert(
      {
        user_id: stateRow.user_id,
        provider: 'oura',
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
