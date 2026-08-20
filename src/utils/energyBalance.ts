import { SEX_ADJUSTMENT } from './cardioCalories';
import { kgToLb } from './units';
import type { NutritionGoal, Sex } from '../types/database';

/** Target daily net (intake minus burn) per body-composition goal. Flat,
 * population-typical numbers rather than a per-user rate — same rationale
 * as NEAT_BASELINE_CALORIES below: a reasonable deterministic default now,
 * refinable later rather than blocking Phase 1 on a settings UI for it. */
export const TARGET_NET_CALORIES_BY_GOAL: Record<NutritionGoal, number> = {
  cut: -500,
  bulk: 300,
  maintain: 0,
};

/** Flat non-exercise-activity-calories allowance added on top of BMR to
 * approximate TDEE — the same kind of population-average placeholder
 * BASE_MET's lookup table is in cardioCalories.ts, refinable later from a
 * connected wearable's own measured burn (this app already has Whoop
 * integration) instead of a flat number. */
export const NEAT_BASELINE_CALORIES = 500;

/** Resistance-training MET tiers (Compendium of Physical Activities: light-
 * or-moderate effort, "squats, slow or explosive effort", and vigorous
 * effort respectively). A completed strength session has no continuous
 * incline/speed input the way treadmill cardio does, so — same idea as
 * BASE_MET's lookup table in cardioCalories.ts — this picks one of a few
 * reference points rather than modeling effort continuously. */
const LIGHT_RESISTANCE_MET = 3.5;
const MODERATE_RESISTANCE_MET = 5.0;
const VIGOROUS_RESISTANCE_MET = 6.0;
/** Back-compat alias for the flat default used when there's no volume to
 * pick a tier from (see estimateStrengthSessionCalories). */
const RESISTANCE_TRAINING_MET = MODERATE_RESISTANCE_MET;

/** kg moved per bodyweight-kg per minute — a session's total volume
 * normalized by both bodyweight and duration, so a short, dense set of heavy
 * squats and a long, light set of curls don't get judged on raw kg alone.
 * Thresholds are a reasonable placeholder tuned against typical hypertrophy/
 * strength sessions (same "deterministic default now, refinable later"
 * rationale as NEAT_BASELINE_CALORIES below), not a precise physiological
 * cutoff. */
const LOAD_RATE_LIGHT_MAX = 0.5;
const LOAD_RATE_VIGOROUS_MIN = 1.5;

function resistanceMetForLoadRate(loadRatePerMin: number): number {
  if (loadRatePerMin < LOAD_RATE_LIGHT_MAX) return LIGHT_RESISTANCE_MET;
  if (loadRatePerMin > LOAD_RATE_VIGOROUS_MIN) return VIGOROUS_RESISTANCE_MET;
  return MODERATE_RESISTANCE_MET;
}

/** Used only when a profile is missing the weight/height/age/sex a real BMR
 * needs — a population-average placeholder so the energy card still shows
 * something before onboarding collects full body stats, rather than
 * blocking on them. computeDailyEnergyTotals flags when this was used via
 * `hasEnoughProfileData`, so callers can caveat the number if they want to. */
const FALLBACK_BMR = 1600;

