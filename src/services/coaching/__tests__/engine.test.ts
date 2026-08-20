import { LocalCoachingEngine, HEADLINE_PHRASINGS, NO_PLAN_PHRASINGS } from '../engine';
import type {
  AdaptationExerciseTarget,
  CompletedSetInfo,
  ExerciseMetadata,
  GenerateTodayFocusSummaryParams,
  PainRiskAssessment,
  ReadinessInputs,
  ReadinessResult,
} from '../types';
import type { LoggedSet } from '../../api/queries/progress';
import { kgToLb, lbToKg } from '../../../utils/units';

describe('LocalCoachingEngine.evaluateReadiness', () => {
  const engine = new LocalCoachingEngine();

  it('scores a fully-reported, well-rested day as high readiness', () => {
    const inputs: ReadinessInputs = {
      checkin: {
        sleepHours: 8,
        sleepQuality: 5,
        soreness: 1,
        stress: 1,
        hasPain: false,
        painNotes: null,
        notes: null,
      },
      wearable: null,
      trainingLoad: { acuteVolumeKg: 1000, chronicAvgVolumeKg: 1000, loadRatio: 1, classification: 'normal' },
      daysSinceLastWorkout: 2,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: null,
    };

    const result = engine.evaluateReadiness(inputs);

    expect(result.score).toBe(100);
    expect(result.band).toBe('high');
    expect(result.recommendedIntensity).toBe('full');
  });

  it('treats missing signals as unavailable rather than penalizing the score', () => {
    const inputs: ReadinessInputs = {
      checkin: null,
      wearable: null,
      trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' },
      daysSinceLastWorkout: null,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: null,
    };

    const result = engine.evaluateReadiness(inputs);

    expect(result.score).toBe(100);
    const checkinFactors = result.factors.filter(f =>
      ['sleep', 'sleep_quality', 'soreness', 'stress', 'pain'].includes(f.key),
    );
    expect(checkinFactors.every(f => f.available === false)).toBe(true);
    expect(result.factors.find(f => f.key === 'training_load')?.available).toBe(false);
    expect(result.factors.find(f => f.key === 'time_since_last_workout')?.available).toBe(false);
  });

  it('drives the score down to very_low when every signal is poor', () => {
    const inputs: ReadinessInputs = {
      checkin: {
        sleepHours: 4,
        sleepQuality: 1,
        soreness: 5,
        stress: 5,
        hasPain: true,
        painNotes: null,
        notes: null,
      },
      wearable: null,
      trainingLoad: { acuteVolumeKg: 3000, chronicAvgVolumeKg: 1000, loadRatio: 3, classification: 'high' },
      daysSinceLastWorkout: 10,
      missedWorkoutsLast14Days: 3,
      priorAverageSoreness: null,
    };

    const result = engine.evaluateReadiness(inputs);

    expect(result.band).toBe('very_low');
    expect(result.recommendedIntensity).toBe('recovery_only');
    expect(result.summary.toLowerCase()).toMatch(/appears|may/);
  });

  it('shows soreness trending down (improving) as green/down even though today\'s rating still dings readiness', () => {
    const inputs: ReadinessInputs = {
      checkin: {
        sleepHours: 8,
        sleepQuality: 5,
        soreness: 2,
        stress: 1,
        hasPain: false,
        painNotes: null,
        notes: null,
      },
      wearable: null,
      trainingLoad: { acuteVolumeKg: 1000, chronicAvgVolumeKg: 1000, loadRatio: 1, classification: 'normal' },
      daysSinceLastWorkout: 2,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: 4,
    };

    const result = engine.evaluateReadiness(inputs);

    const soreness = result.factors.find(f => f.key === 'soreness');
    expect(soreness?.impact).toBe('negative');
    expect(soreness?.trend).toBe('down');
    expect(soreness?.displayImpact).toBe('positive');
  });

  it('shows soreness trending up (worsening) as red/up', () => {
    const inputs: ReadinessInputs = {
      checkin: {
        sleepHours: 8,
        sleepQuality: 5,
        soreness: 4,
        stress: 1,
        hasPain: false,
        painNotes: null,
        notes: null,
      },
      wearable: null,
      trainingLoad: { acuteVolumeKg: 1000, chronicAvgVolumeKg: 1000, loadRatio: 1, classification: 'normal' },
      daysSinceLastWorkout: 2,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: 1.5,
    };

    const result = engine.evaluateReadiness(inputs);

    const soreness = result.factors.find(f => f.key === 'soreness');
    expect(soreness?.trend).toBe('up');
    expect(soreness?.displayImpact).toBe('negative');
  });

  it('lowers the score and reports an available wearable_recovery factor when Whoop recovery is poor', () => {
    const inputs: ReadinessInputs = {
      checkin: null,
      wearable: { source: 'whoop', recoveryScore: 25, sleepPerformancePct: 60, strain: 14 },
      trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' },
      daysSinceLastWorkout: null,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: null,
    };

    const result = engine.evaluateReadiness(inputs);

    expect(result.score).toBeLessThan(100);
    const wearableFactor = result.factors.find(f => f.key === 'wearable_recovery');
    expect(wearableFactor?.available).toBe(true);
    expect(wearableFactor?.impact).toBe('negative');
    expect(wearableFactor?.label).toBe('Whoop recovery');
    expect(wearableFactor?.detail).toContain('Whoop recovery is 25% today');
  });

  it('mentions HRV and a notable sleep debt in the wearable_recovery detail text when Whoop provides them', () => {
    const inputs: ReadinessInputs = {
      checkin: null,
      wearable: {
        source: 'whoop',
        recoveryScore: 72,
        sleepPerformancePct: 80,
        strain: 10,
        hrvMs: 48,
        sleepDebtMinutes: 95, // 1h 35m
      },
      trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' },
      daysSinceLastWorkout: null,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: null,
    };

    const result = engine.evaluateReadiness(inputs);

    const wearableFactor = result.factors.find(f => f.key === 'wearable_recovery');
    expect(wearableFactor?.detail).toContain('HRV 48ms');
    expect(wearableFactor?.detail).toContain('sleep debt 1h 35m');
  });

  it('omits sleep debt from the detail text when it is small enough not to be worth mentioning', () => {
    const inputs: ReadinessInputs = {
      checkin: null,
      wearable: {
        source: 'whoop',
        recoveryScore: 72,
        sleepPerformancePct: 80,
        strain: 10,
        hrvMs: null,
        sleepDebtMinutes: 12,
      },
      trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' },
      daysSinceLastWorkout: null,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: null,
    };

    const result = engine.evaluateReadiness(inputs);

    const wearableFactor = result.factors.find(f => f.key === 'wearable_recovery');
    expect(wearableFactor?.detail).not.toContain('sleep debt');
    expect(wearableFactor?.detail).not.toContain('HRV');
  });

  it('lowers the score and reports a source-aware wearable_recovery factor when Oura readiness is poor', () => {
    const inputs: ReadinessInputs = {
      checkin: null,
      wearable: { source: 'oura', recoveryScore: 25, sleepPerformancePct: 60, strain: null },
      trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' },
      daysSinceLastWorkout: null,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: null,
    };

    const result = engine.evaluateReadiness(inputs);

    expect(result.score).toBeLessThan(100);
    const wearableFactor = result.factors.find(f => f.key === 'wearable_recovery');
    expect(wearableFactor?.available).toBe(true);
    expect(wearableFactor?.impact).toBe('negative');
    expect(wearableFactor?.label).toBe('Oura readiness');
    expect(wearableFactor?.detail).toContain('Oura readiness is 25% today');
    // Whoop-only metric — Oura has no strain equivalent, so it should never
    // appear in the detail text for an Oura-sourced reading.
    expect(wearableFactor?.detail).not.toContain('strain');
  });

  it('treats a null wearable input as unavailable, not zero', () => {
    const inputs: ReadinessInputs = {
      checkin: null,
      wearable: null,
      trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' },
      daysSinceLastWorkout: null,
      missedWorkoutsLast14Days: 0,
      priorAverageSoreness: null,
    };

    const result = engine.evaluateReadiness(inputs);

    const wearableFactor = result.factors.find(f => f.key === 'wearable_recovery');
    expect(wearableFactor?.available).toBe(false);
    expect(wearableFactor?.impact).toBe('neutral');
    expect(result.score).toBe(100);
  });
});

describe('LocalCoachingEngine.calculateTrainingLoad', () => {
  const engine = new LocalCoachingEngine();
  const asOf = new Date('2024-06-15T00:00:00.000Z');

  function set(daysBeforeAsOf: number, loadKg: number, reps: number): LoggedSet {
    const loggedAt = new Date(asOf.getTime() - daysBeforeAsOf * 86_400_000).toISOString();
    return { id: `s-${daysBeforeAsOf}-${loadKg}-${reps}`, exerciseId: 'ex1', exerciseName: 'Squat', loadKg, reps, loggedAt };
  }

  it('classifies a sharp acute spike over chronic average as high', () => {
    const sets: LoggedSet[] = [
      set(1, 100, 5),
      set(2, 100, 5),
      set(3, 100, 5),
      // chronic window (7-35 days back): steady lower volume
      set(10, 50, 5),
      set(17, 50, 5),
      set(24, 50, 5),
      set(31, 50, 5),
    ];

    const result = engine.calculateTrainingLoad(sets, asOf);

    expect(result.classification).toBe('high');
    expect(result.loadRatio).not.toBeNull();
    expect(result.loadRatio as number).toBeGreaterThan(1.3);
  });

  it('returns unknown when there is no chronic history to compare against', () => {
    const sets: LoggedSet[] = [set(1, 100, 5)];
    const result = engine.calculateTrainingLoad(sets, asOf);
    expect(result.classification).toBe('unknown');
    expect(result.loadRatio).toBeNull();
  });
});

