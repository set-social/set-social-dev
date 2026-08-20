import { addDays, differenceInCalendarDays, format, subDays } from 'date-fns';
import { estimateOneRepMax } from '../api/queries/progress';
import type { LoggedSet, PrEvent } from '../api/queries/progress';
import { estimateWorkoutMinutes } from '../../utils/workoutTiming';
import { formatVolume, formatWeight, roundDeltaToPlateIncrement, unitLabel } from '../../utils/units';
import type { EquipmentType, ExerciseCategory, MovementPattern, UnitPreference, WorkoutVariantType } from '../../types/database';
import type {
  AdaptationChange,
  AdaptationExerciseTarget,
  AdaptScheduledWorkoutParams,
  CalculateReadinessTrendParams,
  CoachingEngine,
  DetectTrainingPatternsParams,
  ExerciseExplanationResult,
  ExerciseImprovement,
  ExerciseInconsistency,
  ExerciseMetadata,
  ExercisePerformanceDelta,
  ExerciseRpeTrendInput,
  ExerciseSubstitution,
  EnergySummaryResult,
  GenerateEnergySummaryParams,
  GenerateExerciseExplanationParams,
  GeneratePostWorkoutSummaryParams,
  GenerateTodayFocusSummaryParams,
  GenerateWeeklyReviewParams,
  GenerateWorkoutVariantParams,
  MissedWeekdayInput,
  MuscleGroupVolume,
  PainRiskAssessment,
  PredictPersonalRecordsParams,
  PrPrediction,
  PostWorkoutBestSet,
  PostWorkoutSummaryResult,
  ReadinessBand,
  ReadinessFactor,
  ReadinessInputs,
  ReadinessResult,
  ReadinessTrendDirection,
  ReadinessTrendResult,
  MetricTrend,
  RecommendNextSetParams,
  RecommendSubstitutionParams,
  RecoveryNeed,
  RpeAdherence,
  SetRecommendation,
  SubstitutionMatchSignal,
  TodayFocusSummaryResult,
  TrainingLoadClassification,
  TrainingLoadResult,
  TrainingPattern,
  WeeklyPatternSnapshot,
  WeeklyReviewResult,
  WorkoutVariantChange,
  WorkoutVariantExercise,
  WorkoutVariantResult,
} from './types';

const SEVERE_PAIN_KEYWORDS = [
  'chest pain',
  'dizzy',
  'dizziness',
  'faint',
  'fainting',
  "can't breathe",
  'cannot breathe',
  'numbness',
  'numb',
  'shortness of breath',
];

/** Minimum gap between today's soreness rating and the recent baseline
 * before it counts as a real trend rather than day-to-day noise — a 1-point
 * wobble on a 1-5 scale shouldn't flip the arrow. */
const SORENESS_TREND_THRESHOLD = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function bandLabel(band: ReadinessBand): string {
  switch (band) {
    case 'high':
      return 'strong';
    case 'moderate':
      return 'moderate';
    case 'low':
      return 'lower than usual';
    case 'very_low':
      return 'very low';
  }
}

function bandFromScore(score: number): ReadinessBand {
  if (score >= 80) return 'high';
  if (score >= 60) return 'moderate';
  if (score >= 40) return 'low';
  return 'very_low';
}

export class LocalCoachingEngine implements CoachingEngine {
  calculateTrainingLoad(sets: LoggedSet[], asOf: Date = new Date()): TrainingLoadResult {
    const acuteStart = subDays(asOf, 7);
    const chronicStart = subDays(asOf, 35);

    let acuteVolumeKg = 0;
    let chronicVolumeKg = 0;
    let hasChronicHistory = false;

    for (const set of sets) {
      if (set.loadKg == null) continue;
      const loggedAt = new Date(set.loggedAt);
      const volume = set.loadKg * set.reps;
      if (loggedAt >= acuteStart && loggedAt <= asOf) {
        acuteVolumeKg += volume;
      } else if (loggedAt >= chronicStart && loggedAt < acuteStart) {
        chronicVolumeKg += volume;
        hasChronicHistory = true;
      }
    }

    const chronicAvgVolumeKg = hasChronicHistory ? chronicVolumeKg / 4 : 0;
    const loadRatio = hasChronicHistory && chronicAvgVolumeKg > 0 ? acuteVolumeKg / chronicAvgVolumeKg : null;

    let classification: TrainingLoadResult['classification'] = 'unknown';
    if (loadRatio != null) {
      if (loadRatio < 0.8) classification = 'low';
      else if (loadRatio <= 1.3) classification = 'normal';
      else classification = 'high';
    }

    return { acuteVolumeKg, chronicAvgVolumeKg, loadRatio, classification };
  }

  assessPainRisk(hasPain: boolean, painNotes: string | null): PainRiskAssessment {
    if (!hasPain) {
      return { riskLevel: 'none', recommendation: 'No pain reported.', stopAndSeekMedicalAttention: false };
    }

    const normalizedNotes = (painNotes ?? '').toLowerCase();
    const matchesSevereKeyword = SEVERE_PAIN_KEYWORDS.some(keyword => normalizedNotes.includes(keyword));

    if (matchesSevereKeyword) {
      return {
        riskLevel: 'severe',
        recommendation:
          'What you described includes warning-sign symptoms (e.g. chest pain, dizziness, fainting, numbness). ' +
          'Stop this workout and seek appropriate medical attention. This is informational and not medical advice.',
        stopAndSeekMedicalAttention: true,
      };
    }

    if (normalizedNotes.length === 0) {
      return {
        riskLevel: 'low',
        recommendation: 'Pain reported without detail — go easy on the affected area and stop if it worsens.',
        stopAndSeekMedicalAttention: false,
      };
    }

    return {
      riskLevel: 'moderate',
      recommendation:
        'Pain reported today. Consider training around the affected area or reducing intensity. ' +
        'This is informational and not medical advice — see a professional if pain persists or worsens.',
      stopAndSeekMedicalAttention: false,
    };
  }

