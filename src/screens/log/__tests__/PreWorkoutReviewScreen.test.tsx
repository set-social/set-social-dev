import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PreWorkoutReviewScreen } from '../PreWorkoutReviewScreen';

const mockReplace = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ replace: mockReplace, navigate: mockNavigate, canGoBack: () => false }),
    useRoute: () => ({ params: { programDayId: 'day-1' } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

jest.mock('../../../services/api/queries/programs', () => ({
  useProgramDay: jest.fn(),
}));

jest.mock('../../../services/api/queries/scheduledWorkouts', () => ({
  useScheduledWorkout: jest.fn(),
}));

const mockMutateAsyncCheckin = jest.fn();
const mockMutateAsyncSave = jest.fn().mockResolvedValue([]);

jest.mock('../../../services/api/queries/coaching', () => ({
  useReadinessContext: jest.fn(),
  useSubmitReadinessCheckin: jest.fn(() => ({ mutateAsync: mockMutateAsyncCheckin, isPending: false })),
  useWorkoutAdaptations: jest.fn(),
  useSaveWorkoutAdaptations: jest.fn(() => ({ mutateAsync: mockMutateAsyncSave, isPending: false })),
}));

jest.mock('../../../services/coaching', () => ({
  coachingEngine: {
    evaluateReadiness: jest.fn(),
    assessPainRisk: jest.fn(),
    adaptScheduledWorkout: jest.fn(),
    calculateTrainingLoad: jest.fn(),
  },
}));

import { useProgramDay } from '../../../services/api/queries/programs';
import { useScheduledWorkout } from '../../../services/api/queries/scheduledWorkouts';
import { useReadinessContext, useWorkoutAdaptations } from '../../../services/api/queries/coaching';
import { coachingEngine } from '../../../services/coaching';

const mockedUseProgramDay = useProgramDay as jest.Mock;
const mockedUseScheduledWorkout = useScheduledWorkout as jest.Mock;
const mockedUseReadinessContext = useReadinessContext as jest.Mock;
const mockedUseWorkoutAdaptations = useWorkoutAdaptations as jest.Mock;
const mockedEvaluateReadiness = coachingEngine.evaluateReadiness as jest.Mock;
const mockedAssessPainRisk = coachingEngine.assessPainRisk as jest.Mock;
const mockedAdaptScheduledWorkout = coachingEngine.adaptScheduledWorkout as jest.Mock;

const PROGRAM_DAY = {
  id: 'day-1',
  title: 'Push Day',
  program_exercises: [
    {
      id: 'pe-1',
      exercise_id: 'ex1',
      exercises: { id: 'ex1', name: 'Bench Press', category: 'push', primary_muscle: 'chest' },
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 10,
      target_load_kg: 60,
      target_rpe: 8,
      rest_seconds: 90,
    },
  ],
};

const READINESS_RESULT = {
  score: 55,
  band: 'low' as const,
  factors: [
    { key: 'sleep', label: 'Sleep duration', impact: 'negative' as const, weight: 0.2, detail: 'Slept 5h.', available: true },
  ],
  recommendedIntensity: 'light' as const,
  recommendedRpeRange: [5, 7] as [number, number],
  estimatedSessionQuality: 'fair' as const,
  summary: 'Readiness appears lower than usual today.',
  computedAt: new Date().toISOString(),
};

const PROPOSED_ADAPTATION = {
  id: 'adapt-1',
  adaptationType: 'reduce_sets' as const,
  targetExerciseId: 'ex1',
  fieldChanged: 'target_sets',
  originalValue: 3,
  updatedValue: 2,
  reason: 'Readiness appears lower than usual today.',
  confidence: 0.6,
  source: 'rule_engine' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMutateAsyncSave.mockResolvedValue([]);
  mockedUseProgramDay.mockReturnValue({ data: PROGRAM_DAY, isLoading: false });
  mockedUseScheduledWorkout.mockReturnValue({ data: undefined, isLoading: false });
  mockedUseReadinessContext.mockReturnValue({
    isLoading: false,
    hasCheckin: true,
    checkinId: 'checkin-1',
    inputs: {
      checkin: { sleepHours: 5, sleepQuality: 3, soreness: 3, stress: 3, hasPain: false, painNotes: null },
      wearable: null,
      trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' },
      daysSinceLastWorkout: 2,
      missedWorkoutsLast14Days: 0,
    },
  });
  mockedUseWorkoutAdaptations.mockReturnValue({ data: [], isLoading: false });
  mockedEvaluateReadiness.mockReturnValue(READINESS_RESULT);
  mockedAssessPainRisk.mockReturnValue({ riskLevel: 'none', recommendation: '', stopAndSeekMedicalAttention: false });
  mockedAdaptScheduledWorkout.mockReturnValue([PROPOSED_ADAPTATION]);
  mockUseProfile.mockReturnValue({ data: { is_premium: true } });
});

describe('PreWorkoutReviewScreen', () => {
  it('renders the readiness score and the proposed adaptation for review', async () => {
    const { getByText, getAllByText } = await render(<PreWorkoutReviewScreen />);

    expect(getByText('55')).toBeTruthy();
    expect(getByText('Bench Press')).toBeTruthy();
    expect(getAllByText(/Readiness appears lower than usual today/).length).toBeGreaterThan(0);
  });

  it('shows a Pro upsell instead of the adaptation, and starts the unmodified plan, for a free account', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false } });

    const { getByText, queryByText } = await render(<PreWorkoutReviewScreen />);

    expect(getByText('55')).toBeTruthy(); // readiness score itself stays free
    expect(getByText('Adaptive Coaching Intelligence')).toBeTruthy();
    expect(queryByText('Bench Press')).toBeNull(); // the real adaptation card never rendered
    expect(mockedAdaptScheduledWorkout).not.toHaveBeenCalled();

    await fireEvent.press(getByText('Start Workout'));
    // No adaptation to save — goes straight to the workout.
    expect(mockMutateAsyncSave).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('ActiveWorkoutOverview', { programDayId: 'day-1', scheduledWorkoutId: undefined });

    await fireEvent.press(getByText('Unlock with Pro'));
    expect(mockNavigate).toHaveBeenCalledWith('Paywall', { trigger: 'adaptive_coaching' });
  });

  it('rejecting the adaptation and starting the workout saves it as rejected, then navigates to ActiveWorkoutOverview', async () => {
    const { getByText } = await render(<PreWorkoutReviewScreen />);

    await fireEvent.press(getByText('Reject'));
    await fireEvent.press(getByText('Start Workout'));

    await waitFor(() => expect(mockMutateAsyncSave).toHaveBeenCalledTimes(1));

    const call = mockMutateAsyncSave.mock.calls[0][0];
    expect(call.decisions).toEqual([{ change: PROPOSED_ADAPTATION, accepted: false }]);
    expect(mockReplace).toHaveBeenCalledWith('ActiveWorkoutOverview', { programDayId: 'day-1', scheduledWorkoutId: undefined });
  });

  it('defaults to accepting the proposed adaptation when the user does not change it', async () => {
    const { getByText } = await render(<PreWorkoutReviewScreen />);

    await fireEvent.press(getByText('Start Workout'));

    await waitFor(() => expect(mockMutateAsyncSave).toHaveBeenCalledTimes(1));

    const call = mockMutateAsyncSave.mock.calls[0][0];
    expect(call.decisions).toEqual([{ change: PROPOSED_ADAPTATION, accepted: true }]);
  });
});