describe('LocalCoachingEngine.assessPainRisk', () => {
  const engine = new LocalCoachingEngine();

  it('reports no risk when no pain is flagged', () => {
    expect(engine.assessPainRisk(false, null).riskLevel).toBe('none');
  });

  it('flags severe risk and a stop-and-seek-care recommendation on warning-sign language', () => {
    const result = engine.assessPainRisk(true, 'I have chest pain and feel dizzy');
    expect(result.riskLevel).toBe('severe');
    expect(result.stopAndSeekMedicalAttention).toBe(true);
  });

  it('treats general pain descriptions as moderate, not severe', () => {
    const result = engine.assessPainRisk(true, 'my shoulder feels tight and sore');
    expect(result.riskLevel).toBe('moderate');
    expect(result.stopAndSeekMedicalAttention).toBe(false);
  });
});

describe('LocalCoachingEngine.adaptScheduledWorkout', () => {
  const engine = new LocalCoachingEngine();
  const exercises: AdaptationExerciseTarget[] = [
    {
      exerciseId: 'ex1',
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetLoadKg: 60,
      targetRpe: 8,
      restSeconds: 90,
    },
  ];

  function readiness(band: ReadinessResult['band']): ReadinessResult {
    return {
      score: 50,
      band,
      factors: [],
      recommendedIntensity: 'reduced',
      recommendedRpeRange: [6, 8],
      estimatedSessionQuality: 'fair',
      summary: `Readiness appears ${band} today.`,
      computedAt: new Date().toISOString(),
    };
  }

  const noPainRisk: PainRiskAssessment = { riskLevel: 'none', recommendation: '', stopAndSeekMedicalAttention: false };
  const severePainRisk: PainRiskAssessment = {
    riskLevel: 'severe',
    recommendation: 'stop',
    stopAndSeekMedicalAttention: true,
  };

  it('proposes no changes on high readiness', () => {
    const changes = engine.adaptScheduledWorkout({ exercises, readiness: readiness('high'), painRisk: noPainRisk });
    expect(changes).toEqual([]);
  });

  it('reduces sets, RPE, and increases rest on low readiness', () => {
    const changes = engine.adaptScheduledWorkout({ exercises, readiness: readiness('low'), painRisk: noPainRisk });
    const bySet = changes.find(c => c.fieldChanged === 'target_sets');
    const byRpe = changes.find(c => c.fieldChanged === 'target_rpe');
    const byRest = changes.find(c => c.fieldChanged === 'rest_seconds');
    expect(bySet?.updatedValue).toBe(2);
    expect(byRpe?.updatedValue).toBe(7);
    expect(byRest?.updatedValue).toBe(120);
  });

  it('replaces the workout with a recovery marker plus a real numeric pullback on very_low readiness', () => {
    const changes = engine.adaptScheduledWorkout({ exercises, readiness: readiness('very_low'), painRisk: noPainRisk });
    expect(changes.some(c => c.adaptationType === 'recovery_replacement')).toBe(true);
    const bySet = changes.find(c => c.fieldChanged === 'target_sets');
    expect(bySet?.updatedValue).toBe(2);
    const byRpe = changes.find(c => c.fieldChanged === 'target_rpe');
    expect(byRpe?.updatedValue).toBe(6);
  });

  it('escalates to the recovery path on severe pain regardless of readiness band', () => {
    const changes = engine.adaptScheduledWorkout({
      exercises,
      readiness: readiness('moderate'),
      painRisk: severePainRisk,
    });
    expect(changes.some(c => c.adaptationType === 'recovery_replacement')).toBe(true);
  });

  it('only trims RPE on moderate readiness with non-severe pain, and leaves sets untouched', () => {
    const lowPainRisk: PainRiskAssessment = { riskLevel: 'low', recommendation: '', stopAndSeekMedicalAttention: false };
    const changes = engine.adaptScheduledWorkout({ exercises, readiness: readiness('moderate'), painRisk: lowPainRisk });
    expect(changes.every(c => c.fieldChanged === 'target_rpe')).toBe(true);
    expect(changes[0]?.updatedValue).toBe(7.5);
  });

  // Regression test: workout_adaptations.original_value is NOT NULL in the DB, but
  // restSeconds (and targetRpe) are nullable on an exercise target. A prior version
  // of this code passed exercise.restSeconds straight through as originalValue for
  // the "increase_rest" change, so any exercise with no configured rest period made
  // every insert for that workout fail its NOT NULL constraint on every attempt.
  it('never proposes a change with a null originalValue or updatedValue, even when restSeconds/targetRpe are unset', () => {
    const exercisesWithNulls: AdaptationExerciseTarget[] = [
      { ...exercises[0], restSeconds: null, targetRpe: null },
    ];
    const bands: ReadinessResult['band'][] = ['very_low', 'low', 'moderate', 'high'];
    for (const band of bands) {
      const changes = engine.adaptScheduledWorkout({
        exercises: exercisesWithNulls,
        readiness: readiness(band),
        painRisk: band === 'moderate' ? severePainRisk : noPainRisk,
      });
      for (const change of changes) {
        expect(change.originalValue).not.toBeNull();
        expect(change.updatedValue).not.toBeNull();
      }
    }
  });
});

describe('LocalCoachingEngine.recommendNextSet', () => {
  const engine = new LocalCoachingEngine();
  const target: AdaptationExerciseTarget = {
    exerciseId: 'ex1',
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetLoadKg: 60,
    targetRpe: 8,
    restSeconds: 90,
  };
  const bodyweightTarget: AdaptationExerciseTarget = { ...target, targetLoadKg: null };

  function completedSet(setNumber: number, reps: number, loadKg: number | null, rpe: number | null): CompletedSetInfo {
    return { setNumber, reps, loadKg, rpe };
  }

  it('recommends stopping the exercise when reps crater vs the first set', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 10, 60, 7), completedSet(2, 4, 60, 9)],
      nextSetNumber: 3,
      nextSetCurrentReps: null,
      nextSetCurrentLoadKg: null,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).toBe('stop_exercise');
  });

  it('does not stop the exercise on RPE alone — two max-effort sets with reps intact are left to the reps/weight rules', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 8, 60, 9.5), completedSet(2, 8, 60, 9.5)],
      nextSetNumber: 3,
      nextSetCurrentReps: null,
      nextSetCurrentLoadKg: null,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).not.toBe('stop_exercise');
    expect(result?.type).toBe('keep_weight');
  });

  it('recommends removing an add-on set that came in under the rep range', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [
        completedSet(1, 9, 60, 8),
        completedSet(2, 9, 60, 8),
        completedSet(3, 9, 60, 8),
        completedSet(4, 6, 60, 8),
      ],
      nextSetNumber: null,
      nextSetCurrentReps: null,
      nextSetCurrentLoadKg: null,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).toBe('remove_last_set');
  });

  it('recommends reducing weight after missing the rep target with sets remaining', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 6, 60, 9.6)],
      nextSetNumber: 2,
      nextSetCurrentReps: null,
      nextSetCurrentLoadKg: 60,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).toBe('reduce_weight');
    // 60kg * 10% = 6kg raw delta -> rounds up to 2 x 2.5kg plate increments (5kg), not an arbitrary fraction.
    expect(result?.recommendedLoadKg).toBe(55);
  });

  it('recommends adjusting the rep target instead of weight for bodyweight exercises', () => {
    const result = engine.recommendNextSet({
      target: bodyweightTarget,
      completedSets: [completedSet(1, 6, null, 9)],
      nextSetNumber: 2,
      nextSetCurrentReps: 8,
      nextSetCurrentLoadKg: null,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).toBe('adjust_reps');
    expect(result?.recommendedReps).toBe(6);
  });

  it('does not react to an RPE jump between sets — only the reps/weight rules apply', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 8, 60, 6), completedSet(2, 8, 60, 8)],
      nextSetNumber: 3,
      nextSetCurrentReps: null,
      nextSetCurrentLoadKg: null,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).not.toBe('increase_rest');
    expect(result?.type).toBe('keep_weight');
  });

  it('recommends increasing weight after comfortably hitting the top of the rep range', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 10, 60, 7)],
      nextSetNumber: 2,
      nextSetCurrentReps: 10,
      nextSetCurrentLoadKg: 60,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).toBe('increase_weight');
    // 60kg * 2.5% = 1.5kg raw delta -> floors up to one full 2.5kg plate increment, not 61.5kg (unloadable).
    expect(result?.recommendedLoadKg).toBe(62.5);
  });

  it('recommends increasing weight after hitting the top of the rep range even at a high RPE', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 10, 60, 9.5)],
      nextSetNumber: 2,
      nextSetCurrentReps: 10,
      nextSetCurrentLoadKg: 60,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).toBe('increase_weight');
  });

  it('rounds a weight increase to a real 5 lb plate increment for lb users, never a fractional pound', () => {
    const result = engine.recommendNextSet({
      target,
      // 65 lb, entered in canonical kg storage.
      completedSets: [completedSet(1, 12, lbToKg(65), 7)],
      nextSetNumber: 2,
      nextSetCurrentReps: 10,
      nextSetCurrentLoadKg: lbToKg(65),
      readinessBand: null,
      unitPref: 'lb',
    });
    expect(result?.type).toBe('increase_weight');
    expect(result?.recommendedLoadKg).not.toBeNull();
    expect(Math.round(kgToLb(result!.recommendedLoadKg!))).toBe(70);
  });

  it('rounds a weight decrease to a real 5 lb plate increment for lb users', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 6, lbToKg(65), 9.6)],
      nextSetNumber: 2,
      nextSetCurrentReps: null,
      nextSetCurrentLoadKg: lbToKg(65),
      readinessBand: null,
      unitPref: 'lb',
    });
    expect(result?.type).toBe('reduce_weight');
    expect(result?.recommendedLoadKg).not.toBeNull();
    expect(Math.round(kgToLb(result!.recommendedLoadKg!))).toBe(60);
  });

  it('downgrades an increase-weight signal to keep-weight when readiness is already low', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 10, 60, 7)],
      nextSetNumber: 2,
      nextSetCurrentReps: 8,
      nextSetCurrentLoadKg: 60,
      readinessBand: 'low',
      unitPref: 'kg',
    });
    expect(result?.type).toBe('keep_weight');
    expect(result?.recommendedLoadKg).toBe(60);
  });

  it('recommends repeating the set when performance lands right on target and differs from what the next set already shows', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 9, 60, 8)],
      nextSetNumber: 2,
      nextSetCurrentReps: 8,
      nextSetCurrentLoadKg: 60,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result?.type).toBe('keep_weight');
    expect(result?.recommendedReps).toBe(9);
  });

  it('suppresses the recommendation when the next set is already configured with the exact reps and weight it would suggest', () => {
    // The reported bug: every set is prefilled from the exercise's own
    // targets, so hitting the plan exactly produces a "keep_weight"
    // recommendation that just restates what the next set already shows —
    // not a real recommendation, so it must come back null.
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 9, 60, 8)],
      nextSetNumber: 2,
      nextSetCurrentReps: 9,
      nextSetCurrentLoadKg: 60,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result).toBeNull();
  });

  it('returns null when there are no more sets and nothing notable happened', () => {
    const result = engine.recommendNextSet({
      target,
      completedSets: [completedSet(1, 9, 60, 8)],
      nextSetNumber: null,
      nextSetCurrentReps: null,
      nextSetCurrentLoadKg: null,
      readinessBand: null,
      unitPref: 'kg',
    });
    expect(result).toBeNull();
  });
});

