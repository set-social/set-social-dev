import {
  calculateAge,
  calculateBmr,
  computeDailyEnergyTotals,
  computeMacroTargets,
  estimateStrengthSessionCalories,
  NEAT_BASELINE_CALORIES,
  TARGET_NET_CALORIES_BY_GOAL,
} from '../energyBalance';

describe('calculateAge', () => {
  it('counts a birthday that already happened this year', () => {
    expect(calculateAge('1990-01-15', new Date('2026-06-01'))).toBe(36);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    expect(calculateAge('1990-12-15', new Date('2026-06-01'))).toBe(35);
  });

  it('counts the exact birthday itself as already had', () => {
    expect(calculateAge('1990-06-01', new Date('2026-06-01'))).toBe(36);
  });
});

describe('calculateBmr', () => {
  it('matches the standard Mifflin-St Jeor worked example for a man', () => {
    // 80kg, 180cm, 30yo male: 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(calculateBmr({ weightKg: 80, heightCm: 180, age: 30, sex: 'male' })).toBe(1780);
  });

  it('matches the standard Mifflin-St Jeor worked example for a woman', () => {
    // 65kg, 165cm, 28yo female: 10*65 + 6.25*165 - 5*28 - 161 = 1380.25 -> 1380
    expect(calculateBmr({ weightKg: 65, heightCm: 165, age: 28, sex: 'female' })).toBe(1380);
  });
});

describe('estimateStrengthSessionCalories', () => {
  it('scales with duration', () => {
    const short = estimateStrengthSessionCalories({ durationMinutes: 30, weightKg: 80, sex: 'male' });
    const long = estimateStrengthSessionCalories({ durationMinutes: 60, weightKg: 80, sex: 'male' });
    expect(long).toBeCloseTo(short * 2, 0);
  });

  it('applies the same female adjustment cardioCalories uses', () => {
    const male = estimateStrengthSessionCalories({ durationMinutes: 60, weightKg: 70, sex: 'male' });
    const female = estimateStrengthSessionCalories({ durationMinutes: 60, weightKg: 70, sex: 'female' });
    expect(female).toBeLessThan(male);
    expect(female / male).toBeCloseTo(0.92, 2);
  });

  it('defaults to no sex adjustment when sex is unknown', () => {
    const unspecified = estimateStrengthSessionCalories({ durationMinutes: 60, weightKg: 70 });
    const male = estimateStrengthSessionCalories({ durationMinutes: 60, weightKg: 70, sex: 'male' });
    expect(unspecified).toBe(male);
  });
});

describe('TARGET_NET_CALORIES_BY_GOAL', () => {
  it('is negative for a cut, positive for a bulk, zero for maintenance', () => {
    expect(TARGET_NET_CALORIES_BY_GOAL.cut).toBeLessThan(0);
    expect(TARGET_NET_CALORIES_BY_GOAL.bulk).toBeGreaterThan(0);
    expect(TARGET_NET_CALORIES_BY_GOAL.maintain).toBe(0);
  });
});

describe('computeDailyEnergyTotals', () => {
  const fullProfile = { weightKg: 80, heightCm: 180, age: 30, sex: 'male' as const };

  it('sums food entries for calories and macros', () => {
    const totals = computeDailyEnergyTotals({
      foodEntries: [
        { calories: 400, protein_g: 30, carbs_g: 40, fat_g: 10 },
        { calories: 600, protein_g: 40, carbs_g: 60, fat_g: 20 },
      ],
      strengthSessions: [],
      cardioCalories: 0,
      goal: 'maintain',
      ...fullProfile,
    });
    expect(totals.caloriesIn).toBe(1000);
    expect(totals.proteinG).toBe(70);
    expect(totals.carbsG).toBe(100);
    expect(totals.fatG).toBe(30);
  });

  it('uses a real BMR when the full profile is available, flagged as such', () => {
    const totals = computeDailyEnergyTotals({
      foodEntries: [],
      strengthSessions: [],
      cardioCalories: 0,
      goal: 'maintain',
      ...fullProfile,
    });
    expect(totals.hasEnoughProfileData).toBe(true);
    expect(totals.bmr).toBe(calculateBmr(fullProfile));
    expect(totals.baseOut).toBe(totals.bmr + NEAT_BASELINE_CALORIES);
  });

  it('falls back to a population-average BMR and flags it when profile data is missing', () => {
    const totals = computeDailyEnergyTotals({
      foodEntries: [],
      strengthSessions: [],
      cardioCalories: 0,
      goal: 'maintain',
      weightKg: null,
      heightCm: null,
      age: null,
      sex: null,
    });
    expect(totals.hasEnoughProfileData).toBe(false);
    expect(totals.bmr).toBeGreaterThan(0);
  });

  it('adds cardio and strength-session burn on top of baseline', () => {
    const totals = computeDailyEnergyTotals({
      foodEntries: [],
      strengthSessions: [{ durationMinutes: 60, estimatedCalories: null }],
      cardioCalories: 300,
      goal: 'maintain',
      ...fullProfile,
    });
    const strengthCalories = estimateStrengthSessionCalories({ durationMinutes: 60, weightKg: 80, sex: 'male' });
    expect(totals.workoutOut).toBe(300 + strengthCalories);
    expect(totals.caloriesOut).toBe(totals.baseOut + 300 + strengthCalories);
  });

  it('computes net as intake minus total burn, and remaining against the goal-adjusted target', () => {
    const totals = computeDailyEnergyTotals({
      foodEntries: [{ calories: 1500, protein_g: 100, carbs_g: 150, fat_g: 50 }],
      strengthSessions: [],
      cardioCalories: 0,
      goal: 'cut',
      ...fullProfile,
    });
    expect(totals.net).toBe(1500 - totals.caloriesOut);
    expect(totals.targetIntake).toBe(totals.caloriesOut - 500);
    expect(totals.remaining).toBe(totals.targetIntake - 1500);
  });
});

describe('computeMacroTargets', () => {
  it('targets 1g of protein per lb of bodyweight, regardless of goal', () => {
    const cut = computeMacroTargets({ weightKg: 78, targetIntake: 2000, goal: 'cut' });
    const bulk = computeMacroTargets({ weightKg: 78, targetIntake: 2500, goal: 'bulk' });
    expect(cut.proteinTargetG).toBe(172);
    expect(bulk.proteinTargetG).toBe(172);
  });

  it('falls back to a flat protein target when bodyweight is unknown', () => {
    const targets = computeMacroTargets({ weightKg: null, targetIntake: 2000, goal: 'maintain' });
    expect(targets.proteinTargetG).toBe(150);
  });

  it('never returns a negative carb/fat target even when protein alone exceeds the intake target', () => {
    const targets = computeMacroTargets({ weightKg: 150, targetIntake: 1200, goal: 'cut' });
    expect(targets.carbsTargetG).toBeGreaterThanOrEqual(0);
    expect(targets.fatTargetG).toBeGreaterThanOrEqual(0);
  });
});
