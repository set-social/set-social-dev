// SetSocial - send-push Edge Function
//
// The single fan-in point for every push notification the app sends. Never
// called by the client — only by Postgres triggers (via push_dispatch() in
// 0043_push_notifications.sql / 0044_push_batching.sql, over pg_net) and by
// generate-program on completion. Each caller passes a `type` plus just
// enough ids to look everything else up; this function resolves the
// recipient, checks their per-category preference, builds the title/body
// from the templates in the reviewed design spec, then sends to each of the
// recipient's tokens over whichever channel its platform column says — APNs
// directly over HTTP/2 for 'ios' (Deno's fetch negotiates HTTP/2 via ALPN
// automatically), FCM's HTTP v1 API for 'android'. No push SDK either way —
// both are plain fetch calls, auth'd with a Web-Crypto-signed JWT.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// named "send-push" -> paste this whole file -> Deploy. Requires these
// secrets (Dashboard -> Edge Functions -> Secrets):
//   APNS_TEAM_ID       - Apple Developer Team ID
//   APNS_KEY_ID        - Key ID of the APNs Auth Key (.p8)
//   APNS_PRIVATE_KEY   - full contents of the .p8 file, PEM-encoded
//   APNS_BUNDLE_ID     - defaults to com.soset.app if unset
//   APNS_ENVIRONMENT   - 'sandbox' (default) or 'production'
//   FCM_PROJECT_ID     - Firebase project id (project_id in the service-account JSON)
//   FCM_CLIENT_EMAIL   - client_email from that same service-account JSON
//   FCM_PRIVATE_KEY    - private_key from that same JSON, PEM-encoded
// Also requires, run once against the database (see 0043's header comment):
//   alter database postgres set app.settings.supabase_functions_url = '...';
//   alter database postgres set app.settings.service_role_key = '...';
// Until secrets + those two settings are all in place, calls here either
// no-op (pg_net side) or fail closed (APNs/FCM auth failure, logged, no
// throw) — nothing crashes, notifications just don't go out yet. The two
// providers' secrets are independent of each other — iOS push works with
// only the APNS_* secrets set, same as before Android existed.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID')!;
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID')!;
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY')!;
const APNS_BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID') || 'com.soset.app';
const APNS_ENVIRONMENT = Deno.env.get('APNS_ENVIRONMENT') || 'sandbox';
const APNS_HOST = APNS_ENVIRONMENT === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID')!;
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL')!;
const FCM_PRIVATE_KEY = Deno.env.get('FCM_PRIVATE_KEY')!;

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

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

type Admin = SupabaseClient;

type ResolvedNotification = {
  recipientId: string;
  title: string;
  body: string;
  screen: string;
  params: Record<string, unknown>;
  collapseId?: string;
  priority: '5' | '10';
  interruptionLevel: 'passive' | 'active' | 'time-sensitive';
};

// ---------------------------------------------------------------------------
// APNs auth (JWT, ES256) — signed with Web Crypto directly rather than a
// dependency; APNs auth tokens are reusable for up to an hour, so this is
// cached at module scope and only re-signed once it's ~50 minutes old.

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cachedJwt: { token: string; issuedAt: number } | null = null;

async function getApnsJwt(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedJwt && nowSeconds - cachedJwt.issuedAt < 50 * 60) return cachedJwt.token;

  const signingInput = `${base64url(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID }))}.${base64url(
    JSON.stringify({ iss: APNS_TEAM_ID, iat: nowSeconds }),
  )}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(APNS_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto's ECDSA sign() returns the raw (r || s) IEEE P1363 signature,
  // which is exactly the format JOSE's ES256 wants — no DER re-encoding.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));

  const jwt = `${signingInput}.${base64url(signature)}`;
  cachedJwt = { token: jwt, issuedAt: nowSeconds };
  return jwt;
}

async function sendApns(admin: Admin, deviceToken: string, n: ResolvedNotification) {
  const jwt = await getApnsJwt();
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    'apns-topic': APNS_BUNDLE_ID,
    'apns-push-type': 'alert',
    'apns-priority': n.priority,
    'content-type': 'application/json',
  };
  if (n.collapseId) headers['apns-collapse-id'] = n.collapseId;

  const res = await fetch(`https://${APNS_HOST}/3/device/${deviceToken}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      aps: {
        alert: { title: n.title, body: n.body },
        sound: 'default',
        'interruption-level': n.interruptionLevel,
      },
      screen: n.screen,
      params: n.params,
    }),
  });

  if (!res.ok) {
    const reason = await res.text();
    console.error('APNs send failed', res.status, reason);
    // Apple reports a dead token either way — clean it up so future sends
    // (and the recipient's token count) don't keep carrying dead weight.
    if (res.status === 410 || reason.includes('BadDeviceToken') || reason.includes('Unregistered')) {
      await admin.from('push_tokens').delete().eq('token', deviceToken);
    }
  }
}