describe('LocalCoachingEngine.recommendExerciseSubstitution', () => {
  const engine = new LocalCoachingEngine();

  function exercise(overrides: Partial<ExerciseMetadata>): ExerciseMetadata {
    return {
      id: 'ex-base',
      name: 'Base Exercise',
      category: 'legs',
      primaryMuscle: 'quadriceps',
      secondaryMuscles: [],
      equipment: 'barbell',
      movementPattern: null,
      difficulty: null,
      jointStress: null,
      skillRequirement: null,
      ...overrides,
    };
  }

  const squat = exercise({
    id: 'ex-squat',
    name: 'Barbell Back Squat',
    category: 'legs',
    primaryMuscle: 'quadriceps',
    secondaryMuscles: ['glutes', 'hamstrings'],
    equipment: 'barbell',
    movementPattern: 'squat',
    difficulty: 'intermediate',
  });
  const gobletSquat = exercise({
    id: 'ex-goblet',
    name: 'Dumbbell Goblet Squat',
    primaryMuscle: 'quadriceps',
    secondaryMuscles: ['glutes', 'core'],
    equipment: 'dumbbell',
    movementPattern: 'squat',
    difficulty: 'beginner',
  });
  const legExtension = exercise({
    id: 'ex-legext',
    name: 'Leg Extension',
    primaryMuscle: 'quadriceps',
    secondaryMuscles: [],
    equipment: 'machine',
    movementPattern: 'isolation',
    difficulty: 'beginner',
  });
  const benchPress = exercise({
    id: 'ex-bench',
    name: 'Barbell Bench Press',
    category: 'push',
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
    equipment: 'barbell',
    movementPattern: 'push_horizontal',
    difficulty: 'intermediate',
  });
  const frontSquat = exercise({
    id: 'ex-frontsquat',
    name: 'Barbell Front Squat',
    primaryMuscle: 'quadriceps',
    secondaryMuscles: ['core'],
    equipment: 'barbell',
    movementPattern: 'squat',
    difficulty: 'advanced',
  });
  const bodyweightSquat = exercise({
    id: 'ex-bwsquat',
    name: 'Bodyweight Squat',
    primaryMuscle: 'quadriceps',
    secondaryMuscles: ['glutes'],
    equipment: 'bodyweight',
    movementPattern: 'squat',
    difficulty: 'beginner',
  });

  it('ranks a movement-pattern + muscle match above a muscle-only match, and excludes non-matches', () => {
    const results = engine.recommendExerciseSubstitution({
      exercise: squat,
      candidates: [gobletSquat, legExtension, benchPress],
      availableEquipment: null,
    });

    expect(results.map(r => r.exerciseId)).toEqual(['ex-goblet', 'ex-legext']);
    expect(results[0].matchedOn).toEqual(
      expect.arrayContaining(['movement_pattern', 'primary_muscle', 'category', 'secondary_muscle']),
    );
    expect(results.find(r => r.exerciseId === 'ex-bench')).toBeUndefined();
  });

  it('excludes candidates that require the specifically-unavailable equipment', () => {
    const results = engine.recommendExerciseSubstitution({
      exercise: squat,
      candidates: [gobletSquat, frontSquat],
      availableEquipment: null,
      excludeEquipment: 'barbell',
    });

    expect(results.map(r => r.exerciseId)).toEqual(['ex-goblet']);
  });

  it('excludes candidates outside the available-equipment set', () => {
    const results = engine.recommendExerciseSubstitution({
      exercise: squat,
      candidates: [gobletSquat, legExtension],
      availableEquipment: ['dumbbell'],
    });

    expect(results.map(r => r.exerciseId)).toEqual(['ex-goblet']);
  });

  it('always allows bodyweight candidates regardless of the available-equipment set', () => {
    const results = engine.recommendExerciseSubstitution({
      exercise: squat,
      candidates: [bodyweightSquat],
      availableEquipment: ['barbell'],
    });

    expect(results.map(r => r.exerciseId)).toEqual(['ex-bwsquat']);
  });

  it('penalizes a large difficulty gap enough to drop a category-only match to zero', () => {
    const beginnerExercise = exercise({ id: 'ex-beg', difficulty: 'beginner', category: 'legs' });
    const advancedCategoryOnlyMatch = exercise({
      id: 'ex-adv',
      name: 'Advanced Category Match',
      category: 'legs',
      primaryMuscle: 'calves',
      movementPattern: 'isolation',
      difficulty: 'advanced',
    });

    const results = engine.recommendExerciseSubstitution({
      exercise: beginnerExercise,
      candidates: [advancedCategoryOnlyMatch],
      availableEquipment: null,
    });

    expect(results).toEqual([]);
  });

  it('returns an empty array when there are no candidates', () => {
    const results = engine.recommendExerciseSubstitution({ exercise: squat, candidates: [], availableEquipment: null });
    expect(results).toEqual([]);
  });
});