  evaluateReadiness(inputs: ReadinessInputs): ReadinessResult {
    const factors: ReadinessFactor[] = [];
    let deduction = 0;

    const checkin = inputs.checkin;

    // Sleep duration.
    if (checkin?.sleepHours != null) {
      const hours = checkin.sleepHours;
      let sleepDeduction = 0;
      if (hours < 5) sleepDeduction = 20;
      else if (hours < 6) sleepDeduction = 12;
      else if (hours < 7) sleepDeduction = 6;
      else if (hours <= 9) sleepDeduction = 0;
      else sleepDeduction = 3;
      deduction += sleepDeduction;
      factors.push({
        key: 'sleep',
        label: 'Sleep duration',
        impact: sleepDeduction > 0 ? 'negative' : 'neutral',
        weight: clamp(sleepDeduction / 100, 0, 1),
        detail: `Slept ${hours}h last night.`,
        available: true,
      });
    } else {
      factors.push({
        key: 'sleep',
        label: 'Sleep duration',
        impact: 'neutral',
        weight: 0,
        detail: 'No sleep data logged today.',
        available: false,
      });
    }

    // Sleep quality.
    if (checkin?.sleepQuality != null) {
      const qualityDeduction = clamp((5 - checkin.sleepQuality) * 2.5, 0, 10);
      deduction += qualityDeduction;
      factors.push({
        key: 'sleep_quality',
        label: 'Sleep quality',
        impact: qualityDeduction > 0 ? 'negative' : 'neutral',
        weight: clamp(qualityDeduction / 100, 0, 1),
        detail: `Self-rated sleep quality: ${checkin.sleepQuality}/5.`,
        available: true,
      });
    } else {
      factors.push({
        key: 'sleep_quality',
        label: 'Sleep quality',
        impact: 'neutral',
        weight: 0,
        detail: 'No sleep quality rating logged today.',
        available: false,
      });
    }

    // Soreness.
    if (checkin?.soreness != null) {
      const sorenessDeduction = clamp((checkin.soreness - 1) * 3.75, 0, 15);
      deduction += sorenessDeduction;

      // Trend compares today's rating against the recent baseline, not
      // today's absolute value against zero — soreness that's real but
      // improving should read as green/down, not red. `impact` above stays
      // tied to the absolute rating (still a genuine drag on today's
      // predicted readiness either way); only the display reads off trend.
      const priorAvg = inputs.priorAverageSoreness;
      let sorenessTrend: ReadinessFactor['trend'];
      let sorenessDisplayImpact: ReadinessFactor['displayImpact'];
      if (priorAvg != null) {
        const delta = checkin.soreness - priorAvg;
        if (delta >= SORENESS_TREND_THRESHOLD) {
          sorenessTrend = 'up';
          sorenessDisplayImpact = 'negative';
        } else if (delta <= -SORENESS_TREND_THRESHOLD) {
          sorenessTrend = 'down';
          sorenessDisplayImpact = 'positive';
        } else {
          sorenessTrend = 'flat';
          sorenessDisplayImpact = 'neutral';
        }
      }

      factors.push({
        key: 'soreness',
        label: 'Muscle soreness',
        impact: sorenessDeduction > 0 ? 'negative' : 'neutral',
        displayImpact: sorenessDisplayImpact,
        trend: sorenessTrend,
        weight: clamp(sorenessDeduction / 100, 0, 1),
        detail:
          priorAvg != null
            ? `Self-rated soreness: ${checkin.soreness}/5 (recent average ${priorAvg.toFixed(1)}/5).`
            : `Self-rated soreness: ${checkin.soreness}/5.`,
        available: true,
      });
    } else {
      factors.push({
        key: 'soreness',
        label: 'Muscle soreness',
        impact: 'neutral',
        weight: 0,
        detail: 'No soreness rating logged today.',
        available: false,
      });
    }

    // Stress.
    if (checkin?.stress != null) {
      const stressDeduction = clamp((checkin.stress - 1) * 2.5, 0, 10);
      deduction += stressDeduction;
      factors.push({
        key: 'stress',
        label: 'Stress level',
        impact: stressDeduction > 0 ? 'negative' : 'neutral',
        weight: clamp(stressDeduction / 100, 0, 1),
        detail: `Self-rated stress: ${checkin.stress}/5.`,
        available: true,
      });
    } else {
      factors.push({
        key: 'stress',
        label: 'Stress level',
        impact: 'neutral',
        weight: 0,
        detail: 'No stress rating logged today.',
        available: false,
      });
    }

    // Pain.
    const painRisk = this.assessPainRisk(checkin?.hasPain ?? false, checkin?.painNotes ?? null);
    const painDeductionMap: Record<typeof painRisk.riskLevel, number> = {
      none: 0,
      low: 10,
      moderate: 20,
      severe: 35,
    };
    const painDeduction = checkin ? painDeductionMap[painRisk.riskLevel] : 0;
    deduction += painDeduction;
    factors.push({
      key: 'pain',
      label: 'Reported pain',
      impact: painDeduction > 0 ? 'negative' : 'neutral',
      weight: clamp(painDeduction / 100, 0, 1),
      detail: checkin?.hasPain ? painRisk.recommendation : 'No pain reported today.',
      available: checkin != null,
    });

    // Free-text notes from Home's Quick Check-in. Purely informational —
    // there's no reliable rule-based way to score arbitrary prose, so this
    // never contributes to the deduction — it exists so the athlete's own
    // words show up in the readiness breakdown and today-focus summary
    // (see buildTodayFocusSummaryText), instead of being discarded once the
    // AI parse step has pulled the structured fields out of it.
    const rawNotes = checkin?.notes?.trim() || null;
    factors.push({
      key: 'notes',
      label: 'Your notes',
      impact: 'neutral',
      weight: 0,
      detail: rawNotes ? `"${rawNotes}"` : 'No notes added today.',
      available: rawNotes != null,
    });

    // Wearable recovery (Whoop or Oura). Thresholds below are Whoop's own
    // red/yellow/green recovery bands, reused as-is for Oura readiness too —
    // Oura doesn't publish its own prescriptive cutoffs the way Whoop does,
    // so borrowing Whoop's is a reasonable default rather than Oura's own
    // official bands; worth revisiting if Oura publishes guidance later. Max
    // deduction (30) is in the same range as the pain factor's max (35) — an
    // objective physiological signal should move the needle meaningfully
    // without swamping every self-reported factor combined.
    if (inputs.wearable != null) {
      const { source, recoveryScore: recovery, sleepPerformancePct, strain, hrvMs, sleepDebtMinutes } = inputs.wearable;
      const sourceLabel = source === 'whoop' ? 'Whoop recovery' : 'Oura readiness';
      let wearableDeduction = 0;
      if (recovery < 33) wearableDeduction = 30;
      else if (recovery < 66) wearableDeduction = 15;
      else if (recovery >= 90) wearableDeduction = -5;
      deduction += wearableDeduction;
      // Always the full picture (recovery/readiness + sleep + strain when
      // present), not just the headline score — this is what lets the
      // today-focus summary surface real wearable numbers even on a good
      // day, when the headline score alone wouldn't otherwise earn a mention
      // as a "main factor" (see buildTodayFocusSummaryText, which appends
      // this detail unconditionally whenever available rather than only
      // when it's a top negative).
      const detailBits = [`${sourceLabel} is ${recovery}% today`];
      if (sleepPerformancePct != null) detailBits.push(`sleep ${sleepPerformancePct}%`);
      // Whoop-only — always null for Oura, so this naturally omits with no
      // extra branching.
      if (strain != null) detailBits.push(`strain ${strain.toFixed(1)}`);
      // HRV/sleep debt are the two Whoop-only additions worth a mention in a
      // one-line summary — a genuine trend signal and a directly actionable
      // "you're behind on sleep" respectively. The rest of the new 0074
      // fields (efficiency, consistency, stages, SpO2, skin temp) stay out
      // of this narrative on purpose: six more clauses would turn a coach's
      // summary into a data dump. They're still fully available on
      // `inputs.wearable` for chat-coach's own prompt, which has room to be
      // more thorough than a one-line summary.
      if (hrvMs != null) detailBits.push(`HRV ${hrvMs}ms`);
      if (sleepDebtMinutes != null && sleepDebtMinutes > 30) {
        const hours = Math.floor(sleepDebtMinutes / 60);
        const minutes = sleepDebtMinutes % 60;
        detailBits.push(`sleep debt ${hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`}`);
      }
      factors.push({
        key: 'wearable_recovery',
        label: sourceLabel,
        impact: wearableDeduction > 0 ? 'negative' : wearableDeduction < 0 ? 'positive' : 'neutral',
        weight: clamp(Math.abs(wearableDeduction) / 100, 0, 1),
        detail: `${detailBits.join(', ')}.`,
        available: true,
      });
    } else {
      factors.push({
        key: 'wearable_recovery',
        label: 'Wearable recovery',
        impact: 'neutral',
        weight: 0,
        detail: 'No wearable data available today.',
        available: false,
      });
    }

    // Training load.
    const loadDeductionMap: Record<TrainingLoadResult['classification'], number> = {
      low: -5,
      normal: 0,
      high: 15,
      unknown: 0,
    };
    const loadDeduction = loadDeductionMap[inputs.trainingLoad.classification];
    deduction += loadDeduction;
    // trend reflects the volume itself (high = up, low = down) — deliberately
    // separate from `impact` below, which is about readiness valence instead
    // (high volume is an upward trend but still a negative readiness impact).
    const loadTrend: ReadinessFactor['trend'] =
      inputs.trainingLoad.classification === 'high'
        ? 'up'
        : inputs.trainingLoad.classification === 'low'
          ? 'down'
          : 'flat';
    factors.push({
      key: 'training_load',
      label: 'Recent training load',
      impact: loadDeduction > 0 ? 'negative' : loadDeduction < 0 ? 'positive' : 'neutral',
      // Inverted from `impact`: high volume dings predicted readiness, but
      // on screen that should still read as green/up, not red/up — see
      // ReadinessFactor.displayImpact.
      displayImpact: loadDeduction > 0 ? 'positive' : loadDeduction < 0 ? 'negative' : 'neutral',
      trend: loadTrend,
      weight: clamp(Math.abs(loadDeduction) / 100, 0, 1),
      detail:
        inputs.trainingLoad.classification === 'unknown'
          ? 'Not enough training history yet to estimate load.'
          : `This week's volume looks ${inputs.trainingLoad.classification} relative to your recent average.`,
      available: inputs.trainingLoad.classification !== 'unknown',
    });

    // Time since last workout.
    if (inputs.daysSinceLastWorkout != null) {
      const days = inputs.daysSinceLastWorkout;
      let timeDeduction = 0;
      if (days <= 0) timeDeduction = 5;
      else if (days >= 2 && days <= 3) timeDeduction = -3;
      else if (days >= 7) timeDeduction = 8;
      deduction += timeDeduction;
      factors.push({
        key: 'time_since_last_workout',
        label: 'Time since last workout',
        impact: timeDeduction > 0 ? 'negative' : timeDeduction < 0 ? 'positive' : 'neutral',
        weight: clamp(Math.abs(timeDeduction) / 100, 0, 1),
        detail: days <= 0 ? 'You already trained today.' : `${days} day(s) since your last workout.`,
        available: true,
      });
    } else {
      factors.push({
        key: 'time_since_last_workout',
        label: 'Time since last workout',
        impact: 'neutral',
        weight: 0,
        detail: 'No prior workout history yet.',
        available: false,
      });
    }

    // Missed workouts.
    const missed = inputs.missedWorkoutsLast14Days;
    const missedDeduction = missed >= 3 ? 8 : missed === 2 ? 5 : missed === 1 ? 2 : 0;
    deduction += missedDeduction;
    factors.push({
      key: 'missed_workouts',
      label: 'Recent consistency',
      impact: missedDeduction > 0 ? 'negative' : 'neutral',
      weight: clamp(missedDeduction / 100, 0, 1),
      detail:
        missed === 0
          ? 'No missed workouts in the last two weeks.'
          : `${missed} missed workout(s) in the last two weeks.`,
      available: true,
    });

    const score = clamp(Math.round(100 - deduction), 0, 100);
    const band = bandFromScore(score);

    const intensityMap: Record<ReadinessBand, ReadinessResult['recommendedIntensity']> = {
      high: 'full',
      moderate: 'reduced',
      low: 'light',
      very_low: 'recovery_only',
    };
    const rpeRangeMap: Record<ReadinessBand, [number, number]> = {
      high: [7, 9],
      moderate: [6, 8],
      low: [5, 7],
      very_low: [3, 5],
    };
    const qualityMap: Record<ReadinessBand, ReadinessResult['estimatedSessionQuality']> = {
      high: 'excellent',
      moderate: 'good',
      low: 'fair',
      very_low: 'poor',
    };

    const sortedFactors = [...factors].sort((a, b) => b.weight - a.weight);
    const topNegative = sortedFactors.filter(f => f.available && f.impact === 'negative').slice(0, 2);
    const summary =
      topNegative.length === 0
        ? `Readiness appears ${bandLabel(band)} today.`
        : `Readiness appears ${bandLabel(band)} today — ${topNegative
            .map(f => f.label.toLowerCase())
            .join(' and ')} may be the main factors.`;

    return {
      score,
      band,
      factors: sortedFactors,
      recommendedIntensity: intensityMap[band],
      recommendedRpeRange: rpeRangeMap[band],
      estimatedSessionQuality: qualityMap[band],
      summary,
      computedAt: new Date().toISOString(),
    };
  }

  adaptScheduledWorkout({ exercises, readiness, painRisk }: AdaptScheduledWorkoutParams): AdaptationChange[] {
    const changes: AdaptationChange[] = [];
    // Deterministic (not Date.now()-based) so ids stay stable across recomputes —
    // e.g. a background refetch of any readiness input while this screen is open
    // — otherwise a user's accept/reject decisions get silently discarded because
    // every recompute would look like a brand-new set of changes.
    let idCounter = 0;
    const nextId = (adaptationType: string, targetExerciseId: string | null, fieldChanged: string) => {
      idCounter += 1;
      return `adapt-${adaptationType}-${targetExerciseId ?? 'workout'}-${fieldChanged}-${idCounter}`;
    };

    if (painRisk.riskLevel === 'severe' || readiness.band === 'very_low') {
      const reason =
        painRisk.riskLevel === 'severe'
          ? 'Reported pain matches warning-sign language — recommending recovery/mobility work instead of today’s planned session.'
          : readiness.summary;
      changes.push({
        id: nextId('recovery_replacement', null, 'workout_type'),
        adaptationType: 'recovery_replacement',
        targetExerciseId: null,
        fieldChanged: 'workout_type',
        originalValue: 'planned_workout',
        updatedValue: 'recovery_or_mobility',
        reason,
        confidence: painRisk.riskLevel === 'severe' ? 0.9 : 0.7,
        source: 'rule_engine',
      });

      // No exercise-substitution catalog exists yet (deferred to a later phase), so
      // there's no real mobility/recovery session to swap in. Accepting the change
      // above still needs to do *something* concrete to the planned workout, so pair
      // it with an aggressive, purely numeric pullback on the existing exercises
      // rather than leaving "recovery_replacement" as a decision with no effect.
      for (const exercise of exercises) {
        const reducedSets = Math.max(1, Math.ceil(exercise.targetSets / 2));
        if (reducedSets < exercise.targetSets) {
          changes.push({
            id: nextId('reduce_sets', exercise.exerciseId, 'target_sets'),
            adaptationType: 'reduce_sets',
            targetExerciseId: exercise.exerciseId,
            fieldChanged: 'target_sets',
            originalValue: exercise.targetSets,
            updatedValue: reducedSets,
            reason,
            confidence: 0.65,
            source: 'rule_engine',
          });
        }
        if (exercise.targetRpe != null) {
          changes.push({
            id: nextId('reduce_rpe', exercise.exerciseId, 'target_rpe'),
            adaptationType: 'reduce_rpe',
            targetExerciseId: exercise.exerciseId,
            fieldChanged: 'target_rpe',
            originalValue: exercise.targetRpe,
            updatedValue: Math.max(3, exercise.targetRpe - 2),
            reason,
            confidence: 0.65,
            source: 'rule_engine',
          });
        }
        changes.push({
          id: nextId('increase_rest', exercise.exerciseId, 'rest_seconds'),
          adaptationType: 'increase_rest',
          targetExerciseId: exercise.exerciseId,
          fieldChanged: 'rest_seconds',
          originalValue: exercise.restSeconds ?? 90,
          updatedValue: (exercise.restSeconds ?? 90) + 45,
          reason,
          confidence: 0.6,
          source: 'rule_engine',
        });
      }
      return changes;
    }

    if (readiness.band === 'low') {
      for (const exercise of exercises) {
        if (exercise.targetSets > 1) {
          changes.push({
            id: nextId('reduce_sets', exercise.exerciseId, 'target_sets'),
            adaptationType: 'reduce_sets',
            targetExerciseId: exercise.exerciseId,
            fieldChanged: 'target_sets',
            originalValue: exercise.targetSets,
            updatedValue: exercise.targetSets - 1,
            reason: readiness.summary,
            confidence: 0.6,
            source: 'rule_engine',
          });
        }
        const currentRest = exercise.restSeconds ?? 90;
        changes.push({
          id: nextId('increase_rest', exercise.exerciseId, 'rest_seconds'),
          adaptationType: 'increase_rest',
          targetExerciseId: exercise.exerciseId,
          fieldChanged: 'rest_seconds',
          originalValue: currentRest,
          updatedValue: currentRest + 30,
          reason: 'Extra rest to help manage today’s lower readiness.',
          confidence: 0.55,
          source: 'rule_engine',
        });
        if (exercise.targetRpe != null) {
          changes.push({
            id: nextId('reduce_rpe', exercise.exerciseId, 'target_rpe'),
            adaptationType: 'reduce_rpe',
            targetExerciseId: exercise.exerciseId,
            fieldChanged: 'target_rpe',
            originalValue: exercise.targetRpe,
            updatedValue: Math.max(4, exercise.targetRpe - 1),
            reason: readiness.summary,
            confidence: 0.55,
            source: 'rule_engine',
          });
        }
      }
      return changes;
    }

    if (readiness.band === 'moderate' && painRisk.riskLevel !== 'none') {
      for (const exercise of exercises) {
        if (exercise.targetRpe != null) {
          changes.push({
            id: nextId('reduce_rpe', exercise.exerciseId, 'target_rpe'),
            adaptationType: 'reduce_rpe',
            targetExerciseId: exercise.exerciseId,
            fieldChanged: 'target_rpe',
            originalValue: exercise.targetRpe,
            updatedValue: Math.max(4, exercise.targetRpe - 0.5),
            reason: painRisk.recommendation,
            confidence: 0.5,
            source: 'rule_engine',
          });
        }
      }
    }

    return changes;
  }