// ---------------------------------------------------------------------------
// FCM auth (OAuth2 via a service-account JWT, RS256) — same "sign with Web
// Crypto directly, no SDK" posture as the APNs section above, just RSA
// instead of ECDSA. A minted access token is valid for up to an hour per
// Google's OAuth2 spec, so it's cached at module scope and re-minted once
// it's ~50 minutes old, same shape as the APNs JWT cache.

let cachedFcmToken: { token: string; issuedAt: number } | null = null;

async function getFcmAccessToken(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedFcmToken && nowSeconds - cachedFcmToken.issuedAt < 50 * 60) return cachedFcmToken.token;

  const signingInput = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify({
      iss: FCM_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  )}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(FCM_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM OAuth2 token exchange failed: ${res.status} ${await res.text()}`);
  }
  const { access_token: accessToken } = (await res.json()) as { access_token: string };
  cachedFcmToken = { token: accessToken, issuedAt: nowSeconds };
  return accessToken;
}

async function sendFcm(admin: Admin, fcmToken: string, n: ResolvedNotification) {
  const accessToken = await getFcmAccessToken();

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title: n.title, body: n.body },
        // FCM's data payload only carries flat strings — `params` gets
        // JSON-stringified here and parsed back out client-side (see
        // pushNotifications.ts's parsePayload). APNs' body above sends the
        // same field as a real nested object since its payload has no such
        // restriction.
        data: { screen: n.screen, params: JSON.stringify(n.params) },
        android: {
          // FCM has no APNs-style interruption-level concept — priority is
          // the one lever available, same 5-vs-10 split sendApns already uses.
          priority: n.priority === '10' ? 'high' : 'normal',
          notification: { channel_id: 'default', sound: 'default' },
        },
      },
    }),
  });

  if (!res.ok) {
    const reason = await res.text();
    console.error('FCM send failed', res.status, reason);
    // FCM reports a dead/unregistered token as a 404 with errorCode
    // UNREGISTERED in the body — same cleanup APNs' 410/BadDeviceToken path
    // does above. Not matching on other 4xxs here (e.g. INVALID_ARGUMENT can
    // just as easily mean a malformed request on our end, not a dead token).
    if (res.status === 404 || reason.includes('UNREGISTERED')) {
      await admin.from('push_tokens').delete().eq('token', fcmToken);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-type resolvers — each turns a trigger's minimal payload into the
// actual recipient + copy, or null if the push should be skipped (category
// disabled, no data left to report, etc). Names fall back display_name ->
// handle -> 'Someone' since either profile field can be null.

async function profileName(admin: Admin, userId: string): Promise<string> {
  const { data } = await admin.from('profiles').select('display_name, handle').eq('id', userId).single();
  return data?.display_name ?? data?.handle ?? 'Someone';
}

// Matches the client's ~60s foreground heartbeat (useAppForegroundHeartbeat)
// with a little slack — anything older means the app backgrounded (or was
// killed, which just lets this go stale on its own) since the last beat.
// Used by every new-as-of-milestone-72 resolver below to skip pushing to
// someone who's already looking at the app; existing types (messages,
// friend activity, etc.) are untouched.
const FOREGROUND_ACTIVE_WINDOW_MS = 90_000;

async function isActiveInApp(admin: Admin, userId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('last_foreground_at').eq('id', userId).single();
  const lastForeground = data?.last_foreground_at as string | null | undefined;
  if (!lastForeground) return false;
  return Date.now() - new Date(lastForeground).getTime() < FOREGROUND_ACTIVE_WINDOW_MS;
}

async function resolveMessage(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const { data: message } = await admin
    .from('dm_messages')
    .select('sender_id, conversation_id, body')
    .eq('id', payload.message_id as string)
    .single();
  if (!message) return null;

  const { data: conversation } = await admin
    .from('dm_conversations')
    .select('requester_id, recipient_id')
    .eq('id', message.conversation_id)
    .single();
  if (!conversation) return null;

  const recipientId = conversation.requester_id === message.sender_id ? conversation.recipient_id : conversation.requester_id;

  const { data: recipient } = await admin.from('profiles').select('push_messages_enabled').eq('id', recipientId).single();
  if (!recipient?.push_messages_enabled) return null;

  return {
    recipientId,
    title: await profileName(admin, message.sender_id),
    body: message.body ? truncate(message.body, 80) : '📷 Sent a photo',
    screen: 'Conversation',
    params: { conversationId: message.conversation_id },
    collapseId: `conversation-${message.conversation_id}`,
    priority: '10',
    interruptionLevel: 'time-sensitive',
  };
}

async function friendRequestBody(admin: Admin, addresseeId: string, requesterId: string, requesterName: string): Promise<string> {
  const { count } = await admin
    .from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('addressee_id', addresseeId)
    .eq('status', 'pending');
  const total = count ?? 1;
  if (total <= 1) return `${requesterName} wants to connect on SetSocial`;

  const { data: others } = await admin
    .from('friend_requests')
    .select('requester_id')
    .eq('addressee_id', addresseeId)
    .eq('status', 'pending')
    .neq('requester_id', requesterId)
    .order('created_at', { ascending: false })
    .limit(1);
  const secondName = others?.[0] ? await profileName(admin, others[0].requester_id) : 'someone else';

  if (total === 2) return `${requesterName} and ${secondName} want to connect`;
  const remaining = total - 2;
  return `${requesterName}, ${secondName}, and ${remaining} other${remaining === 1 ? '' : 's'} want to connect`;
}

async function resolveFriendRequest(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const { data: request } = await admin
    .from('friend_requests')
    .select('requester_id, addressee_id')
    .eq('id', payload.request_id as string)
    .single();
  if (!request) return null;

  const { data: recipient } = await admin.from('profiles').select('push_friends_enabled').eq('id', request.addressee_id).single();
  if (!recipient?.push_friends_enabled) return null;

  const requesterName = await profileName(admin, request.requester_id);

  return {
    recipientId: request.addressee_id,
    title: 'New friend request',
    body: await friendRequestBody(admin, request.addressee_id, request.requester_id, requesterName),
    screen: 'FriendsList',
    params: { userId: request.addressee_id, title: 'Friends' },
    collapseId: `friend-requests-${request.addressee_id}`,
    priority: '10',
    interruptionLevel: 'active',
  };
}

async function resolveFriendRequestAccepted(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const { data: request } = await admin
    .from('friend_requests')
    .select('requester_id, addressee_id')
    .eq('id', payload.request_id as string)
    .single();
  if (!request) return null;

  const { data: recipient } = await admin.from('profiles').select('push_friends_enabled').eq('id', request.requester_id).single();
  if (!recipient?.push_friends_enabled) return null;

  const acceptorName = await profileName(admin, request.addressee_id);

  return {
    recipientId: request.requester_id,
    title: `${acceptorName} accepted your request`,
    body: "You're connected — check out their profile and PRs",
    screen: 'FriendProfile',
    params: { userId: request.addressee_id },
    priority: '10',
    interruptionLevel: 'active',
  };
}

async function resolvePostLike(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const postId = payload.post_id as string;
  const ownerId = payload.owner_id as string;

  const { data: owner } = await admin.from('profiles').select('push_activity_enabled').eq('id', ownerId).single();
  if (!owner?.push_activity_enabled) return null;

  const { data: likers, count } = await admin
    .from('post_likes')
    .select('user_id', { count: 'exact' })
    .eq('post_id', postId)
    .neq('user_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(1);
  const total = count ?? 0;
  if (total === 0 || !likers?.[0]) return null;

  const likerName = await profileName(admin, likers[0].user_id);
  const { data: post } = await admin.from('posts').select('caption').eq('id', postId).single();

  return {
    recipientId: ownerId,
    title: total === 1 ? `${likerName} liked your photo` : `${likerName} and ${total - 1} other${total - 1 === 1 ? '' : 's'} liked your photo`,
    body: post?.caption ? truncate(post.caption, 80) : 'Your photo is getting love 🔥',
    screen: 'PostDetail',
    params: { postId },
    collapseId: `post-activity-${postId}`,
    priority: '5',
    interruptionLevel: 'passive',
  };
}

async function resolvePostComment(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const postId = payload.post_id as string;
  const ownerId = payload.owner_id as string;

  const { data: owner } = await admin.from('profiles').select('push_activity_enabled').eq('id', ownerId).single();
  if (!owner?.push_activity_enabled) return null;

  const { data: comments } = await admin
    .from('post_comments')
    .select('user_id, body')
    .eq('post_id', postId)
    .neq('user_id', ownerId)
    .gte('created_at', payload.window_start as string)
    .order('created_at', { ascending: true });
  if (!comments || comments.length === 0) return null;

  let title: string;
  let body: string;
  if (comments.length === 1) {
    title = `${await profileName(admin, comments[0].user_id)} commented on your photo`;
    body = `"${truncate(comments[0].body, 80)}"`;
  } else {
    title = `${comments.length} new comments on your photo`;
    const { data: post } = await admin.from('posts').select('caption').eq('id', postId).single();
    body = post?.caption ? truncate(post.caption, 80) : 'Catch up on what people are saying';
  }

  return {
    recipientId: ownerId,
    title,
    body,
    screen: 'PostDetail',
    params: { postId },
    collapseId: `post-activity-${postId}`,
    priority: '10',
    interruptionLevel: 'active',
  };
}

async function resolveAiProgramReady(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const userId = payload.user_id as string;
  const { data: profile } = await admin.from('profiles').select('push_ai_coach_enabled').eq('id', userId).single();
  if (!profile?.push_ai_coach_enabled) return null;

  return {
    recipientId: userId,
    title: "Your program's ready",
    body: "This week's plan is adjusted for your recovery — take a look",
    screen: 'ProgramDetail',
    params: payload.program_id ? { programId: payload.program_id } : {},
    priority: '10',
    interruptionLevel: 'active',
  };
}

/** Called by proactive-coach-sweep (0059_proactive_coach.sql's cron sweep)
 * once it's confirmed a Pro athlete's streak is at risk this evening.
 * Reuses push_ai_coach_enabled — this is the same "AI coach" category as
 * ai_program_ready, not a new preference. */
async function resolveStreakRiskNudge(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const userId = payload.user_id as string;
  const streak = payload.streak as number;
  const { data: profile } = await admin.from('profiles').select('push_ai_coach_enabled').eq('id', userId).single();
  if (!profile?.push_ai_coach_enabled) return null;

  return {
    recipientId: userId,
    title: "Don't lose your streak!",
    body: `Your ${streak}-day streak is still alive — log today's session before it resets.`,
    screen: 'Today',
    params: {},
    priority: '10',
    interruptionLevel: 'time-sensitive',
  };
}

