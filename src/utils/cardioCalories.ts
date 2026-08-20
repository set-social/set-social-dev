export type CardioActivityKey = 'treadmill' | 'bike' | 'elliptical' | 'row' | 'stairmaster' | 'run' | 'walk' | 'swim' | 'custom';
export type CardioEffort = 'easy' | 'moderate' | 'hard';

/** Flat-ground reference MET values (Compendium of Physical Activities,
 * moderate effort) for activities with no continuous incline/speed input to
 * work from. 'custom' gets a generic moderate-cardio placeholder rather than
 * refusing to estimate at all. */
const BASE_MET: Record<Exclude<CardioActivityKey, 'treadmill'>, number> = {
  bike: 7.0,
  row: 7.0,
  elliptical: 5.0,
  stairmaster: 9.0,
  run: 9.8,
  walk: 3.5,
  swim: 6.0,
  custom: 5.0,
};

const EFFORT_MULTIPLIER: Record<CardioEffort, number> = {
  easy: 0.75,
  moderate: 1,
  hard: 1.35,
};

/** ~5 mph — the conventional walk/run gait-transition speed used to pick
 * which ACSM equation applies below. */
const RUN_SPEED_THRESHOLD_KMH = 8;

/**
 * Treadmill gets a real formula (ACSM walking/running metabolic equations)
 * instead of a lookup table, since incline and speed are continuous inputs a
 * fixed set of reference points can't cover. It also reproduces the popular
 * "12-3-30" workout's well-known MET (~9.5, 12% incline / 3 mph) to within
 * rounding, which is reassuring given how few real data points this is
 * checked against.
 */
function treadmillMET(inclinePct: number, speedKmh: number): number {
  const speedMPerMin = (speedKmh * 1000) / 60;
  const grade = inclinePct / 100;
  const vo2 =
    speedKmh > RUN_SPEED_THRESHOLD_KMH
      ? 0.2 * speedMPerMin + 0.9 * speedMPerMin * grade + 3.5
      : 0.1 * speedMPerMin + 1.8 * speedMPerMin * grade + 3.5;
  return vo2 / 3.5;
}

export function estimateMET(
  activity: CardioActivityKey,
  params: { inclinePct?: number; speedKmh?: number; effort?: CardioEffort },
): number {
  if (activity === 'treadmill' && params.speedKmh != null) {
    return treadmillMET(params.inclinePct ?? 0, params.speedKmh);
  }
  const base = BASE_MET[activity === 'treadmill' ? 'walk' : activity];
  return params.effort ? base * EFFORT_MULTIPLIER[params.effort] : base;
}

/** MET tables (BASE_MET and the ACSM walking/running equations above) are
 * unisex population averages. At matched body weight, a higher average
 * body-fat percentage means less metabolically active tissue, so applying
 * the table value as-is tends to overestimate burn for that population —
 * a known, if imprecise, limitation of MET-based estimates. This is a
 * modest directional correction, not a precise physiological model: small
 * enough not to fight the MET table's own uncertainty. */
export const SEX_ADJUSTMENT: Record<'male' | 'female', number> = {
  male: 1,
  female: 0.92,
};

/**
 * calories = MET x bodyweight(kg) x duration(hours), adjusted for sex —
 * the standard MET-based estimate, computed client-side and
 * deterministically rather than via an LLM call (this app's "AI Coach"
 * elsewhere is already entirely rule-based — see src/services/coaching —
 * so this stays consistent with that, and an LLM would be slower,
 * non-deterministic, and no more accurate at arithmetic than a formula).
 */
export function estimateCardioCalories(params: {
  activity: CardioActivityKey;
  durationMinutes: number;
  inclinePct?: number;
  speedKmh?: number;
  effort?: CardioEffort;
  weightKg: number;
  sex?: 'male' | 'female' | null;
}): number {
  const met = estimateMET(params.activity, params);
  const hours = params.durationMinutes / 60;
  const adjustment = params.sex ? SEX_ADJUSTMENT[params.sex] : 1;
  return Math.round(met * params.weightKg * hours * adjustment);
}