describe('LocalCoachingEngine.generateWorkoutVariant', () => {
  const engine = new LocalCoachingEngine();

  function metadata(overrides: Partial<ExerciseMetadata>): ExerciseMetadata {
    return {
      id: 'ex-base',
      name: 'Base Exercise',
      category: 'legs',
      primaryMuscle: 'quadriceps',
      secondaryMuscles: [],
      equipment: 'barbell',
      movementPattern: null,
      difficulty: null,
      jointStress: null,
      skillRequirement: null,
      ...overrides,
    };
  }

  function target(overrides: Partial<AdaptationExerciseTarget>): AdaptationExerciseTarget {
    return {
      exerciseId: 'ex-base',
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetLoadKg: 60,
      targetRpe: 8,
      restSeconds: 90,
      ...overrides,
    };
  }

  it('leaves everything unchanged for the full variant', () => {
    const squatMeta = metadata({ id: 'ex1', name: 'Squat', movementPattern: 'squat' });
    const result = engine.generateWorkoutVariant({
      source: [{ metadata: squatMeta, target: target({ exerciseId: 'ex1' }) }],
      variantType: 'full',
      candidates: [],
      availableEquipment: null,
    });

    expect(result.exercises).toEqual([
      { exerciseId: 'ex1', exerciseName: 'Squat', targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetLoadKg: 60, targetRpe: 8, restSeconds: 90 },
    ]);
    expect(result.changes).toEqual([{ exerciseId: 'ex1', type: 'kept', reason: expect.any(String) }]);
  });

  it('lightens accessory exercises before touching the compound lift to fit a 30-minute budget', () => {
    const squatMeta = metadata({ id: 'ex1', name: 'Squat', movementPattern: 'squat' });
    const curlMeta = metadata({ id: 'ex2', name: 'Curl', movementPattern: 'isolation' });
    const flyMeta = metadata({ id: 'ex3', name: 'Fly', movementPattern: 'isolation' });
    const raiseMeta = metadata({ id: 'ex4', name: 'Raise', movementPattern: 'isolation' });

    const result = engine.generateWorkoutVariant({
      source: [
        { metadata: squatMeta, target: target({ exerciseId: 'ex1', targetSets: 4, restSeconds: 120 }) },
        { metadata: curlMeta, target: target({ exerciseId: 'ex2', targetSets: 4, restSeconds: 90 }) },
        { metadata: flyMeta, target: target({ exerciseId: 'ex3', targetSets: 4, restSeconds: 90 }) },
        { metadata: raiseMeta, target: target({ exerciseId: 'ex4', targetSets: 4, restSeconds: 90 }) },
      ],
      variantType: 'time_30',
      candidates: [],
      availableEquipment: null,
    });

    expect(result.estimatedMinutes).toBeLessThanOrEqual(30);
    const squatResult = result.exercises.find(e => e.exerciseId === 'ex1');
    expect(squatResult?.targetSets).toBe(4);
    expect(result.changes.find(c => c.exerciseId === 'ex1')?.type).toBe('kept');
    for (const id of ['ex2', 'ex3', 'ex4']) {
      expect(result.changes.find(c => c.exerciseId === id)?.type).toBe('sets_reduced');
    }
  });

  it('drops accessory exercises and, only as a last resort, lightens the compound lift when trimming sets alone is not enough', () => {
    const squatMeta = metadata({ id: 'ex1', name: 'Squat', movementPattern: 'squat' });
    const accessory = (id: string, name: string) => metadata({ id, name, movementPattern: 'isolation' });

    const result = engine.generateWorkoutVariant({
      source: [
        { metadata: squatMeta, target: target({ exerciseId: 'ex1', targetSets: 10, restSeconds: 150 }) },
        { metadata: accessory('ex2', 'Curl'), target: target({ exerciseId: 'ex2', targetSets: 1, restSeconds: 200 }) },
        { metadata: accessory('ex3', 'Fly'), target: target({ exerciseId: 'ex3', targetSets: 1, restSeconds: 200 }) },
        { metadata: accessory('ex4', 'Raise'), target: target({ exerciseId: 'ex4', targetSets: 1, restSeconds: 200 }) },
      ],
      variantType: 'time_30',
      candidates: [],
      availableEquipment: null,
    });

    expect(result.exercises.map(e => e.exerciseId)).toEqual(['ex1']);
    for (const id of ['ex2', 'ex3', 'ex4']) {
      expect(result.changes.find(c => c.exerciseId === id)?.type).toBe('dropped');
    }
    const squatResult = result.exercises.find(e => e.exerciseId === 'ex1');
    expect(squatResult?.targetSets).toBeLessThan(10);
    expect(result.changes.find(c => c.exerciseId === 'ex1')?.type).toBe('sets_reduced');
  });

  it('substitutes exercises that need unavailable equipment for the hotel variant', () => {
    const squatMeta = metadata({ id: 'ex1', name: 'Barbell Back Squat', equipment: 'barbell', movementPattern: 'squat', primaryMuscle: 'quadriceps' });
    const dumbbellSquat = metadata({ id: 'ex2', name: 'Dumbbell Goblet Squat', equipment: 'dumbbell', movementPattern: 'squat', primaryMuscle: 'quadriceps' });

    const result = engine.generateWorkoutVariant({
      source: [{ metadata: squatMeta, target: target({ exerciseId: 'ex1' }) }],
      variantType: 'hotel',
      candidates: [dumbbellSquat],
      availableEquipment: null,
    });

    expect(result.exercises[0].exerciseId).toBe('ex2');
    expect(result.exercises[0].targetLoadKg).toBeNull();
    expect(result.changes[0]).toMatchObject({ exerciseId: 'ex1', type: 'substituted' });
  });

  it('keeps the original exercise with a caveat when no equipment-compatible substitute exists', () => {
    const machineMeta = metadata({ id: 'ex1', name: 'Leg Press', equipment: 'machine', movementPattern: 'squat' });

    const result = engine.generateWorkoutVariant({
      source: [{ metadata: machineMeta, target: target({ exerciseId: 'ex1' }) }],
      variantType: 'bodyweight',
      candidates: [],
      availableEquipment: null,
    });

    expect(result.exercises[0].exerciseId).toBe('ex1');
    expect(result.changes[0]).toMatchObject({ exerciseId: 'ex1', type: 'kept' });
    expect(result.changes[0].reason).toMatch(/no equipment-compatible substitute/i);
  });

  it('respects the caller-provided equipment list for the home variant', () => {
    const squatMeta = metadata({ id: 'ex1', name: 'Barbell Back Squat', equipment: 'barbell', movementPattern: 'squat', primaryMuscle: 'quadriceps' });
    const legPress = metadata({ id: 'ex2', name: 'Leg Press', equipment: 'machine', movementPattern: 'squat', primaryMuscle: 'quadriceps' });

    const result = engine.generateWorkoutVariant({
      source: [{ metadata: squatMeta, target: target({ exerciseId: 'ex1' }) }],
      variantType: 'home',
      candidates: [legPress],
      availableEquipment: ['machine'],
    });

    expect(result.exercises[0].exerciseId).toBe('ex2');
  });

  it('lightens every exercise for the low-readiness variant', () => {
    const squatMeta = metadata({ id: 'ex1', name: 'Squat' });
    const result = engine.generateWorkoutVariant({
      source: [{ metadata: squatMeta, target: target({ exerciseId: 'ex1', targetSets: 3, targetRpe: 8, restSeconds: 90 }) }],
      variantType: 'low_readiness',
      candidates: [],
      availableEquipment: null,
    });

    const e = result.exercises[0];
    expect(e.targetSets).toBe(2);
    expect(e.targetRpe).toBe(7);
    expect(e.restSeconds).toBe(117);
  });

  it('pushes rep ranges and effort in opposite directions for strength vs hypertrophy focus', () => {
    const squatMeta = metadata({ id: 'ex1', name: 'Squat' });
    const baseTarget = target({ exerciseId: 'ex1', targetRepsMin: 8, targetRepsMax: 12, targetRpe: 7, restSeconds: 90 });

    const strength = engine.generateWorkoutVariant({
      source: [{ metadata: squatMeta, target: baseTarget }],
      variantType: 'strength_focus',
      candidates: [],
      availableEquipment: null,
    }).exercises[0];
    expect(strength.targetRepsMin).toBe(5);
    expect(strength.targetRepsMax).toBe(6);
    expect(strength.targetRpe).toBe(8);
    expect(strength.restSeconds).toBe(120);

    const hypertrophy = engine.generateWorkoutVariant({
      source: [{ metadata: squatMeta, target: baseTarget }],
      variantType: 'hypertrophy_focus',
      candidates: [],
      availableEquipment: null,
    }).exercises[0];
    expect(hypertrophy.targetRepsMin).toBe(8);
    expect(hypertrophy.targetRepsMax).toBe(12);
    expect(hypertrophy.targetRpe).toBe(7);
    expect(hypertrophy.restSeconds).toBe(75);
  });

  it('substitutes only high-joint-stress exercises for the reduced-impact variant', () => {
    const highStress = metadata({ id: 'ex1', name: 'Barbell Back Squat', movementPattern: 'squat', primaryMuscle: 'quadriceps', jointStress: 'high' });
    const lowStressAlt = metadata({ id: 'ex2', name: 'Leg Press', movementPattern: 'squat', primaryMuscle: 'quadriceps', jointStress: 'low' });
    const lowStressOriginal = metadata({ id: 'ex3', name: 'Leg Extension', movementPattern: 'isolation', jointStress: 'low' });

    const result = engine.generateWorkoutVariant({
      source: [
        { metadata: highStress, target: target({ exerciseId: 'ex1' }) },
        { metadata: lowStressOriginal, target: target({ exerciseId: 'ex3' }) },
      ],
      variantType: 'reduced_impact',
      candidates: [lowStressAlt],
      availableEquipment: null,
    });

    expect(result.exercises.find(e => e.exerciseName === 'Leg Press')).toBeTruthy();
    expect(result.changes.find(c => c.exerciseId === 'ex1')?.type).toBe('substituted');
    expect(result.changes.find(c => c.exerciseId === 'ex3')?.type).toBe('kept');
  });
});

describe('LocalCoachingEngine.generatePostWorkoutSummary', () => {
  const engine = new LocalCoachingEngine();
  const noPainRisk: PainRiskAssessment = { riskLevel: 'none', recommendation: '', stopAndSeekMedicalAttention: false };

  function exerciseInput(overrides: Partial<{
    exerciseId: string;
    exerciseName: string;
    targetRpe: number | null;
    sets: Array<{ reps: number; loadKg: number | null; rpe: number | null }>;
  }>) {
    return {
      exerciseId: 'ex1',
      exerciseName: 'Squat',
      targetRpe: 8,
      sets: [{ reps: 8, loadKg: 100, rpe: 8 }],
      ...overrides,
    };
  }

  function load(classification: 'low' | 'normal' | 'high' | 'unknown') {
    return { acuteVolumeKg: 1000, chronicAvgVolumeKg: 1000, loadRatio: 1, classification };
  }

  it('sums total volume and returns null volume change when no exercise has prior data', () => {
    const result = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 8 }, { reps: 8, loadKg: 100, rpe: 8 }] })],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });

    expect(result.totalVolumeKg).toBe(1600);
    expect(result.volumeChangeKg).toBeNull();
    expect(result.volumeChangePercent).toBeNull();
  });

  it('computes volume change against prior-session data when available', () => {
    const result = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 8 }, { reps: 8, loadKg: 100, rpe: 8 }] })],
      previousVolumeByExercise: { ex1: 1400 },
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });

    expect(result.volumeChangeKg).toBe(200);
    expect(result.volumeChangePercent).toBeCloseTo((200 / 1400) * 100, 5);
  });

  it('picks the highest-e1RM set across all exercises as the best set', () => {
    const result = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [
        exerciseInput({ exerciseId: 'ex1', exerciseName: 'Squat', sets: [{ reps: 5, loadKg: 100, rpe: 8 }] }),
        exerciseInput({ exerciseId: 'ex2', exerciseName: 'Bench', sets: [{ reps: 5, loadKg: 150, rpe: 8 }] }),
      ],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });

    expect(result.bestSet?.exerciseId).toBe('ex2');
    expect(result.bestSet?.exerciseName).toBe('Bench');
  });

  it('classifies improved/declined exercises against prior best e1RM, ignoring noise under 2%', () => {
    const result = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [
        exerciseInput({ exerciseId: 'ex1', exerciseName: 'Squat', sets: [{ reps: 5, loadKg: 100, rpe: 8 }] }),
        exerciseInput({ exerciseId: 'ex2', exerciseName: 'Bench', sets: [{ reps: 5, loadKg: 90, rpe: 8 }] }),
        exerciseInput({ exerciseId: 'ex3', exerciseName: 'Row', sets: [{ reps: 5, loadKg: 100, rpe: 8 }] }),
      ],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: { ex1: 100, ex2: 120, ex3: 115 },
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });

    expect(result.improvedExercises.map(e => e.exerciseId)).toEqual(['ex1']);
    expect(result.declinedExercises.map(e => e.exerciseId)).toEqual(['ex2']);
  });

  it('computes RPE adherence over sets with both an actual and target RPE', () => {
    const result = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [
        exerciseInput({
          targetRpe: 8,
          sets: [
            { reps: 8, loadKg: 100, rpe: 8 },
            { reps: 8, loadKg: 100, rpe: 9 },
            { reps: 8, loadKg: 100, rpe: 10 },
          ],
        }),
      ],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });

    expect(result.rpeAdherence.ratedSetCount).toBe(3);
    expect(result.rpeAdherence.averageDelta).toBeCloseTo(1, 5);
    expect(result.rpeAdherence.onTargetSetCount).toBe(2);
  });

  it('describes readiness vs. actual performance only when readiness data is available', () => {
    const readiness = {
      score: 70,
      band: 'moderate' as const,
      factors: [],
      recommendedIntensity: 'reduced' as const,
      recommendedRpeRange: [6, 8] as [number, number],
      estimatedSessionQuality: 'good' as const,
      summary: '',
      computedAt: new Date().toISOString(),
    };

    const withReadiness = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 9.5 }] })],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });
    expect(withReadiness.readinessVsPerformance).toMatch(/above/i);

    const withoutReadiness = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 9.5 }] })],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });
    expect(withoutReadiness.readinessVsPerformance).toBeNull();
  });

  it('classifies recovery needs across all three states', () => {
    const highLoad = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 7 }] })],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('high'),
      painRisk: noPainRisk,
    });
    expect(highLoad.estimatedRecoveryNeeds).toBe('extra_rest');

    const lightSession = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 5 }] })],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('low'),
      painRisk: noPainRisk,
    });
    expect(lightSession.estimatedRecoveryNeeds).toBe('light_next_session');

    const normalSession = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 7 }] })],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });
    expect(normalSession.estimatedRecoveryNeeds).toBe('normal');
  });

  it('surfaces the pain-risk recommendation directly as the fatigue concern', () => {
    const result = engine.generatePostWorkoutSummary({
      unitPref: 'kg',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 7 }] })],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: { riskLevel: 'moderate', recommendation: 'Go easy on that shoulder.', stopAndSeekMedicalAttention: false },
    });

    expect(result.painOrFatigueConcern).toBe('Go easy on that shoulder.');
  });

  it('converts the volume sentence to pounds when that is the athlete\'s unit preference, instead of always saying kg', () => {
    const result = engine.generatePostWorkoutSummary({
      unitPref: 'lb',
      exercises: [exerciseInput({ sets: [{ reps: 8, loadKg: 100, rpe: 8 }, { reps: 8, loadKg: 100, rpe: 8 }] })],
      previousVolumeByExercise: {},
      previousBestE1rmByExercise: {},
      sessionPrEvents: [],
      readiness: null,
      trainingLoad: load('normal'),
      painRisk: noPainRisk,
    });

    // 1600kg -> ~3527lb.
    expect(result.summary).toContain('3,527lb of total volume today');
    expect(result.summary).not.toMatch(/kg/);
  });
});