/** Called by proactive-coach-sweep once pr_pace_candidates() surfaces a
 * confident forecast for a Pro athlete. Reuses push_ai_coach_enabled, same
 * category as ai_program_ready/resolveStreakRiskNudge above. */
async function resolvePrPaceForecastReady(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const userId = payload.user_id as string;
  const exerciseId = payload.exercise_id as string;
  const exerciseName = payload.exercise_name as string;
  const targetDate = payload.target_date as string;
  const { data: profile } = await admin.from('profiles').select('push_ai_coach_enabled').eq('id', userId).single();
  if (!profile?.push_ai_coach_enabled) return null;

  return {
    recipientId: userId,
    title: "You're on pace for a PR",
    body: `${exerciseName} — a new best is projected around ${targetDate}.`,
    screen: 'PRDetail',
    params: { exerciseId },
    priority: '5',
    interruptionLevel: 'active',
  };
}

/** Called by proactive-coach-sweep's meal-gap pass (0063_food_photo_logging.sql
 * schema, runMealGapPass) once it's confirmed a Pro athlete has logged today
 * but not dinner, past the local evening cutoff. Gated on both
 * push_ai_coach_enabled (the parent category, same as every other proactive
 * coach push above) AND push_meal_reminders_enabled (0064_meal_skip_and_
 * reminder_settings.sql) — a sub-toggle so an athlete can keep Arnold's
 * other pushes (new programs, PR pace, streak risk) while turning off just
 * these. screen: 'Today' matches streak_risk_nudge's own target, since Home
 * already carries both the Coach entry point and the Energy card this would
 * resolve. */
