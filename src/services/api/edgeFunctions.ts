import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { TrainingGoal, ExperienceLevel, EquipmentType } from '../../types/database';

/** Thrown by invokeFunction when the response body carries a `code` —
 * lets a caller branch on a specific failure (e.g. chat-coach's
 * 'free_limit_reached') without parsing `.message` text. */
export class EdgeFunctionError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.code = code;
  }
}

// Supabase's own FunctionsHttpError.message is a flat, unhelpful "Edge
// Function returned a non-2xx status code" — every edge function in this
// app formats its real error as JSON, but that generic string is all a
// caller gets when the response body isn't parseable as that JSON (e.g. the
// function crashed at cold start/module load, before its own try/catch's
// json() formatting ever ran, or the function itself isn't deployed). Never
// show that raw string to an athlete; this is what they see instead.
const UNREACHABLE_FUNCTION_MESSAGE = 'Something went wrong reaching the server. Please try again in a moment.';

async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // FunctionsHttpError's own message is just "non-2xx status code" — the
    // actual reason is in the response body our function returned.
    if (error instanceof FunctionsHttpError) {
      let serverMessage: string | null = null;
      let code: string | undefined;
      try {
        const errorBody = await error.context.json();
        serverMessage = errorBody?.error ?? null;
        code = errorBody?.code;
      } catch {
        // Response body wasn't JSON — fall through to the generic error.
      }
      throw new EdgeFunctionError(serverMessage ?? UNREACHABLE_FUNCTION_MESSAGE, code);
    }
    // FunctionsFetchError / FunctionsRelayError (network failure, function
    // not found/deployed, etc.) — same principle, never the raw SDK string.
    throw new EdgeFunctionError(UNREACHABLE_FUNCTION_MESSAGE);
  }
  return data as T;
}

export type GenerateProgramInput = {
  goal: TrainingGoal;
  experience_level: ExperienceLevel;
  days_per_week: number;
  /** How many weeks the generated block should run — asked explicitly by
   * the Ask Coach flow before generation, never inferred by the model. */
  weeks_count: number;
  equipment: EquipmentType[];
  injuries_notes: string;
  /** Free-text answer to "what are you trying to accomplish?" — optional,
   * same as injuries_notes. */
  focus_notes: string;
  /** MuscleGroup values (see constants/muscleGroups.ts) the athlete picked
   * to emphasize this program — optional, may be empty. */
  emphasis_muscle_groups: string[];
};

export function generateProgram(input: GenerateProgramInput): Promise<{ program_id: string }> {
  return invokeFunction('generate-program', input);
}

export function deleteAccount(): Promise<void> {
  return invokeFunction('delete-account', {});
}

/** Doesn't change the password itself — emails a confirmation link to the
 * caller's own address from support@setsocial.app, and only applies
 * `newPassword` (see supabase/functions/confirm-password-change) once
 * that's tapped. See useAuth's requestPasswordChange for the caller side. */
export function requestPasswordChange(newPassword: string): Promise<{ ok: true }> {
  return invokeFunction('request-password-change', { newPassword });
}

/** `today` must be the caller's own local-device date (format(new Date(),
 * 'yyyy-MM-dd')) — the edge function runs in UTC with no idea what timezone
 * the athlete is in, and needs a trusted "today" to resolve relative dates
 * ("tomorrow", "this Friday") onto the same scheduled_date convention the
 * rest of the app already uses.
 *
 * Also sends the device's own IANA timezone (the same value useSyncTimezone
 * writes to profiles.timezone) on every call, computed fresh here rather
 * than relying on that fire-and-forget background sync having already
 * landed — chat-coach's day-bucketing (deciding whether a past food/workout
 * entry belongs to "today" or an earlier day) previously fell back to the
 * possibly-null profiles.timezone column, which could silently disagree
 * with `today` above and misclassify a message from late in the athlete's
 * local day as belonging to the wrong calendar date server-side.
 *
 * `photoPath` is an already-uploaded `chat-photos` storage path (see
 * useUploadFoodPhoto) — `message` may be an empty string when a photo
 * carries no caption, but at least one of the two is required. */
export function sendChatMessage(
  conversationId: string,
  message: string,
  today: string,
  photoPath?: string,
): Promise<{ message_id: string }> {
  return invokeFunction('chat-coach', {
    conversation_id: conversationId,
    message,
    today,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    photo_path: photoPath,
  });
}

/** Mints a one-time OAuth state token server-side and returns WHOOP's
 * authorization URL — see supabase/functions/whoop-oauth-start. */
export function startWhoopConnect(): Promise<{ url: string }> {
  return invokeFunction('whoop-oauth-start', {});
}

/** Mints a one-time OAuth state token server-side and returns Spotify's
 * authorization URL — see supabase/functions/spotify-oauth-start. */
export function startSpotifyConnect(): Promise<{ url: string }> {
  return invokeFunction('spotify-oauth-start', {});
}

/** Mints a one-time OAuth state token server-side and returns Oura's
 * authorization URL — see supabase/functions/oura-oauth-start. */