describe('LocalCoachingEngine.generateWeeklyReview', () => {
  const engine = new LocalCoachingEngine();

  function weeklySet(overrides: Partial<{
    exerciseId: string;
    exerciseName: string;
    primaryMuscle: string;
    reps: number;
    loadKg: number | null;
  }>) {
    return { exerciseId: 'ex1', exerciseName: 'Squat', primaryMuscle: 'quadriceps', reps: 8, loadKg: 100, ...overrides };
  }

  function weeklyCheckin(overrides: Partial<{
    date: string;
    sleepHours: number | null;
    soreness: number | null;
    stress: number | null;
    hasPain: boolean;
    painNotes: string | null;
    readinessScore: number;
  }>) {
    return {
      date: '2026-01-05',
      sleepHours: 7,
      soreness: 2,
      stress: 2,
      hasPain: false,
      painNotes: null,
      readinessScore: 80,
      ...overrides,
    };
  }

  function load(classification: 'low' | 'normal' | 'high' | 'unknown') {
    return { acuteVolumeKg: 1000, chronicAvgVolumeKg: 1000, loadRatio: 1, classification };
  }

  const baseParams = {
    weekStart: '2026-01-05',
    weekEnd: '2026-01-11',
    workoutsCompleted: 3,
    workoutsMissed: 0,
    weekSets: [] as ReturnType<typeof weeklySet>[],
    priorBestE1rmByExercise: {} as Record<string, number>,
    weekPrEvents: [] as never[],
    checkins: [] as ReturnType<typeof weeklyCheckin>[],
    trainingLoad: load('normal'),
    unitPref: 'kg' as const,
  };

  it('computes consistency percent, and null when no training days were planned', () => {
    const withPlanned = engine.generateWeeklyReview({ ...baseParams, workoutsCompleted: 3, workoutsMissed: 1 });
    expect(withPlanned.consistencyPercent).toBeCloseTo(75, 5);

    const nonePlanned = engine.generateWeeklyReview({ ...baseParams, workoutsCompleted: 0, workoutsMissed: 0 });
    expect(nonePlanned.consistencyPercent).toBeNull();
  });

  it('sums total volume and groups it by muscle group, sorted descending', () => {
    const result = engine.generateWeeklyReview({
      ...baseParams,
      weekSets: [
        weeklySet({ exerciseId: 'ex1', primaryMuscle: 'quadriceps', reps: 8, loadKg: 100 }),
        weeklySet({ exerciseId: 'ex1', primaryMuscle: 'quadriceps', reps: 8, loadKg: 100 }),
        weeklySet({ exerciseId: 'ex2', exerciseName: 'Bench Press', primaryMuscle: 'chest', reps: 8, loadKg: 50 }),
      ],
    });

    expect(result.totalVolumeKg).toBe(2000);
    expect(result.volumeByMuscleGroup).toEqual([
      { muscle: 'quadriceps', volumeKg: 1600 },
      { muscle: 'chest', volumeKg: 400 },
    ]);
  });

  it('picks the most improved exercise against its prior best e1RM', () => {
    const result = engine.generateWeeklyReview({
      ...baseParams,
      weekSets: [weeklySet({ exerciseId: 'ex1', exerciseName: 'Squat', reps: 5, loadKg: 110 })],
      priorBestE1rmByExercise: { ex1: 100 },
    });

    expect(result.mostImprovedExercise?.exerciseId).toBe('ex1');
    expect(result.mostImprovedExercise?.changePercent).toBeGreaterThan(20);
  });

  it('flags the exercise with the highest load variance above the noise floor as inconsistent', () => {
    const result = engine.generateWeeklyReview({
      ...baseParams,
      weekSets: [
        weeklySet({ exerciseId: 'ex1', exerciseName: 'Squat', loadKg: 60 }),
        weeklySet({ exerciseId: 'ex1', exerciseName: 'Squat', loadKg: 100 }),
        weeklySet({ exerciseId: 'ex2', exerciseName: 'Bench Press', loadKg: 80 }),
        weeklySet({ exerciseId: 'ex2', exerciseName: 'Bench Press', loadKg: 82 }),
      ],
    });

    expect(result.mostInconsistentExercise?.exerciseId).toBe('ex1');
  });

  it('returns null for most inconsistent exercise when nothing exceeds the noise floor', () => {
    const result = engine.generateWeeklyReview({
      ...baseParams,
      weekSets: [
        weeklySet({ exerciseId: 'ex1', loadKg: 100 }),
        weeklySet({ exerciseId: 'ex1', loadKg: 101 }),
      ],
    });

    expect(result.mostInconsistentExercise).toBeNull();
  });

  it('averages readiness/sleep/soreness/stress independently over check-ins with partial data', () => {
    const result = engine.generateWeeklyReview({
      ...baseParams,
      checkins: [
        weeklyCheckin({ date: 'd1', sleepHours: 8, soreness: 2, stress: 1, readinessScore: 90 }),
        weeklyCheckin({ date: 'd2', sleepHours: null, soreness: 4, stress: null, readinessScore: 60 }),
      ],
    });

    expect(result.averageReadinessScore).toBe(75);
    expect(result.averageSleepHours).toBe(8);
    expect(result.averageSoreness).toBe(3);
    expect(result.averageStress).toBe(1);
  });

  it('counts pain reports across the week', () => {
    const result = engine.generateWeeklyReview({
      ...baseParams,
      checkins: [
        weeklyCheckin({ date: 'd1', hasPain: true }),
        weeklyCheckin({ date: 'd2', hasPain: false }),
        weeklyCheckin({ date: 'd3', hasPain: true }),
      ],
    });

    expect(result.painReportCount).toBe(2);
  });

  it('prioritizes pain over consistency, stress, and sleep in the habit observation', () => {
    const withPain = engine.generateWeeklyReview({
      ...baseParams,
      workoutsCompleted: 1,
      workoutsMissed: 3,
      checkins: [weeklyCheckin({ hasPain: true })],
    });
    expect(withPain.habitObservation).toMatch(/discomfort/i);

    const lowConsistency = engine.generateWeeklyReview({ ...baseParams, workoutsCompleted: 1, workoutsMissed: 3 });
    expect(lowConsistency.habitObservation).toMatch(/missed/i);

    const highStress = engine.generateWeeklyReview({
      ...baseParams,
      checkins: [weeklyCheckin({ stress: 5 })],
    });
    expect(highStress.habitObservation).toMatch(/stress/i);

    const lowSleep = engine.generateWeeklyReview({
      ...baseParams,
      checkins: [weeklyCheckin({ stress: 2, sleepHours: 5 })],
    });
    expect(lowSleep.habitObservation).toMatch(/sleep/i);

    const nothingNotable = engine.generateWeeklyReview(baseParams);
    expect(nothingNotable.habitObservation).toBeNull();
  });

  it('never includes readiness, sleep, soreness, stress, pain, or per-exercise data in the shareable summary', () => {
    const result = engine.generateWeeklyReview({
      ...baseParams,
      weekSets: [weeklySet({ exerciseId: 'ex1', exerciseName: 'Very Unique Exercise Name', loadKg: 100 })],
      checkins: [weeklyCheckin({ hasPain: true, painNotes: 'sharp knee pain', sleepHours: 4, stress: 5, soreness: 5 })],
    });

    expect(result.shareableSummary).not.toMatch(/knee|pain|sleep|stress|soreness|readiness|Very Unique Exercise Name/i);
    expect(result.shareableSummary).toMatch(/workout/i);

    // Persist-then-reload round trip (docs/coaching-history.md, Phase 2) —
    // confirms persistence (a plain JSON round trip via Supabase's jsonb)
    // never disturbs this boundary. The boundary itself is enforced by
    // buildShareableWeeklySummary's narrow input struct at construction
    // time, before persistence ever enters the picture — this just guards
    // the read path too.
    const reloaded = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(reloaded.shareableSummary).not.toMatch(/knee|pain|sleep|stress|soreness|readiness|Very Unique Exercise Name/i);
    expect(reloaded.shareableSummary).toMatch(/workout/i);
  });

  it('converts volume in both summary and shareableSummary to pounds when that is the athlete\'s unit preference', () => {
    const result = engine.generateWeeklyReview({
      ...baseParams,
      unitPref: 'lb',
      weekSets: [weeklySet({ exerciseId: 'ex1', reps: 8, loadKg: 100 })],
    });

    // 800kg -> ~1764lb.
    expect(result.summary).toContain('1,764lb of total volume');
    expect(result.shareableSummary).toContain('1,764lb total volume');
    expect(result.summary).not.toMatch(/kg/);
    expect(result.shareableSummary).not.toMatch(/kg/);
  });
});

