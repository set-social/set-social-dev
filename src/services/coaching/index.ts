import { featureFlags } from '../../config/featureFlags';
import { LocalCoachingEngine } from './engine';
import type {
  AdaptScheduledWorkoutParams,
  AdaptationChange,
  CalculateReadinessTrendParams,
  CoachingEngine,
  DetectTrainingPatternsParams,
  EnergySummaryResult,
  ExerciseExplanationResult,
  ExerciseSubstitution,
  GenerateEnergySummaryParams,
  GenerateExerciseExplanationParams,
  GeneratePostWorkoutSummaryParams,
  GenerateTodayFocusSummaryParams,
  GenerateWeeklyReviewParams,
  GenerateWorkoutVariantParams,
  PostWorkoutSummaryResult,
  PredictPersonalRecordsParams,
  PrPrediction,
  ReadinessTrendResult,
  RecommendNextSetParams,
  RecommendSubstitutionParams,
  SetRecommendation,
  TodayFocusSummaryResult,
  TrainingPattern,
  WeeklyReviewResult,
  WorkoutVariantResult,
} from './types';

const localEngine = new LocalCoachingEngine();

/**
 * The engine instance the UI depends on. This is the single swap point for a
 * future remote/AI-backed implementation — call sites never import
 * LocalCoachingEngine directly.
 */
export const coachingEngine: CoachingEngine = {
  evaluateReadiness: inputs => localEngine.evaluateReadiness(inputs),
  calculateTrainingLoad: (sets, asOf) => localEngine.calculateTrainingLoad(sets, asOf),
  assessPainRisk: (hasPain, painNotes) => localEngine.assessPainRisk(hasPain, painNotes),
  adaptScheduledWorkout: (params: AdaptScheduledWorkoutParams): AdaptationChange[] =>
    featureFlags.recoveryAdaptation ? localEngine.adaptScheduledWorkout(params) : [],
  recommendNextSet: (params: RecommendNextSetParams): SetRecommendation | null =>
    featureFlags.aiCoaching ? localEngine.recommendNextSet(params) : null,
  recommendExerciseSubstitution: (params: RecommendSubstitutionParams): ExerciseSubstitution[] =>
    featureFlags.aiCoaching ? localEngine.recommendExerciseSubstitution(params) : [],
  generateWorkoutVariant: (params: GenerateWorkoutVariantParams): WorkoutVariantResult =>
    localEngine.generateWorkoutVariant(
      featureFlags.aiCoaching ? params : { ...params, variantType: 'full' },
    ),
  generateTodayFocusSummary: (params: GenerateTodayFocusSummaryParams): TodayFocusSummaryResult =>
    featureFlags.aiCoaching
      ? localEngine.generateTodayFocusSummary(params)
      : { headline: '', summary: '', band: null },
  generatePostWorkoutSummary: (params: GeneratePostWorkoutSummaryParams): PostWorkoutSummaryResult =>
    localEngine.generatePostWorkoutSummary(
      featureFlags.aiCoaching
        ? params
        : {
            ...params,
            previousVolumeByExercise: {},
            previousBestE1rmByExercise: {},
            sessionPrEvents: [],
            readiness: null,
            painRisk: { riskLevel: 'none', recommendation: '', stopAndSeekMedicalAttention: false },
          },
    ),
  generateWeeklyReview: (params: GenerateWeeklyReviewParams): WeeklyReviewResult =>
    localEngine.generateWeeklyReview(
      featureFlags.aiCoaching
        ? params
        : { ...params, priorBestE1rmByExercise: {}, checkins: [] },
    ),
  calculateReadinessTrend: (params: CalculateReadinessTrendParams): ReadinessTrendResult =>
    featureFlags.coachingHistory
      ? localEngine.calculateReadinessTrend(params)
      : { readiness: null, sleep: null, soreness: null, stress: null },
  detectTrainingPatterns: (params: DetectTrainingPatternsParams): TrainingPattern[] =>
    featureFlags.coachingMemory ? localEngine.detectTrainingPatterns(params) : [],
  predictPersonalRecords: (params: PredictPersonalRecordsParams): PrPrediction[] =>
    featureFlags.predictivePersonalRecords ? localEngine.predictPersonalRecords(params) : [],
  generateExerciseExplanation: (params: GenerateExerciseExplanationParams): ExerciseExplanationResult =>
    featureFlags.exerciseIntelligence
      ? localEngine.generateExerciseExplanation(params)
      : { purpose: '', progressionCriteria: '', regressionCriteria: '' },
  generateEnergySummary: (params: GenerateEnergySummaryParams): EnergySummaryResult =>
    featureFlags.nutritionTracking ? localEngine.generateEnergySummary(params) : { headline: '', body: '' },
};

export * from './types';