export function calculateAge(birthDate: string, asOf: Date = new Date()): number {
  const birth = new Date(birthDate);
  let age = asOf.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    asOf.getMonth() > birth.getMonth() ||
    (asOf.getMonth() === birth.getMonth() && asOf.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * Mifflin-St Jeor — the standard BMR formula. Computed client-side and
 * deterministically, same posture as estimateCardioCalories in
 * cardioCalories.ts (see that file's own comment: this app's "AI Coach" is
 * already entirely rule-based, not LLM-based, for arithmetic like this).
 */
export function calculateBmr(params: { weightKg: number; heightCm: number; age: number; sex: Sex }): number {
  const base = 10 * params.weightKg + 6.25 * params.heightCm - 5 * params.age;
  return Math.round(params.sex === 'male' ? base + 5 : base - 161);
}

/** Same MET x bodyweight(kg) x duration(hours) shape as
 * estimateCardioCalories, reusing its SEX_ADJUSTMENT rather than
 * duplicating the male/female correction factor. */
export function estimateStrengthSessionCalories(params: {
  durationMinutes: number;
  weightKg: number;
  sex?: Sex | null;
  /** Total load moved this session — sum of loadKg * reps across completed,
   * non-warmup sets (same shape as WeeklyReviewResult.totalVolumeKg /
   * PostWorkoutSummaryResult.totalVolumeKg). When given, picks a lighter or
   * heavier MET tier off how dense that volume was relative to bodyweight
   * and session length, instead of always assuming one flat moderate-effort
   * MET — a light-weight technique day and a heavy, dense-volume day
   * shouldn't get the same estimate just because they ran the same length.
   * Omit (or pass null) to fall back to the flat moderate-effort MET, e.g.
   * for a day-level aggregate with no single session's volume to point to. */
  volumeKg?: number | null;
}): number {
  const hours = params.durationMinutes / 60;
  const adjustment = params.sex ? SEX_ADJUSTMENT[params.sex] : 1;
  const met =
    params.volumeKg != null && params.durationMinutes > 0 && params.weightKg > 0
      ? resistanceMetForLoadRate(params.volumeKg / params.weightKg / params.durationMinutes)
      : RESISTANCE_TRAINING_MET;
  return Math.round(met * params.weightKg * hours * adjustment);
}

export type StrengthSessionEnergyInput = {
  /** Minutes spent in this completed strength session (workout_logs with no
   * matching cardio_log_entries row) — from started_at/completed_at. */
  durationMinutes: number;
  /** workout_logs.estimated_calories, persisted once at completion time from
   * the athlete's body stats and that session's own volume (see
   * WorkoutSummaryScreen) — used as-is when present, so a browsed day's
   * total always matches exactly what that session's own summary showed.
   * Null for sessions saved before this existed (or too short/incomplete to
   * estimate), which fall back to a flat duration-only estimate instead. */
  estimatedCalories: number | null;
};

export type DailyEnergyTotalsParams = {
  /** Today's food_log_entries rows — raw snake_case fields, so callers can
   * pass query rows straight through with no adapter step. */
  foodEntries: Array<{ calories: number; protein_g: number; carbs_g: number; fat_g: number }>;
  /** Today's completed strength sessions (workout_logs with no matching
   * cardio_log_entries row) — one entry per session, not pre-summed, so each
   * can use its own persisted estimate instead of one flattened duration. */
  strengthSessions: StrengthSessionEnergyInput[];
  /** Sum of today's cardio_log_entries.estimated_calories — already a real
   * per-activity estimate, just totaled here. */
  cardioCalories: number;
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: Sex | null;
  goal: NutritionGoal;
};

export type DailyEnergyTotals = {
  caloriesIn: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  bmr: number;
  /** BMR + NEAT_BASELINE_CALORIES. */
  baseOut: number;
  /** Cardio + strength-session burn on top of baseOut. */
  workoutOut: number;
  caloriesOut: number;
  /** caloriesOut + the goal's target net — the intake that would hit the
   * goal exactly today. */
  targetIntake: number;
  net: number;
  remaining: number;
  /** False when weight/height/age/sex weren't all available and `bmr` fell
   * back to FALLBACK_BMR — lets the UI caveat the number instead of
   * presenting a population-average guess as a personalized one. */
  hasEnoughProfileData: boolean;
};

/**
 * Default macro targets for a user with no per-user macro plan yet: protein
 * at 1g per lb of bodyweight (the standard strength-training heuristic),
 * then the goal's own target calories split between carbs/fat by a typical
 * ratio. A placeholder in the same spirit as NEAT_BASELINE_CALORIES —
 * replaced by a real per-user macro plan in a later phase, not this one.
 */
export function computeMacroTargets(params: {
  weightKg: number | null;
  targetIntake: number;
  goal: NutritionGoal;
}): { proteinTargetG: number; carbsTargetG: number; fatTargetG: number } {
  const proteinTargetG = params.weightKg != null ? Math.round(kgToLb(params.weightKg)) : 150;
  const proteinCalories = proteinTargetG * 4;
  const remainingCalories = Math.max(0, params.targetIntake - proteinCalories);
  const fatTargetG = Math.round((remainingCalories * 0.35) / 9);
  const carbsTargetG = Math.round((remainingCalories * 0.65) / 4);
  return { proteinTargetG, carbsTargetG, fatTargetG };
}

export function computeDailyEnergyTotals(params: DailyEnergyTotalsParams): DailyEnergyTotals {
  const caloriesIn = params.foodEntries.reduce((sum, e) => sum + e.calories, 0);
  const proteinG = params.foodEntries.reduce((sum, e) => sum + e.protein_g, 0);
  const carbsG = params.foodEntries.reduce((sum, e) => sum + e.carbs_g, 0);
  const fatG = params.foodEntries.reduce((sum, e) => sum + e.fat_g, 0);

  const hasEnoughProfileData =
    params.weightKg != null && params.heightCm != null && params.age != null && params.sex != null;
  const bmr = hasEnoughProfileData
    ? calculateBmr({
        weightKg: params.weightKg as number,
        heightCm: params.heightCm as number,
        age: params.age as number,
        sex: params.sex as Sex,
      })
    : FALLBACK_BMR;

  const strengthCalories = params.strengthSessions.reduce((sum, session) => {
    if (session.estimatedCalories != null) return sum + session.estimatedCalories;
    if (params.weightKg == null || session.durationMinutes <= 0) return sum;
    return (
      sum +
      estimateStrengthSessionCalories({
        durationMinutes: session.durationMinutes,
        weightKg: params.weightKg,
        sex: params.sex,
      })
    );
  }, 0);

  const baseOut = bmr + NEAT_BASELINE_CALORIES;
  const workoutOut = params.cardioCalories + strengthCalories;
  const caloriesOut = baseOut + workoutOut;
  const targetIntake = caloriesOut + TARGET_NET_CALORIES_BY_GOAL[params.goal];
  const net = caloriesIn - caloriesOut;
  const remaining = targetIntake - caloriesIn;

  return {
    caloriesIn,
    proteinG,
    carbsG,
    fatG,
    bmr,
    baseOut,
    workoutOut,
    caloriesOut,
    targetIntake,
    net,
    remaining,
    hasEnoughProfileData,
  };
}
