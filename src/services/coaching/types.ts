import type { ExerciseE1rmHistory, LoggedSet, PrEvent } from '../api/queries/progress';
import type {
  AdaptationType,
  ExerciseCategory,
  ExerciseDifficulty,
  EquipmentType,
  MovementPattern,
  NutritionGoal,
  SetRecommendationType,
  StressLevel,
  UnitPreference,
  WorkoutVariantType,
} from '../../types/database';

export type ReadinessBand = 'high' | 'moderate' | 'low' | 'very_low';

export type ReadinessFactorKey =
  | 'sleep'
  | 'sleep_quality'
  | 'soreness'
  | 'stress'
  | 'pain'
  | 'notes'
  | 'training_load'
  | 'time_since_last_workout'
  | 'missed_workouts'
  | 'wearable_recovery';

export type ReadinessFactor = {
  key: ReadinessFactorKey;
  label: string;
  /** Whether this factor moved the score up, down, or was a wash. Drives the
   * "may be the main factor(s)" reasoning in the summary text — leave this
   * as the readiness-valence truth even when `displayImpact` overrides how
   * it's colored on screen. */
  impact: 'positive' | 'negative' | 'neutral';
  /** Which way the underlying metric itself is trending — independent of
   * `impact`. Most factors don't need this (their trend and their
   * readiness-valence point the same direction, e.g. low sleep is both a
   * downward trend and a negative impact), so it's optional and callers
   * fall back to `impact` for the display icon. Training load is the one
   * factor where they diverge: high recent volume is an upward trend but a
   * negative impact on predicted readiness, so it needs its own explicit
   * direction rather than borrowing impact's. */
  trend?: 'up' | 'down' | 'flat';
  /** Overrides `impact` for the display icon's color only — for factors
   * where "is this good news" reads differently from "did this help
   * predicted readiness." Training load is the one case: high recent volume
   * lowers predicted readiness (`impact: 'negative'`) but is still good news
   * to show green/up, not red/up — red is reserved for genuinely negative
   * changes (e.g. stress rising). Falls back to `impact` when unset. */
  displayImpact?: 'positive' | 'negative' | 'neutral';
  /** Relative contribution to the final score, 0..1. */
  weight: number;
  /** Human-readable detail, e.g. "Slept 5.5h — below your recent average." */
  detail: string;
  /** False when the underlying signal wasn't available (no check-in, no wearable yet). */
  available: boolean;
};

export type ReadinessResult = {
  /** 0-100. */
  score: number;
  band: ReadinessBand;
  /** Sorted by |weight| desc; the ones actually worth showing the user. */
  factors: ReadinessFactor[];
  recommendedIntensity: 'full' | 'reduced' | 'light' | 'recovery_only';
  recommendedRpeRange: [number, number];
  estimatedSessionQuality: 'excellent' | 'good' | 'fair' | 'poor';
  /** One-line, hedged ("appears," "may") explanation — never stated as fact. */
  summary: string;
  computedAt: string;
};

export type TrainingLoadClassification = 'low' | 'normal' | 'high' | 'unknown';

export type TrainingLoadResult = {
  acuteVolumeKg: number;
  chronicAvgVolumeKg: number;
  /** acute / chronic; null when there isn't enough history to compute one. */
  loadRatio: number | null;
  classification: TrainingLoadClassification;
};

export type PainRiskLevel = 'none' | 'low' | 'moderate' | 'severe';

export type PainRiskAssessment = {
  riskLevel: PainRiskLevel;
  recommendation: string;
  /** True on warning-sign language (chest pain, dizziness, fainting, ...). */
  stopAndSeekMedicalAttention: boolean;
};

export type ReadinessCheckinInput = {
  sleepHours: number | null;
  sleepQuality: number | null;
  soreness: number | null;
  stress: number | null;
  hasPain: boolean;
  painNotes: string | null;
  /** Raw free text from Home's Quick Check-in, kept separate from
   * `painNotes` (which is specifically "where does it hurt") — this is
   * whatever the athlete actually typed, quoted back in the today-focus
   * summary so the AI-parsed check-in still surfaces in their own words. */
  notes: string | null;
} | null;

