// GymBee - generate-program Edge Function
//
// Called by the app right after onboarding. Verifies the caller's session,
// asks Claude to design a periodized training block constrained to the
// already-seeded exercise library, then writes the full program tree
// (programs -> program_weeks -> program_days -> program_exercises) and marks
// the profile's onboarding as complete - all server-side via the service-role
// client, so the Anthropic key and the write path never touch the client app.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function named
// "generate-program" -> paste this whole file -> Deploy. Fully self-contained
// (see the inlined guardrails block below for why) — no other files needed.
// Then set the secret: Dashboard -> Edge Functions -> Secrets -> ANTHROPIC_API_KEY.

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
// Tighter than every other AI endpoint here on purpose: this is the only
// one running Opus (far pricier per token than the Sonnet calls elsewhere),
// with output alone running up to 64k tokens per call (see maxTokens
// below), and a real athlete generates a program rarely — once at
// onboarding, then occasionally to regenerate a block, never in a rapid
// burst.
const ENDPOINT_NAME = 'generate-program';
const RATE_LIMIT_USER_PER_HOUR = Number(Deno.env.get('AI_GENERATE_PROGRAM_RATE_LIMIT_USER_PER_HOUR') ?? 3);
const RATE_LIMIT_USER_PER_DAY = Number(Deno.env.get('AI_GENERATE_PROGRAM_RATE_LIMIT_USER_PER_DAY') ?? 8);
const RATE_LIMIT_IP_PER_HOUR = Number(Deno.env.get('AI_GENERATE_PROGRAM_RATE_LIMIT_IP_PER_HOUR') ?? 15);
// Token counts, not dollars — tune against your own Anthropic console/
// invoice numbers, not a hardcoded price (see chat-coach's identical note).
// Opus costs meaningfully more per token than Sonnet, so don't copy
// chat-coach's or form-check's numbers here directly - these budgets are
// endpoint-scoped specifically so each can be tuned to its own model's
// real price (see aiGuardrails.ts's comment on why).
const USER_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_GENERATE_PROGRAM_USER_DAILY_TOKEN_BUDGET') ?? 300_000);
const GLOBAL_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_GENERATE_PROGRAM_GLOBAL_DAILY_TOKEN_BUDGET') ?? 4_000_000);

