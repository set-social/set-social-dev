// GymBee - chat-coach Edge Function
//
// Called from ChatScreen for every message the athlete sends. Verifies the
// caller's session, then runs a tool-use loop against Claude so the coach can
// actually act on the athlete's schedule (look up a day's plan, cancel a
// one-off scheduled workout, search/curate/schedule a workout template) - not
// just chat about it - streaming the reply token-by-token over Realtime
// Broadcast on topic `chat-<conversation id>` exactly as before, and
// persisting the final assistant reply once the loop finishes.
//
// Tool-use turns and the final answer share the same broadcast stream: the
// client sees one continuous run of 'token' events (narration before a tool
// call, then the final reply, all concatenated) followed by one 'done' - the
// client-side contract is unchanged from the pre-tool-use version of this
// function.
//
// Removal is intentionally scoped to one-off `scheduled_workouts` only -
// there is no delete/mutate path for the recurring AI-generated
// `program_days` anywhere in this app (not even in the UI), and building one
// is out of scope here. No in-chat confirmation step exists either - actions
// execute immediately once the model has looked up real current state via
// get_day_plan.
//
// Broadcast is sent via the REST endpoint below rather than opening a
// realtime websocket connection from the function itself (which would add a
// connect/join round-trip to every request). This is a public (non-private)
// broadcast topic - the conversation id in the topic name is the access
// boundary, not Realtime Authorization. Fine for a per-user coach thread;
// revisit if topics ever need to be shared across users.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function named
// "chat-coach" -> paste this whole file -> Deploy. Fully self-contained
// (see the inlined guardrails block below for why) — no other files needed.
// Reuses the ANTHROPIC_API_KEY secret already set for generate-program.

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

const HISTORY_LIMIT = 20;
// SetSocial Pro gate — keep in sync with the paywall copy
// (src/screens/profile/PaywallScreen.tsx) and the approved pricing plan.
// Enforced here, not just client-side, since this is the one call in the
// app with real per-message LLM cost — a client-only check could be
// bypassed by anyone willing to hit the function directly.
const FREE_MESSAGES_PER_MONTH = 3;
const MAX_TOOL_ITERATIONS = 8;

// --- Abuse / cost-control guardrails (see the inlined block near the top of this file) ---
// All configurable via env so they can be tuned per-environment without a
// redeploy of this file. Defaults are deliberately generous for a normal
// chatting athlete and stingy for a script - tune against real usage once
// this has been live for a while.
const ENDPOINT_NAME = 'chat-coach';
const RATE_LIMIT_USER_PER_HOUR = Number(Deno.env.get('AI_RATE_LIMIT_USER_PER_HOUR') ?? 20);
const RATE_LIMIT_USER_PER_DAY = Number(Deno.env.get('AI_RATE_LIMIT_USER_PER_DAY') ?? 100);
// Looser than the per-user limits by design — this exists to catch a flood
// from one IP (many accounts, or a script hammering with expired tokens),
// not to throttle ordinary use, so it should almost never fire for a real
// athlete even on a shared connection.
const RATE_LIMIT_IP_PER_HOUR = Number(Deno.env.get('AI_RATE_LIMIT_IP_PER_HOUR') ?? 60);
// Token counts, not dollars — convert your actual Anthropic budget using
// the current per-token rate on your own Anthropic console/invoice rather
// than trusting a hardcoded price here; API pricing changes over time and
// getting this wrong in either direction defeats the point of a budget.
const USER_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_USER_DAILY_TOKEN_BUDGET') ?? 150_000);
const GLOBAL_DAILY_TOKEN_BUDGET = Number(Deno.env.get('AI_GLOBAL_DAILY_TOKEN_BUDGET') ?? 5_000_000);
// Pro's own, much higher ceiling — the limits above were sized as a
// generic abuse backstop (see the comment above checkUserGuardrailsAndReserve's
// call site) but were the *only* limit a premium user hit too, which meant
// a genuinely engaged Pro athlete (several nutrition-logging messages per
// meal, plus regular coaching chat — each chat-coach call also carries a
// sizeable fixed system-prompt cost: profile, wearables, chat history,
// exercise library, saved facts, all resent every message) could realistically
// cross 100 requests or 150k tokens in a single day purely from normal use,
// not scripted flooding. Sized generously — a real athlete manually typing
// messages essentially can't hit these — while still catching an actual
// flood/script (5-10x normal heavy usage). Same "generous for a real user,
// stingy for a script" philosophy as the free-tier defaults above, just
// recalibrated for what "a lot of real usage" looks like on this tier.
const RATE_LIMIT_USER_PER_HOUR_PREMIUM = Number(Deno.env.get('AI_RATE_LIMIT_USER_PER_HOUR_PREMIUM') ?? 60);
const RATE_LIMIT_USER_PER_DAY_PREMIUM = Number(Deno.env.get('AI_RATE_LIMIT_USER_PER_DAY_PREMIUM') ?? 400);
const USER_DAILY_TOKEN_BUDGET_PREMIUM = Number(Deno.env.get('AI_USER_DAILY_TOKEN_BUDGET_PREMIUM') ?? 750_000);
// Hard input caps, independent of Claude's own context window — bounds
// worst-case prompt size regardless of what's already stored in
// chat_messages from before these limits existed.
const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_MESSAGE_CHAR_LIMIT = 2000;
// Stops the tool-use loop early once THIS request's total output has cost
// enough, independent of MAX_TOOL_ITERATIONS — a chain of several
// max_tokens-capped tool-use turns can still add up to a lot per request
// (up to MAX_TOOL_ITERATIONS * 2048 today) without this.
const MAX_OUTPUT_TOKENS_PER_REQUEST = 6000;
// Supabase Edge Functions are wall-clock limited (150s free / 400s paid), not
// CPU limited (async I/O like these DB/Anthropic calls doesn't count against
// the 2s CPU cap) - a hard platform kill past that limit means no broadcast,
// no graceful anything. This soft budget is checked between loop iterations
// so a slow run finalizes gracefully well before that ever happens.
const SOFT_DEADLINE_MS = 100_000;
const FALLBACK_TEXT = 'I made a change to your schedule — check your calendar or library to confirm.';
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Bounds one historical message's contribution to the prompt regardless of
 * MAX_MESSAGE_LENGTH on new messages — older rows in chat_messages predate
 * that cap, and this is checked at read time so it stays a real guarantee
 * even if the cap is ever changed or bypassed at the DB level. */
function truncateForHistory(text: string): string {
  if (text.length <= HISTORY_MESSAGE_CHAR_LIMIT) return text;
  return `${text.slice(0, HISTORY_MESSAGE_CHAR_LIMIT)}… [truncated]`;
}

async function broadcast(topic: string, event: string, payload: unknown) {
  await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ messages: [{ topic, event, payload }] }),
  });
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}

/** Intl throws on an unrecognized IANA zone name rather than returning
 * false, so validating is "try to use it, see if it throws" - same check
 * client-supplied input needs before it's trusted for every date-bucketing
 * call this function makes downstream (localDateKey, history date markers). */
function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// deno-lint-ignore no-explicit-any
type AnthropicContentBlock = any;

/** Anthropic's vision API accepts jpeg/png/gif/webp — inferred from the
 * storage path's extension (the client names the file after the picked
 * asset's real content type, same convention buildPostPhotoPath/
 * extensionFromContentType already use for post photos). Defaults to jpeg,
 * which is what react-native-image-picker returns on both platforms at the
 * quality<1 setting the composer's attach flow uses. */
function mediaTypeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** Chunked String.fromCharCode.apply rather than one call per byte (which
 * measurably adds up over a multi-hundred-KB photo) or a single spread over
 * the whole buffer (same pattern send-push's base64url already avoids —
 * risks blowing the call stack). 8KB chunks stay well under the argument-
 * count ceiling while cutting the call count by ~4 orders of magnitude. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Downloads a photo from the private chat-photos bucket and returns it as
 * an Anthropic image content block, or null if the download fails (a
 * missing/corrupt photo shouldn't crash the whole turn — the model just
 * won't see an image for that message). */
async function fetchImageBlock(admin: SupabaseClient, path: string): Promise<AnthropicContentBlock | null> {
  const { data, error } = await admin.storage.from('chat-photos').download(path);
  if (error || !data) {
    console.error('failed to download chat photo', path, error);
    return null;
  }
  const buffer = await data.arrayBuffer();
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaTypeFromPath(path), data: arrayBufferToBase64(buffer) },
  };
}

// ---------------------------------------------------------------------------
// Energy math — ported from src/utils/energyBalance.ts. Deno edge functions
// can't import from the RN app's module graph, so this is a deliberate
// duplicate of that file's constants/formulas, same posture as
// estimateOneRepMax just below (also a documented server-side duplicate of
// client math — see 0059_proactive_coach.sql's own comment on it). Keep
// both in sync if the energy formulas ever change.
// ---------------------------------------------------------------------------

const NEAT_BASELINE_CALORIES = 500;
const RESISTANCE_TRAINING_MET = 5.0;
const SEX_ADJUSTMENT: Record<'male' | 'female', number> = { male: 1, female: 0.92 };
const TARGET_NET_CALORIES_BY_GOAL: Record<string, number> = { cut: -500, bulk: 300, maintain: 0 };
const FALLBACK_BMR = 1600;

