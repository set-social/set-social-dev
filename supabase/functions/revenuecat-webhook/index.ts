// SetSocial - revenuecat-webhook Edge Function
//
// Server-side authority for subscription state: RevenueCat calls this on
// every purchase, renewal, cancellation, expiration, refund, etc. and this
// writes the result into public.subscriptions with source = 'revenuecat',
// exactly the row shape 0050_premium_subscriptions.sql already anticipated.
// That table's own AFTER INSERT/UPDATE/DELETE trigger (subscriptions_after_
// change -> sync_is_premium) keeps profiles.is_premium correct automatically
// — this function never touches profiles directly.
//
// Never trust the client for this: the RevenueCat SDK's local CustomerInfo
// (used client-side for this device's own paywall/purchase-button state,
// see src/services/purchases/revenueCat.ts) reflects what *this device*
// just bought, but a Pro badge visible to other athletes, and the
// server-enforced AI Coach message cap (chat-coach edge function), both
// need a source of truth nothing on the device can spoof — that's this
// webhook, running with the service_role key.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "revenuecat-webhook" -> paste this whole file -> Deploy. Requires
// these secrets (Dashboard -> Edge Functions -> Secrets):
//   SUPABASE_URL                 - already set for every function in this project
//   SUPABASE_SERVICE_ROLE_KEY    - already set for every function in this project
//   REVENUECAT_WEBHOOK_AUTH_HEADER - any string you choose; must exactly
//     match the "Authorization header value" field you set when adding this
//     URL as a Webhook in the RevenueCat dashboard (Project Settings ->
//     Integrations -> Webhooks). This is what stops anyone else on the
//     internet from POSTing fake "purchase" events at this URL.
// Then point RevenueCat at:
//   https://<project-ref>.functions.supabase.co/revenuecat-webhook
// with "Entitlement id" filtering left as default (all events) — this
// function itself filters to the SetSocial Pro entitlement below, so
// unrelated entitlements (if this RevenueCat project ever hosts another
// app) are safely ignored rather than misread.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_AUTH_HEADER = Deno.env.get('REVENUECAT_WEBHOOK_AUTH_HEADER')!;

// Must match ENTITLEMENT_ID in src/services/purchases/revenueCat.ts.
const ENTITLEMENT_ID = 'SetSocial Pro';

// Events where access continues (or begins) — some of these (CANCELLATION,
// BILLING_ISSUE, SUBSCRIPTION_PAUSED) mean "won't renew" or "in a grace
// period", not "revoke now": access still ends correctly because expires_at
// is written from the event's own expiration_at_ms either way, same
// mechanism the daily expire_lapsed_subscriptions() sweep already relies on
// for manual grants.
const GRANT_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'TRANSFER',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'NON_RENEWING_PURCHASE',
  'CANCELLATION',
  'BILLING_ISSUE',
  'SUBSCRIPTION_PAUSED',
]);

// Events that revoke access immediately, regardless of expires_at.
const REVOKE_EVENT_TYPES = new Set(['EXPIRATION', 'REFUND', 'INVALIDATED']);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type RevenueCatEvent = {
  type: string;
  app_user_id: string;
  product_id?: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number | null;
};

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (req.headers.get('authorization') !== WEBHOOK_AUTH_HEADER) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await req.json();
    const event = payload.event as RevenueCatEvent | undefined;
    if (!event?.type || !event.app_user_id) return json({ error: 'Malformed event' }, 400);

    // Ignores events for other entitlements outright (e.g. if this
    // RevenueCat project ever hosts more than one app/product) rather than
    // recording a subscription row SetSocial itself shouldn't grant access
    // for.
    if (!event.entitlement_ids?.includes(ENTITLEMENT_ID)) {
      return json({ skipped: true, reason: 'unrelated_entitlement' }, 200);
    }

    const isRevoke = REVOKE_EVENT_TYPES.has(event.type);
    if (!isRevoke && !GRANT_EVENT_TYPES.has(event.type)) {
      // Unmodeled event type (REFUND_REVERSED, INVOICE_ISSUANCE, etc.) —
      // acknowledged so RevenueCat doesn't retry, but nothing written.
      return json({ skipped: true, reason: 'unhandled_event_type' }, 200);
    }

    const nowIso = new Date().toISOString();
    const expiresAt = isRevoke
      ? nowIso
      : event.expiration_at_ms != null
        ? new Date(event.expiration_at_ms).toISOString()
        : null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existing } = await admin
      .from('subscriptions')
      .select('id')
      .eq('user_id', event.app_user_id)
      .eq('source', 'revenuecat')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = {
      user_id: event.app_user_id,
      source: 'revenuecat' as const,
      status: isRevoke ? ('expired' as const) : ('active' as const),
      plan: event.product_id ?? 'premium_monthly',
      expires_at: expiresAt,
      revenuecat_customer_id: event.app_user_id,
      note: `RevenueCat ${event.type}`,
      updated_at: nowIso,
    };

    const { error } = existing
      ? await admin.from('subscriptions').update(row).eq('id', existing.id)
      : await admin.from('subscriptions').insert({ ...row, started_at: nowIso });

    if (error) {
      // Most likely cause: app_user_id doesn't match any profiles.id (an
      // anonymous RevenueCat id from before identifyRevenueCatUser() ran,
      // or a sandbox tester with no real account) — the subscriptions FK
      // rejects it. Retrying won't fix that, so acknowledge rather than
      // let RevenueCat keep resending an event that will never succeed.
      console.error('[revenuecat-webhook] write failed', error);
      return json({ skipped: true, reason: 'write_failed' }, 200);
    }

    return json({ ok: true }, 200);
  } catch (err) {
    console.error('[revenuecat-webhook]', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
