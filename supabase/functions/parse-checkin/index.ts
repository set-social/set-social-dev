// GymBee - parse-checkin Edge Function
//
// Parses a free-text readiness description ("slept like garbage, 5 hours,
// shoulders are sore") into the same structured fields the manual
// PreWorkoutReviewScreen check-in form collects. This function only parses —
// it never writes to readiness_checkins itself. The client always shows the
// parsed fields back to the athlete as an editable, pre-filled form before
// calling the existing useSubmitReadinessCheckin mutation, so a bad parse is
// always caught before it's saved and the write path stays identical to the
// manual form.
//
// Deliberately no cost/usage gate (unlike chat-coach's free-message limit) —
// this replaces what's already a free manual form, so typing instead of
// tapping shouldn't introduce a new cost.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function named
// "parse-checkin" -> paste this whole file -> Deploy. Fully self-contained
// (see the inlined guardrails block below for why) — no other files needed.
// Reuses the same ANTHROPIC_API_KEY secret as chat-coach/generate-program.

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

// --- Abuse / cost-control guardrails (see the inlined block near the top of this file) ---
// This still has no business-tier gate (see the file's own doc comment
// above) - these limits are purely abuse/cost protection, not an upsell,
// same distinction chat-coach draws between its FREE_MESSAGES_PER_MONTH
// gate and its rate limiting.
const ENDPOINT_NAME = 'parse-checkin';
const MAX_TEXT_LENGTH = 2000;
const RATE_LIMIT_USER_PER_HOUR = Number(Deno.env.get('AI_PARSE_CHECKIN_RATE_LIMIT_USER_PER_HOUR') ?? 20);
const RATE_LIMIT_USER_PER_DAY = Number(Deno.env.get('AI_PARSE_CHECKIN_RATE_LIMIT_USER_PER_DAY') ?? 60);
const RATE_LIMIT_IP_PER_HOUR = Number(Deno.env.get('AI_PARSE_CHECKIN_RATE_LIMIT_IP_PER_HOUR') ?? 60);
const USER_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_PARSE_CHECKIN_USER_DAILY_TOKEN_BUDGET') ?? 40_000);
const GLOBAL_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_PARSE_CHECKIN_GLOBAL_DAILY_TOKEN_BUDGET') ?? 1_000_000);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Clamps the model's output to the range the manual form's own
 * SegmentedControl(RATING_OPTIONS) enforces (1-5) — structured-output
 * schemas can constrain type but not a numeric range, so an out-of-range or
 * missing value must be handled after parsing, not trusted from the model. */
function clampRating(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function clampSleepHours(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(24, Math.max(0, value));
}

const checkinSchema = {
  type: 'object',
  properties: {
    sleep_hours: { type: ['number', 'null'] },
    sleep_quality: { type: ['integer', 'null'] },
    soreness: { type: ['integer', 'null'] },
    stress: { type: ['integer', 'null'] },
    has_pain: { type: 'boolean' },
    pain_notes: { type: ['string', 'null'] },
  },
  required: ['sleep_hours', 'sleep_quality', 'soreness', 'stress', 'has_pain', 'pain_notes'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You extract structured readiness check-in fields from an athlete's free-text description of how they're feeling before a workout.
- sleep_hours: hours of sleep last night, if mentioned (a plain number, e.g. 7.5). Null if not mentioned.
- sleep_quality: how well they slept, on a 1-5 scale (1 = terrible, 5 = excellent). Infer from language like "slept like garbage" (low) or "slept great" (high). Null if nothing about sleep quality is mentioned or implied.
- soreness: muscle soreness, 1-5 (1 = none, 5 = very sore). Null if not mentioned or implied.
- stress: stress level, 1-5 (1 = very relaxed, 5 = very stressed). Null if not mentioned or implied.
- has_pain: true only if they describe actual pain (not just soreness/fatigue) - joint pain, sharp pain, an injury flare-up, etc.
- pain_notes: a short paraphrase of what they said about the pain, if has_pain is true. Null otherwise.
Only infer a 1-5 value when the text actually supports it - don't invent a number for something never mentioned.`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Service-role client used only for the guardrail checks below - this
  // function never itself reads/writes app data, see the file's own doc
  // comment (parse-then-let-the-caller-write).
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const clientIp = getClientIp(req);
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
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return json({ error: 'Missing check-in text' }, 400);
    if (text.length > MAX_TEXT_LENGTH) {
      return json({ error: `Please keep your check-in under ${MAX_TEXT_LENGTH} characters.` }, 400);
    }

    const guardrail = await checkUserGuardrailsAndReserve(admin, {
      endpoint: ENDPOINT_NAME,
      userId,
      ip: clientIp,
      userPerHour: RATE_LIMIT_USER_PER_HOUR,
      userPerDay: RATE_LIMIT_USER_PER_DAY,
      userDailyTokenBudget: USER_DAILY_TOKEN_BUDGET,
      globalDailyTokenBudget: GLOBAL_DAILY_TOKEN_BUDGET,
      featureLabel: 'check-in parsing',
    });
    if (!guardrail.allowed) return json({ error: guardrail.error, code: guardrail.code }, guardrail.status);
    requestLogId = guardrail.logId;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
      // deno-lint-ignore no-explicit-any
      ...({
        output_config: { format: { type: 'json_schema', schema: checkinSchema } },
      } as any),
    });

    totalInputTokens += message.usage?.input_tokens ?? 0;
    totalOutputTokens += message.usage?.output_tokens ?? 0;

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error(`No structured output returned (stop_reason: ${message.stop_reason})`);
    }
    // deno-lint-ignore no-explicit-any
    const parsed = JSON.parse(textBlock.text) as any;

    return json(
      {
        sleepHours: clampSleepHours(parsed.sleep_hours),
        sleepQuality: clampRating(parsed.sleep_quality),
        soreness: clampRating(parsed.soreness),
        stress: clampRating(parsed.stress),
        hasPain: parsed.has_pain === true,
        painNotes: parsed.has_pain === true && typeof parsed.pain_notes === 'string' ? parsed.pain_notes : null,
      },
      200,
    );
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  } finally {
    await finalizeAiUsage(admin, requestLogId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
  }
});