describe('LocalCoachingEngine.calculateReadinessTrend', () => {
  const engine = new LocalCoachingEngine();

  function point(weekStart: string, overrides: Partial<{
    averageReadinessScore: number | null;
    averageSleepHours: number | null;
    averageSoreness: number | null;
    averageStress: number | null;
  }> = {}) {
    return {
      weekStart,
      averageReadinessScore: 75,
      averageSleepHours: 7,
      averageSoreness: 2,
      averageStress: 2,
      ...overrides,
    };
  }

  // 6 qualifying prior weeks, every metric averaging to the same baseline
  // as `point`'s own defaults — a neutral fixture each test overrides from.
  const sixQualifyingWeeks = [
    point('2025-11-24'),
    point('2025-12-01'),
    point('2025-12-08'),
    point('2025-12-15'),
    point('2025-12-22'),
    point('2025-12-29'),
  ];

  it('reports "up" when the current value clears the flat band above baseline, "down" below it', () => {
    const up = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageReadinessScore: 81 }), // baseline 75, +6 > 5-point band
      priorWeeks: sixQualifyingWeeks,
    });
    expect(up.readiness).toMatchObject({ direction: 'up', currentValue: 81, baselineValue: 75, qualifyingWeeks: 6 });

    const down = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageReadinessScore: 69 }), // -6
      priorWeeks: sixQualifyingWeeks,
    });
    expect(down.readiness).toMatchObject({ direction: 'down' });
  });

  it('reports "flat" exactly at the band edge, not just strictly inside it', () => {
    const atEdge = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageReadinessScore: 80 }), // baseline 75, +5 == band
      priorWeeks: sixQualifyingWeeks,
    });
    expect(atEdge.readiness).toMatchObject({ direction: 'flat' });

    const justOutside = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageReadinessScore: 80.1 }), // +5.1 > band
      priorWeeks: sixQualifyingWeeks,
    });
    expect(justOutside.readiness).toMatchObject({ direction: 'up' });
  });

  it('applies each metric\'s own flat band — sleep hours and 1-5 scales are not readiness-scale points', () => {
    const result = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageSleepHours: 7.6, averageSoreness: 2.6, averageStress: 1.4 }),
      priorWeeks: sixQualifyingWeeks, // baseline sleep 7, soreness 2, stress 2
    });
    expect(result.sleep).toMatchObject({ direction: 'up' }); // +0.6h > 0.5h band
    expect(result.soreness).toMatchObject({ direction: 'up' }); // +0.6 > 0.5 band
    expect(result.stress).toMatchObject({ direction: 'down' }); // -0.6 > 0.5 band
  });

  it('suppresses a metric (null, never "flat") below the minimum qualifying-weeks guard, and emits at the threshold', () => {
    const twoQualifying = [
      point('2025-12-22'),
      point('2025-12-29'),
      point('2025-11-24', { averageReadinessScore: null }),
      point('2025-12-01', { averageReadinessScore: null }),
      point('2025-12-08', { averageReadinessScore: null }),
      point('2025-12-15', { averageReadinessScore: null }),
    ];
    const suppressed = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageReadinessScore: 90 }),
      priorWeeks: twoQualifying,
    });
    expect(suppressed.readiness).toBeNull();

    const threeQualifying = [
      point('2025-12-15'),
      point('2025-12-22'),
      point('2025-12-29'),
      point('2025-11-24', { averageReadinessScore: null }),
      point('2025-12-01', { averageReadinessScore: null }),
      point('2025-12-08', { averageReadinessScore: null }),
    ];
    const emitted = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageReadinessScore: 90 }),
      priorWeeks: threeQualifying,
    });
    expect(emitted.readiness).not.toBeNull();
    expect(emitted.readiness?.qualifyingWeeks).toBe(3);
  });

  it('is null for a metric with no current-week value, regardless of how much prior history exists', () => {
    const result = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageReadinessScore: null }),
      priorWeeks: sixQualifyingWeeks,
    });
    expect(result.readiness).toBeNull();
  });

  it('windows to the most recent ROLLING_TREND_WEEKS, ignoring older weeks even when more are supplied', () => {
    const sevenWeeks = [
      point('2025-11-17', { averageReadinessScore: 30 }), // oldest — outside the 6-week window, must not pull the baseline down
      ...sixQualifyingWeeks,
    ];
    const result = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05', { averageReadinessScore: 80 }),
      priorWeeks: sevenWeeks,
    });
    expect(result.readiness?.baselineValue).toBe(75);
    expect(result.readiness?.qualifyingWeeks).toBe(6);
  });

  it('treats each metric independently — one qualifying while another does not', () => {
    const mixed = [
      point('2025-12-22'),
      point('2025-12-29'),
      point('2025-12-15', { averageSleepHours: null }),
      point('2025-12-08', { averageSleepHours: null }),
      point('2025-12-01', { averageSleepHours: null }),
      point('2025-11-24', { averageSleepHours: null }),
    ]; // readiness qualifies (6 non-null), sleep doesn't (only 2 non-null)
    const result = engine.calculateReadinessTrend({
      currentWeek: point('2026-01-05'),
      priorWeeks: mixed,
    });
    expect(result.readiness).not.toBeNull();
    expect(result.sleep).toBeNull();
  });
});

describe('LocalCoachingEngine.detectTrainingPatterns', () => {
  const engine = new LocalCoachingEngine();

  function weekSnapshot(overrides: Partial<{
    weekStart: string;
    consistencyPercent: number | null;
    painReportCount: number;
    averageSleepHours: number | null;
  }>) {
    return { weekStart: '2026-01-05', consistencyPercent: 100, painReportCount: 0, averageSleepHours: 8, ...overrides };
  }

  const baseParams = {
    weeklySnapshots: [] as ReturnType<typeof weekSnapshot>[],
    missedWeekdays: [] as never[],
    exerciseRpeTrends: [] as never[],
    dismissedKeys: [] as string[],
  };

  it('flags a weekday missed at or above the 60% threshold, and not below it', () => {
    const flagged = engine.detectTrainingPatterns({
      ...baseParams,
      missedWeekdays: [{ weekday: 5, opportunities: 3, missed: 2 }],
    });
    expect(flagged.map(p => p.key)).toContain('inconsistent_weekday:5');

    const belowThreshold = engine.detectTrainingPatterns({
      ...baseParams,
      missedWeekdays: [{ weekday: 2, opportunities: 5, missed: 2 }],
    });
    expect(belowThreshold.map(p => p.key)).not.toContain('inconsistent_weekday:2');

    const tooFewOpportunities = engine.detectTrainingPatterns({
      ...baseParams,
      missedWeekdays: [{ weekday: 1, opportunities: 2, missed: 2 }],
    });
    expect(tooFewOpportunities.map(p => p.key)).not.toContain('inconsistent_weekday:1');
  });

  it('flags a 3+ consecutive-week decline in consistency, and not a flat/rising trend', () => {
    const declining = engine.detectTrainingPatterns({
      ...baseParams,
      weeklySnapshots: [90, 80, 70, 60].map(consistencyPercent => weekSnapshot({ consistencyPercent })),
    });
    expect(declining.map(p => p.key)).toContain('declining_consistency');

    const rising = engine.detectTrainingPatterns({
      ...baseParams,
      weeklySnapshots: [80, 85, 90].map(consistencyPercent => weekSnapshot({ consistencyPercent })),
    });
    expect(rising.map(p => p.key)).not.toContain('declining_consistency');
  });

  it('flags pain reported in at least 2 of the last 4 weeks, and not just 1', () => {
    const recurring = engine.detectTrainingPatterns({
      ...baseParams,
      weeklySnapshots: [1, 0, 1, 0].map(painReportCount => weekSnapshot({ painReportCount })),
    });
    expect(recurring.map(p => p.key)).toContain('recurring_pain');

    const oneOff = engine.detectTrainingPatterns({
      ...baseParams,
      weeklySnapshots: [1, 0, 0, 0].map(painReportCount => weekSnapshot({ painReportCount })),
    });
    expect(oneOff.map(p => p.key)).not.toContain('recurring_pain');
  });

  it('flags RPE creep at stable load, but not when the load also rose enough to explain it', () => {
    const rpeRising = [7, 7, 7.5, 8, 8.5, 9];
    const creeping = engine.detectTrainingPatterns({
      ...baseParams,
      exerciseRpeTrends: [
        {
          exerciseId: 'ex1',
          exerciseName: 'Bench Press',
          sessions: rpeRising.map(rpe => ({ rpe, loadKg: 100 })),
        },
      ],
    });
    expect(creeping.map(p => p.key)).toContain('rpe_creep:ex1');

    const heavierToo = engine.detectTrainingPatterns({
      ...baseParams,
      exerciseRpeTrends: [
        {
          exerciseId: 'ex2',
          exerciseName: 'Squat',
          sessions: rpeRising.map((rpe, i) => ({ rpe, loadKg: i < 2 ? 100 : 140 })),
        },
      ],
    });
    expect(heavierToo.map(p => p.key)).not.toContain('rpe_creep:ex2');

    const tooFewSessions = engine.detectTrainingPatterns({
      ...baseParams,
      exerciseRpeTrends: [
        { exerciseId: 'ex3', exerciseName: 'Deadlift', sessions: rpeRising.slice(0, 5).map(rpe => ({ rpe, loadKg: 100 })) },
      ],
    });
    expect(tooFewSessions.map(p => p.key)).not.toContain('rpe_creep:ex3');
  });

  it('flags low sleep in at least 3 of the last 4 weeks with data, and not 2', () => {
    const lowSleep = engine.detectTrainingPatterns({
      ...baseParams,
      weeklySnapshots: [6, 6, 6, null].map(averageSleepHours => weekSnapshot({ averageSleepHours })),
    });
    expect(lowSleep.map(p => p.key)).toContain('low_sleep_pattern');

    const onlyTwoLow = engine.detectTrainingPatterns({
      ...baseParams,
      weeklySnapshots: [6, 6, 8, 8].map(averageSleepHours => weekSnapshot({ averageSleepHours })),
    });
    expect(onlyTwoLow.map(p => p.key)).not.toContain('low_sleep_pattern');
  });

  it('excludes dismissed pattern keys and sorts the rest by confidence descending', () => {
    const result = engine.detectTrainingPatterns({
      ...baseParams,
      missedWeekdays: [
        { weekday: 5, opportunities: 3, missed: 3 }, // ratio 1.0
        { weekday: 2, opportunities: 5, missed: 3 }, // ratio 0.6
      ],
      dismissedKeys: ['inconsistent_weekday:2'],
    });

    expect(result.map(p => p.key)).toEqual(['inconsistent_weekday:5']);
    expect(result[0].confidence).toBeCloseTo(1, 5);
  });
});

