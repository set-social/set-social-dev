// GymBee - spotify-oauth-callback Edge Function
//
// Step 2 of the Spotify OAuth connection flow, and the exact URL registered
// as this app's Redirect URI in the Spotify Developer Dashboard. Spotify
// redirects the user's browser here with either `code` + `state` (approved)
// or `error` (denied) — this is hit directly by a browser navigation, not
// called from the app, so it responds with an HTTP redirect rather than
// JSON (see below for why it's a redirect and not an HTML page).
//
// Looks up which user the `state` belongs to (minted by
// spotify-oauth-start), consumes it (one-time use), exchanges the code for
// tokens server-side — so SPOTIFY_CLIENT_SECRET never touches the mobile
// app — and stores the result in integration_connections. The response then
// hands off back to the app via a plain HTTP 302 redirect to the
// soset://spotify-callback deep link (registered in Info.plist /
// AndroidManifest.xml, handled by RootNavigator's `linking` config).
//
// This is a bare redirect rather than an HTML landing page on purpose: Edge
// Functions on the default *.supabase.co domain silently rewrite any
// `Content-Type: text/html` response to `text/plain` (+ `nosniff`) — a
// platform-level restriction, confirmed via supabase/discussions#35627, that
// makes the whole body inert (no rendering, no button, no <script>) no
// matter what the function sets. A 302's `Location` header isn't subject to
// that rewrite, and unlike a JS `window.location` assignment it isn't
// blocked by Safari's no-gesture heuristics either, so it's the reliable way
// to hand off on this domain. Same reasoning as whoop-oauth-callback.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "spotify-oauth-callback" -> paste this whole file -> Deploy.
// Requires the same SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET secrets as
// spotify-oauth-start. This function's deployed URL —
// https://<project-ref>.supabase.co/functions/v1/spotify-oauth-callback —
// is exactly what must be entered as the Redirect URI in the Spotify
// Developer Dashboard.
//
// IMPORTANT — this function must have JWT verification turned OFF. Spotify
// redirects the user's browser straight here with no Supabase session
// attached, so the platform's default JWT gate rejects every request with
// "UNAUTHORIZED_NO_AUTH_HEADER" before this file's own code ever runs.
// Dashboard: Edge Functions -> spotify-oauth-callback -> Details/Settings ->
// turn off "Enforce JWT Verification". CLI: see the
// [functions.spotify-oauth-callback] verify_jwt = false entry in
// supabase/config.toml — `supabase functions deploy` picks it up
// automatically; a Dashboard-deployed function needs the toggle set by hand.
//
// SPOTIFY_TOKEN_URL below reflects Spotify's OAuth 2.0 token endpoint as of
// this writing — confirm against your Spotify Developer Dashboard / Web API
// docs before relying on this, and update the constant below if it's
// changed.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID')!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/spotify-oauth-callback`;
// A state token this old is treated as abandoned rather than honored — the
// whole handshake (open browser, log into Spotify, approve) should take
// well under this in normal use.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// The `status` param here is only ever logged server-side (see the
// `console.error` calls at each errorRedirect() call site) — the redirect
// itself is always an HTTP 302, since that's what makes the browser follow
// `Location`. Any distinct 4xx/5xx we'd otherwise want to surface can't ride
// along on a redirect response, so it isn't a parameter here.
function redirectToApp(status: 'success' | 'error', message?: string): Response {
  const url = new URL('soset://spotify-callback');
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

type SpotifyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  // Spotify echoes back the scopes it actually granted here — logged below
  // so a 403 on a specific Spotify endpoint later can be told apart from a
  // code bug: if its scope is missing here, that's a Dashboard config issue
  // (the app not being in the right access mode for that scope), not
  // something fixable in this function. Same reasoning as WHOOP's `scope`
  // logging in whoop-oauth-callback.
  scope?: string;
};

Deno.serve(async req => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return errorRedirect('Spotify access wasn’t granted. You can try again from the app.');
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

    if (!stateRow || stateRow.provider !== 'spotify') {
      return errorRedirect('This connection request has expired or was already used. Try again from the app.');
    }
    const isExpired = Date.now() - new Date(stateRow.created_at).getTime() > STATE_MAX_AGE_MS;
    if (isExpired) {
      return errorRedirect('This connection request has expired. Try again from the app.');
    }

    const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Spotify's token endpoint expects client credentials via HTTP Basic
        // Auth (client_secret_basic) rather than as body params — unlike
        // WHOOP's token endpoint, which takes client_id/client_secret in the
        // body itself. See whoop-oauth-callback for that variant.
        Authorization: `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('Spotify token exchange failed', tokenResponse.status, await tokenResponse.text());
      return errorRedirect('Spotify couldn’t confirm the connection. Try again from the app.');
    }

    const tokens = (await tokenResponse.json()) as SpotifyTokenResponse;
    console.log('Spotify token exchange granted scopes:', tokens.scope ?? '(not present in response)');
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { error: upsertError } = await admin.from('integration_connections').upsert(
      {
        user_id: stateRow.user_id,
        provider: 'spotify',
        access_token: tokens.access_token,
        // Spotify's Authorization Code flow always issues a refresh_token on
        // the initial exchange (unlike a refresh-of-a-refresh, which can
        // omit it — see the refresh logic in spotify-player), so this
        // shouldn't actually be null in practice, but the fallback keeps a
        // transient omission from wiping a previously stored one.
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
