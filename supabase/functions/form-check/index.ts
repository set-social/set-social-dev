// GymBee - form-check Edge Function (Beta)
//
// Called from FormCheckScreen once the athlete has picked a photo (1 frame)
// or a short video (a handful of sampled frames, extracted client-side) of
// themselves doing a specific exercise, and every frame has already been
// uploaded to the private form-check-photos bucket. Verifies the caller's
// session, downloads every frame, sends them to Claude in one structured-
// output request (same output_config pattern generate-program uses, not
// chat-coach's multi-turn tool loop - this is one request in, one structured
// result out, no back-and-forth needed), records the result, and returns it.
//
// Privacy: unlike chat-coach's chat-photos bucket, nothing uploaded here is
// meant to survive this call. Every frame passed in photo_paths is deleted
// from storage before this function returns - on the success path AND the
// failure path (see the try/finally below) - and form_check_results carries
// no photo_path column, so there's no persisted pointer back to an image
// even if a copy of the request body were ever logged somewhere. The cron
// sweep in 0069_form_check.sql is a backstop for an upload that never makes
// it to this function at all (app killed mid-flow, lost connection).
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function named
// "form-check" -> paste this whole file -> Deploy. Fully self-contained
// (see the inlined guardrails block below for why) — no other files needed.
// Reuses the ANTHROPIC_API_KEY secret already set for generate-program/chat-coach.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js';
import Anthropic from 'npm:@anthropic-ai/sdk';
// --- Shared AI abuse/cost-control guardrails ---------------------------
// Inlined here rather than imported from a shared module: this function is
// deployed by pasting this whole file into the Supabase Dashboard's Edge
// Function editor, which only uploads the one file you paste — a sibling
// shared module never comes along for the ride, and the deploy fails with
// "Module not found ... _shared/aiGuardrails.ts". So this exact block is
// duplicated byte-for-byte across all five functions that call an LLM
// (chat-coach, form-check, generate-program, parse-checkin,
// classify-exercise-muscle). If you change the guardrail logic itself (not
// just the per-endpoint limit constants below, which are meant to differ),
// copy the same change into the other four files too — nothing will warn
// you if they drift out of sync.
//
// Backed by a plain Postgres table (ai_request_log, see migration 0070)
// rather than Redis - this repo already leans on Postgres + pg_cron for
// every other periodic/counted thing (the monthly free-tier checks in
// chat-coach and form-check, the cleanup sweeps), there's no Redis instance
// provisioned anywhere in this project, and at this app's request volume a
// few indexed count/sum queries per request add negligible latency next to
// the Anthropic call itself. Revisit if AI request volume ever gets high
// enough that these queries start showing up in slow-query logs - at that
// point a real in-memory store (Upstash Redis over its HTTP/REST API,
// which is what actually works from an edge runtime like this one - a raw
// TCP Redis client is a bad fit here) with TTL-based counters would cut
// the per-request overhead to ~1 round trip instead of up to 4.

/** Supabase's edge gateway forwards the original client IP via
 * x-forwarded-for (standard proxy convention - a comma-separated
 * "client, proxy1, proxy2" chain; the first entry is the original client).
 * NOT independently verified against a live deployed request as of this
 * writing - log this once in production (e.g. console.log it for a day)
 * and confirm it's actually populated with a real, unspoofable-by-the-
 * client value before leaning on it as your only per-IP signal. */
function getClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip');
}

type AiGuardrailReason =
  | 'rate_limited_ip_hourly'
  | 'rate_limited_user_hourly'
  | 'rate_limited_user_daily'
  | 'global_budget_exceeded'
  | 'user_budget_exceeded'
  | 'ok';