  recommendNextSet({
    target,
    completedSets,
    nextSetNumber,
    nextSetCurrentReps,
    nextSetCurrentLoadKg,
    readinessBand,
    unitPref,
  }: RecommendNextSetParams): SetRecommendation | null {
    if (completedSets.length === 0) return null;

    const lastSet = completedSets[completedSets.length - 1];
    const firstSet = completedSets[0];
    const hasLoad = target.targetLoadKg != null || lastSet.loadKg != null;
    const baseLoad = lastSet.loadKg ?? target.targetLoadKg ?? 0;
    const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Reps and weight only — never RPE. A reps/weight recommendation that
    // exactly matches what the next set is already configured to show
    // (every set is prefilled from the exercise's own targets, see
    // buildDraftSets) isn't a real recommendation, it's just restating the
    // plan back — suppressed here rather than at the one call site so this
    // invariant can't be forgotten by a future second caller.
    const suppressIfNoOp = (rec: SetRecommendation): SetRecommendation | null => {
      const repsUnchanged = rec.recommendedReps == null || rec.recommendedReps === nextSetCurrentReps;
      const loadUnchanged = rec.recommendedLoadKg == null || rec.recommendedLoadKg === nextSetCurrentLoadKg;
      const specifiesSomething = rec.recommendedReps != null || rec.recommendedLoadKg != null;
      return specifiesSomething && repsUnchanged && loadUnchanged ? null : rec;
    };

    // 1. Severe decline — safety-first, same priority position as adaptScheduledWorkout's pain checks.
    const repsCratered = completedSets.length >= 2 && firstSet.reps > 0 && lastSet.reps <= firstSet.reps * 0.5;
    if (repsCratered) {
      return {
        id,
        type: 'stop_exercise',
        recommendedReps: null,
        recommendedLoadKg: null,
        recommendedRpe: null,
        recommendedRestSeconds: null,
        reason: `Reps dropped sharply from your first set (${firstSet.reps} → ${lastSet.reps}) — consider stopping this exercise for today.`,
        confidence: 0.6,
        source: 'rule_engine',
      };
    }

    // 2. An add-on set beyond the plan came in weak — offer to drop it rather than count it.
    if (
      target.targetSets != null &&
      lastSet.setNumber > target.targetSets &&
      target.targetRepsMin != null &&
      lastSet.reps < target.targetRepsMin
    ) {
      return {
        id,
        type: 'remove_last_set',
        recommendedReps: null,
        recommendedLoadKg: null,
        recommendedRpe: null,
        recommendedRestSeconds: null,
        reason: 'That extra set came in under your rep range — you can remove it without affecting your planned work.',
        confidence: 0.5,
        source: 'rule_engine',
      };
    }

    const missedTarget = target.targetRepsMin != null && lastSet.reps < target.targetRepsMin;

    // 3. Missed the rep target, with more sets planned.
    if (nextSetNumber != null && missedTarget) {
      if (hasLoad) {
        return suppressIfNoOp({
          id,
          type: 'reduce_weight',
          recommendedReps: null,
          recommendedLoadKg: Math.max(0, baseLoad - roundDeltaToPlateIncrement(baseLoad * 0.1, unitPref)),
          recommendedRpe: null,
          recommendedRestSeconds: null,
          reason: 'You came in under your rep target — dropping the weight slightly for the next set.',
          confidence: 0.65,
          source: 'rule_engine',
        });
      }
      return suppressIfNoOp({
        id,
        type: 'adjust_reps',
        recommendedReps: Math.max(1, (target.targetRepsMin ?? lastSet.reps) - 2),
        recommendedLoadKg: null,
        recommendedRpe: null,
        recommendedRestSeconds: null,
        reason: 'That rep range looked tough today — aiming a little lower for the next set.',
        confidence: 0.6,
        source: 'rule_engine',
      });
    }

    const hitTopOfRange = target.targetRepsMax != null && lastSet.reps >= target.targetRepsMax;

    // 4. Comfortably hit the top of the rep range — progress it, unless readiness already flagged today as low.
    // (readinessBand is the day's overall recovery/readiness score, not a
    // per-set effort rating — a different, allowed signal from RPE.)
    if (nextSetNumber != null && hitTopOfRange) {
      if (readinessBand === 'low' || readinessBand === 'very_low') {
        return suppressIfNoOp({
          id,
          type: 'keep_weight',
          recommendedReps: lastSet.reps,
          recommendedLoadKg: lastSet.loadKg,
          recommendedRpe: null,
          recommendedRestSeconds: null,
          reason: 'Strong set, but today\'s readiness is lower than usual — holding steady instead of adding weight.',
          confidence: 0.55,
          source: 'rule_engine',
        });
      }
      if (hasLoad) {
        return suppressIfNoOp({
          id,
          type: 'increase_weight',
          recommendedReps: null,
          recommendedLoadKg: baseLoad + roundDeltaToPlateIncrement(baseLoad * 0.025, unitPref),
          recommendedRpe: null,
          recommendedRestSeconds: null,
          reason: 'You hit the top of your rep range comfortably — try a bit more weight next set.',
          confidence: 0.6,
          source: 'rule_engine',
        });
      }
      return suppressIfNoOp({
        id,
        type: 'adjust_reps',
        recommendedReps: (target.targetRepsMax ?? lastSet.reps) + 2,
        recommendedLoadKg: null,
        recommendedRpe: null,
        recommendedRestSeconds: null,
        reason: 'You hit the top of your rep range comfortably — aiming a bit higher next set.',
        confidence: 0.55,
        source: 'rule_engine',
      });
    }

    // 5. Right on target — repeat it.
    const onTarget =
      target.targetRepsMin != null &&
      lastSet.reps >= target.targetRepsMin &&
      (target.targetRepsMax == null || lastSet.reps <= target.targetRepsMax);
    if (nextSetNumber != null && onTarget) {
      return suppressIfNoOp({
        id,
        type: 'keep_weight',
        recommendedReps: lastSet.reps,
        recommendedLoadKg: lastSet.loadKg,
        recommendedRpe: null,
        recommendedRestSeconds: null,
        reason: 'Right on target — repeat this weight and reps.',
        confidence: 0.65,
        source: 'rule_engine',
      });
    }

    return null;
  }