async function resolveMealGapNudge(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const userId = payload.user_id as string;
  const { data: profile } = await admin
    .from('profiles')
    .select('push_ai_coach_enabled, push_meal_reminders_enabled')
    .eq('id', userId)
    .single();
  if (!profile?.push_ai_coach_enabled || !profile?.push_meal_reminders_enabled) return null;

  return {
    recipientId: userId,
    title: 'Dinner not logged yet',
    body: "Today's earlier meals are in — snap a photo of dinner before you turn in.",
    screen: 'Today',
    params: {},
    priority: '5',
    interruptionLevel: 'active',
  };
}

function formatLoad(loadKg: number): string {
  const lb = Math.round(loadKg * 2.20462);
  return `${lb} lb`;
}

/** New PR, self-alert — distinct from pr_pace_forecast_ready (a *prediction*
 * weeks out): this fires once workout_pr_hits() confirms a session's best
 * set actually beat the athlete's prior all-time e1rm. `hits` comes
 * pre-computed from proactive-coach-sweep's runPrHitPass (one RPC call per
 * workout, not per set) so a session with three PRs still resolves to one
 * push, not three. */
async function resolvePrHit(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification[] | null> {
  const athleteId = payload.user_id as string;
  const hits = payload.hits as Array<{ exercise_id: string; exercise_name: string; load_kg: number; reps: number }>;
  if (!hits || hits.length === 0) return null;

  const summary =
    hits.length === 1
      ? `${hits[0].exercise_name} — ${formatLoad(hits[0].load_kg)} × ${hits[0].reps}`
      : `${hits.length} new PRs this session — ${hits.map(h => h.exercise_name).join(', ')}`;

  const notifications: ResolvedNotification[] = [];

  const { data: athlete } = await admin.from('profiles').select('push_pr_alerts_enabled').eq('id', athleteId).single();
  if (athlete?.push_pr_alerts_enabled && !(await isActiveInApp(admin, athleteId))) {
    notifications.push({
      recipientId: athleteId,
      title: 'New PR! 🔥',
      body: summary,
      screen: 'PRDetail',
      params: { exerciseId: hits[0].exercise_id },
      priority: '10',
      interruptionLevel: 'active',
    });
  }

  const athleteName = await profileName(admin, athleteId);
  const { data: friendRows } = await admin
    .from('friend_requests')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${athleteId},addressee_id.eq.${athleteId}`);

  for (const row of (friendRows ?? []).slice(0, 200)) {
    const friendId = row.requester_id === athleteId ? row.addressee_id : row.requester_id;
    const { data: friendProfile } = await admin
      .from('profiles')
      .select('push_friend_prs_enabled')
      .eq('id', friendId)
      .single();
    if (!friendProfile?.push_friend_prs_enabled) continue;
    if (await isActiveInApp(admin, friendId)) continue;

    notifications.push({
      recipientId: friendId,
      title: hits.length === 1 ? `${athleteName} just hit a PR` : `${athleteName} just hit ${hits.length} PRs`,
      body: summary,
      screen: 'FriendProfile',
      params: { userId: athleteId },
      collapseId: `friend-pr-${athleteId}`,
      priority: '5',
      interruptionLevel: 'active',
    });
  }

  return notifications.length > 0 ? notifications : null;
}

/** "Live Now", pushed — fires once, at session start, only for an athlete
 * who's currently checked in (matches live_friend_workouts()'s own
 * definition of "live", 0053_gym_checkin_idle_timeout.sql) and hasn't
 * hidden themselves from the feature entirely
 * (hide_live_workout_from_friends). Fans out to every accepted friend
 * individually so each one's own push_friends_enabled/foreground state is
 * respected. */
async function resolveFriendLiveNearby(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification[] | null> {
  const workoutLogId = payload.workout_log_id as string;
  const starterId = payload.user_id as string;

  const { data: starter } = await admin
    .from('profiles')
    .select('hide_live_workout_from_friends')
    .eq('id', starterId)
    .single();
  if (starter?.hide_live_workout_from_friends) return null;

  const { data: checkin } = await admin
    .from('gym_checkins')
    .select('user_id')
    .eq('user_id', starterId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (!checkin) return null;

  const { data: workout } = await admin
    .from('workout_logs')
    .select('program_day_id, scheduled_workout_id')
    .eq('id', workoutLogId)
    .single();
  if (!workout) return null;

  let workoutTitle = 'a workout';
  if (workout.program_day_id) {
    const { data: pd } = await admin.from('program_days').select('title').eq('id', workout.program_day_id).maybeSingle();
    if (pd?.title) workoutTitle = pd.title;
  } else if (workout.scheduled_workout_id) {
    const { data: sw } = await admin.from('scheduled_workouts').select('name').eq('id', workout.scheduled_workout_id).maybeSingle();
    if (sw?.name) workoutTitle = sw.name;
  }

  const starterName = await profileName(admin, starterId);
  const { data: friendRows } = await admin
    .from('friend_requests')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${starterId},addressee_id.eq.${starterId}`);

  const notifications: ResolvedNotification[] = [];
  for (const row of (friendRows ?? []).slice(0, 200)) {
    const friendId = row.requester_id === starterId ? row.addressee_id : row.requester_id;

    const { data: blocked } = await admin
      .from('blocked_users')
      .select('blocker_id')
      .or(`and(blocker_id.eq.${starterId},blocked_id.eq.${friendId}),and(blocker_id.eq.${friendId},blocked_id.eq.${starterId})`)
      .maybeSingle();
    if (blocked) continue;

    const { data: friendProfile } = await admin.from('profiles').select('push_friends_enabled').eq('id', friendId).single();
    if (!friendProfile?.push_friends_enabled) continue;
    if (await isActiveInApp(admin, friendId)) continue;

    notifications.push({
      recipientId: friendId,
      title: `${starterName}'s live right now`,
      body: `Just started ${workoutTitle} — jump in or send encouragement.`,
      screen: 'FriendProfile',
      params: { userId: starterId },
      collapseId: `live-${starterId}`,
      priority: '5',
      interruptionLevel: 'passive',
    });
  }

  return notifications.length > 0 ? notifications : null;
}