// Deliberately not model-authored: the Edge Function owns weekly scheduling
// so every program matches the exact 7-rows-per-week shape (training days +
// explicit rest days) that Today/Calendar already assume from Milestone 3.
const WEEKDAY_PATTERNS: Record<number, number[]> = {
  1: [3],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function formatLabel(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// The model's own freeform `title` field routinely drifted from what the
// athlete actually asked for (e.g. asking for a core/obliques block and
// getting back "Advanced Hypertrophy Block", typos included) - constructing
// the title deterministically from the same inputs the athlete already
// confirmed (muscle-group emphasis if given, else the goal, plus the
// days/weeks they picked) guarantees it always matches the request instead
// of trusting free text the model was never actually constrained on.
function buildProgramTitle(params: {
  goal: string;
  emphasisMuscleGroups: string[];
  daysPerWeek: number;
  weeksCount: number;
}): string {
  const { goal, emphasisMuscleGroups, daysPerWeek, weeksCount } = params;
  const labels = emphasisMuscleGroups.map(formatLabel);
  const focusLabel =
    labels.length === 0
      ? formatLabel(goal)
      : labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
  return `${focusLabel} — ${daysPerWeek}x/Week, ${weeksCount} Week${weeksCount === 1 ? '' : 's'}`;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Service-role client for every DB write below - bypasses RLS by design;
  // this function is the only place besides the SQL editor that may do
  // that, since it's the trusted server-side path. Also used for the
  // guardrail checks, which need to run before auth even resolves.
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

    // Scoped to the caller's own JWT - used only to verify who's asking.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);
    const userId = userData.user.id;

    const body = await req.json();
    const goal = body.goal as string;
    const experienceLevel = body.experience_level as string;
    const daysPerWeek = Number(body.days_per_week);
    const weeksCount = Number(body.weeks_count);
    const equipment: string[] = Array.isArray(body.equipment) ? body.equipment : [];
    const injuriesNotes: string = body.injuries_notes ?? '';
    const focusNotes: string = body.focus_notes ?? '';
    const emphasisMuscleGroups: string[] = Array.isArray(body.emphasis_muscle_groups) ? body.emphasis_muscle_groups : [];

    if (!goal || !experienceLevel || !daysPerWeek || daysPerWeek < 1 || daysPerWeek > 7) {
      return json({ error: 'Missing or invalid onboarding fields' }, 400);
    }
    if (!weeksCount || weeksCount < 1 || weeksCount > 16) {
      return json({ error: 'weeks_count must be between 1 and 16' }, 400);
    }

    const guardrail = await checkUserGuardrailsAndReserve(admin, {
      endpoint: ENDPOINT_NAME,
      userId,
      ip: clientIp,
      userPerHour: RATE_LIMIT_USER_PER_HOUR,
      userPerDay: RATE_LIMIT_USER_PER_DAY,
      userDailyTokenBudget: USER_DAILY_TOKEN_BUDGET,
      globalDailyTokenBudget: GLOBAL_DAILY_TOKEN_BUDGET,
      featureLabel: 'program generation',
    });
    if (!guardrail.allowed) return json({ error: guardrail.error, code: guardrail.code }, guardrail.status);
    requestLogId = guardrail.logId;

    const { data: exerciseRows, error: exerciseError } = await admin
      .from('exercises')
      .select('id, name, primary_muscle')
      .eq('is_custom', false);
    if (exerciseError) throw exerciseError;
    if (!exerciseRows || exerciseRows.length === 0) {
      return json({ error: 'Exercise library is empty - seed it before generating programs.' }, 500);
    }

    // When the athlete named muscle groups to emphasize, don't just ask the
    // model to "bias toward" them in prose - a soft instruction is exactly
    // how a core/obliques request still came back with shoulder accessories
    // padded in. Narrow the schema's exercise_name enum to only exercises
    // that actually target one of those muscles, so the model has no legal
    // way to reach outside the requested focus. Falls back to the full
    // catalog only if the emphasis somehow matches nothing (never true for
    // the seeded MUSCLE_GROUPS values, but safe if that ever changes).
    const emphasisSet = new Set(emphasisMuscleGroups.map(g => g.toLowerCase()));
    const emphasisFilteredRows =
      emphasisSet.size > 0 ? exerciseRows.filter(e => emphasisSet.has(String(e.primary_muscle ?? '').toLowerCase())) : [];
    const allowedRows = emphasisFilteredRows.length > 0 ? emphasisFilteredRows : exerciseRows;

    const exerciseNames = allowedRows.map(e => e.name as string);
    const nameToId = new Map(allowedRows.map(e => [(e.name as string).toLowerCase(), e.id as string]));

    const programSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        weeks: {
          // Anthropic's structured-output schema rejects minItems/maxItems
          // other than 0 or 1 on arrays, so the exact week/day counts are
          // still enforced via the prompt - but every day's exercises array
          // below gets minItems: 1 (1 is one of the two allowed values),
          // and the plan is validated against weeksCount/daysPerWeek after
          // parsing, before any row is written (see validatePlan below).
          type: 'array',
          items: {
            type: 'object',
            properties: {
              week_number: { type: 'integer' },
              focus: { type: 'string' },
              deload: { type: 'boolean' },
              days: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    exercises: {
                      type: 'array',
                      minItems: 1,
                      items: {
                        type: 'object',
                        properties: {
                          exercise_name: { type: 'string', enum: exerciseNames },
                          target_sets: { type: 'integer' },
                          target_reps_min: { type: 'integer' },
                          target_reps_max: { type: 'integer' },
                          target_rpe: { type: 'number' },
                          rest_seconds: { type: 'integer' },
                          notes: { type: 'string' },
                        },
                        required: ['exercise_name', 'target_sets', 'target_reps_min', 'target_reps_max'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['title', 'exercises'],
                  additionalProperties: false,
                },
              },
            },
            required: ['week_number', 'focus', 'deload', 'days'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'weeks'],
      additionalProperties: false,
    };

    const emphasisApplied = emphasisFilteredRows.length > 0;

    const systemPrompt = `You are an expert strength & conditioning coach designing a periodized training block for one athlete.
Only use exercise names copied exactly from the allowed list in the schema - never invent or rename an exercise.
The plan must contain exactly ${weeksCount} week(s), and every week must contain exactly ${daysPerWeek} training day(s) - do not include rest days, those are scheduled automatically. Every training day must include at least one exercise - never return a day with an empty exercises list.
${weeksCount >= 4 ? 'Make the final week a lighter deload.' : ''}
Respect any injuries or limitations by avoiding or substituting exercises that would aggravate them.
${
  emphasisApplied
    ? `The allowed exercise list has already been narrowed server-side to only exercises matching the athlete's requested muscle-group emphasis (${emphasisMuscleGroups.join(', ')}) - every name in it is guaranteed to target one of those muscles, so build the entire block from this list alone. Vary the block through sets/reps/tempo/ordering/exercise selection across days and weeks rather than reaching for anything outside the list "for balance" or variety - a focused block is supposed to look focused, not diluted with unrelated muscle groups.`
    : `If the athlete describes what this specific program should accomplish, bias exercise selection, ordering, and volume toward that intent - without dropping other muscle groups to the point of leaving them completely untrained.`
}`;

    const userPrompt = `Athlete profile:
- Goal: ${goal}
- Experience level: ${experienceLevel}
- Training days per week: ${daysPerWeek}
- Program length: ${weeksCount} weeks
- Available equipment: ${equipment.length > 0 ? equipment.join(', ') : 'not specified, assume full gym access'}
- Injuries/limitations: ${injuriesNotes || 'none reported'}
- What this program should accomplish: ${focusNotes || 'not specified - use the goal above'}
- Muscle groups to emphasize: ${emphasisMuscleGroups.length > 0 ? emphasisMuscleGroups.join(', ') : 'no particular emphasis, keep it balanced'}

Design their program now.`;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    // A fixed budget doesn't scale with what was actually asked for - a
    // bigger weeksCount/daysPerWeek needs proportionally more output tokens,
    // and the structured-output decoder closes the JSON at whatever fit
    // rather than erroring when it runs out, so an undersized budget doesn't
    // fail loudly - it just silently returns fewer weeks than requested
    // (exactly the "returned 1 week, expected 4" failure this replaces).
    // ~220 tokens/exercise (name + sets/reps/rpe/rest/notes + JSON overhead)
    // at up to 8 exercises/day is a deliberately generous estimate, since
    // undershooting reproduces the same bad-data problem in a different guise.
    const ESTIMATED_TOKENS_PER_EXERCISE = 220;
    const MAX_EXERCISES_PER_DAY_ESTIMATE = 8;
    const maxTokens = Math.min(
      Math.max(weeksCount * daysPerWeek * MAX_EXERCISES_PER_DAY_ESTIMATE * ESTIMATED_TOKENS_PER_EXERCISE + 4000, 20000),
      64000,
    );

    // Streamed (not .create()) purely to avoid the SDK's non-streaming
    // timeout guard and Edge Function wall-clock limits on a large,
    // multi-week structured generation - the full JSON is still accumulated
    // and parsed once before any DB writes happen.
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      // deno-lint-ignore no-explicit-any
      ...({
        output_config: { effort: 'high', format: { type: 'json_schema', schema: programSchema } },
      } as any),
    });
    const message = await stream.finalMessage();
    totalInputTokens += message.usage?.input_tokens ?? 0;
    totalOutputTokens += message.usage?.output_tokens ?? 0;

    // A clearer, more specific message than the generic week/day-count
    // mismatch below when the real cause is that the budget above still
    // wasn't enough (e.g. an athlete picking the maximum weeks and days at
    // once) - lets the athlete know to shrink the request rather than just
    // "try again" into the same wall.
    if (message.stop_reason === 'max_tokens') {
      throw new Error('That program was too large to generate in one request. Try fewer weeks or fewer days per week.');
    }

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error(`No structured output returned (stop_reason: ${message.stop_reason})`);
    }
    // deno-lint-ignore no-explicit-any
    const plan = JSON.parse(textBlock.text) as any;

    // The model can still under/over-shoot the requested shape despite the
    // prompt's instructions (structured-output schemas can't enforce exact
    // array lengths - see programSchema's comment above). Validate the whole
    // plan before writing anything, rather than discovering a malformed day
    // after it's already on the user's calendar as a "0 exercises" tile.
    if (!Array.isArray(plan.weeks) || plan.weeks.length !== weeksCount) {
      throw new Error(`Coach returned ${plan.weeks?.length ?? 0} week(s), expected ${weeksCount}. Please try again.`);
    }
    for (const week of plan.weeks as any[]) {
      if (!Array.isArray(week.days) || week.days.length !== daysPerWeek) {
        throw new Error(
          `Week ${week.week_number} came back with ${week.days?.length ?? 0} training day(s), expected ${daysPerWeek}. Please try again.`,
        );
      }
      for (const day of week.days as any[]) {
        if (!Array.isArray(day.exercises) || day.exercises.length === 0) {
          throw new Error(`"${day.title}" in week ${week.week_number} came back with no exercises. Please try again.`);
        }
      }
    }

    // Only one program can be `active` at a time (enforced by a partial
    // unique index, migration 0029) - archive whatever's currently active
    // first. Generation used to run exactly once per user, atomically tied
    // to finishing onboarding, so this was never reachable before; it's now
    // a repeatable, user-triggered action from the Programs tab.
    const { error: archiveError } = await admin
      .from('programs')
      .update({ status: 'archived' })
      .eq('user_id', userId)
      .eq('status', 'active');
    if (archiveError) throw archiveError;

    const { data: program, error: programError } = await admin
      .from('programs')
      .insert({
        user_id: userId,
        title: buildProgramTitle({ goal, emphasisMuscleGroups, daysPerWeek, weeksCount }),
        goal,
        source: 'ai_generated',
        status: 'active',
        weeks_count: plan.weeks.length,
        days_per_week: daysPerWeek,
      })
      .select()
      .single();
    // 23505 = unique_violation - a race with another generate/create call
    // landed first, not a real server error.
    if (programError?.code === '23505') {
      return json({ error: 'You already have an active program.' }, 409);
    }
    if (programError) throw programError;

    const trainingDaysOfWeek = WEEKDAY_PATTERNS[daysPerWeek] ?? WEEKDAY_PATTERNS[3];

    // deno-lint-ignore no-explicit-any
    for (const week of plan.weeks as any[]) {
      const { data: weekRow, error: weekError } = await admin
        .from('program_weeks')
        .insert({
          program_id: program.id,
          week_number: week.week_number,
          focus: week.focus,
          deload: week.deload,
        })
        .select()
        .single();
      if (weekError) throw weekError;

      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const isTrainingDay = trainingDaysOfWeek.includes(dayOfWeek);
        const trainingIndex = trainingDaysOfWeek.indexOf(dayOfWeek);
        const planDay = isTrainingDay ? week.days[trainingIndex] : null;

        const { data: dayRow, error: dayError } = await admin
          .from('program_days')
          .insert({
            program_week_id: weekRow.id,
            day_number: dayOfWeek + 1,
            day_of_week: dayOfWeek,
            title: isTrainingDay ? (planDay?.title ?? 'Training Day') : 'Rest',
            is_rest_day: !isTrainingDay,
          })
          .select()
          .single();
        if (dayError) throw dayError;

        if (isTrainingDay && planDay) {
          const exerciseInserts = (planDay.exercises as any[])
            .map((ex, index) => {
              const exerciseId = nameToId.get(String(ex.exercise_name).toLowerCase());
              if (!exerciseId) return null;
              return {
                program_day_id: dayRow.id,
                exercise_id: exerciseId,
                order_index: index,
                target_sets: ex.target_sets,
                target_reps_min: ex.target_reps_min,
                target_reps_max: ex.target_reps_max,
                target_rpe: ex.target_rpe ?? null,
                rest_seconds: ex.rest_seconds ?? null,
                notes: ex.notes ?? null,
              };
            })
            .filter((row): row is NonNullable<typeof row> => row != null);

          if (exerciseInserts.length > 0) {
            const { error: exInsertError } = await admin
              .from('program_exercises')
              .insert(exerciseInserts);
            if (exInsertError) throw exInsertError;
          }
        }
      }
    }

    const { error: profileError } = await admin
      .from('profiles')
      .update({
        goal,
        experience_level: experienceLevel,
        days_per_week: daysPerWeek,
        equipment_access: equipment,
        injuries_notes: injuriesNotes || null,
        onboarding_completed: true,
      })
      .eq('id', userId);
    if (profileError) throw profileError;

    // Best-effort — a push failure here shouldn't fail program generation
    // itself, since the program row is already committed and the client's
    // own success path doesn't depend on this at all.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ type: 'ai_program_ready', user_id: userId, program_id: program.id }),
      });
    } catch (pushErr) {
      console.error('send-push call failed', pushErr);
    }

    return json({ program_id: program.id }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  } finally {
    await finalizeAiUsage(admin, requestLogId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
  }
});