async function insertAiRequestLog(
  admin: SupabaseClient,
  row: { userId: string | null; ip: string | null; endpoint: string; allowed: boolean; reason: AiGuardrailReason },
): Promise<string | null> {
  const { data, error } = await admin
    .from('ai_request_log')
    .insert({ user_id: row.userId, ip: row.ip, endpoint: row.endpoint, allowed: row.allowed, reason: row.reason })
    .select('id')
    .single();
  // A logging failure shouldn't be why a legitimate request 500s, but it
  // also shouldn't pass silently - this table is the only record of abuse
  // patterns (requirement: log rate-limit hits and quota breaches).
  if (error) {
    console.error('[aiGuardrails] failed to write ai_request_log row', error);
    return null;
  }
  return data.id as string;
}

type RateLimitReject = { allowed: false; status: number; error: string; code: string };

/** Backstop against a single IP hammering an endpoint, independent of
 * (and checked before) auth - protects the auth check itself from being
 * used as a free DoS vector via a flood of garbage/expired tokens, and
 * catches many-accounts-one-device abuse that per-user limits alone can't
 * see. Deliberately looser than the per-user limits below (a shared
 * office/gym wifi is a real false-positive risk otherwise). */
async function checkIpRateLimit(
  admin: SupabaseClient,
  opts: { endpoint: string; ip: string | null; ipPerHour: number },
): Promise<{ allowed: true } | RateLimitReject> {
  if (!opts.ip) return { allowed: true }; // no IP header available - nothing to key on, fail open here (the per-user checks still apply)

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from('ai_request_log')
    .select('id', { count: 'exact', head: true })
    .eq('ip', opts.ip)
    .gte('created_at', hourAgo);
  if (error) throw error;

  if ((count ?? 0) >= opts.ipPerHour) {
    await insertAiRequestLog(admin, { userId: null, ip: opts.ip, endpoint: opts.endpoint, allowed: false, reason: 'rate_limited_ip_hourly' });
    return { allowed: false, status: 429, error: 'Too many requests from this network. Please try again shortly.', code: 'rate_limited' };
  }
  return { allowed: true };
}

type GuardrailOptions = {
  endpoint: string;
  userId: string;
  ip: string | null;
  userPerHour: number;
  userPerDay: number;
  userDailyTokenBudget: number;
  globalDailyTokenBudget: number;
  /** Plain-language name for the friendly copy on a rejection (e.g.
   * "Arnold", "Form Check", "program generation") - this block is
   * duplicated across several very different features, so the message
   * needs to say which one actually hit its limit rather than a
   * one-size-fits-all "the AI feature". */
  featureLabel: string;
};

/** Run once a request is known to belong to a real, authenticated user.
 * Checks (in order, cheapest/most-likely-to-fail first): per-user hourly
 * count, per-user daily count, this endpoint's global daily token budget,
 * then this user's own daily token budget on this endpoint. On success,
 * reserves a row (0 tokens, allowed=true) for this request *before*
 * returning - closing most
 * of the race window where several concurrent requests from the same user
 * could each pass the same count check before any of them records its own
 * usage. Caller must call finalizeAiUsage(admin, logId, ...) once the
 * model call finishes (success or failure) to fill in the real token
 * counts - until then this reservation still counts toward the caller's
 * own next rate-limit check, which is the intended effect. */