export function startOuraConnect(): Promise<{ url: string }> {
  return invokeFunction('oura-oauth-start', {});
}

export type WhoopSyncResult = {
  cycle_date: string;
  whoop_cycle_id: string;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  recovery_score: number | null;
  sleep_performance_pct: number | null;
  strain: number | null;
  hrv_ms: number | null;
  resting_heart_rate: number | null;
  synced_at: string;
};

/** Pulls the caller's latest recovery/sleep/strain from WHOOP and upserts it
 * into whoop_metrics server-side — see supabase/functions/whoop-sync. Only
 * call this when the user is already known to be connected (see
 * useIntegrationConnections); the real read path for display is
 * useWhoopMetrics's direct table read, not this function's response. */
export function syncWhoopMetrics(): Promise<WhoopSyncResult> {
  return invokeFunction('whoop-sync', {});
}

export type OuraSyncResult = {
  metric_date: string;
  readiness_score: number;
  sleep_score: number | null;
  activity_score: number | null;
  synced_at: string;
};

/** Pulls the caller's latest readiness/sleep/activity from Oura and upserts
 * it into oura_metrics server-side — see supabase/functions/oura-sync. Only
 * call this when the user is already known to be connected (see
 * useIntegrationConnections); the real read path for display is
 * useOuraMetrics's direct table read, not this function's response. */
export function syncOuraMetrics(): Promise<OuraSyncResult> {
  return invokeFunction('oura-sync', {});
}

export type SpotifyPlayerAction = 'now_playing' | 'play' | 'pause' | 'next' | 'previous';

/** Spotify's own /me/player response shape, trimmed to the fields a "now
 * playing" widget needs — see supabase/functions/spotify-player. `result` is
 * `null` when nothing is currently playing on any device (Spotify's 204). */
export type SpotifyPlayerResult = {
  action: SpotifyPlayerAction;
  result: {
    is_playing: boolean;
    progress_ms: number | null;
    item: {
      name: string;
      duration_ms: number;
      artists: { name: string }[];
      album: { images: { url: string }[] };
    } | null;
  } | null;
};

/** Reads or controls Spotify playback via the caller's stored tokens — see
 * supabase/functions/spotify-player. Only call this when the user is
 * already known to be connected (see useIntegrationConnections); the client
 * never sees the Spotify access token itself. */
export function spotifyPlayerAction(action: SpotifyPlayerAction): Promise<SpotifyPlayerResult> {
  return invokeFunction('spotify-player', { action });
}

export type ParsedCheckin = {
  sleepHours: number | null;
  sleepQuality: number | null;
  soreness: number | null;
  stress: number | null;
  hasPain: boolean;
  painNotes: string | null;
};

/** Parses a free-text readiness description into the same fields the manual
 * PreWorkoutReviewScreen check-in form collects — see
 * supabase/functions/parse-checkin. Never writes to readiness_checkins
 * itself; the caller always shows the result back as an editable form before
 * submitting via useSubmitReadinessCheckin. */
export function parseCheckinText(text: string): Promise<ParsedCheckin> {
  return invokeFunction('parse-checkin', { text });
}

export type ExerciseMuscleClassification = {
  /** Position in the `names` array this classifies. The response can omit
   * indices the model wasn't confident about, so callers must match by this
   * rather than assuming a 1:1, same-order response. */
  index: number;
  primaryMuscle: string;
};

/** Classifies custom exercise names by primary muscle group (see
 * constants/muscleGroups.ts for the fixed set of values) — see
 * supabase/functions/classify-exercise-muscle. Never writes to the exercises
 * table itself; callers apply the result via their own update. Max 30 names
 * per call. */
export function classifyExerciseMuscles(names: string[]): Promise<{ classifications: ExerciseMuscleClassification[] }> {
  return invokeFunction('classify-exercise-muscle', { names });
}

export type SpotifyPlaylistSummary = {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  ownerName: string | null;
};

export type FormCheckCue = { label: string; status: 'good' | 'warning'; note: string };
export type FormCheckResult = {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  cues: FormCheckCue[];
  tips: string[];
};

/** Sends already-uploaded form-check-photos paths (1 for a photo, several
 * for a video's sampled frames — see useUploadFormCheckPhoto) off for
 * analysis — see supabase/functions/form-check. The function deletes every
 * frame server-side before returning, success or failure, so nothing further
 * needs to be cleaned up client-side once this resolves or throws. */
export function analyzeFormCheck(input: {
  exercise_id: string;
  exercise_name: string;
  photo_paths: string[];
}): Promise<FormCheckResult> {
  return invokeFunction('form-check', input);
}

/** Lists the caller's Spotify playlists — see
 * supabase/functions/spotify-playlists. Only call this when the user is
 * already known to be connected (see useIntegrationConnections). */
export function fetchSpotifyPlaylists(): Promise<{ playlists: SpotifyPlaylistSummary[] }> {
  return invokeFunction('spotify-playlists', {});
}