/** Once-daily digest — content (has_plan_today/streak/recovery_score)
 * arrives pre-computed from proactive-coach-sweep's runMorningBriefPass,
 * which already has the timezone-aware program/streak porting this would
 * otherwise have to duplicate; this resolver only checks the toggle/
 * foreground state and turns those fields into copy. */
async function resolveMorningBrief(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const userId = payload.user_id as string;
  const { data: profile } = await admin
    .from('profiles')
    .select('push_morning_brief_enabled, display_name, handle')
    .eq('id', userId)
    .single();
  if (!profile?.push_morning_brief_enabled) return null;
  if (await isActiveInApp(admin, userId)) return null;

  const name = profile.display_name ?? profile.handle ?? null;
  const title = name ? `Good morning, ${name} ☀️` : 'Good morning ☀️';

  const hasPlanToday = payload.has_plan_today as boolean;
  const streak = (payload.streak as number) ?? 0;
  const recoveryScore = payload.recovery_score as number | null;
  const streakClause = streak > 0 ? `You're on a ${streak}-day streak.` : '';

  let body: string;
  if (!hasPlanToday) {
    body = recoveryScore != null
      ? `Rest day — recovery's at ${recoveryScore}%. ${streakClause || 'A good day to recharge.'}`
      : `Rest day. ${streakClause || 'A good day to recharge.'}`;
  } else if (recoveryScore != null && recoveryScore < 40) {
    body = `Recovery's low today (${recoveryScore}%) — Arnold would go lighter today.`;
  } else if (recoveryScore != null && recoveryScore >= 70) {
    body = `Recovery's at ${recoveryScore}% — a great day to push. ${streakClause}`.trim();
  } else {
    body = streakClause ? `Today's session is on deck. ${streakClause} Keep it rolling.` : "Today's session is on deck — let's get it.";
  }

  return {
    recipientId: userId,
    title,
    body: truncate(body, 110),
    screen: 'Today',
    params: {},
    collapseId: `morning-brief-${userId}`,
    priority: '5',
    interruptionLevel: 'passive',
  };
}

