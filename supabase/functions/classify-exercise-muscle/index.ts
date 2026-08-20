// GymBee - classify-exercise-muscle Edge Function
//
// Classifies user-typed custom exercise names ("DB curls", "Sled Push") by
// primary muscle group, so custom exercises don't all get lumped into one
// "Custom" bucket in the Stats tab's volume-by-muscle-group breakdown. This
// function only classifies — it never writes to the exercises table itself;
// callers (useCreateExercise's background classify, useBackfillCustom
// ExerciseMuscles) apply the result via their own update, same
// parse-then-let-the-caller-write split as parse-checkin.
//
// Deliberately no cost/usage gate (unlike chat-coach's free-message limit) —
// this replaces what would otherwise just be a hardcoded 'Custom' literal,
// not a paid feature.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function named
// "classify-exercise-muscle" -> paste this whole file -> Deploy. Fully
// self-contained (see the inlined guardrails block below for why) — no
// other files needed. Reuses the same ANTHROPIC_API_KEY secret as
// chat-coach/generate-program/parse-checkin.

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
// No business-tier gate (see the file's own doc comment above) - these
// limits are purely abuse/cost protection. Slightly looser than
// parse-checkin's: useBackfillCustomExerciseMuscles can legitimately fire
// several calls in a row (MAX_NAMES=30 per call) when backfilling an
// athlete's existing custom exercises.
const ENDPOINT_NAME = 'classify-exercise-muscle';
const RATE_LIMIT_USER_PER_HOUR = Number(Deno.env.get('AI_CLASSIFY_MUSCLE_RATE_LIMIT_USER_PER_HOUR') ?? 30);
const RATE_LIMIT_USER_PER_DAY = Number(Deno.env.get('AI_CLASSIFY_MUSCLE_RATE_LIMIT_USER_PER_DAY') ?? 100);
const RATE_LIMIT_IP_PER_HOUR = Number(Deno.env.get('AI_CLASSIFY_MUSCLE_RATE_LIMIT_IP_PER_HOUR') ?? 100);
const USER_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_CLASSIFY_MUSCLE_USER_DAILY_TOKEN_BUDGET') ?? 30_000);
const GLOBAL_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_CLASSIFY_MUSCLE_GLOBAL_DAILY_TOKEN_BUDGET') ?? 1_000_000);

/** Keep in sync with src/constants/muscleGroups.ts — this function runs as a
 * standalone Deno deploy with no access to the app's own source tree, so the
 * list is duplicated here rather than imported. */
const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'core',
  'obliques',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'full_body',
];

const MAX_NAMES = 30;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const classifySchema = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          primary_muscle: { type: 'string', enum: MUSCLE_GROUPS },
        },
        required: ['index', 'primary_muscle'],
        additionalProperties: false,
      },
    },
  },
  required: ['classifications'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You classify strength-training exercise names by the single muscle group each one primarily targets. The names come from athletes typing in their own custom exercises, so expect informal, abbreviated, or shorthand phrasing (e.g. "DB curls", "Cable face pulls", "Sled push").

Choose exactly one muscle group per exercise from this fixed list: ${MUSCLE_GROUPS.join(', ')}.

Guidance:
- Pick the single muscle group the exercise most directly trains, not every muscle involved as a stabilizer.
- Use full_body only for exercises that genuinely train the whole body with no one dominant target (e.g. burpees, Turkish get-up, sled push/pull, complexes) - not as a default for anything merely ambiguous.
- If a name is too vague, garbled, or unrecognizable to classify with real confidence, omit that index from your response entirely rather than guessing.

The input is a numbered list of exercise names. Respond with a classification for each index you're confident about, referencing the same index from the input list.`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Service-role client used only for the guardrail checks below - this
  // function never itself reads/writes the exercises table, see the file's
  // own doc comment (parse-then-let-the-caller-write).
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
    const names: string[] = Array.isArray(body.names)
      ? body.names.filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0)
      : [];
    if (names.length === 0) return json({ error: 'Missing exercise names' }, 400);
    if (names.length > MAX_NAMES) return json({ error: `Too many names (max ${MAX_NAMES})` }, 400);

    const guardrail = await checkUserGuardrailsAndReserve(admin, {
      endpoint: ENDPOINT_NAME,
      userId,
      ip: clientIp,
      userPerHour: RATE_LIMIT_USER_PER_HOUR,
      userPerDay: RATE_LIMIT_USER_PER_DAY,
      userDailyTokenBudget: USER_DAILY_TOKEN_BUDGET,
      globalDailyTokenBudget: GLOBAL_DAILY_TOKEN_BUDGET,
      featureLabel: 'exercise classification',
    });
    if (!guardrail.allowed) return json({ error: guardrail.error, code: guardrail.code }, guardrail.status);
    requestLogId = guardrail.logId;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const userMessage = names.map((name, index) => `${index}: ${name}`).join('\n');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      // deno-lint-ignore no-explicit-any
      ...({
        output_config: { format: { type: 'json_schema', schema: classifySchema } },
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
    const rawClassifications = Array.isArray(parsed.classifications) ? parsed.classifications : [];

    // Validate against the input bounds and enum ourselves rather than
    // trusting the schema alone — a model can still return an out-of-range
    // index or (rarely) drift from the enum, and a bad write here would
    // silently mislabel someone's exercise.
    const seen = new Set<number>();
    const classifications = rawClassifications
      .filter((c: unknown): c is { index: number; primary_muscle: string } => {
        if (typeof c !== 'object' || c === null) return false;
        const { index, primary_muscle } = c as { index?: unknown; primary_muscle?: unknown };
        return (
          typeof index === 'number' &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < names.length &&
          !seen.has(index) &&
          typeof primary_muscle === 'string' &&
          MUSCLE_GROUPS.includes(primary_muscle)
        );
      })
      .map((c: { index: number; primary_muscle: string }) => {
        seen.add(c.index);
        return { index: c.index, primaryMuscle: c.primary_muscle };
      });

    return json({ classifications }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  } finally {
    await finalizeAiUsage(admin, requestLogId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
  }
});
