import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import HealthKit, { CategoryValueSleepAnalysis } from '@kingstinct/react-native-healthkit';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';

// Apple Health, Phase 1 (iOS only) — see docs/apple-health.md. Unlike
// whoop.ts/oura.ts, there is no OAuth and no edge function here: the app
// reads HealthKit directly on-device via @kingstinct/react-native-healthkit
// and writes the result straight to Supabase as the signed-in user (normal
// RLS, no service-role writer — see 0079_device_health.sql). "Sync" means
// "read HealthKit right now and upsert what came back," not "trigger a
// server-side job."

export type DeviceHealthMetricsRow = Database['public']['Tables']['device_health_metrics']['Row'];
export type DeviceHealthConnectionRow = Database['public']['Tables']['device_health_connections']['Row'];

const RESTING_HEART_RATE = 'HKQuantityTypeIdentifierRestingHeartRate' as const;
const HRV_SDNN = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' as const;
const STEP_COUNT = 'HKQuantityTypeIdentifierStepCount' as const;
const SLEEP_ANALYSIS = 'HKCategoryTypeIdentifierSleepAnalysis' as const;

// Every "asleep" state HealthKit can report, excluding inBed and awake —
// what actually counts toward sleep duration. asleepUnspecified and asleep
// share the same underlying enum value (1); listed separately here only for
// clarity at the call site, Set collapses the duplicate.
const ASLEEP_VALUES = new Set<number>([
  CategoryValueSleepAnalysis.asleepUnspecified,
  CategoryValueSleepAnalysis.asleep,
  CategoryValueSleepAnalysis.asleepCore,
  CategoryValueSleepAnalysis.asleepDeep,
  CategoryValueSleepAnalysis.asleepREM,
]);

/** yyyy-MM-dd in device local time — same convention every other "today"
 * concept in this app already uses (e.g. chat-coach's client-supplied
 * `today`), since HealthKit has no idea what "today" means for the athlete
 * beyond the device's own clock/timezone, which is exactly what's wanted
 * here (this never runs server-side). */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** False on Android (always) and on an iOS device/simulator with no Health
 * app data source at all — callers use this to hide the whole feature
 * rather than letting a native call throw. Not a permission check: HealthKit
 * never exposes real grant/deny status to the app, see readTodayAppleHealthMetrics. */
export function isAppleHealthAvailable(): boolean {
  return Platform.OS === 'ios' && HealthKit.isHealthDataAvailable();
}

/** HealthKit's requestAuthorization resolves once the system sheet has been
 * presented and dismissed — it does NOT report which of the 4 requested
 * types were actually granted vs. denied (deliberate Apple privacy
 * behavior). A `true` here is proof the request happened, never proof of
 * access — see docs/apple-health.md's "Permission UX" section. */
async function requestAppleHealthAuthorization(): Promise<boolean> {
  return HealthKit.requestAuthorization({
    toRead: [RESTING_HEART_RATE, HRV_SDNN, STEP_COUNT, SLEEP_ANALYSIS],
  });
}

type AppleHealthReadResult = {
  restingHeartRate: number | null;
  hrvMs: number | null;
  sleepDurationMinutes: number | null;
  stepCount: number | null;
};

/**
 * Reads today's four Phase 1 fields directly from HealthKit. Each of the
 * four is fetched independently and defaults to null on its own failure —
 * since HealthKit never distinguishes "denied" from "no data exists" (see
 * above), one missing type must never blank out the other three that did
 * come back.
 */