export type WearableReadinessInput = {
  /** Which wearable this reading came from — Whoop's recovery_score and
   * Oura's readiness_score are directly analogous (both 0-100 "how ready am
   * I" scores), so they share this one input shape rather than each having
   * their own; the source tag is what lets downstream code (detail text,
   * chat prompts) speak accurately about which wearable is being reported. */
  source: 'whoop' | 'oura';
  /** 0-100. Whoop's recovery_score, or Oura's readiness_score. */
  recoveryScore: number;
  /** Whoop's sleep_performance_pct, or Oura's sleep_score. */
  sleepPerformancePct: number | null;
  /** Whoop-only (workout exertion) — always null for Oura, which has no
   * equivalent metric. */
  strain: number | null;
  /** Everything below is Whoop-only (whoop_metrics — see
   * 0025_whoop_metrics.sql / 0074_whoop_sleep_detail.sql) — Oura has its own
   * differently-shaped sleep/biometric data that isn't threaded through here
   * yet, so these are always null for an Oura reading. All optional so
   * existing callers building this object don't need to change. Not used in
   * evaluateReadiness's deduction math (that stays scoped to
   * recovery/sleep/strain, the same three signals it's always used) — these
   * exist so the richer narrative (detail text, chat-coach's prompt) can
   * mention them; the LLM reasons over the raw numbers itself rather than
   * this app hand-coding new deduction thresholds for each one. */
  hrvMs?: number | null;
  restingHeartRate?: number | null;
  sleepEfficiencyPct?: number | null;
  sleepConsistencyPct?: number | null;
  respiratoryRate?: number | null;
  remSleepMinutes?: number | null;
  deepSleepMinutes?: number | null;
  lightSleepMinutes?: number | null;
  awakeMinutes?: number | null;
  sleepDebtMinutes?: number | null;
  spo2Pct?: number | null;
  skinTempCelsius?: number | null;
} | null;

export type ReadinessInputs = {
  checkin: ReadinessCheckinInput;
  wearable: WearableReadinessInput;
  trainingLoad: TrainingLoadResult;
  daysSinceLastWorkout: number | null;
  missedWorkoutsLast14Days: number;
  /** Trailing average of `soreness` from the athlete's recent check-ins
   * (today excluded) — lets the soreness factor tell whether today's rating
   * is trending up or down instead of only looking at today's absolute
   * value. Null with too little check-in history to form a baseline. */
  priorAverageSoreness: number | null;
};

export type AdaptationExerciseTarget = {
  exerciseId: string;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoadKg: number | null;
  targetRpe: number | null;
  restSeconds: number | null;
};

export type AdaptationChange = {
  /** Client-side id, stable for the review session, before persistence. */
  id: string;
  adaptationType: AdaptationType;
  targetExerciseId: string | null;
  fieldChanged: string;
  originalValue: unknown;
  updatedValue: unknown;
  reason: string;
  confidence: number;
  source: 'rule_engine' | 'ai' | 'user';
};

export type AdaptScheduledWorkoutParams = {
  exercises: AdaptationExerciseTarget[];
  readiness: ReadinessResult;
  painRisk: PainRiskAssessment;
};

export type CompletedSetInfo = {
  setNumber: number;
  reps: number;
  loadKg: number | null;
  rpe: number | null;
};

export type SetRecommendation = {
  /** Client-side id, stable for the review session, before persistence. */
  id: string;
  type: SetRecommendationType;
  recommendedReps: number | null;
  recommendedLoadKg: number | null;
  recommendedRpe: number | null;
  recommendedRestSeconds: number | null;
  reason: string;
  confidence: number;
  source: 'rule_engine' | 'ai' | 'user';
};

export type RecommendNextSetParams = {
  target: AdaptationExerciseTarget;
  /** Chronological, completed, non-warmup working sets for this exercise so far — the just-completed set is the last element. */
  completedSets: CompletedSetInfo[];
  /** The set number the recommendation would apply to, or null if none remain. */
  nextSetNumber: number | null;
  /** What that next set is already configured to show, before any
   * recommendation is applied — every set is prefilled from the exercise's
   * own targets (buildDraftSets), so a reps/weight recommendation that
   * exactly matches these isn't recommending a change at all; it's just
   * restating the plan back. Used to suppress that case rather than show a
   * no-op "recommendation". */
  nextSetCurrentReps: number | null;
  nextSetCurrentLoadKg: number | null;
  readinessBand: ReadinessBand | null;
  /** Determines the plate increment a weight change is rounded to (5 lb vs 2.5 kg). */
  unitPref: UnitPreference;
};