describe('LocalCoachingEngine.predictPersonalRecords', () => {
  const engine = new LocalCoachingEngine();
  const asOf = '2024-04-01';

  function dateDaysAgo(days: number): string {
    const d = new Date(asOf);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  function history(exerciseId: string, points: Array<{ daysAgo: number; e1rm: number }>) {
    return {
      exerciseId,
      exerciseName: `Exercise ${exerciseId}`,
      points: points.map(p => ({ date: dateDaysAgo(p.daysAgo), e1rm: p.e1rm })),
    };
  }

  it('predicts a future e1RM for a clear, well-fit upward trend', () => {
    const result = engine.predictPersonalRecords({
      unitPref: 'kg',
      asOf,
      exerciseHistories: [
        history('ex1', [
          { daysAgo: 50, e1rm: 100 },
          { daysAgo: 40, e1rm: 105 },
          { daysAgo: 30, e1rm: 110 },
          { daysAgo: 20, e1rm: 115 },
          { daysAgo: 10, e1rm: 120 },
          { daysAgo: 0, e1rm: 125 },
        ]),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].exerciseId).toBe('ex1');
    expect(result[0].currentBestE1rm).toBe(125);
    expect(result[0].predictedE1rm).toBeGreaterThan(125);
    expect(result[0].confidence).toBeCloseTo(1, 5);
    expect(result[0].summary).toMatch(/could|projection/i);
  });

  it('converts the predicted e1RM in the summary to pounds when that is the athlete\'s unit preference', () => {
    const result = engine.predictPersonalRecords({
      unitPref: 'lb',
      asOf,
      exerciseHistories: [
        history('ex1', [
          { daysAgo: 50, e1rm: 100 },
          { daysAgo: 40, e1rm: 105 },
          { daysAgo: 30, e1rm: 110 },
          { daysAgo: 20, e1rm: 115 },
          { daysAgo: 10, e1rm: 120 },
          { daysAgo: 0, e1rm: 125 },
        ]),
      ],
    });

    expect(result[0].summary).toMatch(/lb/);
    expect(result[0].summary).not.toMatch(/kg/);
  });

  it('suppresses a prediction with fewer than 4 qualifying points', () => {
    const result = engine.predictPersonalRecords({
      unitPref: 'kg',
      asOf,
      exerciseHistories: [
        history('ex1', [
          { daysAgo: 30, e1rm: 100 },
          { daysAgo: 20, e1rm: 110 },
          { daysAgo: 10, e1rm: 120 },
        ]),
      ],
    });
    expect(result).toHaveLength(0);
  });

  it('suppresses a prediction whose points span fewer than 14 days', () => {
    const result = engine.predictPersonalRecords({
      unitPref: 'kg',
      asOf,
      exerciseHistories: [
        history('ex1', [
          { daysAgo: 5, e1rm: 100 },
          { daysAgo: 4, e1rm: 105 },
          { daysAgo: 3, e1rm: 110 },
          { daysAgo: 0, e1rm: 115 },
        ]),
      ],
    });
    expect(result).toHaveLength(0);
  });

  it('suppresses a flat or declining trend', () => {
    const result = engine.predictPersonalRecords({
      unitPref: 'kg',
      asOf,
      exerciseHistories: [
        history('ex1', [
          { daysAgo: 40, e1rm: 120 },
          { daysAgo: 30, e1rm: 118 },
          { daysAgo: 20, e1rm: 116 },
          { daysAgo: 10, e1rm: 114 },
          { daysAgo: 0, e1rm: 112 },
        ]),
      ],
    });
    expect(result).toHaveLength(0);
  });

  it('suppresses a noisy trend with a weak fit (low R-squared)', () => {
    const result = engine.predictPersonalRecords({
      unitPref: 'kg',
      asOf,
      exerciseHistories: [
        history('ex1', [
          { daysAgo: 40, e1rm: 100 },
          { daysAgo: 30, e1rm: 130 },
          { daysAgo: 20, e1rm: 95 },
          { daysAgo: 10, e1rm: 125 },
          { daysAgo: 0, e1rm: 105 },
        ]),
      ],
    });
    expect(result).toHaveLength(0);
  });

  it('suppresses a well-fit but negligible projected gain', () => {
    const result = engine.predictPersonalRecords({
      unitPref: 'kg',
      asOf,
      exerciseHistories: [
        history('ex1', [
          { daysAgo: 30, e1rm: 100 },
          { daysAgo: 20, e1rm: 100.1 },
          { daysAgo: 10, e1rm: 100.2 },
          { daysAgo: 0, e1rm: 100.3 },
        ]),
      ],
    });
    expect(result).toHaveLength(0);
  });

  it('sorts multiple qualifying exercises by confidence descending', () => {
    const result = engine.predictPersonalRecords({
      unitPref: 'kg',
      asOf,
      exerciseHistories: [
        history('tight-fit', [
          { daysAgo: 40, e1rm: 100 },
          { daysAgo: 30, e1rm: 110 },
          { daysAgo: 20, e1rm: 120 },
          { daysAgo: 10, e1rm: 130 },
          { daysAgo: 0, e1rm: 140 },
        ]),
        history('noisier-fit', [
          { daysAgo: 40, e1rm: 100 },
          { daysAgo: 30, e1rm: 118 },
          { daysAgo: 20, e1rm: 112 },
          { daysAgo: 10, e1rm: 128 },
          { daysAgo: 0, e1rm: 130 },
        ]),
      ],
    });

    expect(result.map(p => p.exerciseId)).toEqual(['tight-fit', 'noisier-fit']);
    expect(result[0].confidence).toBeGreaterThan(result[1].confidence);
  });
});

describe('LocalCoachingEngine.generateExerciseExplanation', () => {
  const engine = new LocalCoachingEngine();

  function exercise(overrides: Partial<ExerciseMetadata>): ExerciseMetadata {
    return {
      id: 'ex-base',
      name: 'Base Exercise',
      category: 'legs',
      primaryMuscle: 'quadriceps',
      secondaryMuscles: [],
      equipment: 'barbell',
      movementPattern: null,
      difficulty: null,
      jointStress: null,
      skillRequirement: null,
      ...overrides,
    };
  }

  it('varies purpose text by movement pattern', () => {
    const squat = engine.generateExerciseExplanation({ exercise: exercise({ movementPattern: 'squat' }) });
    const hinge = engine.generateExerciseExplanation({ exercise: exercise({ movementPattern: 'hinge' }) });

    expect(squat.purpose).not.toBe(hinge.purpose);
    expect(squat.purpose).toMatch(/squat/i);
    expect(hinge.purpose).toMatch(/hinge|posterior/i);
  });

  it('mentions the primary muscle in the purpose text', () => {
    const result = engine.generateExerciseExplanation({
      exercise: exercise({ movementPattern: 'squat', primaryMuscle: 'quadriceps' }),
    });
    expect(result.purpose).toMatch(/quadriceps/);
  });

  it('falls back to a category-based purpose when movement pattern is null', () => {
    const result = engine.generateExerciseExplanation({ exercise: exercise({ movementPattern: null, category: 'pull' }) });
    expect(result.purpose).toMatch(/pulling|back/i);
  });

  it('gives load/RPE-based progression and regression guidance for strength categories', () => {
    const result = engine.generateExerciseExplanation({ exercise: exercise({ category: 'legs' }) });
    expect(result.progressionCriteria).toMatch(/weight|rpe/i);
    expect(result.regressionCriteria).toMatch(/weight|rep/i);
  });

  it('gives duration/intensity-based guidance for cardio, not load-based', () => {
    const result = engine.generateExerciseExplanation({ exercise: exercise({ category: 'cardio' }) });
    expect(result.progressionCriteria).toMatch(/duration|pace|intensity/i);
    expect(result.progressionCriteria).not.toMatch(/add weight/i);
  });

  it('gives range-of-motion-based guidance for mobility work', () => {
    const result = engine.generateExerciseExplanation({ exercise: exercise({ category: 'mobility' }) });
    expect(result.progressionCriteria).toMatch(/range of motion|hold/i);
    expect(result.regressionCriteria).toMatch(/range|position/i);
  });

  it('adds a suitable-alternatives pointer to the regression text only when joint stress is high', () => {
    const highStress = engine.generateExerciseExplanation({ exercise: exercise({ jointStress: 'high' }) });
    const lowStress = engine.generateExerciseExplanation({ exercise: exercise({ jointStress: 'low' }) });

    expect(highStress.regressionCriteria).toMatch(/alternatives/i);
    expect(lowStress.regressionCriteria).not.toMatch(/alternatives/i);
  });
});

describe('LocalCoachingEngine.generateTodayFocusSummary', () => {
  const engine = new LocalCoachingEngine();

  function readiness(band: ReadinessResult['band']): ReadinessResult {
    const rpeRangeByBand: Record<ReadinessResult['band'], [number, number]> = {
      high: [7, 9],
      moderate: [6, 8],
      low: [5, 7],
      very_low: [3, 5],
    };
    return {
      score: band === 'high' ? 90 : band === 'moderate' ? 70 : band === 'low' ? 50 : 30,
      band,
      factors: [],
      recommendedIntensity: 'full',
      recommendedRpeRange: rpeRangeByBand[band],
      estimatedSessionQuality: 'good',
      summary: `Readiness appears ${band} today.`,
      computedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  const baseParams: GenerateTodayFocusSummaryParams = {
    readiness: null,
    plan: { kind: 'none' },
    recentPr: null,
    missedYesterday: false,
    completedYesterday: false,
    isMilestoneWeek: false,
    currentWeekNumber: null,
    weeksCount: 0,
    streak: 0,
  };

  it('opens with a rest-day sentence and headline when the plan is a rest day', () => {
    const result = engine.generateTodayFocusSummary({ ...baseParams, plan: { kind: 'rest_day' } });
    expect(result.summary.toLowerCase()).toMatch(/rest day/);
    expect(HEADLINE_PHRASINGS.rest_day).toContain(result.headline);
    expect(result.band).toBeNull();
  });

  it('opens with the day title, exercise count, and RPE target for a training day', () => {
    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      readiness: readiness('high'),
      plan: { kind: 'training_day', dayTitle: 'Push Day', exerciseCount: 5, isDeload: false },
    });
    // Wording varies (see trainingDayOpeners) — assert on the fact reported.
    expect(result.summary).toContain('Push Day (5 exercises)');
    expect(result.summary).toContain('Readiness appears high today.');
    expect(result.summary).toContain('Aim for RPE 7-9 today.');
    expect(HEADLINE_PHRASINGS.high).toContain(result.headline);
    expect(result.band).toBe('high');
  });

  it('mentions the deload week for a training day marked as deload', () => {
    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      plan: { kind: 'training_day', dayTitle: 'Legs', exerciseCount: 4, isDeload: true },
    });
    expect(result.summary).toContain('a deload week');
  });

  it('includes the RPE target for a scheduled workout too, not just program training days', () => {
    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      readiness: readiness('moderate'),
      plan: { kind: 'scheduled', name: 'Custom Session' },
    });
    // Wording varies (see scheduledOpeners) — assert on the fact reported.
    expect(result.summary).toContain('"Custom Session"');
    expect(result.summary).toContain('Aim for RPE 6-8 today.');
  });

  it('always mentions connected Whoop data in the summary, even on a good day when it isn’t a top negative factor', () => {
    const goodReadiness: ReadinessResult = {
      ...readiness('high'),
      factors: [
        {
          key: 'wearable_recovery',
          label: 'Whoop recovery',
          impact: 'positive',
          weight: 0.05,
          detail: 'Whoop recovery is 92% today, sleep performance 88%, strain 6.5.',
          available: true,
        },
      ],
    };

    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      readiness: goodReadiness,
      plan: { kind: 'training_day', dayTitle: 'Push Day', exerciseCount: 5, isDeload: false },
    });

    expect(result.summary).toContain('Whoop recovery is 92% today, sleep performance 88%, strain 6.5.');
  });

  it('says nothing about Whoop when the factor is unavailable (not connected, or not scored yet)', () => {
    const disconnectedReadiness: ReadinessResult = {
      ...readiness('high'),
      factors: [
        {
          key: 'wearable_recovery',
          label: 'Whoop recovery',
          impact: 'neutral',
          weight: 0,
          detail: 'No Whoop data available today.',
          available: false,
        },
      ],
    };

    const result = engine.generateTodayFocusSummary({ ...baseParams, readiness: disconnectedReadiness });

    expect(result.summary).not.toContain('Whoop');
  });

  it('omits the RPE clause for a completed workout even when readiness is available', () => {
    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      readiness: readiness('high'),
      plan: { kind: 'completed', dayTitle: 'Leg Day' },
    });
    // Wording varies (see completedOpeners) — assert on the fact reported.
    expect(result.summary).toContain('Leg Day');
    expect(result.summary).not.toMatch(/Aim for RPE/);
  });

  it('omits the readiness sentence entirely when readiness is null', () => {
    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      plan: { kind: 'training_day', dayTitle: 'Push Day', exerciseCount: 3, isDeload: false },
    });
    expect(result.summary).not.toMatch(/Readiness appears/);
    expect(result.summary).not.toMatch(/Aim for RPE/);
    expect(HEADLINE_PHRASINGS.no_data).toContain(result.headline);
  });

  it('reports nothing scheduled for a plan-less day', () => {
    const result = engine.generateTodayFocusSummary(baseParams);
    expect(NO_PLAN_PHRASINGS).toContain(result.summary.trim());
  });

  it('prioritizes a missed-yesterday note over a recent PR', () => {
    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      missedYesterday: true,
      recentPr: { exerciseName: 'Bench Press', loadKg: 100, reps: 5, daysAgo: 2, sameCalendarWeek: true },
    });
    expect(result.summary).toContain("Yesterday's session is still open");
    expect(result.summary).not.toMatch(/PR/);
  });

  it('prioritizes a recent PR over a milestone week', () => {
    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      recentPr: { exerciseName: 'Squat', loadKg: 140, reps: 3, daysAgo: 0, sameCalendarWeek: true },
      isMilestoneWeek: true,
      currentWeekNumber: 4,
      weeksCount: 8,
    });
    // Wording varies (see recentPrPhrasings) — assert on the fact reported,
    // not one specific phrasing among the equivalent variants.
    expect(result.summary).toMatch(/Squat/);
    expect(result.summary).not.toMatch(/Week 4 of 8/);
  });

  it('never claims a PR happened "today" unless it actually did — the lookback window reaches back up to 6 days', () => {
    const loggedToday = engine.generateTodayFocusSummary({
      ...baseParams,
      recentPr: { exerciseName: 'Barbell Bicep Curl', loadKg: 20, reps: 8, daysAgo: 0, sameCalendarWeek: true },
    });
    expect(loggedToday.summary).toMatch(/Barbell Bicep Curl today/);

    const loggedEarlierInWeek = engine.generateTodayFocusSummary({
      ...baseParams,
      recentPr: { exerciseName: 'Barbell Bicep Curl', loadKg: 20, reps: 8, daysAgo: 4, sameCalendarWeek: true },
    });
    // The plan-less baseParams opener ("Nothing is scheduled on today's
    // calendar.") legitimately contains "today" — only the PR clause itself
    // must not claim same-day timing it doesn't have.
    expect(loggedEarlierInWeek.summary).not.toMatch(/Barbell Bicep Curl today/);
    expect(loggedEarlierInWeek.summary).toMatch(/Barbell Bicep Curl this week/);
  });

  it('says "last week" rather than "this week" for a PR that falls in the lookback window but not the current calendar week', () => {
    // e.g. today is a Monday and the PR landed on the preceding Tuesday:
    // daysAgo (6) is within the lookback window, but it's a different
    // calendar week — this is the exact case that used to misreport a PR
    // from a prior week as having happened "this week".
    const loggedLastWeek = engine.generateTodayFocusSummary({
      ...baseParams,
      recentPr: { exerciseName: 'Barbell Bicep Curl', loadKg: 20, reps: 8, daysAgo: 6, sameCalendarWeek: false },
    });
    expect(loggedLastWeek.summary).toMatch(/Barbell Bicep Curl last week/);
    expect(loggedLastWeek.summary).not.toMatch(/Barbell Bicep Curl today/);
    expect(loggedLastWeek.summary).not.toMatch(/Barbell Bicep Curl this week/);
  });

  it('mentions recovering well from yesterday only when yesterday was completed, readiness is good, and nothing higher-priority applies', () => {
    const result = engine.generateTodayFocusSummary({
      ...baseParams,
      readiness: readiness('high'),
      plan: { kind: 'training_day', dayTitle: 'Push Day', exerciseCount: 5, isDeload: false },
      completedYesterday: true,
    });
    expect(result.summary).toMatch(/yesterday/i);

    const lowReadiness = engine.generateTodayFocusSummary({
      ...baseParams,
      readiness: readiness('low'),
      plan: { kind: 'training_day', dayTitle: 'Push Day', exerciseCount: 5, isDeload: false },
      completedYesterday: true,
    });
    expect(lowReadiness.summary).not.toMatch(/yesterday/i);

    const notCompletedYesterday = engine.generateTodayFocusSummary({
      ...baseParams,
      readiness: readiness('high'),
      plan: { kind: 'training_day', dayTitle: 'Push Day', exerciseCount: 5, isDeload: false },
      completedYesterday: false,
    });
    expect(notCompletedYesterday.summary).not.toMatch(/yesterday/i);
  });

  it('calls out the final week distinctly from a mid-program milestone week', () => {
    const finalWeek = engine.generateTodayFocusSummary({
      ...baseParams,
      isMilestoneWeek: true,
      currentWeekNumber: 8,
      weeksCount: 8,
    });
    expect(finalWeek.summary).toContain('final week, finish strong');

    const midWeek = engine.generateTodayFocusSummary({
      ...baseParams,
      isMilestoneWeek: true,
      currentWeekNumber: 4,
      weeksCount: 8,
    });
    expect(midWeek.summary).toContain('right on schedule');
  });

  it('mentions the streak only when nothing higher-priority applies and it exceeds two days', () => {
    const withStreak = engine.generateTodayFocusSummary({ ...baseParams, streak: 5 });
    // Wording varies (see streakPhrasings) — assert on the fact reported.
    expect(withStreak.summary).toMatch(/5[- ]day|5 days/);

    const shortStreak = engine.generateTodayFocusSummary({ ...baseParams, streak: 2 });
    expect(shortStreak.summary).not.toMatch(/streak|days in a row|days and counting/);
  });

  it('derives the headline from the readiness band when the plan is not a rest day', () => {
    // Wording varies daily (see HEADLINE_PHRASINGS) — assert on the band it
    // was drawn from, not one fixed label.
    expect(HEADLINE_PHRASINGS.moderate).toContain(
      engine.generateTodayFocusSummary({ ...baseParams, readiness: readiness('moderate') }).headline,
    );
    expect(HEADLINE_PHRASINGS.low).toContain(
      engine.generateTodayFocusSummary({ ...baseParams, readiness: readiness('low') }).headline,
    );
    expect(HEADLINE_PHRASINGS.very_low).toContain(
      engine.generateTodayFocusSummary({ ...baseParams, readiness: readiness('very_low') }).headline,
    );
  });
});