/** Mid-morning, Whoop-connected only — recovery_score arrives pre-fetched
 * from runRecoveryNudgePass (already filtered to SCORED rows past the
 * high/low threshold and to athletes with no session logged yet today), so
 * this only re-checks the toggle and foreground state, same division of
 * labor as every other proactive-coach resolver. */
async function resolveRecoveryNudge(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const userId = payload.user_id as string;
  const recoveryScore = payload.recovery_score as number;
  const { data: profile } = await admin.from('profiles').select('push_ai_coach_enabled').eq('id', userId).single();
  if (!profile?.push_ai_coach_enabled) return null;
  if (await isActiveInApp(admin, userId)) return null;

  const high = recoveryScore >= 70;
  return {
    recipientId: userId,
    title: high ? 'Recovery is high today' : 'Recovery is low today',
    body: high
      ? `${recoveryScore}% and no session logged yet — good day to chase a heavier top set.`
      : `${recoveryScore}% today — consider lighter loads or extra rest between sets.`,
    screen: 'Today',
    params: {},
    collapseId: `recovery-nudge-${userId}`,
    priority: '5',
    interruptionLevel: 'passive',
  };
}

// Same radius nearby_checkins() / is_within_checkin_radius()
// (0037_gym_checkins.sql / 0084_spot_requests.sql) use — kept in sync by
// convention, not a shared constant, same as every other cross-language
// duplication in this file (e.g. FOREGROUND_ACTIVE_WINDOW_MS vs the
// client's own heartbeat interval).
const SPOT_REQUEST_RADIUS_METERS = 150;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function exerciseLabel(exerciseName: string, setNumber: number | null, loadKg: number | null): string {
  const setPart = setNumber != null ? ` — Set ${setNumber}` : '';
  const loadPart = loadKg != null ? ` (${formatLoad(loadKg)})` : '';
  return `${exerciseName}${setPart}${loadPart}`;
}