export type ExerciseMetadata = {
  id: string;
  name: string;
  category: ExerciseCategory;
  primaryMuscle: string;
  secondaryMuscles: string[];
  equipment: EquipmentType;
  movementPattern: MovementPattern | null;
  difficulty: ExerciseDifficulty | null;
  jointStress: StressLevel | null;
  skillRequirement: StressLevel | null;
};

export type SubstitutionMatchSignal = 'movement_pattern' | 'primary_muscle' | 'category' | 'secondary_muscle';

export type ExerciseSubstitution = {
  /** Client-side id, stable for the review session, before persistence. */
  id: string;
  exerciseId: string;
  exerciseName: string;
  reason: string;
  confidence: number;
  matchedOn: SubstitutionMatchSignal[];
};

export type RecommendSubstitutionParams = {
  exercise: ExerciseMetadata;
  candidates: ExerciseMetadata[];
  /** null means unrestricted (e.g. browsing alternatives, not a live equipment gap). */
  availableEquipment: EquipmentType[] | null;
  /** The specific equipment that's unavailable right now, if that's what triggered this — always excluded regardless of availableEquipment. */
  excludeEquipment?: EquipmentType;
};

export type VariantSourceExercise = {
  metadata: ExerciseMetadata;
  target: AdaptationExerciseTarget;
};

export type WorkoutVariantChangeType =
  | 'kept'
  | 'sets_reduced'
  | 'reps_adjusted'
  | 'rpe_adjusted'
  | 'rest_adjusted'
  | 'substituted'
  | 'dropped';

export type WorkoutVariantChange = {
  /** The *original* exercise's id — stable even when the exercise was substituted or dropped. */
  exerciseId: string;
  type: WorkoutVariantChangeType;
  reason: string;
};

export type WorkoutVariantExercise = {
  exerciseId: string;
  exerciseName: string;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoadKg: number | null;
  targetRpe: number | null;
  restSeconds: number | null;
};

export type WorkoutVariantResult = {
  variantType: WorkoutVariantType;
  label: string;
  summary: string;
  estimatedMinutes: number;
  exercises: WorkoutVariantExercise[];
  /** One entry per original exercise, always present — including unchanged ones. */
  changes: WorkoutVariantChange[];
};

export type GenerateWorkoutVariantParams = {
  source: VariantSourceExercise[];
  variantType: WorkoutVariantType;
  candidates: ExerciseMetadata[];
  /** The user's own equipment (profiles.equipment_access) — used by the 'home' variant, and as a relevance signal elsewhere. */
  availableEquipment: EquipmentType[] | null;
};

export type PostWorkoutExerciseInput = {
  exerciseId: string;
  exerciseName: string;
  targetRpe: number | null;
  sets: Array<{ reps: number; loadKg: number | null; rpe: number | null }>;
};

export type ExercisePerformanceDelta = {
  exerciseId: string;
  exerciseName: string;
  direction: 'improved' | 'declined';
  detail: string;
};

export type RpeAdherence = {
  ratedSetCount: number;
  /** actual - target, averaged over sets with both values; null when no set has both. */
  averageDelta: number | null;
  onTargetSetCount: number;
};

export type RecoveryNeed = 'normal' | 'light_next_session' | 'extra_rest';

export type PostWorkoutBestSet = {
  exerciseId: string;
  exerciseName: string;
  loadKg: number;
  reps: number;
  e1rm: number;
};