async function readTodayAppleHealthMetrics(): Promise<AppleHealthReadResult> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  // Sleep sessions span midnight — a window back to noon the day before
  // catches "went to bed last night, still asleep or just woke up" without
  // pulling in the *previous* night's sleep too.
  const sleepWindowStart = new Date(startOfToday);
  sleepWindowStart.setHours(-12, 0, 0, 0);

  const [restingHeartRate, hrv, sleepSamples, stepStats] = await Promise.all([
    HealthKit.getMostRecentQuantitySample(RESTING_HEART_RATE, 'count/min').catch(() => undefined),
    HealthKit.getMostRecentQuantitySample(HRV_SDNN, 'ms').catch(() => undefined),
    HealthKit
      .queryCategorySamples(SLEEP_ANALYSIS, {
        limit: 0,
        filter: { date: { startDate: sleepWindowStart, endDate: now } },
      })
      .catch(() => []),
    HealthKit
      .queryStatisticsForQuantity(STEP_COUNT, ['cumulativeSum'], {
        filter: { date: { startDate: startOfToday, endDate: now } },
      })
      .catch(() => undefined),
  ]);

  const sleepDurationMinutes = sleepSamples.length
    ? Math.round(
        sleepSamples
          .filter(sample => ASLEEP_VALUES.has(sample.value as number))
          .reduce((sum, sample) => sum + (sample.endDate.getTime() - sample.startDate.getTime()) / 60_000, 0),
      )
    : null;

  return {
    restingHeartRate: restingHeartRate ? Math.round(restingHeartRate.quantity) : null,
    hrvMs: hrv ? Math.round(hrv.quantity) : null,
    sleepDurationMinutes,
    stepCount: stepStats?.sumQuantity ? Math.round(stepStats.sumQuantity.quantity) : null,
  };
}

async function upsertDeviceHealthMetrics(userId: string, result: AppleHealthReadResult): Promise<void> {
  const { error } = await supabase.from('device_health_metrics').upsert(
    {
      user_id: userId,
      metric_date: localDateKey(new Date()),
      source: 'apple_health',
      resting_heart_rate: result.restingHeartRate,
      hrv_ms: result.hrvMs,
      hrv_method: result.hrvMs != null ? 'sdnn' : null,
      sleep_duration_minutes: result.sleepDurationMinutes,
      step_count: result.stepCount,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,metric_date,source' },
  );
  if (error) throw error;
}

/** Upserts on (user_id, source) — omitting requested_at here means a
 * conflict-update never touches it, so it stays set to the FIRST successful
 * request only (matches 0079_device_health.sql's own comment: existence of
 * this row means "requested at least once," never "currently granted"). */
async function upsertDeviceHealthConnection(userId: string): Promise<void> {
  const { error } = await supabase.from('device_health_connections').upsert(
    { user_id: userId, source: 'apple_health', last_synced_at: new Date().toISOString() },
    { onConflict: 'user_id,source' },
  );
  if (error) throw error;
}

export function useDeviceHealthConnection(userId: string | null) {
  return useQuery({
    queryKey: ['deviceHealthConnection', userId, 'apple_health'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('device_health_connections')
        .select('*')
        .eq('user_id', userId as string)
        .eq('source', 'apple_health')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: userId != null,
  });
}

export function useLatestAppleHealthMetrics(userId: string | null) {
  return useQuery({
    queryKey: ['deviceHealthMetrics', userId, 'apple_health'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('device_health_metrics')
        .select('*')
        .eq('user_id', userId as string)
        .eq('source', 'apple_health')
        .order('metric_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: userId != null,
  });
}

/** The one "Connect" action for Apple Health: request the native permission
 * sheet, then immediately read + persist whatever came back. There's no
 * separate OAuth-callback step to wait for (see docs/apple-health.md) — this
 * single mutation is the entire connect flow, and is also what re-syncs on
 * every later screen focus once a connection row already exists. */
export function useSyncAppleHealth(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in.');
      const requested = await requestAppleHealthAuthorization();
      if (!requested) throw new Error('Could not request Health access. Please try again.');
      const result = await readTodayAppleHealthMetrics();
      await Promise.all([upsertDeviceHealthMetrics(userId, result), upsertDeviceHealthConnection(userId)]);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deviceHealthConnection', userId, 'apple_health'] });
      queryClient.invalidateQueries({ queryKey: ['deviceHealthMetrics', userId, 'apple_health'] });
    },
  });
}

/** Only ever removes the local connection row — the app has no way to
 * revoke a HealthKit grant itself (only the athlete can, in iOS Settings).
 * Existing device_health_metrics history is left alone, same precedent
 * Whoop/Oura disconnect already sets (useDisconnectIntegration never
 * deletes whoop_metrics/oura_metrics either). */
export function useDisconnectAppleHealth(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in.');
      const { error } = await supabase
        .from('device_health_connections')
        .delete()
        .eq('user_id', userId)
        .eq('source', 'apple_health');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deviceHealthConnection', userId, 'apple_health'] });
    },
  });
}