function calculateAge(birthDate: string, asOf: Date): number {
  const birth = new Date(birthDate);
  let age = asOf.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    asOf.getMonth() > birth.getMonth() || (asOf.getMonth() === birth.getMonth() && asOf.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function calculateBmr(params: { weightKg: number; heightCm: number; age: number; sex: 'male' | 'female' }): number {
  const base = 10 * params.weightKg + 6.25 * params.heightCm - 5 * params.age;
  return Math.round(params.sex === 'male' ? base + 5 : base - 161);
}

function estimateStrengthSessionCalories(params: { durationMinutes: number; weightKg: number; sex: 'male' | 'female' | null }): number {
  const hours = params.durationMinutes / 60;
  const adjustment = params.sex ? SEX_ADJUSTMENT[params.sex] : 1;
  return Math.round(RESISTANCE_TRAINING_MET * params.weightKg * hours * adjustment);
}

/** yyyy-MM-dd for a given instant in a given IANA zone — the same
 * Intl.DateTimeFormat approach proactive-coach-sweep's localDateParts uses,
 * trimmed to just the key get_energy_stats' day-bucketing needs. */
function localDateKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    instant,
  );
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/** Every tool: strict:true + additionalProperties:false + every property in
 * `required` (optional fields are typed nullable rather than omitted - under
 * strict mode "required" means "key must be present", not "must be
 * non-null"). No tool takes a user_id/owner input - that's always injected
 * server-side from the verified JWT, never accepted from the model. */
function buildTools(exerciseNames: string[]) {
  return [
    {
      name: 'get_day_plan',
      description:
        "Look up everything for one specific date, checking every source that can put a workout on the calendar: whether it's already completed, an explicit rest/missed override, a one-off scheduled workout, the recurring weekly schedule, and the AI-generated program day - in that priority order (same as the app's own calendar/Home screens). Call this before removing or adding anything for a date, and whenever the athlete asks what's planned for a day - never say nothing is scheduled without calling this first, since a day can be planned via the weekly recurring schedule alone with no scheduled_workouts row at all. This is also the only way to get valid ids for remove_scheduled_workout - never guess or reuse an id from earlier in the conversation.",
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format.' },
        },
        required: ['date'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'remove_scheduled_workout',
      description:
        'Cancels/removes a one-off scheduled workout by its id, from a prior get_day_plan call in THIS conversation turn. Call this whenever the athlete asks to cancel, remove, delete, or skip a workout that get_day_plan showed as a scheduled_workout. Cannot remove a recurring AI-generated program day - if get_day_plan showed the day as a program_day instead, explain that it can\'t be removed and suggest an alternative (like substituting an exercise) instead of calling this.',
      input_schema: {
        type: 'object',
        properties: {
          scheduled_workout_id: {
            type: 'string',
            description: 'The id of a scheduled_workouts entry returned by get_day_plan.',
          },
        },
        required: ['scheduled_workout_id'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'search_workout_templates',
      description:
        "Searches the athlete's saved workout library by name. Always call this before curate_workout_template, so an existing matching workout is reused instead of duplicated.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text, e.g. "shoulder" or "push day".' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'curate_workout_template',
      description:
        "Creates a brand-new saved workout template built only from the athlete's real exercise library. Only call this after search_workout_templates found nothing suitable. Design 4-7 exercises appropriate to the requested focus and the athlete's experience level. This does NOT put it on the calendar - always follow a successful call with schedule_workout_template.",
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'e.g. "Shoulder Day"' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                exercise_name: { type: 'string', enum: exerciseNames },
                target_sets: { type: 'integer' },
                target_reps_min: { type: 'integer' },
                target_reps_max: { type: 'integer' },
                target_rpe: { type: ['number', 'null'], description: 'Target RPE, or null if not specified.' },
                rest_seconds: { type: ['integer', 'null'], description: 'Rest between sets in seconds, or null.' },
              },
              required: ['exercise_name', 'target_sets', 'target_reps_min', 'target_reps_max', 'target_rpe', 'rest_seconds'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'exercises'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'schedule_workout_template',
      description:
        "Puts an existing (or just-curated) workout template onto the athlete's schedule for a specific date.",
      input_schema: {
        type: 'object',
        properties: {
          template_id: { type: 'string' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format. Must be today or later.' },
        },
        required: ['template_id', 'date'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'get_workout_stats',
      description:
        "Looks up the athlete's actual logged training history: workouts completed, total sets/volume, recent personal records (PRs), and per-exercise progress (best estimated 1-rep max, most recent working set). Also returns cardio_summary (session count, total duration/distance/calories, and recent individual sessions) whenever cardio was logged in range and exercise_name is null — call this too for questions about running, cycling, or cardio training generally, not just strength lifts. Call this whenever the athlete asks about their stats, progress, volume, PRs, cardio, or how a specific lift is trending — never guess, estimate, or make up numbers when this tool can answer directly.",
      input_schema: {
        type: 'object',
        properties: {
          exercise_name: {
            type: ['string', 'null'],
            description:
              'Look up progress for one specific exercise (matched by a case-insensitive substring against what the athlete actually logged, so it also works for their own custom exercises not in the shared library), or null for an overall summary across everything logged.',
          },
          days: {
            type: ['integer', 'null'],
            description: 'How many days of history to include. Defaults to 90 if null.',
          },
        },
        required: ['exercise_name', 'days'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'log_food_estimate',
      description:
        "Records a calorie/macro estimate for food the athlete described or sent a photo of, as a PENDING entry — the athlete still has to confirm or edit it in the app before it counts toward their daily total, so it's fine (encouraged, even) to log your best guess rather than withholding one. If something important is genuinely ambiguous from a photo (e.g. portion size, whether a visible sauce/dressing is included, single vs. double portion), ask ONE short clarifying question in plain text first and wait for the reply instead of calling this — but don't stall on minor uncertainty; call this with your best estimate and a lower confidence instead. Works from a text description alone too, with no photo required.",
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short food name, e.g. "Grilled chicken rice bowl".' },
          calories: { type: 'integer' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description:
              "high: the food and a reasonable portion are clear from what you were given (an ordinary photo of an identifiable dish, or a caption/reply that states what it is) - this is the default whenever nothing about the estimate is genuinely in question. Routine estimation (exact oil amount, garnish, precise cut) does not by itself drop this to medium. medium: identified, but portion size or preparation is a real guess that could swing the estimate a lot. low: genuinely unsure what this is.",
          },
          // Plain string enum, never `type: ['string', 'null']` + an enum
          // containing `null` — Anthropic's strict tool-schema validator
          // rejects that combination outright ("Invalid schema: enum value
          // ... does not match declared type"), even though it's valid
          // JSON Schema. A required enum with no null option is the fix,
          // not a workaround — model just always picks its best guess.
          meal_type: {
            type: 'string',
            enum: ['breakfast', 'lunch', 'dinner', 'snack'],
            description: "Best guess from context (time of day, what was said/shown) — default to 'snack' if genuinely ambiguous, never omit.",
          },
        },
        required: ['name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence', 'meal_type'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'skip_meal',
      description:
        "Records that the athlete is intentionally NOT eating a specific meal today (skipped breakfast, fasting through lunch, etc.) - call this instead of log_food_estimate when they say they're skipping a meal, not when they simply haven't told you about it yet. Stops that meal from looking like an unlogged gap without recording any food or calories.",
      input_schema: {
        type: 'object',
        properties: {
          meal_type: {
            type: 'string',
            enum: ['breakfast', 'lunch', 'dinner', 'snack'],
            description: 'Which meal is being skipped.',
          },
        },
        required: ['meal_type'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'get_food_log_for_date',
      description:
        "Look up every food entry logged for one specific date - name, meal type, calories, macros, status (pending/confirmed/skipped), and its id. Call this before update_food_log_entry or delete_food_log_entry so you have a real id to act on - never guess one or reuse one from earlier in the conversation, since the athlete's own app can add, edit, or remove entries at any time. Also the right call whenever they ask what they've logged for a day.",
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format.' },
        },
        required: ['date'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'update_food_log_entry',
      description:
        "Edits an existing food log entry - e.g. correcting a portion size, fixing a wrong estimate, or renaming it. Call get_food_log_for_date first for a real id; never guess one. This always overwrites name/calories/protein_g/carbs_g/fat_g together (the tool schema requires all of them) - for any field the athlete isn't asking to change, pass back the current value from get_food_log_for_date rather than a guess. Never changes which meal it's logged as or its confirmed/pending status - only the name and numbers.",
      input_schema: {
        type: 'object',
        properties: {
          food_log_entry_id: { type: 'string', description: 'id from a prior get_food_log_for_date call.' },
          name: { type: 'string' },
          calories: { type: 'integer' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
        },
        required: ['food_log_entry_id', 'name', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'delete_food_log_entry',
      description:
        "Permanently removes a food log entry. Call get_food_log_for_date first for a real id; never guess one. There's no undo, so your reply is the athlete's only confirmation of what happened.",
      input_schema: {
        type: 'object',
        properties: {
          food_log_entry_id: { type: 'string', description: 'id from a prior get_food_log_for_date call.' },
        },
        required: ['food_log_entry_id'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'get_energy_stats',
      description:
        "Looks up the athlete's actual logged calorie intake and burn over a recent day range — daily calories in/out/net, how many days were a deficit vs. a surplus, average net, and weight_trend (weigh-ins actually logged in that same range, and the change between the first and latest). Call this whenever they ask how they're doing this week, about their deficit/surplus trend, whether their diet is actually working, or anything about recent energy balance or weight change — never guess or estimate from earlier turns when this tool can answer directly, same as get_workout_stats for training stats.",
      input_schema: {
        type: 'object',
        properties: {
          days: {
            type: ['integer', 'null'],
            description: 'How many days back to include, most recent first. Defaults to 7 (a week) if null; capped at 14.',
          },
        },
        required: ['days'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'get_training_patterns',
      description:
        "Looks up habit/consistency patterns the app has already detected from the athlete's last ~6 weeks of training and readiness check-ins — things like a specific weekday they consistently miss, declining week-over-week consistency, recurring pain reports, a specific exercise's RPE creeping up at the same load, or a low-sleep pattern. This is real detected-and-persisted pattern data (refreshed when the athlete opens the Home screen, so it can be a little stale, never live) — call it whenever they ask why they keep missing a day, whether a lift is getting harder for a bad reason, or anything about their own habits or trends over time, instead of trying to infer a pattern yourself from get_workout_stats' raw numbers. Returns an empty list if nothing's been detected yet, which is a normal state, not an error.",
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'get_program_overview',
      description:
        "Summarizes the athlete's active AI-generated program as a whole — title, goal, current week vs. total weeks, weeks remaining, and roughly how consistent they've been since it started. get_day_plan only ever covers one specific date and can't answer 'how's my program going' or 'what week am I on' — call this instead whenever the athlete asks about their program's overall progress, pacing, or how much is left. Returns has_active_program: false if they don't have one (e.g. following a manual weekly schedule instead of an AI-generated program) — say so plainly rather than guessing at one.",
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'remember_fact',
      description:
        "Saves a short named fact about the athlete for you to recall in every future conversation, not just this one — e.g. \"remember this as my standard shake: two scoops protein, 1 tbsp peanut butter, 1 cup almond milk\". Call this whenever the athlete explicitly asks you to remember or save something under a name. Calling this again with a label that already exists (matched case-insensitively) overwrites the old value with the new one — treat that as the athlete updating it, and say so. Every saved fact is already listed in your instructions below on every turn, so there's no lookup tool for these — just refer back to what's already there.",
      input_schema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short name the athlete gave it, e.g. "standard shake".' },
          value: { type: 'string', description: 'The actual content to remember.' },
        },
        required: ['label', 'value'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'forget_fact',
      description:
        'Deletes a previously saved fact by its label (matched case-insensitively). Call this when the athlete asks you to forget, delete, or remove something you were asked to remember. Use the exact label as shown in your instructions below — if none matches closely, say so rather than guessing.',
      input_schema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The label of the fact to remove, e.g. "standard shake".' },
        },
        required: ['label'],
        additionalProperties: false,
      },
      strict: true,
    },
    // deno-lint-ignore no-explicit-any
  ] as any;
}

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

type ToolContext = {
  userId: string;
  admin: SupabaseClient;
  nameToId: Map<string, string>;
  today: string;
  /** Storage path of a photo attached to THIS turn, or null — never a
   * historical photo from earlier in the conversation, even when one was
   * re-embedded into the model's context (see the history-mapping code
   * below). log_food_estimate only ever attributes a photo to the estimate
   * it produces when the athlete actually attached one just now. */
  photoPath: string | null;
  /** Same profile row already fetched once for the system prompt — passed
   * through rather than re-queried, for get_energy_stats' BMR/day-bucketing
   * math. */
  bodyStats: {
    timezone: string;
    nutritionGoal: string;
    heightCm: number | null;
    sex: 'male' | 'female' | null;
    birthDate: string | null;
  };
};

/**
 * Checks every source that can put a workout on this date, matching the
 * app's own single source of truth for "what's the plan for this date"
 * (resolveDayPlan, src/utils/dayPlan.ts) — previously this only checked the
 * AI-generated program and one-off scheduled_workouts, so a day planned
 * purely via the recurring weekly schedule (no scheduled_workouts row at
 * all) came back with nothing found even though Home/Calendar showed a
 * workout. Returns each source separately rather than pre-resolving one
 * winner, so the model can explain *why* when more than one applies (e.g. a
 * one-off swap overriding the usual weekly day) — but the precedence to
 * reason with, same as resolveDayPlan, is: completed > day_override >
 * scheduled_workouts > weekly_recurring > program_day.
 */
async function getDayPlan(input: Record<string, unknown>, ctx: ToolContext) {
  if (!isValidDateString(input.date)) return { error: 'date must be in YYYY-MM-DD format' };
  const date = input.date;
  const target = new Date(`${date}T00:00:00Z`);
  const dayOfWeek = target.getUTCDay();

  // Generous UTC window around the target date, then filtered precisely by
  // the athlete's own local calendar day below — same "wide window, exact
  // local filter" approach already used in proactive-coach-sweep and
  // get_energy_stats for this exact class of "did X happen on date Y in the
  // athlete's own timezone" question.
  const sinceIso = new Date(target.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const untilIso = new Date(target.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: program, error: programError },
    { data: weeklyEntry, error: weeklyError },
    { data: scheduled, error: scheduledError },
    { data: completedLogs, error: logsError },
    { data: override, error: overrideError },
  ] = await Promise.all([
    ctx.admin
      .from('programs')
      .select('start_date, weeks_count, program_weeks ( week_number, program_days ( day_of_week, title, is_rest_day, program_exercises ( exercises ( name ) ) ) )')
      .eq('user_id', ctx.userId)
      .eq('status', 'active')
      .maybeSingle(),
    ctx.admin
      .from('weekly_schedule')
      .select('day_type, workout_templates ( name, workout_template_exercises ( exercises ( name ) ) )')
      .eq('user_id', ctx.userId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle(),
    ctx.admin
      .from('scheduled_workouts')
      .select('id, name, scheduled_workout_exercises ( exercises ( name ) )')
      .eq('user_id', ctx.userId)
      .eq('scheduled_date', date)
      .limit(20),
    ctx.admin
      .from('workout_logs')
      .select('id, completed_at')
      .eq('user_id', ctx.userId)
      .not('completed_at', 'is', null)
      .gte('completed_at', sinceIso)
      .lt('completed_at', untilIso),
    ctx.admin.from('day_overrides').select('status').eq('user_id', ctx.userId).eq('date', date).maybeSingle(),
  ]);
  if (programError) throw programError;
  if (weeklyError) throw weeklyError;
  if (scheduledError) throw scheduledError;
  if (logsError) throw logsError;
  if (overrideError) throw overrideError;

  // deno-lint-ignore no-explicit-any
  let programDay: any = null;
  if (program) {
    // Ported from getProgramDayForDate (src/services/api/queries/programs.ts)
    // - UTC throughout, since this runs server-side rather than on-device.
    const start = new Date(`${program.start_date}T00:00:00Z`);
    const daysSinceStart = Math.floor((target.getTime() - start.getTime()) / 86_400_000);
    if (daysSinceStart >= 0) {
      const weekNumber = Math.floor(daysSinceStart / 7) + 1;
      if (weekNumber <= program.weeks_count) {
        // deno-lint-ignore no-explicit-any
        const week = (program.program_weeks as any[]).find(w => w.week_number === weekNumber);
        // deno-lint-ignore no-explicit-any
        const day = week?.program_days.find((d: any) => d.day_of_week === dayOfWeek);
        if (day) {
          programDay = {
            title: day.title,
            is_rest_day: day.is_rest_day,
            // deno-lint-ignore no-explicit-any
            exercises: day.program_exercises.map((pe: any) => pe.exercises.name),
          };
        }
      }
    }
  }

  const completedWorkoutLogIds = (completedLogs ?? [])
    .filter(log => localDateKey(new Date(log.completed_at as string), ctx.bodyStats.timezone) === date)
    .map(log => log.id);

  // deno-lint-ignore no-explicit-any
  const weeklyTemplate = weeklyEntry?.workout_templates as any;

  return {
    date,
    completed_workout_log_ids: completedWorkoutLogIds,
    day_override: (override?.status as string | undefined) ?? null,
    scheduled_workouts: (scheduled ?? []).map(sw => ({
      id: sw.id,
      name: sw.name,
      // deno-lint-ignore no-explicit-any
      exercises: (sw.scheduled_workout_exercises as any[]).map(e => e.exercises.name),
    })),
    weekly_recurring: weeklyEntry
      ? {
          day_type: weeklyEntry.day_type,
          name: weeklyTemplate?.name ?? null,
          // deno-lint-ignore no-explicit-any
          exercises: (weeklyTemplate?.workout_template_exercises ?? []).map((te: any) => te.exercises.name),
        }
      : null,
    program_day: programDay,
  };
}

async function removeScheduledWorkout(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.scheduled_workout_id !== 'string') {
    return { error: 'scheduled_workout_id is required' };
  }
  const scheduledWorkoutId = input.scheduled_workout_id;

  // Refuse rather than orphan a completed log's link back to what it fulfilled.
  // Scoped to ctx.userId, not just scheduled_workout_id - without it, a
  // scheduled_workout_id that happens to collide with another athlete's
  // completed log would leak that it exists (and wrongly block this
  // athlete's own removal) even though the delete below is correctly
  // scoped and could never touch it.
  const { data: linkedLog, error: logError } = await ctx.admin
    .from('workout_logs')
    .select('id')
    .eq('scheduled_workout_id', scheduledWorkoutId)
    .eq('user_id', ctx.userId)
    .not('completed_at', 'is', null)
    .maybeSingle();
  if (logError) throw logError;
  if (linkedLog) {
    return { error: 'That workout is already logged as completed - it can’t be removed.' };
  }

  // Ownership check lives IN the delete statement, not a separate SELECT -
  // .select() afterward is what lets us tell "0 rows matched" (wrong id, or
  // someone else's row) apart from "1 row deleted". Without it a foreign id
  // would silently no-op and this would incorrectly report success.
  const { data, error } = await ctx.admin
    .from('scheduled_workouts')
    .delete()
    .eq('id', scheduledWorkoutId)
    .eq('user_id', ctx.userId)
    .select('name, scheduled_date');
  if (error) throw error;
  if (!data || data.length === 0) return { error: 'No matching scheduled workout found for this athlete.' };

  return { removed: true, name: data[0].name, date: data[0].scheduled_date };
}

async function searchWorkoutTemplates(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.query !== 'string') return { error: 'query is required' };

  const { data, error } = await ctx.admin
    .from('workout_templates')
    .select('id, name, workout_template_exercises ( exercises ( name ) )')
    .eq('user_id', ctx.userId)
    .ilike('name', `%${input.query}%`)
    .limit(20);
  if (error) throw error;

  return {
    matches: (data ?? []).map(t => ({
      id: t.id,
      name: t.name,
      // deno-lint-ignore no-explicit-any
      exercises: (t.workout_template_exercises as any[]).map(e => e.exercises.name),
    })),
  };
}

async function curateWorkoutTemplate(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.name !== 'string' || !Array.isArray(input.exercises)) {
    return { error: 'name and exercises are required' };
  }

  const rows = input.exercises
    // deno-lint-ignore no-explicit-any
    .map((ex: any, index: number) => {
      const exerciseId = ctx.nameToId.get(String(ex.exercise_name).toLowerCase());
      if (!exerciseId) return null;
      return {
        exercise_id: exerciseId,
        order_index: index,
        target_sets: ex.target_sets,
        target_reps_min: ex.target_reps_min,
        target_reps_max: ex.target_reps_max,
        target_load_kg: null,
        target_rpe: ex.target_rpe ?? null,
        rest_seconds: ex.rest_seconds ?? null,
        notes: null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (rows.length === 0) return { error: 'None of the requested exercises matched the exercise library.' };

  const { data: template, error } = await ctx.admin
    .from('workout_templates')
    .insert({ user_id: ctx.userId, name: input.name })
    .select()
    .single();
  if (error) throw error;

  const { error: exercisesError } = await ctx.admin
    .from('workout_template_exercises')
    .insert(rows.map(row => ({ ...row, workout_template_id: template.id })));
  if (exercisesError) throw exercisesError;

  return { template_id: template.id, name: template.name, exercise_count: rows.length };
}

async function scheduleWorkoutTemplate(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.template_id !== 'string' || !isValidDateString(input.date)) {
    return { error: 'template_id and a valid date are required' };
  }
  if (input.date < ctx.today) return { error: 'Cannot schedule a workout in the past.' };

  const { data: template, error } = await ctx.admin
    .from('workout_templates')
    .select('id, name, workout_template_exercises ( * )')
    .eq('id', input.template_id)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) throw error;
  if (!template) return { error: 'Template not found for this athlete.' };

  const { data: scheduled, error: scheduleError } = await ctx.admin
    .from('scheduled_workouts')
    .insert({
      user_id: ctx.userId,
      scheduled_date: input.date,
      name: template.name,
      source_template_id: template.id,
    })
    .select()
    .single();
  if (scheduleError) throw scheduleError;

  const templateExercises = template.workout_template_exercises as Array<Record<string, unknown>>;
  if (templateExercises.length > 0) {
    const rows = templateExercises.map(te => ({
      scheduled_workout_id: scheduled.id,
      exercise_id: te.exercise_id,
      order_index: te.order_index,
      target_sets: te.target_sets,
      target_reps_min: te.target_reps_min,
      target_reps_max: te.target_reps_max,
      target_load_kg: te.target_load_kg,
      target_rpe: te.target_rpe,
      rest_seconds: te.rest_seconds,
      notes: te.notes,
    }));
    const { error: insertError } = await ctx.admin.from('scheduled_workout_exercises').insert(rows);
    if (insertError) throw insertError;
  }

  return { scheduled_workout_id: scheduled.id, name: scheduled.name, date: scheduled.scheduled_date };
}

/** Epley estimated one-rep max — same formula as the client's
 * estimateOneRepMax (src/services/api/queries/progress.ts), ported here
 * since this runs server-side against the raw tables directly. */
function estimateOneRepMax(loadKg: number, reps: number): number {
  return loadKg * (1 + reps / 30);
}

type LoggedSetRow = {
  reps: number;
  load_kg: number | null;
  logged_at: string;
  exercises: { name: string } | null;
};

async function getWorkoutStats(input: Record<string, unknown>, ctx: ToolContext) {
  const days = typeof input.days === 'number' && input.days > 0 ? Math.min(Math.floor(input.days), 365) : 90;
  const exerciseNameFilter = typeof input.exercise_name === 'string' ? input.exercise_name.toLowerCase() : null;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: logs, error: logsError } = await ctx.admin
    .from('workout_logs')
    .select('id')
    .eq('user_id', ctx.userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', cutoff);
  if (logsError) throw logsError;

  // workout_log_sets has no user_id column of its own — RLS (bypassed here
  // by the service-role client) scopes it via workout_logs.user_id instead,
  // so the same join has to be done explicitly with !inner to filter by it.
  const { data: setRows, error: setsError } = await ctx.admin
    .from('workout_log_sets')
    .select('reps, load_kg, logged_at, exercises ( name ), workout_logs!inner ( user_id )')
    .eq('workout_logs.user_id', ctx.userId)
    .eq('completed', true)
    .eq('is_warmup', false)
    .gte('logged_at', cutoff)
    .order('logged_at', { ascending: true });
  if (setsError) throw setsError;
  const sets = (setRows ?? []) as unknown as LoggedSetRow[];

  let totalVolumeKg = 0;
  const bestE1rmByExercise = new Map<string, number>();
  const prEvents: Array<{ exercise_name: string; reps: number; load_kg: number; estimated_1rm_kg: number; achieved_at: string }> = [];
  const exerciseAgg = new Map<
    string,
    { sets: number; bestE1rm: number; latest: { reps: number; load_kg: number | null; logged_at: string } }
  >();

  for (const s of sets) {
    if (s.load_kg != null) totalVolumeKg += s.load_kg * s.reps;
    const name = s.exercises?.name ?? 'Unknown exercise';
    const agg = exerciseAgg.get(name) ?? {
      sets: 0,
      bestE1rm: 0,
      latest: { reps: s.reps, load_kg: s.load_kg, logged_at: s.logged_at },
    };
    agg.sets += 1;
    agg.latest = { reps: s.reps, load_kg: s.load_kg, logged_at: s.logged_at };
    if (s.load_kg != null && s.load_kg > 0) {
      const e1rm = estimateOneRepMax(s.load_kg, s.reps);
      if (e1rm > agg.bestE1rm) agg.bestE1rm = e1rm;
      const priorBest = bestE1rmByExercise.get(name) ?? 0;
      if (e1rm > priorBest) {
        bestE1rmByExercise.set(name, e1rm);
        prEvents.push({
          exercise_name: name,
          reps: s.reps,
          load_kg: s.load_kg,
          estimated_1rm_kg: Math.round(e1rm * 10) / 10,
          achieved_at: s.logged_at,
        });
      }
    }
    exerciseAgg.set(name, agg);
  }

  const exerciseSummary = [...exerciseAgg.entries()]
    .filter(([name]) => !exerciseNameFilter || name.toLowerCase().includes(exerciseNameFilter))
    .sort((a, b) => b[1].sets - a[1].sets)
    .slice(0, exerciseNameFilter ? 1 : 8)
    .map(([name, agg]) => ({
      exercise_name: name,
      sets_logged: agg.sets,
      best_estimated_1rm_kg: agg.bestE1rm > 0 ? Math.round(agg.bestE1rm * 10) / 10 : null,
      most_recent_set: agg.latest,
    }));

  // total_sets_logged/total_volume_kg used to always cover every exercise in
  // range_days regardless of exercise_name, while exercise_summary above
  // correctly narrowed to just the filtered exercise - asking "how's my
  // bench doing" got a bench-only exercise_summary sitting next to
  // all-exercise totals in the same response, which a model reading this
  // JSON could easily report as if they were bench-specific.
  // workouts_completed stays a whole-session count either way (it isn't
  // exercise-granular - workout_logs has no per-set link to filter by).
  const filteredSets = exerciseNameFilter
    ? sets.filter(s => (s.exercises?.name ?? 'Unknown exercise').toLowerCase().includes(exerciseNameFilter))
    : sets;
  const filteredVolumeKg = exerciseNameFilter
    ? filteredSets.reduce((sum, s) => sum + (s.load_kg != null ? s.load_kg * s.reps : 0), 0)
    : totalVolumeKg;

  // Cardio has no e1rm/PR concept, so it never touches exerciseAgg/prEvents
  // above - it's a completely separate query, skipped entirely when
  // exercise_name is set (a cardio activity name would never match a
  // strength exercise filter, and returning it anyway would just be noise
  // in an already-narrowed response).
  let cardioSummary: {
    sessions_logged: number;
    total_duration_minutes: number;
    total_distance_km: number;
    total_estimated_calories: number;
    recent_sessions: Array<{ activity: string; duration_minutes: number; distance_km: number | null; logged_at: string }>;
  } | null = null;
  if (!exerciseNameFilter) {
    const { data: cardioRows, error: cardioError } = await ctx.admin
      .from('cardio_log_entries')
      .select('duration_minutes, distance_km, estimated_calories, custom_activity_name, created_at, exercises ( name )')
      .eq('user_id', ctx.userId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });
    if (cardioError) throw cardioError;
    const cardioRowsTyped = (cardioRows ?? []) as unknown as Array<{
      duration_minutes: number;
      distance_km: number | null;
      estimated_calories: number;
      custom_activity_name: string | null;
      created_at: string;
      exercises: { name: string } | null;
    }>;
    if (cardioRowsTyped.length > 0) {
      cardioSummary = {
        sessions_logged: cardioRowsTyped.length,
        total_duration_minutes: Math.round(cardioRowsTyped.reduce((sum, c) => sum + c.duration_minutes, 0) * 10) / 10,
        total_distance_km: Math.round(cardioRowsTyped.reduce((sum, c) => sum + (c.distance_km ?? 0), 0) * 100) / 100,
        total_estimated_calories: Math.round(cardioRowsTyped.reduce((sum, c) => sum + c.estimated_calories, 0)),
        recent_sessions: cardioRowsTyped.slice(0, 8).map(c => ({
          activity: c.exercises?.name ?? c.custom_activity_name ?? 'Cardio',
          duration_minutes: c.duration_minutes,
          distance_km: c.distance_km,
          logged_at: c.created_at,
        })),
      };
    }
  }

  return {
    range_days: days,
    workouts_completed: (logs ?? []).length,
    total_sets_logged: filteredSets.length,
    total_volume_kg: Math.round(filteredVolumeKg * 10) / 10,
    recent_prs: prEvents.slice(-5).reverse(),
    exercise_summary: exerciseSummary,
    // null when no cardio was logged in range, or when narrowed to a
    // specific strength exercise_name - never an empty object, so the model
    // can check truthiness directly instead of inspecting sessions_logged.
    cardio_summary: cardioSummary,
  };
}

const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

/** Always inserts status: 'pending' — the athlete confirms or edits in the
 * app before this counts toward their daily total (see 0063_food_photo_
 * logging.sql and EnergyTodayCard's status='confirmed' filter). ctx.
 * photoPath is only ever the CURRENT turn's photo (see ToolContext), so a
 * text-only "log a banana" call correctly stores no photo_path. */
async function logFoodEstimate(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.name !== 'string' || !input.name.trim()) return { error: 'name is required' };
  if (typeof input.calories !== 'number' || input.calories < 0) return { error: 'calories must be a non-negative number' };
  if (typeof input.confidence !== 'string' || !CONFIDENCE_LEVELS.has(input.confidence)) {
    return { error: 'confidence must be high, medium, or low' };
  }
  const mealType = typeof input.meal_type === 'string' && MEAL_TYPES.has(input.meal_type) ? input.meal_type : null;

  const { data: entry, error } = await ctx.admin
    .from('food_log_entries')
    .insert({
      user_id: ctx.userId,
      name: input.name.trim(),
      meal_type: mealType,
      calories: Math.round(input.calories),
      protein_g: typeof input.protein_g === 'number' ? input.protein_g : 0,
      carbs_g: typeof input.carbs_g === 'number' ? input.carbs_g : 0,
      fat_g: typeof input.fat_g === 'number' ? input.fat_g : 0,
      status: 'pending',
      confidence: input.confidence,
      photo_path: ctx.photoPath,
    })
    .select()
    .single();
  if (error) throw error;

  return {
    food_log_entry_id: entry.id,
    name: entry.name,
    calories: entry.calories,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    fat_g: entry.fat_g,
    confidence: entry.confidence,
  };
}

/** Zero-calorie food_log_entries row, status: 'skipped' - the same signal
 * LogFoodScreen's own "Skip this meal" button writes (src/screens/log/
 * LogFoodScreen.tsx). Never counts toward totals (outside the 'confirmed'
 * filter every totals query uses) but does count as "accounted for" in
 * hasLoggedMealToday (proactive-coach-sweep), so the meal-gap reminder
 * stops nagging about it. */
async function skipMeal(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.meal_type !== 'string' || !MEAL_TYPES.has(input.meal_type)) {
    return { error: 'meal_type must be breakfast, lunch, dinner, or snack' };
  }

  const { data: entry, error } = await ctx.admin
    .from('food_log_entries')
    .insert({
      user_id: ctx.userId,
      name: `Skipped ${input.meal_type}`,
      meal_type: input.meal_type,
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      status: 'skipped',
    })
    .select('id')
    .single();
  if (error) throw error;

  return { food_log_entry_id: entry.id, meal_type: input.meal_type };
}

/**
 * Every food_log_entries row for one local calendar day, in every status -
 * the required first step before update_food_log_entry/delete_food_log_entry
 * can act on a real id, same "lookup tool returns real ids, a second tool
 * consumes them" shape as get_day_plan -> remove_scheduled_workout. Over-
 * fetches a generous UTC window then filters precisely via localDateKey
 * (same approach get_energy_stats' day-bucketing uses) since logged_at is a
 * timestamptz and a naive UTC date range would misclassify entries logged
 * near midnight in the athlete's own timezone.
 */
async function getFoodLogForDate(input: Record<string, unknown>, ctx: ToolContext) {
  if (!isValidDateString(input.date)) return { error: 'date must be in YYYY-MM-DD format' };
  const date = input.date;

  const dayStartUtc = new Date(`${date}T00:00:00Z`).getTime();
  const sinceIso = new Date(dayStartUtc - 24 * 60 * 60 * 1000).toISOString();
  const untilIso = new Date(dayStartUtc + 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await ctx.admin
    .from('food_log_entries')
    .select('id, name, meal_type, calories, protein_g, carbs_g, fat_g, status, logged_at')
    .eq('user_id', ctx.userId)
    .gte('logged_at', sinceIso)
    .lte('logged_at', untilIso)
    .order('logged_at', { ascending: true });
  if (error) throw error;

  const entries = (data ?? []).filter(
    row => localDateKey(new Date(row.logged_at as string), ctx.bodyStats.timezone) === date,
  );

  return {
    date,
    entries: entries.map(row => ({
      food_log_entry_id: row.id,
      name: row.name,
      meal_type: row.meal_type,
      calories: row.calories,
      protein_g: row.protein_g,
      carbs_g: row.carbs_g,
      fat_g: row.fat_g,
      status: row.status,
    })),
  };
}

async function updateFoodLogEntry(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.food_log_entry_id !== 'string') return { error: 'food_log_entry_id is required' };
  if (typeof input.name !== 'string' || !input.name.trim()) return { error: 'name is required' };
  if (typeof input.calories !== 'number' || input.calories < 0) return { error: 'calories must be a non-negative number' };

  // Ownership check lives IN the update statement, not a separate SELECT -
  // .select() afterward is what lets us tell "0 rows matched" (wrong id, or
  // someone else's row) apart from "1 row updated", same reasoning as
  // remove_scheduled_workout's delete below.
  const { data, error } = await ctx.admin
    .from('food_log_entries')
    .update({
      name: input.name.trim(),
      calories: Math.round(input.calories),
      protein_g: typeof input.protein_g === 'number' ? input.protein_g : 0,
      carbs_g: typeof input.carbs_g === 'number' ? input.carbs_g : 0,
      fat_g: typeof input.fat_g === 'number' ? input.fat_g : 0,
    })
    .eq('id', input.food_log_entry_id)
    .eq('user_id', ctx.userId)
    .select('id, name, calories, protein_g, carbs_g, fat_g, status');
  if (error) throw error;
  if (!data || data.length === 0) return { error: 'No matching food log entry found for this athlete.' };

  const entry = data[0];
  return {
    food_log_entry_id: entry.id,
    name: entry.name,
    calories: entry.calories,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    fat_g: entry.fat_g,
    status: entry.status,
  };
}

async function deleteFoodLogEntry(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.food_log_entry_id !== 'string') return { error: 'food_log_entry_id is required' };

  const { data, error } = await ctx.admin
    .from('food_log_entries')
    .delete()
    .eq('id', input.food_log_entry_id)
    .eq('user_id', ctx.userId)
    .select('name');
  if (error) throw error;
  if (!data || data.length === 0) return { error: 'No matching food log entry found for this athlete.' };

  return { deleted: true, name: data[0].name };
}

type WorkoutLogForEnergy = {
  started_at: string;
  completed_at: string;
  cardio_log_entries: Array<{ estimated_calories: number }>;
};

/**
 * Returns data only — the model narrates it in its own reply, same "tools
 * read/write real data, Claude composes the sentence" split every other
 * tool here already follows. Never confused with coachingEngine's
 * deterministic Home-card text (src/services/coaching), which stays
 * LLM-free by design; this is the opposite side of that boundary.
 */
async function getEnergyStats(input: Record<string, unknown>, ctx: ToolContext) {
  const requestedDays = typeof input.days === 'number' ? input.days : 7;
  const days = Math.min(14, Math.max(1, Math.round(requestedDays)));
  const { timezone, nutritionGoal, heightCm, sex, birthDate } = ctx.bodyStats;
  const targetNet = TARGET_NET_CALORIES_BY_GOAL[nutritionGoal] ?? 0;

  // Unbounded (not windowed by `days`) — this is the BMR input, and the
  // most recent weigh-in is the right one to use for that even if it's
  // older than the requested range.
  const { data: latestWeightRow } = await ctx.admin
    .from('body_metrics')
    .select('weight_kg')
    .eq('user_id', ctx.userId)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const weightKg = (latestWeightRow?.weight_kg as number | null) ?? null;

  const hasEnoughProfileData = weightKg != null && heightCm != null && sex != null && birthDate != null;
  const bmr = hasEnoughProfileData
    ? calculateBmr({ weightKg: weightKg as number, heightCm: heightCm as number, age: calculateAge(birthDate as string, new Date()), sex: sex as 'male' | 'female' })
    : FALLBACK_BMR;
  const baseOut = bmr + NEAT_BASELINE_CALORIES;

  // A couple of days' buffer past the requested range, same "generous
  // window then filter precisely by local day" approach proactive-coach-
  // sweep's fetchCompletedDateKeys already uses.
  const sinceIso = new Date(Date.now() - (days + 2) * 24 * 60 * 60 * 1000).toISOString();

  // Unlike latestWeightRow above (BMR input, unbounded), this is scoped to
  // the same window the calorie/deficit numbers below cover — the whole
  // point is letting the model say whether the deficit/surplus actually
  // moved the scale over *this* stretch, not just report it in isolation.
  // null (not 0/omitted) whenever there are fewer than two weigh-ins in
  // range, since a one-point "trend" isn't one.
  const { data: weightTrendRows } = await ctx.admin
    .from('body_metrics')
    .select('weight_kg, logged_at')
    .eq('user_id', ctx.userId)
    .not('weight_kg', 'is', null)
    .gte('logged_at', sinceIso)
    .order('logged_at', { ascending: true });
  const weightTrend = (weightTrendRows ?? []) as Array<{ weight_kg: number; logged_at: string }>;
  const weightChangeKg =
    weightTrend.length >= 2
      ? Math.round((weightTrend[weightTrend.length - 1].weight_kg - weightTrend[0].weight_kg) * 10) / 10
      : null;

  const [{ data: foodRows }, { data: workoutRows }] = await Promise.all([
    ctx.admin
      .from('food_log_entries')
      .select('logged_at, calories, protein_g')
      .eq('user_id', ctx.userId)
      .eq('status', 'confirmed')
      .gte('logged_at', sinceIso),
    ctx.admin
      .from('workout_logs')
      .select('started_at, completed_at, cardio_log_entries ( estimated_calories )')
      .eq('user_id', ctx.userId)
      .not('completed_at', 'is', null)
      .gte('completed_at', sinceIso),
  ]);

  const byDay = new Map<string, { caloriesIn: number; proteinG: number; workoutOut: number }>();
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = localDateKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000), timezone);
    dayKeys.push(key);
    byDay.set(key, { caloriesIn: 0, proteinG: 0, workoutOut: 0 });
  }

  for (const row of foodRows ?? []) {
    const bucket = byDay.get(localDateKey(new Date(row.logged_at as string), timezone));
    if (!bucket) continue;
    bucket.caloriesIn += (row.calories as number) ?? 0;
    bucket.proteinG += (row.protein_g as number) ?? 0;
  }

  for (const row of (workoutRows ?? []) as WorkoutLogForEnergy[]) {
    const bucket = byDay.get(localDateKey(new Date(row.completed_at), timezone));
    if (!bucket) continue;
    const cardioEntry = row.cardio_log_entries?.[0];
    if (cardioEntry) {
      bucket.workoutOut += cardioEntry.estimated_calories ?? 0;
    } else if (weightKg != null) {
      const minutes = Math.max(0, (new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()) / 60_000);
      bucket.workoutOut += estimateStrengthSessionCalories({ durationMinutes: minutes, weightKg, sex });
    }
  }

  const daily = dayKeys.map(date => {
    const bucket = byDay.get(date)!;
    const caloriesOut = baseOut + bucket.workoutOut;
    return {
      date,
      calories_in: Math.round(bucket.caloriesIn),
      calories_out: Math.round(caloriesOut),
      net: Math.round(bucket.caloriesIn - caloriesOut),
      protein_g: Math.round(bucket.proteinG),
    };
  });

  const daysWithLoggedMeals = daily.filter(d => d.calories_in > 0).length;
  const deficitDays = daily.filter(d => d.net <= 0).length;
  const averageNet = daily.length > 0 ? Math.round(daily.reduce((sum, d) => sum + d.net, 0) / daily.length) : 0;

  return {
    days,
    nutrition_goal: nutritionGoal,
    target_net: targetNet,
    average_net: averageNet,
    deficit_days: deficitDays,
    surplus_days: daily.length - deficitDays,
    days_with_logged_meals: daysWithLoggedMeals,
    daily,
    // False whenever bmr above fell back to FALLBACK_BMR (missing weight,
    // height, sex, or birth date) — same signal EnergyTodayCard's own
    // "using an estimated baseline" caveat is driven by
    // (src/utils/energyBalance.ts's hasEnoughProfileData). Lets the model
    // caveat calories_out/net the same way instead of stating a possibly
    // population-average number as fact.
    has_enough_profile_data: hasEnoughProfileData,
    // The actual outcome the deficit/surplus above is supposed to produce —
    // null whenever there are fewer than two weigh-ins in `days` (a single
    // point isn't a trend), never fabricated from the BMR-input weight
    // above, which can be arbitrarily old.
    weight_trend: {
      weigh_ins_in_range: weightTrend.length,
      first_weight_kg: weightTrend[0]?.weight_kg ?? null,
      latest_weight_kg: weightTrend[weightTrend.length - 1]?.weight_kg ?? null,
      change_kg: weightChangeKg,
    },
  };
}

/** Pure read of already-detected-and-persisted patterns (see
 * 0016_training_patterns.sql and src/services/api/queries/coachingMemory.ts)
 * — detection itself runs client-side (deterministic, stateless) whenever
 * TodayScreen/MoreForYouCard compute it and call useSyncTrainingPatterns;
 * this tool never runs detection itself, it just reads what's already
 * there, same "server reads what the client already wrote" shape as
 * get_workout_stats reading workout_log_sets. */
async function getTrainingPatterns(_input: Record<string, unknown>, ctx: ToolContext) {
  const { data, error } = await ctx.admin
    .from('training_patterns')
    .select('pattern_type, title, detail, evidence_summary, confidence, last_detected_at')
    .eq('user_id', ctx.userId)
    .eq('status', 'active')
    .order('confidence', { ascending: false });
  if (error) throw error;

  return {
    patterns: (data ?? []).map(row => ({
      type: row.pattern_type,
      title: row.title,
      detail: row.detail,
      evidence: row.evidence_summary,
      confidence: row.confidence,
      last_detected_at: row.last_detected_at,
    })),
  };
}

/** Same UTC-anchored date-string arithmetic getDayPlan already uses (this
 * function runs server-side with no idea what timezone the athlete is in,
 * so ctx.today — the client's real local date, sent fresh every message —
 * is the only trustworthy "today" here, never `new Date()`). */
async function getProgramOverview(_input: Record<string, unknown>, ctx: ToolContext) {
  const { data: program, error } = await ctx.admin
    .from('programs')
    .select('title, goal, start_date, weeks_count, program_weeks ( week_number, program_days ( day_of_week, is_rest_day ) )')
    .eq('user_id', ctx.userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!program) return { has_active_program: false };

  const start = new Date(`${program.start_date}T00:00:00Z`);
  const todayDate = new Date(`${ctx.today}T00:00:00Z`);
  const daysSinceStart = Math.floor((todayDate.getTime() - start.getTime()) / 86_400_000);
  const rawWeek = Math.floor(daysSinceStart / 7) + 1;
  const isFinished = rawWeek > program.weeks_count;
  const currentWeek = Math.min(Math.max(rawWeek, 1), program.weeks_count);

  // Every training (non-rest) program day whose date has already passed,
  // across every week from the start through today — the denominator for a
  // rough consistency read, not an exact one (see the field comment below).
  let trainingDaysElapsed = 0;
  // deno-lint-ignore no-explicit-any
  for (const week of (program.program_weeks as any[]) ?? []) {
    // deno-lint-ignore no-explicit-any
    for (const day of week.program_days ?? []) {
      if (day.is_rest_day) continue;
      const dayOffset = (week.week_number - 1) * 7 + day.day_of_week;
      const dayDate = new Date(start.getTime() + dayOffset * 86_400_000);
      if (dayDate.getTime() <= todayDate.getTime()) trainingDaysElapsed++;
    }
  }

  const { count: workoutsCompletedSinceStart } = await ctx.admin
    .from('workout_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ctx.userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', program.start_date);

  return {
    has_active_program: true,
    title: program.title,
    goal: program.goal,
    current_week: currentWeek,
    total_weeks: program.weeks_count,
    weeks_remaining: isFinished ? 0 : program.weeks_count - currentWeek + 1,
    is_finished: isFinished,
    training_days_elapsed_this_program: trainingDaysElapsed,
    // Every completed session since the program's start date, not narrowed
    // to program-scheduled days specifically — an ad-hoc workout added via
    // the library counts here too. A reasonable proxy for "how consistent
    // have they actually been", not an exact program-only adherence
    // percentage — never present it to the athlete as one.
    workouts_completed_since_program_start: workoutsCompletedSinceStart ?? 0,
  };
}

/** Explicit "find by label ilike, update if found else insert" rather than
 * a .upsert(onConflict:) call — supabase-js's upsert targets a literal
 * column list, and the backstop unique index (0077_user_facts.sql) is on
 * lower(label), an expression it can't target directly. Same ownership-
 * scoped "act then check rows returned" shape as update_food_log_entry. */
async function rememberFact(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.label !== 'string' || !input.label.trim()) return { error: 'label is required' };
  if (typeof input.value !== 'string' || !input.value.trim()) return { error: 'value is required' };
  const label = input.label.trim();
  const value = input.value.trim();

  const { data: existing, error: findError } = await ctx.admin
    .from('user_facts')
    .select('id')
    .eq('user_id', ctx.userId)
    .ilike('label', label)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await ctx.admin
      .from('user_facts')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
    return { saved: true, label, value, updated: true };
  }

  const { error } = await ctx.admin.from('user_facts').insert({ user_id: ctx.userId, label, value });
  if (error) throw error;
  return { saved: true, label, value, updated: false };
}

async function forgetFact(input: Record<string, unknown>, ctx: ToolContext) {
  if (typeof input.label !== 'string' || !input.label.trim()) return { error: 'label is required' };

  const { data, error } = await ctx.admin
    .from('user_facts')
    .delete()
    .eq('user_id', ctx.userId)
    .ilike('label', input.label.trim())
    .select('label');
  if (error) throw error;
  if (!data || data.length === 0) return { error: 'No matching saved fact found for this athlete.' };

  return { deleted: true, label: data[0].label };
}

function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext) {
  switch (name) {
    case 'get_day_plan':
      return getDayPlan(input, ctx);
    case 'remove_scheduled_workout':
      return removeScheduledWorkout(input, ctx);
    case 'search_workout_templates':
      return searchWorkoutTemplates(input, ctx);
    case 'curate_workout_template':
      return curateWorkoutTemplate(input, ctx);
    case 'get_workout_stats':
      return getWorkoutStats(input, ctx);
    case 'schedule_workout_template':
      return scheduleWorkoutTemplate(input, ctx);
    case 'log_food_estimate':
      return logFoodEstimate(input, ctx);
    case 'skip_meal':
      return skipMeal(input, ctx);
    case 'get_food_log_for_date':
      return getFoodLogForDate(input, ctx);
    case 'update_food_log_entry':
      return updateFoodLogEntry(input, ctx);
    case 'delete_food_log_entry':
      return deleteFoodLogEntry(input, ctx);
    case 'get_energy_stats':
      return getEnergyStats(input, ctx);
    case 'get_training_patterns':
      return getTrainingPatterns(input, ctx);
    case 'get_program_overview':
      return getProgramOverview(input, ctx);
    case 'remember_fact':
      return rememberFact(input, ctx);
    case 'forget_fact':
      return forgetFact(input, ctx);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Service-role client for every DB write below - bypasses RLS by design,
  // so ownership is checked explicitly instead of relying on policies. Also
  // used for the guardrail checks, which need to run before auth even
  // resolves (see checkIpRateLimit below).
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const clientIp = getClientIp(req);
  // Filled in once checkUserGuardrailsAndReserve reserves a row, and again
  // as real Anthropic usage comes in below - read by the `finally` block at
  // the bottom so partial spend is still recorded even if something fails
  // mid-request, not just on a clean success.
  let requestLogId: string | null = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Backstop against a flood hitting this endpoint before auth even
    // resolves (garbage/expired tokens still cost a real auth.getUser()
    // round trip) - checked ahead of everything else since it doesn't need
    // a user at all.
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
    const conversationId = body.conversation_id as string;
    const message = ((body.message as string) ?? '').trim();
    // Storage path within the private `chat-photos` bucket, already
    // uploaded by the client before this call — a food photo the athlete
    // attached, or undefined for a plain-text message. `message` may be
    // empty when a photo carries no caption.
    const photoPath = typeof body.photo_path === 'string' && body.photo_path.trim() ? body.photo_path.trim() : null;
    // Trusted "today" comes from the client (its own local device time, the
    // same format(new Date(),'yyyy-MM-dd') convention scheduled_date already
    // uses everywhere) - this function runs in UTC with no idea what
    // timezone the athlete is actually in, so computing "today" here would
    // silently write the wrong date for anyone west of UTC late in their day.
    const todayInput = body.today as string;
    const today = isValidDateString(todayInput) ? todayInput : new Date().toISOString().slice(0, 10);
    // Same IANA zone useSyncTimezone writes to profiles.timezone
    // (Intl.DateTimeFormat().resolvedOptions().timeZone), but sent fresh on
    // every message rather than relying on that fire-and-forget background
    // sync having already landed. Without this, day-bucketing below
    // (history date markers, get_food_log_for_date, get_energy_stats) fell
    // back to profiles.timezone - nullable, and null for any athlete whose
    // sync hadn't completed yet - which silently defaulted to UTC and could
    // disagree with `today` above (always the device's real local date):
    // exactly the gap that let a food entry logged the athlete's local
    // yesterday evening get bucketed onto today's UTC date, surfacing as
    // "I already logged eggs" for something logged the day before.
    const clientTimezone = isValidTimeZone(body.timezone) ? body.timezone : null;
    if (!conversationId || (!message && !photoPath)) {
      return json({ error: 'conversation_id and a message or photo_path are required' }, 400);
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return json({ error: `Please keep messages under ${MAX_MESSAGE_LENGTH} characters.` }, 400);
    }

    // Fetched ahead of the guardrail check below (rather than alongside the
    // rest of the context in the Promise.all further down) purely so
    // is_premium is known in time to pick which of that check's two limit
    // tiers applies — everything else this row carries is only needed once
    // we're past the guardrail and actually building the prompt, same as
    // before.
    const { data: profile } = await admin
      .from('profiles')
      .select(
        'display_name, goal, experience_level, days_per_week, injuries_notes, is_premium, timezone, nutrition_goal, height_cm, sex, birth_date',
      )
      .eq('id', userId)
      .single();

    // Abuse-prevention rate limiting + daily token budget - distinct from
    // the FREE_MESSAGES_PER_MONTH business-tier gate below, which exists to
    // upsell, not to stop abuse (a premium user has no monthly cap, but
    // still shouldn't be able to script unlimited concurrent requests).
    // Pro gets the much higher _PREMIUM ceiling (see its own comment) —
    // real engaged use of a paid tier shouldn't run into a limit sized for
    // catching abuse on the free tier.
    const isPremium = !!profile?.is_premium;
    const guardrail = await checkUserGuardrailsAndReserve(admin, {
      endpoint: ENDPOINT_NAME,
      userId,
      ip: clientIp,
      userPerHour: isPremium ? RATE_LIMIT_USER_PER_HOUR_PREMIUM : RATE_LIMIT_USER_PER_HOUR,
      userPerDay: isPremium ? RATE_LIMIT_USER_PER_DAY_PREMIUM : RATE_LIMIT_USER_PER_DAY,
      userDailyTokenBudget: isPremium ? USER_DAILY_TOKEN_BUDGET_PREMIUM : USER_DAILY_TOKEN_BUDGET,
      globalDailyTokenBudget: GLOBAL_DAILY_TOKEN_BUDGET,
      featureLabel: 'Arnold',
    });
    if (!guardrail.allowed) return json({ error: guardrail.error, code: guardrail.code }, guardrail.status);
    requestLogId = guardrail.logId;

    const { data: conversation, error: conversationError } = await admin
      .from('chat_conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .single();
    if (conversationError || !conversation || conversation.user_id !== userId) {
      return json({ error: 'Conversation not found' }, 404);
    }

    // Independent reads, fetched together rather than one at a time — none
    // of these depend on each other's results, and each round trip was
    // previously adding its own latency to every chat-coach call before the
    // (much more expensive) Anthropic request even starts. profile itself
    // was already fetched above (needed earlier, for the guardrail tier).
    const [
      { data: whoopMetrics },
      { data: ouraMetrics },
      { data: appleHealthMetrics },
      { data: historyRows, error: historyError },
      { data: exerciseRows, error: exerciseError },
      { data: factRows, error: factsError },
    ] = await Promise.all([
      // Only present for athletes who've connected + synced Whoop (see
      // supabase/functions/whoop-sync) — absent for everyone else, which is
      // why this is spliced onto the prompt conditionally below rather than
      // folded into the fixed template like the profile fields above.
      admin
        .from('whoop_metrics')
        .select(
          'recovery_score, sleep_performance_pct, strain, score_state, cycle_date, hrv_ms, resting_heart_rate, sleep_efficiency_pct, sleep_consistency_pct, respiratory_rate, rem_sleep_minutes, deep_sleep_minutes, light_sleep_minutes, awake_minutes, sleep_debt_minutes, spo2_pct, skin_temp_celsius',
        )
        .eq('user_id', userId)
        .order('cycle_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Same idea as whoop_metrics above, for athletes who've connected +
      // synced Oura instead (see supabase/functions/oura-sync). Oura has no
      // score_state concept — a row simply doesn't exist until it's scored —
      // so "connected and has data" is just "this query returned a row".
      admin
        .from('oura_metrics')
        .select('readiness_score, sleep_score, activity_score, metric_date')
        .eq('user_id', userId)
        .order('metric_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Apple Health, Phase 1 (docs/apple-health.md) — the app itself
      // writes this (no sync edge function exists for this source, see the
      // plan doc's architecture section), so "has data" is just "this
      // query returned a row", same as Oura above. Deliberately informational
      // only: unlike whoopSection/ouraSection below, this never carries a
      // recovery score (HealthKit doesn't have one) and the prompt below
      // says so explicitly, so the model never invents one.
      admin
        .from('device_health_metrics')
        .select('resting_heart_rate, hrv_ms, hrv_method, sleep_duration_minutes, step_count, metric_date')
        .eq('user_id', userId)
        .eq('source', 'apple_health')
        .order('metric_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('chat_messages')
        .select('role, content, photo_path, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT),
      // Same enum-constrained-exercise-name pattern as generate-program:
      // fetch the real (non-custom) library once, use it to build
      // curate_workout_template's tool schema, and to defensively resolve
      // names -> ids after the fact even though `strict: true` already
      // enforces the enum.
      admin.from('exercises').select('id, name').eq('is_custom', false),
      // Athlete-named facts saved via the remember_fact tool (0077_user_
      // facts.sql) — a separate table from chat_messages specifically so
      // these survive Clear Chat (useClearChat only deletes chat_messages
      // rows) and are visible regardless of how much conversation history
      // is in scope.
      admin.from('user_facts').select('label, value').eq('user_id', userId).order('created_at', { ascending: true }),
    ]);
    if (historyError) throw historyError;
    if (exerciseError) throw exerciseError;
    if (factsError) throw factsError;
    const history = (historyRows ?? []).reverse();
    const exerciseNames = (exerciseRows ?? []).map(e => e.name as string);
    const nameToId = new Map((exerciseRows ?? []).map(e => [(e.name as string).toLowerCase(), e.id as string]));

    if (!isPremium) {
      // Approximate month boundary from the client's own local "today"
      // (see the comment on `today` above) rather than this function's UTC
      // clock — a few hours of slop at the edge of a month is fine for a
      // soft usage cap, and this stays consistent with how `today` is
      // already used everywhere else here.
      const monthStart = `${today.slice(0, 7)}-01`;
      const { count: messagesThisMonth, error: countError } = await admin
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('role', 'user')
        .gte('created_at', monthStart);
      if (countError) throw countError;

      if ((messagesThisMonth ?? 0) >= FREE_MESSAGES_PER_MONTH) {
        return json(
          {
            error: `You've used your ${FREE_MESSAGES_PER_MONTH} free AI Coach messages this month. Upgrade to SetSocial Pro for unlimited access.`,
            code: 'free_limit_reached',
          },
          402,
        );
      }
    }

    const { error: insertUserError } = await admin
      .from('chat_messages')
      .insert({ conversation_id: conversationId, role: 'user', content: message || null, photo_path: photoPath });
    if (insertUserError) throw insertUserError;

    const weekdayName = WEEKDAY_NAMES[new Date(`${today}T00:00:00Z`).getUTCDay()];
    // Only present for athletes who've connected + synced Whoop and whose
    // latest cycle is fully scored — absent for everyone else, so this is
    // appended conditionally rather than folded into the fixed template
    // like the profile fields below.
    let whoopSection = '';
    if (whoopMetrics?.score_state === 'SCORED') {
      // Headline three always present (score_state === 'SCORED' guarantees
      // recovery/strain exist); everything past that is from
      // 0074_whoop_sleep_detail.sql and only appended when actually
      // present, since older synced rows and athletes mid-sync won't have
      // all of it yet. One flat list rather than the today-focus summary's
      // narrower "HRV + sleep debt only" version (see engine.ts) - a system
      // prompt has room to be thorough where a one-line UI summary doesn't.
      const whoopBits = [
        `recovery ${whoopMetrics.recovery_score}%`,
        `sleep performance ${whoopMetrics.sleep_performance_pct ?? 'unknown'}%`,
        `strain ${whoopMetrics.strain ?? 'unknown'}`,
      ];
      if (whoopMetrics.hrv_ms != null) whoopBits.push(`HRV ${whoopMetrics.hrv_ms}ms`);
      if (whoopMetrics.resting_heart_rate != null) whoopBits.push(`resting heart rate ${whoopMetrics.resting_heart_rate}bpm`);
      if (whoopMetrics.sleep_efficiency_pct != null) whoopBits.push(`sleep efficiency ${whoopMetrics.sleep_efficiency_pct}%`);
      if (whoopMetrics.sleep_consistency_pct != null) whoopBits.push(`sleep consistency ${whoopMetrics.sleep_consistency_pct}%`);
      if (whoopMetrics.respiratory_rate != null) whoopBits.push(`respiratory rate ${whoopMetrics.respiratory_rate}/min`);
      if (
        whoopMetrics.rem_sleep_minutes != null &&
        whoopMetrics.deep_sleep_minutes != null &&
        whoopMetrics.light_sleep_minutes != null &&
        whoopMetrics.awake_minutes != null
      ) {
        whoopBits.push(
          `sleep stages ${whoopMetrics.rem_sleep_minutes}min REM / ${whoopMetrics.deep_sleep_minutes}min deep / ${whoopMetrics.light_sleep_minutes}min light / ${whoopMetrics.awake_minutes}min awake`,
        );
      }
      if (whoopMetrics.sleep_debt_minutes != null) whoopBits.push(`sleep debt ${whoopMetrics.sleep_debt_minutes}min`);
      if (whoopMetrics.spo2_pct != null) whoopBits.push(`SpO2 ${whoopMetrics.spo2_pct}%`);
      if (whoopMetrics.skin_temp_celsius != null) whoopBits.push(`skin temp ${whoopMetrics.skin_temp_celsius}°C`);
      whoopSection = `\n\nToday's Whoop data (${whoopMetrics.cycle_date}): ${whoopBits.join(', ')}. Factor this into training and recovery advice - e.g. favor lighter intensity or extra rest on low-recovery days, high sleep debt, or low HRV - and reference these numbers directly if the athlete asks how they're doing.`;
    }
    // Independent of whoopSection above (not a fallback for it) — an
    // athlete can have both connected at once, in which case both sections
    // are appended and Arnold can reference either number in conversation.
    // No score_state gate needed here since a row only exists once scored.
    const ouraSection = ouraMetrics
      ? `\n\nToday's Oura data (${ouraMetrics.metric_date}): readiness ${ouraMetrics.readiness_score}%, sleep ${ouraMetrics.sleep_score ?? 'unknown'}%, activity ${ouraMetrics.activity_score ?? 'unknown'}%. Factor this into training and recovery advice - e.g. favor lighter intensity or extra rest on low-readiness days - and reference these numbers directly if the athlete asks how they're doing.`
      : '';
    // Apple Health, Phase 1 — raw signal only, deliberately not scored the
    // way whoopSection/ouraSection above are (see this function's own fetch
    // comment). The instruction below is explicit about that boundary so
    // the model never treats these numbers as a substitute recovery score.
    let appleHealthSection = '';
    if (appleHealthMetrics) {
      const bits: string[] = [];
      if (appleHealthMetrics.resting_heart_rate != null) bits.push(`resting heart rate ${appleHealthMetrics.resting_heart_rate}bpm`);
      if (appleHealthMetrics.hrv_ms != null) {
        const method = appleHealthMetrics.hrv_method === 'rmssd' ? 'RMSSD' : 'SDNN';
        bits.push(`HRV ${appleHealthMetrics.hrv_ms}ms (${method})`);
      }
      if (appleHealthMetrics.sleep_duration_minutes != null) {
        bits.push(`slept ${Math.floor(appleHealthMetrics.sleep_duration_minutes / 60)}h ${appleHealthMetrics.sleep_duration_minutes % 60}m`);
      }
      if (appleHealthMetrics.step_count != null) bits.push(`${appleHealthMetrics.step_count} steps`);
      if (bits.length > 0) {
        appleHealthSection = `\n\nApple Health data (${appleHealthMetrics.metric_date}): ${bits.join(', ')}. This is raw device data, not a recovery score - Apple Health has no equivalent of Whoop/Oura's recovery score, so never state or imply one from these numbers. Fine to reference directly if the athlete asks about their sleep, heart rate, HRV, or steps, but (unlike Whoop/Oura data, if present above) don't use it on its own to justify a training-intensity recommendation.`;
      }
    }
    // Persists across conversations and survives Clear Chat (see the
    // fetch comment above) — listed here in full rather than behind a
    // lookup tool since the list is expected to stay short.
    const factsSection = (factRows ?? []).length
      ? `\n\nFacts you've saved for this athlete: ${(factRows ?? []).map(f => `"${f.label}": ${f.value}`).join('; ')}.`
      : '';
    const systemPrompt = `You are Arnold, SetSocial's AI strength coach, chatting with ${profile?.display_name ?? 'an athlete'}. If asked your name, you're Arnold.
Athlete profile - goal: ${profile?.goal ?? 'unspecified'}, experience: ${profile?.experience_level ?? 'unspecified'}, training days/week: ${profile?.days_per_week ?? 'unspecified'}, injuries/limitations: ${profile?.injuries_notes || 'none reported'}.
Answer training, recovery, and nutrition questions concisely and encouragingly. Keep replies short (a few sentences unless the question needs more). Flag when something warrants seeing a doctor or physical therapist instead of guessing.

Today is ${today} (${weekdayName}). Use this as "today" when resolving relative dates like "tomorrow", "this Friday", or "next week" - never assume or compute your own date.

This conversation is one ongoing thread that spans many days, not just today - earlier messages below may be from yesterday or further back. A message is only tagged with a \`[YYYY-MM-DD]\` marker when its date differs from the message before it, so a run of untagged messages after a marker all belong to that same tagged date. Before telling the athlete something is "already logged" or already done today, check that it actually happened on a message tagged (or falling under) ${today} - a similar-sounding meal or action from a previous day is not a duplicate, it's just something they did before.

You can take real actions on the athlete's schedule using the tools available to you:
- Always call get_day_plan for a date before changing anything for it, or before answering what's planned for a day - never guess an id or assume what's scheduled.
- You can cancel a workout the athlete (or you) added via the library/schedule system with remove_scheduled_workout. You CANNOT remove a day from their ongoing AI-generated training program - there is no way to delete those in this app today. If get_day_plan shows the day is a program_day (not a scheduled_workout), explain that plainly and suggest an alternative, like substituting an exercise, instead of attempting the removal.
- scheduled_workouts has no limit of one per day - if get_day_plan returns more than one for the date and it's not clear which the athlete means, ask before removing anything rather than guessing.
- If get_day_plan comes back with nothing for a date, say so rather than inventing a workout that isn't there.
- To add a themed or one-off workout (e.g. "shoulder day"), first call search_workout_templates. Only call curate_workout_template if nothing suitable already exists. A successful curate_workout_template must always be followed by schedule_workout_template - creating a template alone does not put it on the athlete's calendar.
- Always state plainly, in your reply, exactly what you removed or created and scheduled (name + date). There is no undo, so your reply is the athlete's only confirmation of what happened.
- You DO have access to the athlete's actual logged training history - call get_workout_stats whenever they ask about their stats, progress, volume, PRs, or how a specific lift is trending. Never say you don't have access to their stats or make numbers up - call the tool and report exactly what it returns, and use it to ground any recommendation in what they've actually been doing.
- When the athlete sends a food photo, or just describes something they ate, identify it and call log_food_estimate with your best calorie/macro guess - it only saves as a pending draft they still have to confirm in the app, so a reasonable estimate with honest confidence beats withholding one. Before framing anything as an additional or duplicate serving "on top of" what's already logged, call get_food_log_for_date for ${today} and base that claim only on what it actually returns - never infer a same-day duplicate from earlier chat history, since a similar-sounding meal mentioned there can be from a previous day that's simply still in the conversation. A caption sent alongside a photo (e.g. "log this for breakfast, it's two eggs and toast") is real grounding, not just a meal-type hint - let it resolve exactly the ambiguity it addresses rather than estimating as if it weren't there. Ask ONE short clarifying question first only when something genuinely changes the estimate a lot (e.g. dressing on the side vs. mixed in, single vs. double portion) - don't interrogate them over minor uncertainty. Default to high confidence whenever the food and portion are reasonably clear; medium/low are for real ambiguity, not routine estimation. Always say your confidence level and briefly why in your reply, so what you say and the confidence badge they see never disagree.
- When the athlete says they're skipping a meal, fasting through it, or just not eating it - call skip_meal instead of log_food_estimate. It records nothing nutritionally, it just stops that meal from looking like an unlogged gap.
- When the athlete wants to correct, edit, or delete something already logged (e.g. "that was actually 3 eggs not 2", "delete the yogurt I logged", "remove breakfast") - always call get_food_log_for_date for that date first to get a real id; never guess one or reuse one from earlier in the conversation, since entries can also be added/edited/removed from the app itself at any time. If more than one entry could match what they mean, ask which one rather than guessing. update_food_log_entry only changes the name/calories/macros, never which meal it's logged as; delete_food_log_entry has no undo, so always state plainly in your reply exactly what you changed or removed.
- Whenever the athlete asks how they're doing this week (or any recent stretch), about their deficit/surplus trend, or anything about recent calorie/energy balance, call get_energy_stats and ground your reply in exactly what it returns - call out specific days when it's informative (e.g. a surplus day with an obvious explanation isn't a problem, one day doesn't undo a trend), not just an average. Never estimate or recall this from earlier in the conversation when the tool can answer it directly. If has_enough_profile_data is false, the calories-out/net numbers are a population-average estimate, not personalized - say so plainly and point them at Stats > Body Metrics to add their height, weight, age and sex for an accurate one, the same way the Home screen already caveats it. weight_trend on the same response is the actual outcome that deficit/surplus is supposed to produce - if weigh_ins_in_range is 2 or more, factor change_kg into your answer whenever the athlete is asking whether their diet is working, not just the calorie math; if it's under 2, say plainly that there isn't enough recent weigh-in data to tell yet rather than guessing.
- Whenever the athlete asks why they keep missing a particular day, whether a lift's effort has been creeping up, or anything about their own habits or trends over time, call get_training_patterns - this is real detected pattern data (the same "coaching memory" insights shown on their Home screen), not something to infer fresh from get_workout_stats' raw numbers. An empty list back means nothing's been detected yet, not that nothing is being watched for.
- Whenever the athlete asks how their program is going overall, what week they're on, or how much is left, call get_program_overview - get_day_plan only ever covers one specific date and can't answer a whole-program question. has_active_program: false means they're not on an AI-generated program right now (e.g. following a manual weekly schedule instead) - say so plainly. workouts_completed_since_program_start is a rough consistency signal, not an exact program-only adherence percentage - never state it as one.
- When the athlete explicitly asks you to remember or save something under a name (e.g. "remember this as my standard shake"), call remember_fact - it persists across every future conversation, not just this one, so use it only for things they actually asked you to save, never as a substitute for normal conversation memory within this chat. If they ask you to forget or delete a saved fact, call forget_fact with its exact label from the list below.${whoopSection}${ouraSection}${appleHealthSection}${factsSection}`;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const topic = `chat-${conversationId}`;
    const tools = buildTools(exerciseNames);
    const ctx: ToolContext = {
      userId,
      admin,
      nameToId,
      today,
      photoPath,
      bodyStats: {
        timezone: clientTimezone ?? (profile?.timezone as string | null) ?? 'UTC',
        nutritionGoal: (profile?.nutrition_goal as string | null) ?? 'maintain',
        heightCm: (profile?.height_cm as number | null) ?? null,
        sex: (profile?.sex as 'male' | 'female' | null) ?? null,
        birthDate: (profile?.birth_date as string | null) ?? null,
      },
    };

    // Only re-embed the SINGLE most recent photo found in history, and only
    // when this turn didn't just bring its own — a clarifying-question
    // follow-up ("is that a single or double patty?") needs the model to
    // still see the photo it asked about, but re-fetching every historical
    // photo on every turn would be wasted work for photos no longer
    // relevant to the conversation.
    const mostRecentPhotoHistoryIndex = photoPath
      ? -1
      : (() => {
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].photo_path) return i;
          }
          return -1;
        })();

    // deno-lint-ignore no-explicit-any
    const historyMessages: any[] = [];
    // Undated history reads as if every past exchange happened "just now" -
    // the model has no other way to tell a food logged yesterday from one
    // logged five minutes ago, and will otherwise mistake a similar-sounding
    // meal from an earlier day for a duplicate of today's. Stamp a
    // `[<date>]` marker on the first message of each calendar day (in the
    // athlete's own timezone, same as get_energy_stats' day-bucketing) so
    // day boundaries are visible without tagging every single turn.
    let lastHistoryDateKey: string | null = null;
    for (let i = 0; i < history.length; i++) {
      const row = history[i];
      const role = row.role as 'user' | 'assistant';
      const rowDateKey = localDateKey(new Date(row.created_at as string), ctx.bodyStats.timezone);
      const dateMarker = rowDateKey !== lastHistoryDateKey ? `[${rowDateKey}] ` : '';
      lastHistoryDateKey = rowDateKey;
      const rowContent = row.content ? truncateForHistory(row.content as string) : null;
      if (i === mostRecentPhotoHistoryIndex && row.photo_path) {
        const imageBlock = await fetchImageBlock(admin, row.photo_path as string);
        const blocks: AnthropicContentBlock[] = imageBlock ? [imageBlock] : [];
        blocks.push({ type: 'text', text: `${dateMarker}${rowContent ? rowContent : '[Photo]'}` });
        historyMessages.push({ role, content: blocks });
      } else if (row.photo_path) {
        // A photo existed here but isn't being re-shown to the model this
        // turn — a short marker so it still knows one was part of this
        // exchange, without paying to re-fetch and re-encode it.
        historyMessages.push({ role, content: `${dateMarker}${rowContent ? `[Photo] ${rowContent}` : '[Photo]'}` });
      } else {
        historyMessages.push({ role, content: `${dateMarker}${rowContent ?? ''}` });
      }
    }

    // deno-lint-ignore no-explicit-any
    let currentTurnContent: any;
    if (photoPath) {
      const imageBlock = await fetchImageBlock(admin, photoPath);
      if (!imageBlock) throw new Error('Could not read the attached photo.');
      const blocks: AnthropicContentBlock[] = [imageBlock];
      if (message) blocks.push({ type: 'text', text: message });
      currentTurnContent = blocks;
    } else {
      currentTurnContent = message;
    }

    // deno-lint-ignore no-explicit-any
    const messages: any[] = [...historyMessages, { role: 'user' as const, content: currentTurnContent }];

    const startTime = Date.now();
    let finalText = '';
    let exhaustedMidToolUse = false;
    // Set when log_food_estimate succeeds this turn — attached to the
    // assistant's persisted reply below so the client knows to render
    // FoodEstimateCard instead of plain text for this message.
    let loggedFoodEntryId: string | null = null;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      if (Date.now() - startTime > SOFT_DEADLINE_MS) {
        exhaustedMidToolUse = true;
        break;
      }

      const stream = anthropic.messages.stream({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        thinking: { type: 'disabled' },
        system: systemPrompt,
        tools,
        messages,
      });

      stream.on('text', delta => {
        // Fire-and-forget: broadcast order matches emit order since each call
        // is awaited by the SDK's internal event loop before the next delta
        // fires, but we don't block the stream on the HTTP round-trip here.
        broadcast(topic, 'token', { delta }).catch(err => console.error('broadcast failed', err));
      });

      const response = await stream.finalMessage();
      // Accumulated regardless of how this iteration ends (reply or another
      // tool call) - read by the `finally` block at the very bottom of the
      // handler so real spend is recorded even if a later iteration throws.
      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;

      if (response.stop_reason !== 'tool_use') {
        // A turn can contain more than one text block (narration ahead of
        // each of several tool calls) - concatenate all of them rather than
        // .find()-ing just the first, which would silently drop the rest.
        finalText = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('');
        exhaustedMidToolUse = false;
        break;
      }

      exhaustedMidToolUse = true;

      // MAX_TOOL_ITERATIONS bounds how many Claude calls one request can
      // chain, but each is independently capped at max_tokens=2048 - a full
      // chain can still cost more than any single call's cap suggests. This
      // is the actual per-request ceiling; it's checked here (after this
      // turn's tool_use is already paid for) rather than before, since
      // there's no way to stop a turn already in flight.
      if (totalOutputTokens >= MAX_OUTPUT_TOKENS_PER_REQUEST) break;

      messages.push({ role: 'assistant', content: response.content });

      // Every tool_use in this turn gets executed, and every result is
      // batched into ONE subsequent user message - the API pairs tool_use/
      // tool_result by id within adjacent turns, and splitting results
      // across multiple messages measurably discourages future parallel
      // tool calls.
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const result = await executeTool(block.name, block.input as Record<string, unknown>, ctx);
          if (block.name === 'log_food_estimate') {
            const foodResult = result as { food_log_entry_id?: unknown };
            if (typeof foodResult.food_log_entry_id === 'string') loggedFoodEntryId = foodResult.food_log_entry_id;
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          console.error(`tool ${block.name} failed`, err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // The loop only exits mid tool-use via the iteration cap or soft
    // deadline - in that case `finalText` was never assigned (the last turn
    // was a bare tool_use block, not a reply), so a completed mutation is
    // never silently left unconfirmed. Also guards the degenerate case of a
    // normal completion whose final turn happened to carry no text blocks.
    if (exhaustedMidToolUse || !finalText) {
      finalText = FALLBACK_TEXT;
    }

    const { data: assistantRow, error: insertAssistantError } = await admin
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: finalText,
        food_log_entry_id: loggedFoodEntryId,
      })
      .select()
      .single();
    if (insertAssistantError) throw insertAssistantError;

    await broadcast(topic, 'done', { message_id: assistantRow.id, content: finalText });

    return json({ message_id: assistantRow.id }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  } finally {
    // Runs on every exit path, including the guardrail rejections above
    // (a no-op there - requestLogId is only set once a request is actually
    // allowed through) and any error after Claude was already called, so
    // real spend is never left unrecorded because of a downstream failure.
    await finalizeAiUsage(admin, requestLogId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
  }
});
