// GymBee - form-check-cleanup-sweep Edge Function
//
// Woken up every 20 minutes by run_form_check_cleanup_sweep()
// (0069_form_check.sql), itself scheduled via pg_cron and invoked with the
// service-role key the same way proactive-coach-sweep's own net.http_post
// call is - there is no caller JWT to verify here, this is server-to-server
// only.
//
// The form-check Edge Function already deletes every frame it downloads,
// on both its success and failure paths (see its `finally` block) - this
// sweep only exists to catch an upload that never made it that far at all
// (the athlete backgrounded the app, lost connection, or force-quit between
// uploading a frame and calling form-check). Anything left in
// form-check-photos older than STALE_AFTER_MS is deleted here.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "form-check-cleanup-sweep" -> paste this whole file -> Deploy.

import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'form-check-photos';
const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

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
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const cutoff = Date.now() - STALE_AFTER_MS;

    // Bucket root lists one entry per athlete's folder (id: null, no
    // created_at - only leaf files carry that metadata), since every upload
    // is written to `${userId}/...`.
    const { data: userFolders, error: listUsersError } = await admin.storage.from(BUCKET).list('', { limit: 1000 });
    if (listUsersError) throw listUsersError;

    let removedCount = 0;
    for (const folder of userFolders ?? []) {
      if (!folder.name) continue;
      try {
        const { data: files, error: listFilesError } = await admin.storage.from(BUCKET).list(folder.name, { limit: 1000 });
        if (listFilesError) {
          console.error('failed to list form-check-photos folder', folder.name, listFilesError);
          continue;
        }
        const stalePaths = (files ?? [])
          .filter(file => file.created_at && new Date(file.created_at).getTime() < cutoff)
          .map(file => `${folder.name}/${file.name}`);
        if (stalePaths.length === 0) continue;

        const { error: removeError } = await admin.storage.from(BUCKET).remove(stalePaths);
        if (removeError) {
          console.error('failed to remove stale form-check-photos', stalePaths, removeError);
          continue;
        }
        removedCount += stalePaths.length;
      } catch (err) {
        console.error('form-check-cleanup-sweep folder failed', folder.name, err);
      }
    }

    return json({ ok: true, removed: removedCount }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
