// GymBee - request-password-change Edge Function
//
// Called from the Account screen's "Change Password" field (see
// src/screens/profile/AccountScreen.tsx / useAuth's requestPasswordChange).
// Unlike a plain supabase.auth.updateUser({ password }) call, this does NOT
// apply the new password itself — it stores it in pending_password_changes
// (see migration 0068) alongside a one-time token, emails a confirmation
// link to the caller's own address from support@setsocial.app, and only
// supabase/functions/confirm-password-change (hit when that link is
// tapped) actually applies it and forces every session to log back in.
//
// Requires two Supabase project secrets to send mail through Google
// Workspace: GMAIL_USER (support@setsocial.app) and GMAIL_APP_PASSWORD (a
// 16-character App Password generated for that mailbox — see this repo's
// setup notes for exactly how). Set via:
//   supabase secrets set GMAIL_USER=support@setsocial.app GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "request-password-change" -> paste this whole file -> Deploy.
// Leave "Enforce JWT Verification" ON (the default) — this function must
// only ever run on behalf of an already-signed-in caller.

import { createClient } from 'npm:@supabase/supabase-js';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER')!;
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD')!;

const MIN_PASSWORD_LENGTH = 6;
const TOKEN_TTL_MINUTES = 20;
const RESEND_COOLDOWN_SECONDS = 60;

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

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function confirmationEmailHtml(firstName: string, confirmUrl: string): string {
  // Inline-styled, table-based layout — email clients don't load app fonts
  // or external stylesheets, so this deliberately doesn't reach for Inter
  // (see theme/tokens.ts's fontFamily note) and sticks to a system stack.
  // Colors mirror src/theme/tokens.ts (bg.base, text.primary/secondary,
  // accent.primary) so this reads as the same brand as the app — kept in
  // sync by hand, same as the native widget colors, since there's no
  // shared token source into an Edge Function.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#090B10;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#090B10;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#171B23;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <span style="font-size:20px;font-weight:800;letter-spacing:-0.2px;color:#F2F4F7;">Set</span><span style="font-size:20px;font-weight:800;letter-spacing:-0.2px;color:#00F5D4;">Social</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0 0 16px 0;font-size:20px;font-weight:700;color:#F2F4F7;">Confirm your password change</p>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:21px;color:#A7AFBD;">Hey ${firstName}, you asked to change your SetSocial password. Tap the button below to confirm — until you do, your current password still works and nothing changes.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;" align="center">
                <a href="${confirmUrl}" style="display:inline-block;padding:14px 32px;border-radius:999px;background-color:#00F5D4;color:#04140D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;">Confirm password change</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0 0 8px 0;font-size:13px;line-height:18px;color:#737C8C;">This link expires in ${TOKEN_TTL_MINUTES} minutes and works once. Confirming will sign you out everywhere — you'll need to log back in with the new password.</p>
                <p style="margin:0;font-size:13px;line-height:18px;color:#737C8C;">Didn't request this? Ignore this email and your password will stay the same, or reach us at support@setsocial.app.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    // Deno.env.get(...)! at the top of this file is a compile-time-only
    // assertion — a missing secret silently becomes the string `undefined`
    // at runtime, not a throw, so a forgotten `supabase secrets set` step
    // (see this file's own header comment) would otherwise surface as an
    // opaque SMTP auth failure deep inside smtp.send() instead of a message
    // that says what's actually wrong.
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.error('request-password-change misconfigured: GMAIL_USER/GMAIL_APP_PASSWORD secret(s) not set');
      return json(
        { error: 'Password changes are temporarily unavailable. Please try again later or contact support@setsocial.app.' },
        500,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);
    const user = userData.user;

    const { newPassword } = await req.json();
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existing } = await admin
      .from('pending_password_changes')
      .select('created_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing) {
      const ageSeconds = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
      if (ageSeconds < RESEND_COOLDOWN_SECONDS) {
        return json({ error: 'A confirmation email was just sent — check your inbox before requesting another.' }, 429);
      }
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    const firstName = profile?.display_name?.split(' ')[0] || 'there';

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: upsertError } = await admin
      .from('pending_password_changes')
      .upsert(
        { user_id: user.id, new_password: newPassword, token_hash: tokenHash, expires_at: expiresAt, created_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (upsertError) throw upsertError;

    const confirmUrl = `${SUPABASE_URL}/functions/v1/confirm-password-change?token=${rawToken}`;

    const smtp = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
      },
    });
    try {
      await smtp.send({
        from: `SetSocial <${GMAIL_USER}>`,
        to: user.email!,
        subject: 'Confirm your password change',
        html: confirmationEmailHtml(firstName, confirmUrl),
        content: 'auto',
      });
    } finally {
      await smtp.close();
    }

    return json({ ok: true }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
