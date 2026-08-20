// GymBee - delete-account Edge Function
//
// Called from the Account screen's danger zone. Verifies the caller's
// session, then permanently deletes their auth.users row via the
// service-role admin API. profiles.id -> auth.users.id is ON DELETE CASCADE
// (see migration 0001), and everything else FKs through profiles/programs,
// so this single admin call is enough to remove all of the user's data.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function named
// "delete-account" -> paste this whole file -> Deploy.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    // Scoped to the caller's own JWT - used only to verify who's asking.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);

    // Service-role client, needed because deleting an auth.users row is an
    // admin-only operation - this is the only step this function performs.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id);
    if (deleteError) throw deleteError;

    return json({ ok: true }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