export type PostWorkoutSummaryResult = {
  totalVolumeKg: number;
  /** null when none of this session's exercises have prior-session data to compare against. */
  volumeChangeKg: number | null;
  volumeChangePercent: number | null;
  newPersonalRecords: PrEvent[];
  bestSet: PostWorkoutBestSet | null;
  improvedExercises: ExercisePerformanceDelta[];
  declinedExercises: ExercisePerformanceDelta[];
  rpeAdherence: RpeAdherence;
  /** null when no pre-workout readiness data is available for today. */
  readinessVsPerformance: string | null;
  estimatedRecoveryNeeds: RecoveryNeed;
  suggestedNextAction: string;
  /** null when nothing concerning was flagged. */
  painOrFatigueConcern: string | null;
  /** The synthesized, plain-language coaching note. */
  summary: string;
};

export type TodayPlanContext =
  | { kind: 'rest_day' }
  | { kind: 'cardio_day' }
  | { kind: 'training_day'; dayTitle: string | null; exerciseCount: number; isDeload: boolean }
  | { kind: 'scheduled'; name: string }
  | { kind: 'completed'; dayTitle: string | null }
  | { kind: 'none' };

export type GenerateTodayFocusSummaryParams = {
  /** null only when there's not enough signal to evaluate readiness at all. */
  readiness: ReadinessResult | null;
  plan: TodayPlanContext;
  /** daysAgo is 0 for a PR logged today, 1 for yesterday, etc. — the summary
   * text needs this to avoid claiming "today" for a PR that actually
   * happened earlier in the lookback window (see recentPr's computation in
   * TodayScreen, which looks back up to 6 days). sameCalendarWeek is a
   * separate check (Sun-Sat, matching WeekTimeline/streak elsewhere) since
   * "6 days ago" and "this calendar week" aren't the same thing — a PR from
   * 6 days ago can easily be last week, not this one, and the summary
   * shouldn't claim otherwise. */
  recentPr: { exerciseName: string; loadKg: number; reps: number; daysAgo: number; sameCalendarWeek: boolean } | null;
  missedYesterday: boolean;
  /** Whether a workout was logged yesterday — feeds the "recovered well"
   * remark, distinct from `missedYesterday` (which only fires when
   * yesterday was a required training day that got skipped). */
  completedYesterday: boolean;
  isMilestoneWeek: boolean;
  currentWeekNumber: number | null;
  weeksCount: number;
  streak: number;
};

export type TodayFocusSummaryResult = {
  /** Short label for the card, e.g. "Ready to train", "Take it easy today", "Rest day". */
  headline: string;
  /** The synthesized paragraph. */
  summary: string;
  /** null when readiness wasn't available — lets the UI skip a readiness-colored icon. */
  band: ReadinessBand | null;
};

export type GeneratePostWorkoutSummaryParams = {
  exercises: PostWorkoutExerciseInput[];
  /** exerciseId -> that exercise's total volume the last *other* time it was trained. Absent key = no prior data. */
  previousVolumeByExercise: Record<string, number>;
  /** exerciseId -> that exercise's best e1RM the last *other* time it was trained. Absent key = no prior data. */
  previousBestE1rmByExercise: Record<string, number>;
  sessionPrEvents: PrEvent[];
  readiness: ReadinessResult | null;
  trainingLoad: TrainingLoadResult;
  painRisk: PainRiskAssessment;
  /** Every weight figure worked into `summary`/`shareableSummary` text
   * converts through this — the engine's own inputs/outputs otherwise stay
   * in kg (its one internal unit), same as the rest of the app. */
  unitPref: UnitPreference;
};

export type MuscleGroupVolume = { muscle: string; volumeKg: number };

export type ExerciseImprovement = {
  exerciseId: string;
  exerciseName: string;
  changePercent: number;
};

export type ExerciseInconsistency = {
  exerciseId: string;
  exerciseName: string;
  detail: string;
};

export type WeeklySetInput = {
  exerciseId: string;
  exerciseName: string;
  primaryMuscle: string;
  reps: number;
  loadKg: number | null;
};

export type WeeklyCheckinInput = {
  date: string;
  sleepHours: number | null;
  soreness: number | null;
  stress: number | null;
  hasPain: boolean;
  painNotes: string | null;
  /** Pre-computed by the caller via evaluateReadiness on that day's check-in alone (other inputs marked unavailable — not re-derived for past days). */
  readinessScore: number;
};