async function checkUserGuardrailsAndReserve(
  admin: SupabaseClient,
  opts: GuardrailOptions,
): Promise<{ allowed: true; logId: string | null } | RateLimitReject> {
  const { endpoint, userId, ip, featureLabel } = opts;
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  // Rolling 24h window, not "since UTC midnight" - a hard midnight reset
  // would let someone burn a full day's budget at 23:59 and another full
  // day's at 00:01. The token budgets below use UTC-midnight instead,
  // deliberately - see the comment there.
  const utcDayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';

  const [{ count: hourlyCount, error: hourlyErr }, { count: dailyCount, error: dailyErr }] = await Promise.all([
    admin.from('ai_request_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('endpoint', endpoint).gte('created_at', hourAgo),
    admin.from('ai_request_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('endpoint', endpoint).gte('created_at', dayAgo),
  ]);
  if (hourlyErr) throw hourlyErr;
  if (dailyErr) throw dailyErr;

  if ((hourlyCount ?? 0) >= opts.userPerHour) {
    await insertAiRequestLog(admin, { userId, ip, endpoint, allowed: false, reason: 'rate_limited_user_hourly' });
    return { allowed: false, status: 429, error: `You're using ${featureLabel} faster than we can keep up — take a short break and try again in a few minutes.`, code: 'rate_limited' };
  }
  if ((dailyCount ?? 0) >= opts.userPerDay) {
    await insertAiRequestLog(admin, { userId, ip, endpoint, allowed: false, reason: 'rate_limited_user_daily' });
    return { allowed: false, status: 429, error: `You've reached today's limit for ${featureLabel}. Try again tomorrow.`, code: 'rate_limited' };
  }

  // Scoped to this one endpoint, not account-wide - different endpoints
  // call different models at very different per-token prices (chat-coach
  // and form-check use Sonnet, generate-program uses Opus), so summing raw
  // token counts across endpoints into one number would silently blend
  // cheap and expensive tokens as if they cost the same. Each endpoint
  // tunes its own budget against its own model's real per-token price
  // instead. Resets at UTC midnight rather than a rolling 24h window - the
  // point of this one isn't fairness to an individual caller, it's "did
  // today's aggregate spend on this feature cross the number on the
  // Anthropic invoice I'm trying not to blow through", and that number is
  // naturally a calendar-day figure.
  const { data: globalTokens, error: globalErr } = await admin.rpc('ai_token_usage_since', { p_since: utcDayStart, p_user_id: null, p_endpoint: endpoint });
  if (globalErr) throw globalErr;
  if ((globalTokens ?? 0) >= opts.globalDailyTokenBudget) {
    await insertAiRequestLog(admin, { userId, ip, endpoint, allowed: false, reason: 'global_budget_exceeded' });
    return { allowed: false, status: 503, error: `${featureLabel} is getting a lot of requests right now. Please try again in a little while.`, code: 'ai_unavailable' };
  }

  const { data: userTokens, error: userTokensErr } = await admin.rpc('ai_token_usage_since', { p_since: utcDayStart, p_user_id: userId, p_endpoint: endpoint });
  if (userTokensErr) throw userTokensErr;
  if ((userTokens ?? 0) >= opts.userDailyTokenBudget) {
    await insertAiRequestLog(admin, { userId, ip, endpoint, allowed: false, reason: 'user_budget_exceeded' });
    return { allowed: false, status: 429, error: `You've used up today's budget for ${featureLabel}. It resets tomorrow.`, code: 'budget_exceeded' };
  }

  const logId = await insertAiRequestLog(admin, { userId, ip, endpoint, allowed: true, reason: 'ok' });
  return { allowed: true, logId };
}

/** Fills in real token counts on the row reserved by
 * checkUserGuardrailsAndReserve. Call from a finally block so partial spend
 * (the model was called at least once before something else failed) is
 * still recorded - an uncounted request is exactly the kind of gap that
 * lets a spike sneak past the global budget check unnoticed. */
async function finalizeAiUsage(
  admin: SupabaseClient,
  logId: string | null,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  if (!logId) return;
  const { error } = await admin
    .from('ai_request_log')
    .update({ input_tokens: usage.inputTokens, output_tokens: usage.outputTokens })
    .eq('id', logId);
  if (error) console.error('[aiGuardrails] failed to finalize ai_request_log row', logId, error);
}
// --- End shared AI abuse/cost-control guardrails ------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'form-check-photos';
// SetSocial Pro gate for the Beta period — same posture as chat-coach's
// FREE_MESSAGES_PER_MONTH: enforced server-side, not just client-side, since
// this is a real per-call LLM vision cost. Keep in sync with the paywall
// copy (src/screens/profile/PaywallScreen.tsx).
const FREE_FORM_CHECKS_PER_MONTH = 3;
const MAX_FRAMES = 8;

// --- Abuse / cost-control guardrails (see the inlined block near the top of this file) ---
// Lower than chat-coach's defaults — a legitimate athlete runs a handful of
// form checks in a session at most, never a rapid back-to-back stream.
const ENDPOINT_NAME = 'form-check';
const RATE_LIMIT_USER_PER_HOUR = Number(Deno.env.get('AI_FORM_CHECK_RATE_LIMIT_USER_PER_HOUR') ?? 10);
const RATE_LIMIT_USER_PER_DAY = Number(Deno.env.get('AI_FORM_CHECK_RATE_LIMIT_USER_PER_DAY') ?? 30);
const RATE_LIMIT_IP_PER_HOUR = Number(Deno.env.get('AI_FORM_CHECK_RATE_LIMIT_IP_PER_HOUR') ?? 30);
// Token counts, not dollars — tune against your own Anthropic console/
// invoice numbers, not a hardcoded price (see chat-coach's identical note).
const USER_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_FORM_CHECK_USER_DAILY_TOKEN_BUDGET') ?? 60_000);
const GLOBAL_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_FORM_CHECK_GLOBAL_DAILY_TOKEN_BUDGET') ?? 1_500_000);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// deno-lint-ignore no-explicit-any
type AnthropicContentBlock = any;

/** Same convention chat-coach's mediaTypeFromPath uses — the client names
 * each uploaded frame after the picked/extracted asset's real content type. */
function mediaTypeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** Chunked to avoid blowing the call stack on a multi-hundred-KB frame —
 * same approach as chat-coach's arrayBufferToBase64. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

async function fetchImageBlock(admin: SupabaseClient, path: string): Promise<AnthropicContentBlock | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) {
    console.error('failed to download form-check frame', path, error);
    return null;
  }
  const buffer = await data.arrayBuffer();
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaTypeFromPath(path), data: arrayBufferToBase64(buffer) },
  };
}

const formCheckSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'One or two sentences on overall form quality. Say plainly if the exercise or body isn\'t clearly visible.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    cues: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'e.g. "Depth", "Bar path", "Knee position"' },
          status: { type: 'string', enum: ['good', 'warning'] },
          note: { type: 'string', description: 'One sentence, specific to what is visible.' },
        },
        required: ['label', 'status', 'note'],
        additionalProperties: false,
      },
    },
    tips: {
      type: 'array',
      items: { type: 'string' },
      description: '1-2 concrete, actionable cues to try next time.',
    },
  },
  required: ['summary', 'confidence', 'cues', 'tips'],
  additionalProperties: false,
};

type FormCheckOutput = {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  cues: Array<{ label: string; status: 'good' | 'warning'; note: string }>;
  tips: string[];
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const clientIp = getClientIp(req);
  let photoPaths: string[] = [];
  let requestLogId: string | null = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    const ipCheck = await checkIpRateLimit(admin, { endpoint: ENDPOINT_NAME, ip: clientIp, ipPerHour: RATE_LIMIT_IP_PER_HOUR });
    if (!ipCheck.allowed) return json({ error: ipCheck.error, code: ipCheck.code }, ipCheck.status);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);
    const userId = userData.user.id;

    const body = await req.json();
    const exerciseId = body.exercise_id as string;
    const exerciseName = body.exercise_name as string;
    photoPaths = Array.isArray(body.photo_paths) ? (body.photo_paths as string[]) : [];

    if (!exerciseId || !exerciseName) return json({ error: 'Missing exercise_id or exercise_name' }, 400);
    if (photoPaths.length === 0) return json({ error: 'No photos provided' }, 400);
    if (photoPaths.length > MAX_FRAMES) return json({ error: `Too many frames (max ${MAX_FRAMES})` }, 400);
    // Every uploaded frame lives in the caller's own folder (enforced by the
    // form-check-photos RLS policy too, but checked here up front so a
    // malformed path fails fast rather than surfacing as a silent download
    // failure below).
    if (!photoPaths.every(p => p.startsWith(`${userId}/`))) {
      return json({ error: 'Invalid photo path' }, 400);
    }

    const guardrail = await checkUserGuardrailsAndReserve(admin, {
      endpoint: ENDPOINT_NAME,
      userId,
      ip: clientIp,
      userPerHour: RATE_LIMIT_USER_PER_HOUR,
      userPerDay: RATE_LIMIT_USER_PER_DAY,
      userDailyTokenBudget: USER_DAILY_TOKEN_BUDGET,
      globalDailyTokenBudget: GLOBAL_DAILY_TOKEN_BUDGET,
      featureLabel: 'Form Check',
    });
    if (!guardrail.allowed) return json({ error: guardrail.error, code: guardrail.code }, guardrail.status);
    requestLogId = guardrail.logId;

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('is_premium')
      .eq('id', userId)
      .single();
    if (profileError) throw profileError;

    if (!profile?.is_premium) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const { count: checksThisMonth, error: countError } = await admin
        .from('form_check_results')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', monthStart.toISOString());
      if (countError) throw countError;

      if ((checksThisMonth ?? 0) >= FREE_FORM_CHECKS_PER_MONTH) {
        return json(
          {
            error: `You've used your ${FREE_FORM_CHECKS_PER_MONTH} free Form Checks this month. Upgrade to SetSocial Pro for unlimited access.`,
            code: 'free_limit_reached',
          },
          402,
        );
      }
    }

    const imageBlocks = (await Promise.all(photoPaths.map(path => fetchImageBlock(admin, path)))).filter(
      (block): block is AnthropicContentBlock => block != null,
    );
    if (imageBlocks.length === 0) {
      return json({ error: 'Could not read the uploaded photo(s). Please try again.' }, 500);
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      thinking: { type: 'disabled' },
      system:
        'You are Arnold, SetSocial\'s AI strength coach, reviewing an athlete\'s exercise form from photos. Identify 3-5 specific, concrete form cues - a mix of what\'s solid and what to adjust - grounded only in what\'s actually visible across the image(s). Never invent a rep count, weight, or detail you can\'t see. If the images don\'t clearly show the exercise, or the athlete\'s body isn\'t fully in frame, say so plainly in the summary and set confidence to "low" rather than guessing at cues. Keep each cue\'s note to one sentence. tips should be 1-2 concrete coaching cues to try next time, not a restatement of the cues above.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Exercise: ${exerciseName}. ${imageBlocks.length} image${imageBlocks.length > 1 ? 's' : ''}${
                imageBlocks.length > 1 ? ', sampled in temporal order through one set' : ''
              }.`,
            },
            ...imageBlocks,
          ],
        },
      ],
      // deno-lint-ignore no-explicit-any
      ...({ output_config: { effort: 'high', format: { type: 'json_schema', schema: formCheckSchema } } } as any),
    });
    const message = await stream.finalMessage();
    totalInputTokens += message.usage?.input_tokens ?? 0;
    totalOutputTokens += message.usage?.output_tokens ?? 0;

    if (message.stop_reason === 'max_tokens') {
      throw new Error('Form Check response was too large to generate. Please try again.');
    }
    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error(`No structured output returned (stop_reason: ${message.stop_reason})`);
    }
    const result = JSON.parse(textBlock.text) as FormCheckOutput;
    if (!Array.isArray(result.cues) || result.cues.length === 0) {
      throw new Error('Coach returned no form cues. Please try again.');
    }

    const { error: insertError } = await admin.from('form_check_results').insert({
      user_id: userId,
      exercise_id: exerciseId,
      exercise_name: exerciseName,
      summary: result.summary,
      cues: result.cues,
      tips: result.tips ?? [],
      confidence: result.confidence,
    });
    if (insertError) throw insertError;

    return json(result, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  } finally {
    // Runs on every exit path - success, a thrown error, even the early
    // 400/402 returns above (photoPaths is [] there, so .remove() is a
    // no-op) - so an uploaded frame is never left behind because of a
    // downstream failure.
    if (photoPaths.length > 0) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove(photoPaths);
      if (removeError) console.error('failed to delete form-check frames', photoPaths, removeError);
    }
    await finalizeAiUsage(admin, requestLogId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
  }
});