/** Fans out to every athlete currently checked in within radius of the
 * requester's own active check-in, same "reference point is always the
 * subject's own row, read server-side" posture nearby_checkins() and
 * is_within_checkin_radius() both already use — this resolver duplicates
 * that distance math in TS (matching resolveFriendLiveNearby's own "do the
 * joins/filters here, not in a dedicated RPC" precedent) since it needs to
 * loop over every candidate to build one push each, not just answer a
 * single yes/no. No push at all if the requester's own check-in has
 * already expired (e.g. they checked out, or it timed out) since then —
 * there's no one left to spot. */
async function resolveSpotRequest(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification[] | null> {
  const requestId = payload.request_id as string;
  const { data: request } = await admin
    .from('spot_requests')
    .select('id, requester_id, exercise_name, set_number, load_kg, status')
    .eq('id', requestId)
    .single();
  if (!request || request.status !== 'pending') return null;

  const { data: requesterCheckin } = await admin
    .from('gym_checkins')
    .select('latitude, longitude')
    .eq('user_id', request.requester_id)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (!requesterCheckin) return null;

  const { data: candidates } = await admin
    .from('gym_checkins')
    .select('user_id, latitude, longitude')
    .neq('user_id', request.requester_id)
    .gt('expires_at', new Date().toISOString());
  if (!candidates || candidates.length === 0) return null;

  const requesterName = await profileName(admin, request.requester_id);
  const label = exerciseLabel(request.exercise_name, request.set_number, request.load_kg);

  const notifications: ResolvedNotification[] = [];
  for (const candidate of candidates.slice(0, 200)) {
    const distance = haversineMeters(
      requesterCheckin.latitude,
      requesterCheckin.longitude,
      candidate.latitude,
      candidate.longitude,
    );
    if (distance > SPOT_REQUEST_RADIUS_METERS) continue;

    const { data: blocked } = await admin
      .from('blocked_users')
      .select('blocker_id')
      .or(
        `and(blocker_id.eq.${request.requester_id},blocked_id.eq.${candidate.user_id}),and(blocker_id.eq.${candidate.user_id},blocked_id.eq.${request.requester_id})`,
      )
      .maybeSingle();
    if (blocked) continue;

    const { data: candidateProfile } = await admin
      .from('profiles')
      .select('push_spot_requests_enabled')
      .eq('id', candidate.user_id)
      .single();
    if (!candidateProfile?.push_spot_requests_enabled) continue;

    notifications.push({
      recipientId: candidate.user_id,
      title: `${requesterName} needs a spot`,
      body: label,
      screen: 'SpotRequest',
      params: { requestId: request.id },
      collapseId: `spot-request-${request.id}`,
      priority: '10',
      interruptionLevel: 'time-sensitive',
    });
  }

  return notifications.length > 0 ? notifications : null;
}

/** Courtesy nudge to the requester once someone accepts — the primary
 * confirmation UX is in-place (SpotRequestSentSheet polls the request's own
 * status while open), so this exists for the case they've since navigated
 * away. No preference gate — deliberately: this is a direct, expected
 * consequence of a request the athlete themselves just sent seconds ago,
 * not an unsolicited social ping, so push_spot_requests_enabled (which
 * governs *receiving* other athletes' requests) doesn't apply to it. */
async function resolveSpotRequestAccepted(admin: Admin, payload: Record<string, unknown>): Promise<ResolvedNotification | null> {
  const { data: request } = await admin
    .from('spot_requests')
    .select('requester_id, responder_id, exercise_name, set_number, load_kg')
    .eq('id', payload.request_id as string)
    .single();
  if (!request || !request.responder_id) return null;

  const responderName = await profileName(admin, request.responder_id);
  const label = exerciseLabel(request.exercise_name, request.set_number, request.load_kg);

  return {
    recipientId: request.requester_id,
    title: `${responderName} is on the way to spot you`,
    body: label,
    screen: 'Today',
    params: {},
    priority: '10',
    interruptionLevel: 'time-sensitive',
  };
}

const RESOLVERS: Record<
  string,
  (admin: Admin, payload: Record<string, unknown>) => Promise<ResolvedNotification | ResolvedNotification[] | null>
> = {
  message: resolveMessage,
  friend_request: resolveFriendRequest,
  friend_request_accepted: resolveFriendRequestAccepted,
  post_like: resolvePostLike,
  post_comment: resolvePostComment,
  ai_program_ready: resolveAiProgramReady,
  streak_risk_nudge: resolveStreakRiskNudge,
  meal_gap_nudge: resolveMealGapNudge,
  pr_pace_forecast_ready: resolvePrPaceForecastReady,
  pr_hit: resolvePrHit,
  friend_live_nearby: resolveFriendLiveNearby,
  morning_brief: resolveMorningBrief,
  recovery_nudge: resolveRecoveryNudge,
  spot_request: resolveSpotRequest,
  spot_request_accepted: resolveSpotRequestAccepted,
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json();
    const type = payload.type as string;

    const resolve = RESOLVERS[type];
    if (!resolve) return json({ error: `Unknown notification type: ${type}` }, 400);

    const resolved = await resolve(admin, payload);
    if (!resolved) return json({ skipped: true }, 200);
    const notifications = Array.isArray(resolved) ? resolved : [resolved];
    if (notifications.length === 0) return json({ skipped: true }, 200);

    let totalSent = 0;
    for (const notification of notifications) {
      const { data: tokens } = await admin
        .from('push_tokens')
        .select('token, platform')
        .eq('user_id', notification.recipientId);
      if (!tokens || tokens.length === 0) continue;

      await Promise.all(
        tokens.map(t => (t.platform === 'android' ? sendFcm(admin, t.token, notification) : sendApns(admin, t.token, notification))),
      );
      totalSent += tokens.length;
    }

    return json({ sent: totalSent }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