export type WeeklyReviewResult = {
  weekStart: string;
  weekEnd: string;
  workoutsCompleted: number;
  workoutsMissed: number;
  /** null when no training days were planned this week. */
  consistencyPercent: number | null;
  totalVolumeKg: number;
  /** Sorted descending by volume. */
  volumeByMuscleGroup: MuscleGroupVolume[];
  newPersonalRecords: PrEvent[];
  mostImprovedExercise: ExerciseImprovement | null;
  mostInconsistentExercise: ExerciseInconsistency | null;
  averageReadinessScore: number | null;
  averageSleepHours: number | null;
  averageSoreness: number | null;
  averageStress: number | null;
  painReportCount: number;
  trainingLoadClassification: TrainingLoadClassification;
  /** A single one-week heuristic observation, not the cross-week pattern memory of a later phase. */
  habitObservation: string | null;
  recommendedChangesNextWeek: string;
  summary: string;
  /** Privacy-safe subset only — no readiness/sleep/soreness/stress/pain/per-exercise data. */
  shareableSummary: string;
};

export type GenerateWeeklyReviewParams = {
  weekStart: string;
  weekEnd: string;
  workoutsCompleted: number;
  workoutsMissed: number;
  weekSets: WeeklySetInput[];
  /** exerciseId -> best e1RM before weekStart. Absent key = no prior data. */
  priorBestE1rmByExercise: Record<string, number>;
  weekPrEvents: PrEvent[];
  checkins: WeeklyCheckinInput[];
  trainingLoad: TrainingLoadResult;
  /** Converts every weight figure worked into `summary`/`shareableSummary`/
   * `habitObservation` text — see GeneratePostWorkoutSummaryParams. */
  unitPref: UnitPreference;
};

export type ReadinessTrendDirection = 'up' | 'down' | 'flat';

/** null means insufficient qualifying history (< MIN_QUALIFYING_WEEKS out
 * of ROLLING_TREND_WEEKS), never fabricated as 'flat' — see
 * docs/coaching-history.md's "Multi-week trending" section. */
export type MetricTrend = {
  direction: ReadinessTrendDirection;
  currentValue: number;
  /** Mean of the qualifying prior weeks. */
  baselineValue: number;
  qualifyingWeeks: number;
} | null;

export type ReadinessTrendResult = {
  readiness: MetricTrend;
  sleep: MetricTrend;
  soreness: MetricTrend;
  stress: MetricTrend;
};

/** One persisted week's four averages — a narrow projection of
 * WeeklyReviewResult (not the whole persisted row), since trending only
 * ever needs these four numbers per week. */
export type WeeklyTrendPoint = {
  weekStart: string;
  averageReadinessScore: number | null;
  averageSleepHours: number | null;
  averageSoreness: number | null;
  averageStress: number | null;
};

export type CalculateReadinessTrendParams = {
  currentWeek: WeeklyTrendPoint;
  /** Up to ROLLING_TREND_WEEKS prior weeks, any order — the engine sorts
   * and windows internally. */
  priorWeeks: WeeklyTrendPoint[];
};

export type TrainingPatternType =
  | 'inconsistent_weekday'
  | 'declining_consistency'
  | 'recurring_pain'
  | 'rpe_creep'
  | 'low_sleep_pattern';

export type TrainingPattern = {
  /** Stable id for persistence/dismissal, e.g. "inconsistent_weekday:5" or "rpe_creep:<exerciseId>". */
  key: string;
  type: TrainingPatternType;
  /** 0..1, recomputed fresh each detection run from the current lookback window. */
  confidence: number;
  title: string;
  detail: string;
  evidenceSummary: string;
};

export type WeeklyPatternSnapshot = {
  weekStart: string;
  consistencyPercent: number | null;
  painReportCount: number;
  averageSleepHours: number | null;
};

export type MissedWeekdayInput = {
  /** 0 = Sunday .. 6 = Saturday, matching Date#getDay(). */
  weekday: number;
  opportunities: number;
  missed: number;
};

export type ExerciseRpeTrendInput = {
  exerciseId: string;
  exerciseName: string;
  /** Chronological (oldest -> newest) working-set RPE/load pairs over the lookback window. */
  sessions: Array<{ rpe: number; loadKg: number | null }>;
};

