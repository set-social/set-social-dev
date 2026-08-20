import { useState } from 'react';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useAuthStore } from '../../store/authStore';
import { useUpdateProfile } from '../../services/api/queries/profiles';
import { useLogBodyMetric } from '../../services/api/queries/bodyMetrics';
import { lbToKg, feetInchesToCm } from '../../utils/units';

/**
 * Saves the athlete's onboarding answers and flips onboarding_completed —
 * shared by both BuildFirstWeekScreen paths ("build my week" and "I'll pick
 * my own days"), since either way onboarding ends here. Previously lived
 * inline as InjuriesScreen's onFinish; extracted once a second caller needed
 * the exact same save-then-reset-then-flip-session sequence.
 */
export function useCompleteOnboarding() {
  const userId = useAuthStore(state => state.userId);
  const setSession = useAuthStore(state => state.setSession);
  const {
    sex,
    heightFeet,
    heightInches,
    weightLb,
    goal,
    experienceLevel,
    daysPerWeek,
    equipment,
    injuriesNotes,
    reset,
  } = useOnboardingStore();
  const updateProfile = useUpdateProfile(userId);
  const logBodyMetric = useLogBodyMetric(userId);
  const [error, setError] = useState<string | null>(null);

  const complete = async () => {
    if (!userId || !goal || !experienceLevel || !daysPerWeek || sex == null || heightFeet == null || heightInches == null || weightLb == null) {
      setError('Missing onboarding answers — please go back and complete every step.');
      return;
    }
    setError(null);
    try {
      await Promise.all([
        updateProfile.mutateAsync({
          goal,
          experience_level: experienceLevel,
          days_per_week: daysPerWeek,
          equipment_access: equipment,
          injuries_notes: injuriesNotes || null,
          sex,
          height_cm: Math.round(feetInchesToCm(heightFeet, heightInches) * 10) / 10,
          onboarding_completed: true,
        }),
        // Starting weight isn't a profiles column — it's the first entry in
        // body_metrics, the same table (and "latest entry wins" convention)
        // every later weight update and the cardio calorie estimate already
        // read from, so a later re-weigh is picked up automatically.
        logBodyMetric.mutateAsync({ weightKg: lbToKg(weightLb) }),
      ]);
      reset();
      setSession({ userId, onboardingCompleted: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile. Please try again.');
    }
  };

  return { complete, isPending: updateProfile.isPending || logBodyMetric.isPending, error };
}