  /**
   * Shared scoring/filtering core for equipment- and pattern-aware exercise
   * matching — used both by the public recommendExerciseSubstitution and
   * internally by generateWorkoutVariant's equipment/impact strategies, so
   * there's exactly one ranking algorithm rather than two that can drift.
   */
  private rankSubstitutes(
    exercise: ExerciseMetadata,
    candidates: ExerciseMetadata[],
    availableEquipment: EquipmentType[] | null,
    excludeEquipment: EquipmentType | undefined,
    preferLowerJointStress = false,
  ): Array<{ candidate: ExerciseMetadata; score: number; matchedOn: SubstitutionMatchSignal[] }> {
    const scored: Array<{ candidate: ExerciseMetadata; score: number; matchedOn: SubstitutionMatchSignal[] }> = [];

    for (const candidate of candidates) {
      if (candidate.id === exercise.id) continue;
      if (excludeEquipment && candidate.equipment === excludeEquipment) continue;
      if (
        availableEquipment != null &&
        candidate.equipment !== 'bodyweight' &&
        !availableEquipment.includes(candidate.equipment)
      ) {
        continue;
      }

      const matchedOn: SubstitutionMatchSignal[] = [];
      let score = 0;

      if (exercise.movementPattern != null && candidate.movementPattern === exercise.movementPattern) {
        score += 3;
        matchedOn.push('movement_pattern');
      }
      if (candidate.primaryMuscle === exercise.primaryMuscle) {
        score += 2;
        matchedOn.push('primary_muscle');
      }
      if (candidate.category === exercise.category) {
        score += 1;
        matchedOn.push('category');
      }
      const secondaryOverlap = candidate.secondaryMuscles.some(m => exercise.secondaryMuscles.includes(m));
      if (secondaryOverlap) {
        score += 1;
        matchedOn.push('secondary_muscle');
      }
      if (
        exercise.difficulty != null &&
        candidate.difficulty != null &&
        Math.abs(DIFFICULTY_ORDER[exercise.difficulty] - DIFFICULTY_ORDER[candidate.difficulty]) >= 2
      ) {
        score -= 1;
      }
      if (
        preferLowerJointStress &&
        exercise.jointStress != null &&
        candidate.jointStress != null &&
        JOINT_STRESS_ORDER[candidate.jointStress] < JOINT_STRESS_ORDER[exercise.jointStress]
      ) {
        score += 2;
      }

      if (score > 0) scored.push({ candidate, score, matchedOn });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  recommendExerciseSubstitution({
    exercise,
    candidates,
    availableEquipment,
    excludeEquipment,
  }: RecommendSubstitutionParams): ExerciseSubstitution[] {
    const scored = this.rankSubstitutes(exercise, candidates, availableEquipment, excludeEquipment);

    return scored.slice(0, 5).map(({ candidate, score, matchedOn }) => ({
      id: `sub-${Date.now()}-${candidate.id}`,
      exerciseId: candidate.id,
      exerciseName: candidate.name,
      reason: buildSubstitutionReason(exercise, candidate, matchedOn),
      confidence: clamp(score / 7, 0.3, 0.9),
      matchedOn,
    }));
  }

  generateWorkoutVariant({
    source,
    variantType,
    candidates,
    availableEquipment,
  }: GenerateWorkoutVariantParams): WorkoutVariantResult {
    let working = source.map(e => ({ metadata: e.metadata, target: { ...e.target } }));
    const changes = new Map<string, WorkoutVariantChange>();
    for (const e of working) {
      changes.set(e.target.exerciseId, {
        exerciseId: e.target.exerciseId,
        type: 'kept',
        reason: VARIANT_DESCRIPTIONS[variantType],
      });
    }

    switch (variantType) {
      case 'full':
        break;
      case 'time_45':
        working = this.fitToTimeBudget(working, 45, changes);
        break;
      case 'time_30':
        working = this.fitToTimeBudget(working, 30, changes);
        break;
      case 'hotel':
      case 'home':
      case 'bodyweight': {
        const allowlist = equipmentAllowlistFor(variantType, availableEquipment);
        working = working.map(e => this.applyEquipmentConstraint(e, candidates, allowlist, changes));
        break;
      }
      case 'low_readiness':
        working = working.map(e => this.applyLowReadiness(e, changes));
        break;
      case 'strength_focus':
        working = working.map(e => this.applyStrengthFocus(e, changes));
        break;
      case 'hypertrophy_focus':
        working = working.map(e => this.applyHypertrophyFocus(e, changes));
        break;
      case 'reduced_impact':
        working = working.map(e => this.applyReducedImpact(e, candidates, changes));
        break;
    }

    const exercises: WorkoutVariantExercise[] = working.map(e => ({
      exerciseId: e.target.exerciseId,
      exerciseName: e.metadata.name,
      targetSets: e.target.targetSets,
      targetRepsMin: e.target.targetRepsMin,
      targetRepsMax: e.target.targetRepsMax,
      targetLoadKg: e.target.targetLoadKg,
      targetRpe: e.target.targetRpe,
      restSeconds: e.target.restSeconds,
    }));

    return {
      variantType,
      label: VARIANT_LABELS[variantType],
      summary: VARIANT_DESCRIPTIONS[variantType],
      estimatedMinutes:
        estimateWorkoutMinutes(exercises.map(e => ({ targetSets: e.targetSets, restSeconds: e.restSeconds }))) ?? 0,
      exercises,
      changes: [...changes.values()],
    };
  }

  private fitToTimeBudget(
    working: Array<{ metadata: ExerciseMetadata; target: AdaptationExerciseTarget }>,
    budgetMinutes: number,
    changes: Map<string, WorkoutVariantChange>,
  ): Array<{ metadata: ExerciseMetadata; target: AdaptationExerciseTarget }> {
    let list = working;
    const minutes = () =>
      estimateWorkoutMinutes(list.map(e => ({ targetSets: e.target.targetSets, restSeconds: e.target.restSeconds }))) ?? 0;

    if (minutes() <= budgetMinutes) return list;

    // 1. Trim accessory sets by 1 (floor 1).
    for (const e of list) {
      if (minutes() <= budgetMinutes) break;
      if (!isCompoundPattern(e.metadata.movementPattern) && e.target.targetSets > 1) {
        e.target.targetSets -= 1;
        changes.set(e.target.exerciseId, {
          exerciseId: e.target.exerciseId,
          type: 'sets_reduced',
          reason: `Reduced to ${e.target.targetSets} sets to fit a ${budgetMinutes}-minute session.`,
        });
      }
    }

    // 2. Drop accessory exercises entirely, from the end, before ever touching a compound lift.
    for (let i = list.length - 1; i >= 0 && minutes() > budgetMinutes; i--) {
      if (!isCompoundPattern(list[i].metadata.movementPattern)) {
        const removed = list[i];
        changes.set(removed.target.exerciseId, {
          exerciseId: removed.target.exerciseId,
          type: 'dropped',
          reason: `Dropped to fit a ${budgetMinutes}-minute session — prioritizing your main lifts.`,
        });
        list = [...list.slice(0, i), ...list.slice(i + 1)];
      }
    }

    // 3. Only if compounds are all that's left and still over budget, lighten them too.
    for (const e of list) {
      if (minutes() <= budgetMinutes) break;
      if (e.target.targetSets > 2) {
        e.target.targetSets -= 1;
        changes.set(e.target.exerciseId, {
          exerciseId: e.target.exerciseId,
          type: 'sets_reduced',
          reason: `Reduced to ${e.target.targetSets} sets to fit a ${budgetMinutes}-minute session.`,
        });
      }
    }

    return list;
  }

  private applyEquipmentConstraint(
    e: { metadata: ExerciseMetadata; target: AdaptationExerciseTarget },
    candidates: ExerciseMetadata[],
    allowlist: EquipmentType[],
    changes: Map<string, WorkoutVariantChange>,
  ): { metadata: ExerciseMetadata; target: AdaptationExerciseTarget } {
    if (e.metadata.equipment === 'bodyweight' || allowlist.includes(e.metadata.equipment)) {
      return e;
    }
    const ranked = this.rankSubstitutes(e.metadata, candidates, allowlist, undefined);
    const best = ranked[0];
    if (!best) {
      changes.set(e.target.exerciseId, {
        exerciseId: e.target.exerciseId,
        type: 'kept',
        reason: `No equipment-compatible substitute found for ${e.metadata.name} — keeping it as planned.`,
      });
      return e;
    }
    changes.set(e.target.exerciseId, {
      exerciseId: e.target.exerciseId,
      type: 'substituted',
      reason: buildSubstitutionReason(e.metadata, best.candidate, best.matchedOn),
    });
    return { metadata: best.candidate, target: { ...e.target, exerciseId: best.candidate.id, targetLoadKg: null } };
  }

  private applyLowReadiness(
    e: { metadata: ExerciseMetadata; target: AdaptationExerciseTarget },
    changes: Map<string, WorkoutVariantChange>,
  ): { metadata: ExerciseMetadata; target: AdaptationExerciseTarget } {
    const target = { ...e.target };
    target.targetSets = Math.max(1, target.targetSets - 1);
    if (target.targetRpe != null) target.targetRpe = Math.max(4, target.targetRpe - 1);
    target.restSeconds = Math.round((target.restSeconds ?? 90) * 1.3);
    changes.set(e.target.exerciseId, {
      exerciseId: e.target.exerciseId,
      type: 'sets_reduced',
      reason: 'Lightened for a lower-readiness session — fewer sets, easier target RPE, more rest.',
    });
    return { metadata: e.metadata, target };
  }

  private applyStrengthFocus(
    e: { metadata: ExerciseMetadata; target: AdaptationExerciseTarget },
    changes: Map<string, WorkoutVariantChange>,
  ): { metadata: ExerciseMetadata; target: AdaptationExerciseTarget } {
    const target = { ...e.target };
    if (target.targetRepsMax != null) target.targetRepsMax = Math.min(target.targetRepsMax, 6);
    if (target.targetRepsMin != null) target.targetRepsMin = Math.min(target.targetRepsMin, 5);
    target.targetRpe = Math.max(target.targetRpe ?? 8, 8);
    target.restSeconds = (target.restSeconds ?? 90) + 30;
    changes.set(e.target.exerciseId, {
      exerciseId: e.target.exerciseId,
      type: 'reps_adjusted',
      reason: 'Shifted toward lower reps and higher effort for a strength-focused session.',
    });
    return { metadata: e.metadata, target };
  }

  private applyHypertrophyFocus(
    e: { metadata: ExerciseMetadata; target: AdaptationExerciseTarget },
    changes: Map<string, WorkoutVariantChange>,
  ): { metadata: ExerciseMetadata; target: AdaptationExerciseTarget } {
    const target = { ...e.target };
    target.targetRepsMin = Math.max(target.targetRepsMin ?? 8, 8);
    target.targetRepsMax = Math.min(Math.max(target.targetRepsMax ?? 12, 12), 15);
    if (target.targetRpe != null) target.targetRpe = Math.min(target.targetRpe, 8);
    target.restSeconds = Math.min(target.restSeconds ?? 90, 75);
    changes.set(e.target.exerciseId, {
      exerciseId: e.target.exerciseId,
      type: 'reps_adjusted',
      reason: 'Shifted toward moderate-to-higher reps and shorter rest for a hypertrophy-focused session.',
    });
    return { metadata: e.metadata, target };
  }

  private applyReducedImpact(
    e: { metadata: ExerciseMetadata; target: AdaptationExerciseTarget },
    candidates: ExerciseMetadata[],
    changes: Map<string, WorkoutVariantChange>,
  ): { metadata: ExerciseMetadata; target: AdaptationExerciseTarget } {
    if (e.metadata.jointStress !== 'high') return e;
    const ranked = this.rankSubstitutes(e.metadata, candidates, null, undefined, true);
    const best = ranked[0];
    if (!best) return e;
    changes.set(e.target.exerciseId, {
      exerciseId: e.target.exerciseId,
      type: 'substituted',
      reason: `${buildSubstitutionReason(e.metadata, best.candidate, best.matchedOn)} Lower joint stress than ${e.metadata.name}.`,
    });
    return { metadata: best.candidate, target: { ...e.target, exerciseId: best.candidate.id, targetLoadKg: null } };
  }

  generateTodayFocusSummary(params: GenerateTodayFocusSummaryParams): TodayFocusSummaryResult {
    const { readiness, plan } = params;

    const headlineKey =
      plan.kind === 'rest_day'
        ? 'rest_day'
        : plan.kind === 'cardio_day'
          ? 'cardio_day'
          : readiness == null
            ? 'no_data'
            : readiness.band;
    const headline = pickPhrasing(HEADLINE_PHRASINGS[headlineKey], headlineKey);

    const summary = buildTodayFocusSummaryText(params);

    return { headline, summary, band: readiness?.band ?? null };
  }

  generatePostWorkoutSummary({
    exercises,
    previousVolumeByExercise,
    previousBestE1rmByExercise,
    sessionPrEvents,
    readiness,
    trainingLoad,
    painRisk,
    unitPref,
  }: GeneratePostWorkoutSummaryParams): PostWorkoutSummaryResult {
    let totalVolumeKg = 0;
    let bestSet: PostWorkoutBestSet | null = null;
    let bestSetE1rm = 0;
    const ratedDeltas: number[] = [];
    const actualRpes: number[] = [];
    let onTargetSetCount = 0;
    const bestE1rmThisSessionByExercise = new Map<string, number>();

    for (const exercise of exercises) {
      let exerciseBestE1rm = 0;
      for (const set of exercise.sets) {
        totalVolumeKg += (set.loadKg ?? 0) * set.reps;

        if (set.loadKg != null && set.loadKg > 0) {
          const e1rm = estimateOneRepMax(set.loadKg, set.reps);
          if (e1rm > exerciseBestE1rm) exerciseBestE1rm = e1rm;
          if (e1rm > bestSetE1rm) {
            bestSetE1rm = e1rm;
            bestSet = {
              exerciseId: exercise.exerciseId,
              exerciseName: exercise.exerciseName,
              loadKg: set.loadKg,
              reps: set.reps,
              e1rm,
            };
          }
        }

        if (set.rpe != null) {
          actualRpes.push(set.rpe);
          if (exercise.targetRpe != null) {
            const delta = set.rpe - exercise.targetRpe;
            ratedDeltas.push(delta);
            if (Math.abs(delta) <= 1) onTargetSetCount++;
          }
        }
      }
      if (exerciseBestE1rm > 0) bestE1rmThisSessionByExercise.set(exercise.exerciseId, exerciseBestE1rm);
    }

    let previousVolumeTotal = 0;
    let hasPriorVolumeData = false;
    for (const exercise of exercises) {
      const prev = previousVolumeByExercise[exercise.exerciseId];
      if (prev != null) {
        previousVolumeTotal += prev;
        hasPriorVolumeData = true;
      }
    }
    const volumeChangeKg = hasPriorVolumeData ? totalVolumeKg - previousVolumeTotal : null;
    const volumeChangePercent =
      volumeChangeKg != null && previousVolumeTotal > 0 ? (volumeChangeKg / previousVolumeTotal) * 100 : null;

    const improvedExercises: ExercisePerformanceDelta[] = [];
    const declinedExercises: ExercisePerformanceDelta[] = [];
    for (const exercise of exercises) {
      const prevBest = previousBestE1rmByExercise[exercise.exerciseId];
      const thisBest = bestE1rmThisSessionByExercise.get(exercise.exerciseId);
      if (prevBest == null || prevBest <= 0 || thisBest == null) continue;
      const changePercent = ((thisBest - prevBest) / prevBest) * 100;
      if (changePercent > 2) {
        improvedExercises.push({
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
          direction: 'improved',
          detail: `Estimated 1RM up ~${Math.round(changePercent)}% from last time.`,
        });
      } else if (changePercent < -2) {
        declinedExercises.push({
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
          direction: 'declined',
          detail: `Estimated 1RM down ~${Math.round(Math.abs(changePercent))}% from last time.`,
        });
      }
    }

    const rpeAdherence: RpeAdherence = {
      ratedSetCount: ratedDeltas.length,
      averageDelta: ratedDeltas.length > 0 ? average(ratedDeltas) : null,
      onTargetSetCount,
    };

    const avgActualRpe = actualRpes.length > 0 ? average(actualRpes) : null;

    let readinessVsPerformance: string | null = null;
    if (readiness && avgActualRpe != null) {
      const [lo, hi] = readiness.recommendedRpeRange;
      const rounded = avgActualRpe.toFixed(1);
      if (avgActualRpe > hi + 0.5) {
        readinessVsPerformance = `You trained at an average RPE of ${rounded}, above today's recommended ${lo}-${hi} range given your readiness.`;
      } else if (avgActualRpe < lo - 0.5) {
        readinessVsPerformance = `You trained at an average RPE of ${rounded}, below today's recommended ${lo}-${hi} range — there may have been room to push a bit more.`;
      } else {
        readinessVsPerformance = `You trained at an average RPE of ${rounded}, right within today's recommended ${lo}-${hi} range.`;
      }
    }

    let estimatedRecoveryNeeds: RecoveryNeed = 'normal';
    if (trainingLoad.classification === 'high' || (avgActualRpe != null && avgActualRpe >= 9)) {
      estimatedRecoveryNeeds = 'extra_rest';
    } else if (trainingLoad.classification === 'low' && avgActualRpe != null && avgActualRpe <= 6) {
      estimatedRecoveryNeeds = 'light_next_session';
    }

    let painOrFatigueConcern: string | null = null;
    if (painRisk.riskLevel !== 'none') {
      painOrFatigueConcern = painRisk.recommendation;
    } else if (rpeAdherence.averageDelta != null && rpeAdherence.averageDelta >= 2) {
      painOrFatigueConcern = 'Effort ran noticeably higher than planned today — keep an eye on recovery before your next session.';
    }

    const suggestedNextAction = buildSuggestedNextAction({
      sessionPrEvents,
      improvedExercises,
      declinedExercises,
      estimatedRecoveryNeeds,
    });
    const summary = buildPostWorkoutSummaryText({
      totalVolumeKg,
      volumeChangePercent,
      sessionPrEvents,
      improvedExercises,
      declinedExercises,
      estimatedRecoveryNeeds,
      painOrFatigueConcern,
      unitPref,
    });

    return {
      totalVolumeKg,
      volumeChangeKg,
      volumeChangePercent,
      newPersonalRecords: sessionPrEvents,
      bestSet,
      improvedExercises,
      declinedExercises,
      rpeAdherence,
      readinessVsPerformance,
      estimatedRecoveryNeeds,
      suggestedNextAction,
      painOrFatigueConcern,
      summary,
    };
  }

  generateWeeklyReview({
    weekStart,
    weekEnd,
    workoutsCompleted,
    workoutsMissed,
    weekSets,
    priorBestE1rmByExercise,
    weekPrEvents,
    checkins,
    trainingLoad,
    unitPref,
  }: GenerateWeeklyReviewParams): WeeklyReviewResult {
    const totalPlanned = workoutsCompleted + workoutsMissed;
    const consistencyPercent = totalPlanned > 0 ? (workoutsCompleted / totalPlanned) * 100 : null;

    let totalVolumeKg = 0;
    const volumeByMuscle = new Map<string, number>();
    const setsByExercise = new Map<string, typeof weekSets>();
    for (const set of weekSets) {
      const volume = (set.loadKg ?? 0) * set.reps;
      totalVolumeKg += volume;
      volumeByMuscle.set(set.primaryMuscle, (volumeByMuscle.get(set.primaryMuscle) ?? 0) + volume);
      const list = setsByExercise.get(set.exerciseId) ?? [];
      list.push(set);
      setsByExercise.set(set.exerciseId, list);
    }
    const volumeByMuscleGroup: MuscleGroupVolume[] = [...volumeByMuscle.entries()]
      .map(([muscle, volumeKg]) => ({ muscle, volumeKg }))
      .sort((a, b) => b.volumeKg - a.volumeKg);

    let mostImprovedExercise: ExerciseImprovement | null = null;
    let bestImprovementPercent = 0;
    let mostInconsistentExercise: ExerciseInconsistency | null = null;
    let highestCv = INCONSISTENCY_CV_THRESHOLD;

    for (const [exerciseId, sets] of setsByExercise) {
      const exerciseName = sets[0].exerciseName;
      const loadedSets = sets.filter(s => s.loadKg != null && s.loadKg > 0);

      if (loadedSets.length > 0) {
        const bestE1rmThisWeek = loadedSets.reduce(
          (best, s) => Math.max(best, estimateOneRepMax(s.loadKg as number, s.reps)),
          0,
        );
        const priorBest = priorBestE1rmByExercise[exerciseId];
        if (priorBest != null && priorBest > 0) {
          const changePercent = ((bestE1rmThisWeek - priorBest) / priorBest) * 100;
          if (changePercent > 0 && changePercent > bestImprovementPercent) {
            bestImprovementPercent = changePercent;
            mostImprovedExercise = { exerciseId, exerciseName, changePercent };
          }
        }
      }

      if (loadedSets.length >= 2) {
        const loads = loadedSets.map(s => s.loadKg as number);
        const mean = average(loads);
        if (mean > 0) {
          const variance = average(loads.map(l => (l - mean) ** 2));
          const cv = Math.sqrt(variance) / mean;
          if (cv > highestCv) {
            highestCv = cv;
            mostInconsistentExercise = {
              exerciseId,
              exerciseName,
              detail: `Load varied notably across sets this week (${formatWeight(Math.min(...loads), unitPref)}-${formatWeight(Math.max(...loads), unitPref)}${unitLabel(unitPref)}).`,
            };
          }
        }
      }
    }

    const sleepValues = checkins.map(c => c.sleepHours).filter((v): v is number => v != null);
    const sorenessValues = checkins.map(c => c.soreness).filter((v): v is number => v != null);
    const stressValues = checkins.map(c => c.stress).filter((v): v is number => v != null);
    const painReportCount = checkins.filter(c => c.hasPain).length;

    const averageReadinessScore = checkins.length > 0 ? average(checkins.map(c => c.readinessScore)) : null;
    const averageSleepHours = sleepValues.length > 0 ? average(sleepValues) : null;
    const averageSoreness = sorenessValues.length > 0 ? average(sorenessValues) : null;
    const averageStress = stressValues.length > 0 ? average(stressValues) : null;

    const habitObservation = buildHabitObservation({
      painReportCount,
      consistencyPercent,
      averageStress,
      averageSleepHours,
    });
    const recommendedChangesNextWeek = buildWeeklyRecommendation({
      painReportCount,
      trainingLoadClassification: trainingLoad.classification,
      consistencyPercent,
      mostImprovedExercise,
    });
    const summary = buildWeeklyReviewSummary({
      workoutsCompleted,
      workoutsMissed,
      totalVolumeKg,
      weekPrEvents,
      mostImprovedExercise,
      habitObservation,
      unitPref,
    });
    const shareableSummary = buildShareableWeeklySummary({
      workoutsCompleted,
      totalVolumeKg,
      prCount: weekPrEvents.length,
      consistencyPercent,
      unitPref,
    });

    return {
      weekStart,
      weekEnd,
      workoutsCompleted,
      workoutsMissed,
      consistencyPercent,
      totalVolumeKg,
      volumeByMuscleGroup,
      newPersonalRecords: weekPrEvents,
      mostImprovedExercise,
      mostInconsistentExercise,
      averageReadinessScore,
      averageSleepHours,
      averageSoreness,
      averageStress,
      painReportCount,
      trainingLoadClassification: trainingLoad.classification,
      habitObservation,
      recommendedChangesNextWeek,
      summary,
      shareableSummary,
    };
  }

  calculateReadinessTrend({ currentWeek, priorWeeks }: CalculateReadinessTrendParams): ReadinessTrendResult {
    // Windowed here (not trusted from the caller) — "up to
    // ROLLING_TREND_WEEKS, any order" per the param's own contract.
    const windowed = [...priorWeeks].sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, ROLLING_TREND_WEEKS);

    return {
      readiness: computeMetricTrend(
        currentWeek.averageReadinessScore,
        windowed.map(w => w.averageReadinessScore),
        READINESS_FLAT_BAND,
      ),
      sleep: computeMetricTrend(currentWeek.averageSleepHours, windowed.map(w => w.averageSleepHours), SLEEP_FLAT_BAND),
      soreness: computeMetricTrend(
        currentWeek.averageSoreness,
        windowed.map(w => w.averageSoreness),
        SORENESS_STRESS_FLAT_BAND,
      ),
      stress: computeMetricTrend(currentWeek.averageStress, windowed.map(w => w.averageStress), SORENESS_STRESS_FLAT_BAND),
    };
  }

  detectTrainingPatterns({
    weeklySnapshots,
    missedWeekdays,
    exerciseRpeTrends,
    dismissedKeys,
  }: DetectTrainingPatternsParams): TrainingPattern[] {
    const dismissed = new Set(dismissedKeys);
    const candidates: TrainingPattern[] = [
      ...detectInconsistentWeekdays(missedWeekdays),
      ...detectDecliningConsistency(weeklySnapshots),
      ...detectRecurringPain(weeklySnapshots),
      ...detectRpeCreep(exerciseRpeTrends),
      ...detectLowSleep(weeklySnapshots),
    ];

    return candidates
      .filter(pattern => !dismissed.has(pattern.key))
      .sort((a, b) => b.confidence - a.confidence);
  }

  predictPersonalRecords({ exerciseHistories, asOf, unitPref }: PredictPersonalRecordsParams): PrPrediction[] {
    const asOfDate = new Date(asOf);
    const lookbackStart = subDays(asOfDate, PREDICTION_LOOKBACK_DAYS);
    const targetDate = format(addDays(asOfDate, PREDICTION_HORIZON_DAYS), 'yyyy-MM-dd');

    const predictions: PrPrediction[] = [];
    for (const history of exerciseHistories) {
      const points = history.points.filter(p => {
        const pointDate = new Date(p.date);
        return pointDate >= lookbackStart && pointDate <= asOfDate;
      });
      if (points.length < PREDICTION_MIN_POINTS) continue;

      const firstDate = new Date(points[0].date);
      const spanDays = differenceInCalendarDays(new Date(points[points.length - 1].date), firstDate);
      if (spanDays < PREDICTION_MIN_SPAN_DAYS) continue;

      const { slope, intercept, r2 } = linearRegression(
        points.map(p => ({ x: differenceInCalendarDays(new Date(p.date), firstDate), y: p.e1rm })),
      );
      if (slope <= 0 || r2 < PREDICTION_MIN_R2) continue;

      const currentBestE1rm = Math.max(...points.map(p => p.e1rm));
      const horizonX = differenceInCalendarDays(addDays(asOfDate, PREDICTION_HORIZON_DAYS), firstDate);
      const predictedE1rm = intercept + slope * horizonX;
      if (predictedE1rm - currentBestE1rm < PREDICTION_MIN_GAIN_KG) continue;

      predictions.push({
        exerciseId: history.exerciseId,
        exerciseName: history.exerciseName,
        currentBestE1rm,
        predictedE1rm,
        targetDate,
        confidence: clamp(r2, 0, 1),
        summary: buildPrPredictionSummary({ exerciseName: history.exerciseName, predictedE1rm, targetDate, unitPref }),
      });
    }

    return predictions.sort((a, b) => b.confidence - a.confidence);
  }

  generateExerciseExplanation({ exercise }: GenerateExerciseExplanationParams): ExerciseExplanationResult {
    return {
      purpose: buildExercisePurpose(exercise),
      progressionCriteria: buildProgressionCriteria(exercise),
      regressionCriteria: buildRegressionCriteria(exercise),
    };
  }

  generateEnergySummary(params: GenerateEnergySummaryParams): EnergySummaryResult {
    return {
      headline: buildEnergySummaryHeadline(params),
      body: buildEnergySummaryText(params),
    };
  }
}

const DIFFICULTY_ORDER: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const JOINT_STRESS_ORDER: Record<string, number> = { low: 0, moderate: 1, high: 2 };

const COMPOUND_PATTERNS = new Set<string>([
  'squat',
  'hinge',
  'lunge',
  'push_horizontal',
  'push_vertical',
  'pull_horizontal',
  'pull_vertical',
  'carry',
]);

function isCompoundPattern(pattern: string | null): boolean {
  return pattern != null && COMPOUND_PATTERNS.has(pattern);
}

const VARIANT_LABELS: Record<WorkoutVariantType, string> = {
  full: 'Full Workout',
  time_45: '45-Minute Version',
  time_30: '30-Minute Version',
  hotel: 'Hotel Gym Version',
  home: 'Home Gym Version',
  bodyweight: 'Bodyweight Version',
  low_readiness: 'Low-Readiness Version',
  strength_focus: 'Strength-Focused Version',
  hypertrophy_focus: 'Hypertrophy-Focused Version',
  reduced_impact: 'Reduced-Impact Version',
};

const VARIANT_DESCRIPTIONS: Record<WorkoutVariantType, string> = {
  full: 'No changes — full session.',
  time_45: 'Trimmed to fit roughly 45 minutes, prioritizing your main lifts.',
  time_30: 'Trimmed to fit roughly 30 minutes, prioritizing your main lifts.',
  hotel: 'Swapped exercises that need a full gym for dumbbell/band/bodyweight versions.',
  home: 'Swapped exercises your home equipment can\'t cover.',
  bodyweight: 'Swapped every exercise for a bodyweight-only version.',
  low_readiness: 'Lightened for a lower-readiness day — fewer sets, easier RPE, more rest.',
  strength_focus: 'Shifted toward lower reps and higher effort.',
  hypertrophy_focus: 'Shifted toward moderate-to-higher reps and shorter rest.',
  reduced_impact: 'Swapped high-joint-stress exercises for gentler alternatives where possible.',
};

function equipmentAllowlistFor(
  variantType: 'hotel' | 'home' | 'bodyweight',
  availableEquipment: EquipmentType[] | null,
): EquipmentType[] {
  switch (variantType) {
    case 'bodyweight':
      return ['bodyweight'];
    case 'hotel':
      return ['bodyweight', 'dumbbell', 'band'];
    case 'home':
      return availableEquipment ?? ['bodyweight'];
  }
}

function buildSubstitutionReason(
  exercise: ExerciseMetadata,
  candidate: ExerciseMetadata,
  matchedOn: SubstitutionMatchSignal[],
): string {
  const parts: string[] = [];
  if (matchedOn.includes('movement_pattern') && exercise.movementPattern) {
    parts.push(`same ${exercise.movementPattern.replace('_', ' ')} pattern`);
  }
  if (matchedOn.includes('primary_muscle')) {
    parts.push(`same ${exercise.primaryMuscle} focus`);
  } else if (matchedOn.includes('category')) {
    parts.push(`similar ${exercise.category} movement`);
  }
  const whatMatched = parts.length > 0 ? parts.join(' and ') : 'a reasonable overall match';
  const equipmentNote =
    candidate.equipment !== exercise.equipment
      ? ` — uses ${candidate.equipment} instead of ${exercise.equipment}`
      : '';
  return `${whatMatched[0].toUpperCase()}${whatMatched.slice(1)}${equipmentNote}.`;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function buildSuggestedNextAction(input: {
  sessionPrEvents: PrEvent[];
  improvedExercises: ExercisePerformanceDelta[];
  declinedExercises: ExercisePerformanceDelta[];
  estimatedRecoveryNeeds: RecoveryNeed;
}): string {
  if (input.sessionPrEvents.length > 0) {
    return 'Great session — keep the same approach next time and let the new numbers become your new baseline.';
  }
  if (input.estimatedRecoveryNeeds === 'extra_rest') {
    return 'Consider an extra rest day (or a lighter session) before your next workout.';
  }
  if (input.declinedExercises.length > input.improvedExercises.length) {
    return "A few lifts dipped today — make sure you're recovering well before the next session.";
  }
  if (input.estimatedRecoveryNeeds === 'light_next_session') {
    return "That felt manageable — you're in good shape to push a little harder next time.";
  }
  return 'Right on track — keep progressing as planned.';
}

/** Picks one of several equivalent phrasings for an earned coaching remark.
 * Seeded on the fact it's reporting (exercise name, streak length, etc.)
 * *plus* the calendar date, so re-rendering the same screen within a day
 * never flickers to a different line, but the same PR or streak reads
 * differently from one day to the next instead of settling into one fixed
 * sentence forever. */
function pickPhrasing(variants: string[], seed: string): string {
  const daily = `${seed}-${new Date().toDateString()}`;
  let hash = 0;
  for (let i = 0; i < daily.length; i++) hash = (hash * 31 + daily.charCodeAt(i)) >>> 0;
  return variants[hash % variants.length];
}

/** `daysAgo` and `sameCalendarWeek` keep this honest about *when* the PR
 * actually happened — the lookback window it's drawn from (see recentPr in
 * TodayScreen) reaches back up to 6 days, so unconditionally saying "today"
 * (or "this week") would misdescribe a PR from earlier as having just
 * happened. The lookback never exceeds 6 days, so a PR that isn't in the
 * current calendar week is necessarily in the immediately preceding one —
 * "last week" is always accurate here, not just a guess. */
function recentPrPhrasings(exerciseName: string, daysAgo: number, sameCalendarWeek: boolean): string[] {
  // Every variant keeps `${exerciseName} ${when}` contiguous (tests assert on
  // that exact substring to check the "was this really today/this week/last
  // week" logic without pinning a single wording).
  const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : sameCalendarWeek ? 'this week' : 'last week';
  return [
    `You set a PR on ${exerciseName} ${when} — that strength is real now.`,
    `${exerciseName} ${when}: a new PR, and it wasn't luck — you earned it.`,
    `New best on ${exerciseName} ${when}. Keep stacking wins like that.`,
    `${exerciseName} ${when} — a new high. Proof the work is paying off.`,
    `You out-lifted your old self on ${exerciseName} ${when}. That's the whole game.`,
    `PR alert: ${exerciseName} ${when}. Carry that energy into your next session.`,
    `${exerciseName} ${when}: a new best. Your training's clearly working.`,
  ];
}

function streakPhrasings(streak: number): string[] {
  // Every variant contains a literal "${streak}-day" or "${streak} days" so
  // tests can assert on the number reported without pinning one wording.
  return [
    `You're on a ${streak}-day streak.`,
    `${streak} days in a row — showing up is the hard part, and you've nailed it.`,
    `You've shown great consistency lately — ${streak} days and counting.`,
    `${streak} days straight. That's not motivation, that's a habit.`,
    `${streak}-day streak going. Future you is going to thank present you.`,
    `${streak}-day streak and counting — keep the chain going.`,
    `${streak} days deep. Consistency like this is what actually moves the needle.`,
  ];
}

// Every variant mentions "yesterday" — tests assert on that to confirm this
// clause only fires when yesterday's session is the reason being cited.
const RECOVERED_WELL_PHRASINGS = [
  "You recovered well after yesterday's workout.",
  "Your effort yesterday is setting you up for a strong session today.",
  "Nice bounce-back from yesterday's session.",
  "Yesterday's work is banked — your body's ready to build on it today.",
  "Recovery's on track after yesterday — good day to push a bit.",
  "You bounced back well from yesterday — a sign your training load is dialed in.",
];

// Every variant mentions "cardio" — same substring-testing convention as
// REST_DAY_PHRASINGS below. No workout name/exercise list is available for
// this case (a weekly/program cardio day carries no template, just the
// day-type flag — see asTrainingEntry's own doc comment in TodayScreen),
// so unlike trainingDayOpeners this can't report a fact, only the kind of
// day it is.
const CARDIO_DAY_PHRASINGS = [
  "Cardio day — get the heart rate up.",
  "Cardio's on the schedule today.",
  "Today's built for cardio.",
  "Cardio day — any pace counts.",
  "Steady state or intervals — your call today.",
];

// Every variant mentions "rest day" — tests assert on that substring so the
// exact wording can rotate without pinning one fixed sentence.
const REST_DAY_PHRASINGS = [
  "Today is a rest day — recovery is part of the plan.",
  "Today's your rest day — take it easy, your body's doing the work now.",
  "Rest day today. Recovery is training too.",
  "It's a rest day — let your body catch up so tomorrow's session hits harder.",
  "Today's built for recovery, not lifting. Enjoy it.",
  "Rest day on the calendar — no workout needed, just rest well.",
  "Today's a scheduled rest day. Trust the process and recharge.",
  "Rest day. Even the iron needs a day off sometimes.",
  "It's a rest day — put the weights down, you've earned it.",
  "Rest day today. Tomorrow's iron will still be heavy, promise.",
];

/**
 * Arnold's Summary headline, by readiness band (plus the rest-day and
 * no-readiness-data cases) — picked daily via `pickPhrasing` so the same
 * band doesn't read as one frozen label forever. Kept short (this renders as
 * the card's bolded lede, not a full sentence) and, per the athlete's own
 * feedback that the card felt lifeless, actually got some personality this
 * pass instead of a single flat label per band.
 */
export const HEADLINE_PHRASINGS: Record<'rest_day' | 'cardio_day' | 'no_data' | ReadinessBand, string[]> = {
  rest_day: ['Rest day', 'Off day, on purpose', 'Recovery is the workout today', 'Rest hard today', "The iron gets a day off, too"],
  cardio_day: ['Cardio day', 'Heart rate up', 'Time to move', 'Cardio time'],
  no_data: ['Today', "Let's see what today brings", 'New day, fresh iron', "Today's the day"],
  high: ['Ready to train', 'Full send today', "Let's pump some iron", 'Green light — go time', "Today's a beast-mode day"],
  moderate: ['Good to go', 'Solid day for solid reps', 'Steady effort, steady gains', "On track — let's work"],
  low: ['Ease in today', 'Light on the gas today', 'Show up, take it easy', 'A gentler kind of strong today'],
  very_low: ['Take it easy today', 'Recovery mode: engaged', 'Low and slow today', 'Protect the gains — go easy today'],
};

/** Every variant keeps `${dayTitle} (${count} exercise[s])` contiguous, with
 * `, a deload week` appended when applicable — tests assert on that fact
 * fragment rather than one fixed sentence, same convention as
 * `recentPrPhrasings`/`streakPhrasings` below. */
function trainingDayOpeners(dayTitle: string, exerciseCount: number, isDeload: boolean): string[] {
  const fact = `${dayTitle} (${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'})${isDeload ? ', a deload week' : ''}`;
  return [
    `Today's plan is ${fact}. Let's move some iron.`,
    `On the menu today: ${fact} — the iron doesn't lift itself.`,
    `Up today: ${fact}. Go show it who's boss.`,
    `Today's plan is ${fact}. No excuses, just reps.`,
    `Today: ${fact}. Let's make it count.`,
    `Today's plan is ${fact}. Time to earn it.`,
  ];
}

/** Every variant keeps `"${name}"` (the exact scheduled-workout name, quoted)
 * intact — same substring-testing convention as the other phrasing pools. */
function scheduledOpeners(name: string): string[] {
  return [
    `You have "${name}" scheduled for today.`,
    `"${name}" is on the books for today — let's get it done.`,
    `Today's session: "${name}". Time to show up.`,
    `On today's schedule: "${name}" — let's make it happen.`,
    `You penciled in "${name}" for today. No skipping it now.`,
  ];
}

/** Every variant keeps the exact `dayTitle` contiguous, same convention as
 * the other phrasing pools. */
function completedOpeners(dayTitle: string): string[] {
  return [
    `You've already completed ${dayTitle} — nice work.`,
    `${dayTitle}: done and dusted. Nice work.`,
    `${dayTitle} is in the books — that's how it's done.`,
    `You already crushed ${dayTitle} today. Go put your feet up.`,
    `${dayTitle}, complete. The hard part's over.`,
  ];
}

export const NO_PLAN_PHRASINGS = [
  'Nothing is scheduled on today’s calendar.',
  'No plan on the books for today — a good day for a walk, or just rest.',
  "Today's wide open. Nothing on the calendar.",
  "Nothing scheduled today — the iron will still be there tomorrow.",
  "Calendar's clear today. Freestyle something if you're feeling it.",
];

const GOAL_LABEL: Record<GenerateEnergySummaryParams['goal'], string> = {
  cut: 'cut',
  bulk: 'bulk',
  maintain: 'maintenance',
};

// caloriesIn <= targetIntake is "on track" for every goal, cut/bulk/maintain
// alike — the goal only shapes targetIntake itself (see
// TARGET_NET_CALORIES_BY_GOAL in energyBalance.ts), so this comparison never
// needs to branch on which goal is set.
function buildEnergySummaryHeadline(input: GenerateEnergySummaryParams): string {
  if (input.entriesLoggedToday === 0) return 'Nothing logged yet today';
  const onTrack = input.caloriesIn <= input.targetIntake;
  return onTrack ? 'ON TRACK' : 'OFF TRACK';
}

/**
 * Deterministic, rule-based — same posture as buildTodayFocusSummaryText
 * just below and cardioCalories.ts's own energy math: no LLM call, just
 * arithmetic already computed by computeDailyEnergyTotals composed into a
 * sentence or two.
 */
function buildEnergySummaryText(input: GenerateEnergySummaryParams): string {
  const parts: string[] = [];

  if (input.entriesLoggedToday === 0) {
    parts.push("Nothing logged yet today — snap a photo of your next meal and I'll take it from there.");
    return parts.join(' ');
  }

  const netAbs = Math.abs(Math.round(input.net));
  const netDirection = input.net < 0 ? 'deficit' : input.net > 0 ? 'surplus' : 'even';
  parts.push(
    netDirection === 'even'
      ? "You're exactly even today."
      : `You're at a ${netAbs} cal ${netDirection} today.`,
  );

  const remaining = input.targetIntake - input.caloriesIn;
  if (remaining >= 0) {
    parts.push(`That leaves about ${Math.round(remaining)} cal to stay on pace for your ${GOAL_LABEL[input.goal]}.`);
  } else {
    parts.push(`That's ${Math.abs(Math.round(remaining))} cal over pace for your ${GOAL_LABEL[input.goal]} — not a big deal on its own, just something to notice.`);
  }

  if (input.proteinTargetG > 0) {
    const proteinRatio = input.proteinG / input.proteinTargetG;
    if (proteinRatio < 0.5) {
      parts.push(`Protein's light so far (${Math.round(input.proteinG)}g of ${input.proteinTargetG}g) — worth making up ground at your next meal.`);
    }
  }

  if (input.hasEveningMealGap) {
    parts.push("It's been a few hours since your last meal — worth logging dinner before you lose track of it.");
  }

  return parts.join(' ');
}

function buildTodayFocusSummaryText(input: GenerateTodayFocusSummaryParams): string {
  const {
    readiness,
    plan,
    recentPr,
    missedYesterday,
    completedYesterday,
    isMilestoneWeek,
    currentWeekNumber,
    weeksCount,
    streak,
  } = input;
  const parts: string[] = [];

  switch (plan.kind) {
    case 'rest_day':
      parts.push(pickPhrasing(REST_DAY_PHRASINGS, 'rest-day'));
      break;
    case 'cardio_day':
      parts.push(pickPhrasing(CARDIO_DAY_PHRASINGS, 'cardio-day'));
      break;
    case 'training_day': {
      const dayTitle = plan.dayTitle ?? 'a training day';
      parts.push(
        pickPhrasing(trainingDayOpeners(dayTitle, plan.exerciseCount, plan.isDeload), `${dayTitle}-${plan.exerciseCount}`),
      );
      break;
    }
    case 'scheduled':
      parts.push(pickPhrasing(scheduledOpeners(plan.name), plan.name));
      break;
    case 'completed': {
      const dayTitle = plan.dayTitle ?? "today's workout";
      parts.push(pickPhrasing(completedOpeners(dayTitle), dayTitle));
      break;
    }
    case 'none':
      parts.push(pickPhrasing(NO_PLAN_PHRASINGS, 'no-plan'));
      break;
  }

  if (readiness) {
    parts.push(readiness.summary);
    if (plan.kind === 'training_day' || plan.kind === 'scheduled') {
      const [lo, hi] = readiness.recommendedRpeRange;
      parts.push(`Aim for RPE ${lo}-${hi} today.`);
    }
    // readiness.summary only names a factor when it's among the top negative
    // contributors to the score — a good/neutral Whoop day would otherwise
    // never get mentioned at all, even though the athlete is connected and
    // it's right there. Surface it unconditionally whenever available so
    // "connected + scored" always means "shows up in today's summary."
    const wearableFactor = readiness.factors.find(f => f.key === 'wearable_recovery');
    if (wearableFactor?.available) {
      parts.push(wearableFactor.detail);
    }
    // Same reasoning as wearableFactor above — the athlete's own check-in
    // words should always show up when present, not just when they happen
    // to be one of the top negative factors.
    const notesFactor = readiness.factors.find(f => f.key === 'notes');
    if (notesFactor?.available) {
      parts.push(`You noted: ${notesFactor.detail}.`);
    }
  }

  if (missedYesterday) {
    parts.push("Yesterday's session is still open — jump back in when you're ready.");
  } else if (recentPr) {
    parts.push(
      pickPhrasing(
        recentPrPhrasings(recentPr.exerciseName, recentPr.daysAgo, recentPr.sameCalendarWeek),
        recentPr.exerciseName,
      ),
    );
  } else if (
    completedYesterday &&
    readiness &&
    (readiness.band === 'high' || readiness.band === 'moderate') &&
    (plan.kind === 'training_day' || plan.kind === 'scheduled')
  ) {
    parts.push(pickPhrasing(RECOVERED_WELL_PHRASINGS, `${readiness.band}-${streak}`));
  } else if (isMilestoneWeek && currentWeekNumber != null) {
    parts.push(
      currentWeekNumber === weeksCount
        ? `Week ${currentWeekNumber} of ${weeksCount} — final week, finish strong.`
        : `Week ${currentWeekNumber} of ${weeksCount} — right on schedule.`,
    );
  } else if (streak > 2) {
    parts.push(pickPhrasing(streakPhrasings(streak), String(streak)));
  }

  return parts.join(' ');
}

function buildPostWorkoutSummaryText(input: {
  totalVolumeKg: number;
  volumeChangePercent: number | null;
  sessionPrEvents: PrEvent[];
  improvedExercises: ExercisePerformanceDelta[];
  declinedExercises: ExercisePerformanceDelta[];
  estimatedRecoveryNeeds: RecoveryNeed;
  painOrFatigueConcern: string | null;
  unitPref: UnitPreference;
}): string {
  const parts: string[] = [];

  let volumeSentence = `You moved ${formatVolume(input.totalVolumeKg, input.unitPref)}${unitLabel(input.unitPref)} of total volume today`;
  if (input.volumeChangePercent != null) {
    const direction = input.volumeChangePercent >= 0 ? 'up' : 'down';
    volumeSentence += `, ${direction} ${Math.abs(Math.round(input.volumeChangePercent))}% from last time`;
  }
  parts.push(`${volumeSentence}.`);

  if (input.sessionPrEvents.length === 1) {
    const prName = input.sessionPrEvents[0].exerciseName;
    parts.push(
      pickPhrasing(
        [
          `That ${prName} PR wasn't luck.`,
          `You just set a PR on ${prName} — nice work.`,
          `New best on ${prName} today — that's real progress.`,
          `${prName} just hit a new high. Well earned.`,
          `You out-did yourself on ${prName} today.`,
        ],
        prName,
      ),
    );
  } else if (input.sessionPrEvents.length > 1) {
    parts.push(
      pickPhrasing(
        [
          `You set ${input.sessionPrEvents.length} new personal records today — that's a huge session.`,
          `${input.sessionPrEvents.length} PRs in one day. That's exceptional work.`,
          `${input.sessionPrEvents.length} new bests today — you clearly showed up ready.`,
        ],
        String(input.sessionPrEvents.length),
      ),
    );
  }

  if (input.improvedExercises.length > 0 || input.declinedExercises.length > 0) {
    const bits: string[] = [];
    if (input.improvedExercises.length > 0) {
      bits.push(`${input.improvedExercises.length} exercise${input.improvedExercises.length === 1 ? '' : 's'} trending up`);
    }
    if (input.declinedExercises.length > 0) {
      bits.push(`${input.declinedExercises.length} trending down`);
    }
    parts.push(`Compared with last time: ${bits.join(', ')}.`);
  }

  if (input.painOrFatigueConcern) {
    parts.push(input.painOrFatigueConcern);
  } else if (input.estimatedRecoveryNeeds === 'extra_rest') {
    parts.push('This looked like a demanding session — plan for a bit more recovery.');
  }

  return parts.join(' ');
}

/** Coefficient-of-variation floor below which load variance across a week's
 * sets is just normal noise, not something worth flagging as "inconsistent." */
const INCONSISTENCY_CV_THRESHOLD = 0.15;

function buildHabitObservation(input: {
  painReportCount: number;
  consistencyPercent: number | null;
  averageStress: number | null;
  averageSleepHours: number | null;
}): string | null {
  if (input.painReportCount > 0) {
    return `Discomfort came up on ${input.painReportCount} day${input.painReportCount === 1 ? '' : 's'} this week.`;
  }
  if (input.consistencyPercent != null && input.consistencyPercent < 70) {
    return 'A few planned sessions were missed this week.';
  }
  if (input.averageStress != null && input.averageStress >= 4) {
    return 'Stress levels ran high this week.';
  }
  if (input.averageSleepHours != null && input.averageSleepHours < 6) {
    return 'Sleep averaged under 6 hours this week.';
  }
  return null;
}

function buildWeeklyRecommendation(input: {
  painReportCount: number;
  trainingLoadClassification: TrainingLoadClassification;
  consistencyPercent: number | null;
  mostImprovedExercise: ExerciseImprovement | null;
}): string {
  if (input.painReportCount > 0) {
    return "Consider addressing the discomfort you reported before next week's sessions.";
  }
  if (input.trainingLoadClassification === 'high') {
    return 'Ease off slightly next week to let recovery catch up.';
  }
  if (input.consistencyPercent != null && input.consistencyPercent < 70) {
    return 'Aim to hit more of your planned sessions next week.';
  }
  if (input.mostImprovedExercise) {
    return pickPhrasing(
      [
        `Keep building on your progress with ${input.mostImprovedExercise.exerciseName}.`,
        `${input.mostImprovedExercise.exerciseName} is trending up — keep pushing it.`,
        `Whatever you're doing with ${input.mostImprovedExercise.exerciseName}, it's working. Stay on it.`,
      ],
      input.mostImprovedExercise.exerciseName,
    );
  }
  return "Keep the same approach — it's working.";
}

function buildWeeklyReviewSummary(input: {
  workoutsCompleted: number;
  workoutsMissed: number;
  totalVolumeKg: number;
  weekPrEvents: PrEvent[];
  mostImprovedExercise: ExerciseImprovement | null;
  habitObservation: string | null;
  unitPref: UnitPreference;
}): string {
  const parts: string[] = [];
  parts.push(
    `You completed ${input.workoutsCompleted} workout${input.workoutsCompleted === 1 ? '' : 's'} this week` +
      (input.workoutsMissed > 0 ? ` and missed ${input.workoutsMissed}` : '') +
      `, moving ${formatVolume(input.totalVolumeKg, input.unitPref)}${unitLabel(input.unitPref)} of total volume.`,
  );
  if (input.weekPrEvents.length > 0) {
    parts.push(
      `You set ${input.weekPrEvents.length} new personal record${input.weekPrEvents.length === 1 ? '' : 's'}.`,
    );
  }
  if (input.mostImprovedExercise) {
    parts.push(
      `${input.mostImprovedExercise.exerciseName} looked strongest, up ~${Math.round(input.mostImprovedExercise.changePercent)}%.`,
    );
  }
  if (input.habitObservation) {
    parts.push(input.habitObservation);
  }
  return parts.join(' ');
}

function buildShareableWeeklySummary(input: {
  workoutsCompleted: number;
  totalVolumeKg: number;
  prCount: number;
  consistencyPercent: number | null;
  unitPref: UnitPreference;
}): string {
  const parts: string[] = [
    `${input.workoutsCompleted} workout${input.workoutsCompleted === 1 ? '' : 's'} completed this week`,
    `${formatVolume(input.totalVolumeKg, input.unitPref)}${unitLabel(input.unitPref)} total volume`,
  ];
  if (input.prCount > 0) {
    parts.push(`${input.prCount} new PR${input.prCount === 1 ? '' : 's'}`);
  }
  if (input.consistencyPercent != null) {
    parts.push(`${Math.round(input.consistencyPercent)}% consistency`);
  }
  return parts.join(' · ');
}

/** One metric's trend: null if there's no current-week value to compare at
 * all, or fewer than MIN_QUALIFYING_WEEKS of the (already-windowed) prior
 * values are non-null — never fabricated as 'flat' for missing data, same
 * suppress-don't-guess posture predictPersonalRecords' guards already use. */
function computeMetricTrend(currentValue: number | null, priorValues: Array<number | null>, flatBand: number): MetricTrend {
  if (currentValue == null) return null;
  const qualifying = priorValues.filter((v): v is number => v != null);
  if (qualifying.length < MIN_QUALIFYING_WEEKS) return null;

  const baselineValue = average(qualifying);
  const delta = currentValue - baselineValue;
  const direction: ReadinessTrendDirection = Math.abs(delta) <= flatBand ? 'flat' : delta > 0 ? 'up' : 'down';
  return { direction, currentValue, baselineValue, qualifyingWeeks: qualifying.length };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const INCONSISTENT_WEEKDAY_MIN_OPPORTUNITIES = 3;
const INCONSISTENT_WEEKDAY_RATIO_THRESHOLD = 0.6;

function detectInconsistentWeekdays(missedWeekdays: MissedWeekdayInput[]): TrainingPattern[] {
  const patterns: TrainingPattern[] = [];
  for (const entry of missedWeekdays) {
    if (entry.opportunities < INCONSISTENT_WEEKDAY_MIN_OPPORTUNITIES) continue;
    const ratio = entry.missed / entry.opportunities;
    if (ratio < INCONSISTENT_WEEKDAY_RATIO_THRESHOLD) continue;
    const dayName = WEEKDAY_NAMES[entry.weekday];
    patterns.push({
      key: `inconsistent_weekday:${entry.weekday}`,
      type: 'inconsistent_weekday',
      confidence: clamp(ratio, 0, 1),
      title: `${dayName} sessions keep getting skipped`,
      detail: `You've missed ${entry.missed} of ${entry.opportunities} planned ${dayName} sessions recently.`,
      evidenceSummary: `${entry.missed}/${entry.opportunities} ${dayName} sessions missed`,
    });
  }
  return patterns;
}

const DECLINING_CONSISTENCY_MIN_RUN = 3;

function detectDecliningConsistency(weeklySnapshots: WeeklyPatternSnapshot[]): TrainingPattern[] {
  let runEnd = weeklySnapshots.length - 1;
  while (runEnd >= 0 && weeklySnapshots[runEnd].consistencyPercent == null) runEnd--;
  if (runEnd < DECLINING_CONSISTENCY_MIN_RUN - 1) return [];

  let runStart = runEnd;
  while (
    runStart > 0 &&
    weeklySnapshots[runStart - 1].consistencyPercent != null &&
    (weeklySnapshots[runStart - 1].consistencyPercent as number) >
      (weeklySnapshots[runStart].consistencyPercent as number)
  ) {
    runStart--;
  }

  const runLength = runEnd - runStart + 1;
  if (runLength < DECLINING_CONSISTENCY_MIN_RUN) return [];

  const first = weeklySnapshots[runStart].consistencyPercent as number;
  const last = weeklySnapshots[runEnd].consistencyPercent as number;
  const confidence = clamp(0.5 + (first - last) / 100, 0.5, 1);

  return [
    {
      key: 'declining_consistency',
      type: 'declining_consistency',
      confidence,
      title: 'Consistency has been sliding',
      detail: `Weekly consistency dropped for ${runLength} weeks in a row, from ${Math.round(first)}% to ${Math.round(last)}%.`,
      evidenceSummary: `${runLength} consecutive declining weeks (${Math.round(first)}% -> ${Math.round(last)}%)`,
    },
  ];
}

const RECURRING_PAIN_LOOKBACK_WEEKS = 4;
const RECURRING_PAIN_MIN_WEEKS = 2;

function detectRecurringPain(weeklySnapshots: WeeklyPatternSnapshot[]): TrainingPattern[] {
  const recent = weeklySnapshots.slice(-RECURRING_PAIN_LOOKBACK_WEEKS);
  if (recent.length === 0) return [];
  const painWeeks = recent.filter(w => w.painReportCount > 0).length;
  if (painWeeks < RECURRING_PAIN_MIN_WEEKS) return [];

  return [
    {
      key: 'recurring_pain',
      type: 'recurring_pain',
      confidence: clamp(painWeeks / recent.length, 0, 1),
      title: 'Discomfort has come up more than once',
      detail: `You've reported some discomfort in ${painWeeks} of the last ${recent.length} weeks. Worth mentioning to a professional if it continues.`,
      evidenceSummary: `Pain reported in ${painWeeks}/${recent.length} recent weeks`,
    },
  ];
}

const RPE_CREEP_MIN_SESSIONS = 6;
const RPE_CREEP_MIN_INCREASE = 1;
const RPE_CREEP_MAX_LOAD_INCREASE_RATIO = 1.05;

function detectRpeCreep(exerciseRpeTrends: ExerciseRpeTrendInput[]): TrainingPattern[] {
  const patterns: TrainingPattern[] = [];

  for (const trend of exerciseRpeTrends) {
    if (trend.sessions.length < RPE_CREEP_MIN_SESSIONS) continue;

    const thirdSize = Math.floor(trend.sessions.length / 3);
    const earliest = trend.sessions.slice(0, thirdSize);
    const latest = trend.sessions.slice(trend.sessions.length - thirdSize);
    const earliestAvgRpe = average(earliest.map(s => s.rpe));
    const latestAvgRpe = average(latest.map(s => s.rpe));
    const rpeIncrease = latestAvgRpe - earliestAvgRpe;
    if (rpeIncrease < RPE_CREEP_MIN_INCREASE) continue;

    const earliestLoads = earliest.map(s => s.loadKg).filter((v): v is number => v != null);
    const latestLoads = latest.map(s => s.loadKg).filter((v): v is number => v != null);
    if (earliestLoads.length > 0 && latestLoads.length > 0) {
      const earliestAvgLoad = average(earliestLoads);
      const latestAvgLoad = average(latestLoads);
      // A load increase is a legitimate reason RPE rose too — only flag creep
      // when the exercise got harder without getting meaningfully heavier.
      if (earliestAvgLoad > 0 && latestAvgLoad / earliestAvgLoad > RPE_CREEP_MAX_LOAD_INCREASE_RATIO) continue;
    }

    patterns.push({
      key: `rpe_creep:${trend.exerciseId}`,
      type: 'rpe_creep',
      confidence: clamp(0.4 + rpeIncrease * 0.2, 0, 1),
      title: `${trend.exerciseName} is feeling harder`,
      detail: `Average effort on ${trend.exerciseName} rose about ${rpeIncrease.toFixed(1)} RPE points at a similar load — a sign of accumulating fatigue.`,
      evidenceSummary: `RPE ${earliestAvgRpe.toFixed(1)} -> ${latestAvgRpe.toFixed(1)} at ~stable load`,
    });
  }

  return patterns;
}

const LOW_SLEEP_LOOKBACK_WEEKS = 4;
const LOW_SLEEP_MIN_WEEKS = 3;
const LOW_SLEEP_THRESHOLD_HOURS = 6.5;

function detectLowSleep(weeklySnapshots: WeeklyPatternSnapshot[]): TrainingPattern[] {
  const recent = weeklySnapshots
    .slice(-LOW_SLEEP_LOOKBACK_WEEKS)
    .filter((w): w is WeeklyPatternSnapshot & { averageSleepHours: number } => w.averageSleepHours != null);
  if (recent.length < LOW_SLEEP_MIN_WEEKS) return [];
  const lowSleepWeeks = recent.filter(w => w.averageSleepHours < LOW_SLEEP_THRESHOLD_HOURS).length;
  if (lowSleepWeeks < LOW_SLEEP_MIN_WEEKS) return [];

  return [
    {
      key: 'low_sleep_pattern',
      type: 'low_sleep_pattern',
      confidence: clamp(lowSleepWeeks / recent.length, 0, 1),
      title: 'Sleep has been running short',
      detail: `Average sleep was under ${LOW_SLEEP_THRESHOLD_HOURS}h in ${lowSleepWeeks} of the last ${recent.length} weeks with check-ins.`,
      evidenceSummary: `Low sleep in ${lowSleepWeeks}/${recent.length} recent weeks`,
    },
  ];
}

const PREDICTION_LOOKBACK_DAYS = 90;
const PREDICTION_HORIZON_DAYS = 42;
const PREDICTION_MIN_POINTS = 4;
const PREDICTION_MIN_SPAN_DAYS = 14;
const PREDICTION_MIN_R2 = 0.3;
const PREDICTION_MIN_GAIN_KG = 1;

// Multi-week readiness trending (docs/coaching-history.md, Phase 2) — a
// current-week-vs-rolling-baseline comparison, not a fitted trend line, so
// there's no R²/confidence to compute here the way predictPersonalRecords
// above has one. ROLLING_TREND_WEEKS matches Phase 8's own 6-week
// training_patterns lookback rather than picking a new arbitrary number.
const ROLLING_TREND_WEEKS = 6;
const MIN_QUALIFYING_WEEKS = 3;
const READINESS_FLAT_BAND = 5; // points, 0-100 scale
const SLEEP_FLAT_BAND = 0.5; // hours
const SORENESS_STRESS_FLAT_BAND = 0.5; // 1-5 scale

function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number; r2: number } {
  const meanX = average(points.map(p => p.x));
  const meanY = average(points.map(p => p.y));

  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  for (const { x, y } of points) {
    ssXY += (x - meanX) * (y - meanY);
    ssXX += (x - meanX) ** 2;
    ssYY += (y - meanY) ** 2;
  }

  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const intercept = meanY - slope * meanX;
  const r2 = ssXX > 0 && ssYY > 0 ? (ssXY * ssXY) / (ssXX * ssYY) : 0;

  return { slope, intercept, r2 };
}

function buildPrPredictionSummary(input: {
  exerciseName: string;
  predictedE1rm: number;
  targetDate: string;
  unitPref: UnitPreference;
}): string {
  const formattedDate = format(new Date(input.targetDate), 'MMM d');
  return (
    `At this pace, your ${input.exerciseName} could reach ~${formatWeight(input.predictedE1rm, input.unitPref)}${unitLabel(input.unitPref)} by ${formattedDate}` +
    ' — a rough projection based on your recent trend, not a guarantee.'
  );
}

const MOVEMENT_PATTERN_PURPOSE: Record<MovementPattern, string> = {
  squat:
    'builds lower-body strength through a squat pattern — the hip/knee mechanics carry over to your other squat and lunge work',
  hinge:
    'trains the hip-hinge pattern, building posterior-chain strength that underpins deadlifts and carries over to sprinting and jumping power',
  lunge: "trains a single-leg squat/lunge pattern, building unilateral strength and balance a barbell squat alone doesn't cover",
  push_horizontal: 'builds horizontal pushing strength (chest, shoulders, triceps) — the pattern behind bench-press-style lifts',
  push_vertical: 'builds vertical pushing strength (shoulders, triceps) — the pattern behind overhead-press-style lifts',
  pull_horizontal: 'builds horizontal pulling strength through your upper back, balancing out your pushing work and supporting posture',
  pull_vertical: 'builds vertical pulling strength through your lats and back — the pattern behind pull-up/lat-pulldown-style lifts',
  carry: 'builds total-body stability and grip under load — a pattern that rarely gets trained directly outside loaded-carry work',
  rotation: "trains rotational core strength and control, which most straight-line lifts don't challenge directly",
  isolation: 'isolates a single muscle group directly — useful for targeted growth or bringing up an area compound lifts undertrain',
  core: 'builds core strength and stability that supports every other lift in your program',
  cardio: 'builds cardiovascular conditioning and work capacity, supporting recovery between sets and sessions',
};

const CATEGORY_PURPOSE: Record<ExerciseCategory, string> = {
  push: 'builds pushing strength through your chest, shoulders, and triceps',
  pull: 'builds pulling strength through your back and biceps, balancing out your pushing work',
  legs: 'builds lower-body strength and stability',
  core: 'builds core strength and stability that supports every other lift in your program',
  full_body: 'trains multiple muscle groups together, building coordination as well as strength',
  cardio: 'builds cardiovascular conditioning and work capacity',
  mobility: 'improves range of motion and movement quality, supporting your other lifts',
};

function buildExercisePurpose(exercise: ExerciseMetadata): string {
  const description = exercise.movementPattern
    ? MOVEMENT_PATTERN_PURPOSE[exercise.movementPattern]
    : CATEGORY_PURPOSE[exercise.category];
  return `This exercise ${description}. It primarily targets your ${exercise.primaryMuscle}.`;
}

function buildProgressionCriteria(exercise: ExerciseMetadata): string {
  if (exercise.category === 'cardio') {
    return 'Progress by extending duration or increasing pace/intensity once the current session feels comfortably sustainable — not by adding load.';
  }
  if (exercise.category === 'mobility') {
    return 'Progress by increasing range of motion or hold time once the current range feels controlled and pain-free.';
  }
  return 'Once you can complete every set at the top of your rep range with 1-2 reps left in reserve, add weight next session.';
}

function buildRegressionCriteria(exercise: ExerciseMetadata): string {
  let base: string;
  if (exercise.category === 'cardio') {
    base = "If you can't sustain the target pace or duration, reduce the intensity or shorten the session rather than pushing through.";
  } else if (exercise.category === 'mobility') {
    base = "If a position causes pain or you can't control the range, back off to a smaller range of motion.";
  } else {
    base = "If you're missing reps or grinding well before the target RPE, drop the weight or trim the rep range for a session or two.";
  }
  if (exercise.jointStress === 'high') {
    base +=
      " This one is higher-impact on your joints — if it's bothering you, check the suitable alternatives below for a lower-impact swap.";
  }
  return base;
}

export type { AdaptationExerciseTarget };