export type DetectTrainingPatternsParams = {
  /** Oldest -> newest. */
  weeklySnapshots: WeeklyPatternSnapshot[];
  missedWeekdays: MissedWeekdayInput[];
  exerciseRpeTrends: ExerciseRpeTrendInput[];
  /** Pattern keys the user has already dismissed — excluded from the output entirely. */
  dismissedKeys: string[];
};

export type PrPrediction = {
  exerciseId: string;
  exerciseName: string;
  currentBestE1rm: number;
  predictedE1rm: number;
  /** ISO date (yyyy-MM-dd), asOf + the fixed prediction horizon. */
  targetDate: string;
  /** 0..1, the regression fit's clamped R². */
  confidence: number;
  /** Hedged, non-guaranteed "Future You" framing — "could," "at this pace," never a promise. */
  summary: string;
};

export type PredictPersonalRecordsParams = {
  exerciseHistories: ExerciseE1rmHistory[];
  /** ISO date (yyyy-MM-dd) to project forward from — explicit for determinism, not `new Date()` inside the engine. */
  asOf: string;
  /** Converts the projected e1RM worked into each prediction's `summary` text. */
  unitPref: UnitPreference;
};

export type ExerciseExplanationResult = {
  /** Why this exercise is worth doing — the "why am I doing this" cue. */
  purpose: string;
  progressionCriteria: string;
  regressionCriteria: string;
};

export type GenerateExerciseExplanationParams = {
  exercise: ExerciseMetadata;
};

export type GenerateEnergySummaryParams = {
  goal: NutritionGoal;
  caloriesIn: number;
  caloriesOut: number;
  net: number;
  /** caloriesOut + the goal's target net — see computeDailyEnergyTotals. */
  targetIntake: number;
  proteinG: number;
  proteinTargetG: number;
  /** How many food_log_entries exist today — 0 means nothing logged yet, a
   * different opening line than "logged but off pace". */
  entriesLoggedToday: number;
  /** True once it's locally evening and no entry looks like a dinner/evening
   * meal yet — the same "it's getting late" framing StreakRiskNudge uses for
   * training, applied to the day's last expected meal instead. */
  hasEveningMealGap: boolean;
};

export type EnergySummaryResult = {
  /** Short label for the card, e.g. "ON TRACK", "OFF TRACK", "Nothing logged yet". */
  headline: string;
  /** The synthesized sentence or two. */
  body: string;
};

/**
 * The UI depends on this interface, never on a specific engine implementation
 * or AI provider directly. A later phase (generateVoiceCue) extends this
 * same interface as it's built, rather than replacing it.
 */
export interface CoachingEngine {
  evaluateReadiness(inputs: ReadinessInputs): ReadinessResult;
  calculateTrainingLoad(sets: LoggedSet[], asOf?: Date): TrainingLoadResult;
  assessPainRisk(hasPain: boolean, painNotes: string | null): PainRiskAssessment;
  adaptScheduledWorkout(params: AdaptScheduledWorkoutParams): AdaptationChange[];
  recommendNextSet(params: RecommendNextSetParams): SetRecommendation | null;
  recommendExerciseSubstitution(params: RecommendSubstitutionParams): ExerciseSubstitution[];
  generateWorkoutVariant(params: GenerateWorkoutVariantParams): WorkoutVariantResult;
  generateTodayFocusSummary(params: GenerateTodayFocusSummaryParams): TodayFocusSummaryResult;
  generatePostWorkoutSummary(params: GeneratePostWorkoutSummaryParams): PostWorkoutSummaryResult;
  generateWeeklyReview(params: GenerateWeeklyReviewParams): WeeklyReviewResult;
  calculateReadinessTrend(params: CalculateReadinessTrendParams): ReadinessTrendResult;
  detectTrainingPatterns(params: DetectTrainingPatternsParams): TrainingPattern[];
  predictPersonalRecords(params: PredictPersonalRecordsParams): PrPrediction[];
  generateExerciseExplanation(params: GenerateExerciseExplanationParams): ExerciseExplanationResult;
  generateEnergySummary(params: GenerateEnergySummaryParams): EnergySummaryResult;
}
