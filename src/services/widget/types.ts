import type { ReadinessBand } from '../coaching';

export type WidgetPlanKind = 'training' | 'cardio' | 'completed' | 'rest' | 'none';

export type WidgetPlan = {
  kind: WidgetPlanKind;
  /** "Today" | "Today · Done" | "Next" (peeking past a rest day). */
  label: string;
  title: string | null;
  meta: string | null;
};

/**
 * Exactly mirrors WidgetPayload in ios/Shared/WidgetPayload.swift — field
 * names and nesting must match, since it's serialized with
 * `JSON.stringify` on this side and decoded with Swift's synthesized
 * `Codable` conformance (no key-mapping) on the other.
 */
export type WidgetPayload = {
  /** Date.prototype.toISOString() — includes milliseconds. */
  updatedAt: string;
  /** yyyy-MM-dd, the local calendar day this payload was computed for. */
  dateKey: string;
  headline: string;
  summary: string;
  band: ReadinessBand | null;
  isRestDay: boolean;
  plan: WidgetPlan;
  sessionsThisWeek: number | null;
  weeklyTarget: number | null;
  /** 0-100, same score AiSummaryCard's readiness ring shows — null when
   * there's not enough data yet (e.g. no check-in and no wearable today). */
  readinessScore: number | null;
  /** Consecutive-day training streak, same number StreakRiskNudge/Home's
   * own streak chip show. */
  streak: number;
  /** Today's logged calories and target — same two numbers
   * EnergyTodayCard's ring is built from. Either can be null independently
   * (e.g. a target exists before any food is logged, or vice versa for an
   * athlete with no profile data yet to estimate a target from). */
  caloriesLogged: number | null;
  calorieTarget: number | null;
  /** soset:// deep link that opens Arnold with the chat input focused and
   * ready for a food description or photo — the widget's "Log Food" tap
   * target on both platforms. Always the same fixed URL; carried on the
   * payload (rather than hardcoded twice, once per native platform) so
   * there's exactly one place that ever needs to change it. */
  logFoodDeepLink: string;
};
