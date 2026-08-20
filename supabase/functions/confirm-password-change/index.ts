// GymBee - confirm-password-change Edge Function
//
// This is the URL support@setsocial.app's "Confirm password change" email
// (sent by request-password-change) links to. It's hit directly by a
// browser navigation from the Mail app, not called from the app itself, so
// like whoop-oauth-callback/spotify-oauth-callback/oura-oauth-callback it
// responds with an HTTP redirect rather than an HTML page (Content-Type:
// text/html gets silently downgraded to text/plain on the default
// *.supabase.co domain — see those functions' own comments for the full
// rationale). The redirect target is soset://password-changed?status=..., a
// new deep-link path RootNavigator's usePasswordChangeDeepLink hook listens
// for directly (this one can't reuse the `linking.config.screens` approach
// those OAuth callbacks use, since it has to force a sign-out regardless of
// which stack — Auth or the authenticated tree — happens to be mounted).
//
// Looks up the token (hashed the same way request-password-change hashed it
// before storing) in pending_password_changes, applies the stored password
// via the admin API, force-invalidates every session for that user via the
// revoke_all_sessions() function from migration 0068, and deletes the row —
// single use, whether it succeeds or has already expired.
//
// IMPORTANT — this function must have JWT verification turned OFF (the
// browser tapping this link has no Supabase session/apikey to send). See
// the [functions.confirm-password-change] verify_jwt = false entry in
// supabase/config.toml; a Dashboard-deployed function needs the "Enforce
// JWT Verification" toggle turned off by hand under
// Edge Functions -> confirm-password-change -> Details/Settings.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "confirm-password-change" -> paste this whole file -> Deploy.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function redirect(status: 'success' | 'invalid' | 'expired' | 'error') {
  return new Response(null, {
    status: 302,
    headers: { Location: `soset://password-changed?status=${status}` },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async req => {
  try {
    const token = new URL(req.url).searchParams.get('token');
    if (!token) return redirect('invalid');

    const tokenHash = await sha256Hex(token);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: pending, error: lookupError } = await admin
      .from('pending_password_changes')
      .select('id, user_id, new_password, expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!pending) return redirect('invalid');

    // Consume the row up front regardless of outcome — a token is single
    // use whether it succeeds, is expired, or something fails applying it,
    // so a re-tap of the same email link can't retry against stale state.
    await admin.from('pending_password_changes').delete().eq('id', pending.id);

    if (new Date(pending.expires_at).getTime() < Date.now()) {
      return redirect('expired');
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(pending.user_id, {
      password: pending.new_password,
    });
    if (updateError) throw updateError;

    const { error: revokeError } = await admin.rpc('revoke_all_sessions', { target_user_id: pending.user_id });
    if (revokeError) throw revokeError;

    return redirect('success');
  } catch (err) {
    console.error(err);
    return redirect('error');
  }
});
