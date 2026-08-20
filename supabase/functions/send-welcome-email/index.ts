// GymBee - send-welcome-email Edge Function
//
// Fires once per new account, right after signup — not called from client
// code (contrast confirm-password-change), but invoked directly by a
// Supabase Database Webhook on `auth.users` INSERT. Configure that webhook
// in the Dashboard (Database -> Webhooks -> Create a new hook):
//   Table:       auth.users
//   Events:      Insert
//   Type:        HTTP Request
//   URL:         https://<project-ref>.supabase.co/functions/v1/send-welcome-email
//   HTTP Headers: add one named `x-webhook-secret` set to the same value as
//                 the WELCOME_EMAIL_WEBHOOK_SECRET secret below — this is
//                 the only thing standing between this endpoint and anyone
//                 on the internet POSTing a fake signup payload at it, since
//                 (unlike confirm-password-change) there's no logged-in
//                 caller to check a session against.
//
// Requires the same GMAIL_USER / GMAIL_APP_PASSWORD secrets
// request-password-change already uses (no new mail credentials needed —
// same support@setsocial.app mailbox), plus one new secret:
//   supabase secrets set WELCOME_EMAIL_WEBHOOK_SECRET=$(openssl rand -hex 24)
// Paste that same value into the webhook's `x-webhook-secret` header above.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "send-welcome-email" -> paste this whole file -> Deploy. Turn OFF
// "Enforce JWT Verification" for this one (the default expects a
// user/anon Supabase JWT, which a Database Webhook call never sends) —
// the x-webhook-secret check above is what authenticates the caller instead.

import { createClient } from 'npm:@supabase/supabase-js';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER')!;
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD')!;
const WELCOME_EMAIL_WEBHOOK_SECRET = Deno.env.get('WELCOME_EMAIL_WEBHOOK_SECRET')!;

const TRIAL_DAYS = 3;

// Real feature list — kept in sync with PaywallScreen.tsx's own FEATURES
// array by hand (no shared module between an Edge Function and the RN
// bundle), not the full list: just the four most concrete, skimmable ones
// for an email a new athlete has zero context for yet. The trailing
// "...and more" line covers the rest (regenerating a program, unlimited
// history, etc.) without listing every single one here.
const TRIAL_FEATURES = [
  'Unlimited Arnold conversations &amp; Form Checks',
  'Arnold Macro Tracking',
  'Adaptive Coaching Intelligence — your plan adjusts to your readiness',
  'Full progress analytics, PR history &amp; the home screen widget',
];

// Public bucket set up in 0075_branding_storage.sql — upload the real mark
// once (Dashboard -> Storage -> branding, or `supabase storage cp`), same
// PNG as src/assets/branding/setsocial-mark.png. An inline SVG (what
// SetSocialMarkOutline uses in-app) isn't an option here: most email
// clients, notably Outlook and a lot of mobile Mail apps, simply don't
// render SVG at all — only <img src> to a hosted raster file works
// everywhere.
const BRAND_MARK_URL = `${SUPABASE_URL}/storage/v1/object/public/branding/setsocial-mark.png`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function welcomeEmailHtml(firstName: string): string {
  // Same fixed dark brand treatment as request-password-change's
  // confirmationEmailHtml — inline-styled, table-based, system font stack.
  // Keep these two visually identical in spirit if either one changes.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#090B10;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#090B10;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#171B23;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:8px;vertical-align:middle;"><img src="${BRAND_MARK_URL}" width="22" height="22" alt="" style="display:block;border:0;" /></td>
                  <td style="vertical-align:middle;"><span style="font-size:20px;font-weight:800;letter-spacing:-0.2px;color:#F2F4F7;">Set</span><span style="font-size:20px;font-weight:800;letter-spacing:-0.2px;color:#00F5D4;">Social</span></td>
                </tr></table>
                <div style="display:inline-block;margin-top:18px;padding:5px 12px;border-radius:999px;background-color:rgba(0,245,212,0.14);color:#00F5D4;font-size:12px;font-weight:700;letter-spacing:0.2px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${TRIAL_DAYS}-DAY FREE TRIAL</div>
                <p style="margin:16px 0 0 0;font-size:22px;font-weight:800;line-height:28px;color:#F2F4F7;letter-spacing:-0.3px;">Welcome, ${firstName}. Let's build your first program.</p>
                <p style="margin:12px 0 0 0;font-size:15px;line-height:23px;color:#A7AFBD;">Your account's ready. Every new athlete gets a ${TRIAL_DAYS}-day free trial of SetSocial Pro — here's what that unlocks:</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                ${TRIAL_FEATURES.map(
                  f =>
                    `<p style="margin:0 0 10px 0;font-size:14px;line-height:20px;color:#E5E8ED;">&#10003;&nbsp;&nbsp;${f}</p>`,
                ).join('\n                ')}
                <p style="margin:0;font-size:13px;line-height:18px;color:#737C8C;">...and more.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 32px 0 32px;" align="center">
                <a href="soset://paywall?trigger=welcome_email" style="display:inline-block;padding:15px 28px;border-radius:999px;background-color:#00F5D4;color:#04140D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15.5px;font-weight:800;letter-spacing:-0.1px;text-decoration:none;">Start your ${TRIAL_DAYS}-Day Free Trial of SetSocial Pro</a>
                <p style="margin:14px 0 0 0;font-size:12px;color:#737C8C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">No charge until your trial ends. Cancel anytime in the App Store or Google Play.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 0 32px;"><div style="height:1px;background-color:rgba(255,255,255,0.08);margin-top:28px;"></div></td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0;font-size:12.5px;line-height:18px;color:#737C8C;">Didn't create a SetSocial account? Ignore this email, or reach us at support@setsocial.app.</p>
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
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !WELCOME_EMAIL_WEBHOOK_SECRET) {
      console.error('send-welcome-email misconfigured: GMAIL_USER/GMAIL_APP_PASSWORD/WELCOME_EMAIL_WEBHOOK_SECRET secret(s) not set');
      return json({ error: 'Not configured' }, 500);
    }

    // Only Supabase's own Database Webhook (configured with this same
    // secret in a custom header) should ever be able to trigger a send —
    // there's no user session to check the way confirm-password-change
    // checks one, so this header is the entire authentication story.
    if (req.headers.get('x-webhook-secret') !== WELCOME_EMAIL_WEBHOOK_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // Database Webhook payload shape: { type, table, schema, record, old_record }.
    // record is the just-inserted auth.users row.
    const payload = await req.json();
    const newUser = payload?.record;
    const email: string | undefined = newUser?.email;
    const userId: string | undefined = newUser?.id;
    if (!email || !userId) {
      return json({ error: 'Missing record.email/record.id in webhook payload' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // display_name is set by a separate client-side profile update right
    // after signUp() resolves (see SignUpScreen), not passed to signUp()
    // itself — it usually isn't there yet by the time this webhook fires,
    // same timing gap request-password-change's own firstName lookup
    // already falls back gracefully for.
    const { data: profile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();
    const firstName = profile?.display_name?.split(' ')[0] || 'there';

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
        to: email,
        subject: `Welcome to SetSocial — your ${TRIAL_DAYS}-day Pro trial is ready`,
        html: welcomeEmailHtml(firstName),
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
