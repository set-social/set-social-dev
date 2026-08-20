import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ActiveExerciseScreen } from '../ActiveExerciseScreen';
import { useActiveWorkoutStore } from '../../../store/activeWorkoutStore';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSetParams = jest.fn();
const mockUseRoute = jest.fn((): { params: { exerciseId: string } } => ({
  params: { exerciseId: 'ex1' },
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setParams: mockSetParams,
      canGoBack: () => true,
    }),
    useRoute: () => mockUseRoute(),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const EXERCISE_LIBRARY = [
  {
    id: 'ex1',
    name: 'Bench Press',
    category: 'push',
    primary_muscle: 'chest',
    equipment: 'barbell',
    secondary_muscles: ['triceps'],
    movement_pattern: 'push_horizontal',
    difficulty: 'intermediate',
    joint_stress: 'moderate',
    skill_requirement: 'moderate',
    instructions: null,
    demo_media_url: null,
    demo_media_type: null,
    is_custom: false,
    created_by: null,
    created_at: '',
  },
  {
    id: 'ex2',
    name: 'Dumbbell Bench Press',
    category: 'push',
    primary_muscle: 'chest',
    equipment: 'dumbbell',
    secondary_muscles: ['triceps'],
    movement_pattern: 'push_horizontal',
    difficulty: 'beginner',
    joint_stress: 'low',
    skill_requirement: 'low',
    instructions: null,
    demo_media_url: null,
    demo_media_type: null,
    is_custom: false,
    created_by: null,
    created_at: '',
  },
];

jest.mock('../../../services/api/queries/exercises', () => ({
  useExercises: jest.fn(() => ({ data: EXERCISE_LIBRARY, isLoading: false })),
}));

const mockUpdateProfileMutate = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: jest.fn(() => ({ data: { id: 'user-1', equipment_access: ['barbell', 'dumbbell'], is_premium: true }, isLoading: false })),
  useUpdateProfile: jest.fn(() => ({ mutate: mockUpdateProfileMutate })),
}));

const mockLogSetMutateAsync = jest.fn().mockResolvedValue({ id: 'dbset-1' });
const mockUpdateSetMutate = jest.fn();
const mockUpdateSetMutateAsync = jest.fn();
const mockDeleteSetMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/workoutLogs', () => ({
  useLogSet: jest.fn(() => ({ mutateAsync: mockLogSetMutateAsync })),
  useUpdateSet: jest.fn(() => ({ mutate: mockUpdateSetMutate, mutateAsync: mockUpdateSetMutateAsync })),
  useDeleteSet: jest.fn(() => ({ mutateAsync: mockDeleteSetMutateAsync })),
}));

// Not under test here (see SpotRequestSentSheet's own coverage) — this
// screen only needs the button/handler wiring to work, not a real mutation.
const mockRequestSpotMutateAsync = jest.fn().mockResolvedValue({ id: 'spot-req-1', expiresAt: '2026-01-01T00:00:00Z' });
type MockSpotRequestData = { id: string; status: string; expiresAt: string } | undefined;
const mockUseSpotRequest = jest.fn(
  (..._args: unknown[]): { data: MockSpotRequestData; isLoading: boolean } => ({
    data: undefined,
    isLoading: false,
  }),
);
jest.mock('../../../services/api/queries/spotRequests', () => ({
  useRequestSpot: jest.fn(() => ({ mutateAsync: mockRequestSpotMutateAsync, isPending: false })),
  useSpotRequest: (...args: unknown[]) => mockUseSpotRequest(...args),
}));

// SpotRequestSentSheet pulls in its own query hooks (useSpotRequest, etc.) —
// stubbed to a no-op so this file doesn't also need to mock those.
jest.mock('../SpotRequestSentSheet', () => {
  const actual = jest.requireActual('../SpotRequestSentSheet');
  return {
    // The real formatCountdown — ActiveExerciseScreen's own button uses it
    // directly, so the mock needs the real implementation, not a stub.
    formatCountdown: actual.formatCountdown,
    SpotRequestSentSheet: () => null,
  };
});

jest.mock('../../../services/api/queries/progress', () => {
  const actual = jest.requireActual('../../../services/api/queries/progress');
  return {
    ...actual,
    useLoggedSets: jest.fn(() => ({ data: [], isLoading: false })),
  };
});

// Renders `trigger` as text so tests can observe when ActiveExerciseScreen
// decides a completed set is a new PR, without depending on PrBanner's own
// (reanimated-driven) visual animation state.
jest.mock('../PrBanner', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return {
    PrBanner: ({ trigger }: { trigger: number }) =>
      ReactActual.createElement(Text, { testID: 'pr-banner-trigger' }, trigger),
  };
});

// Not under test here (see SpotifyNowPlayingBar.test.tsx) — stubbed out so
// this file doesn't also need to mock the integrations/spotify query
// modules its real implementation pulls in.
jest.mock('../SpotifyNowPlayingBar', () => ({
  SpotifyNowPlayingBar: () => null,
}));

const mockSaveRecommendationMutate = jest.fn();
const mockSaveSubstitutionMutate = jest.fn();

jest.mock('../../../services/api/queries/coaching', () => ({
  useReadinessContext: jest.fn(() => ({
    isLoading: false,
    inputs: {
      checkin: null,
      wearable: null,
      trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' },
      daysSinceLastWorkout: null,
      missedWorkoutsLast14Days: 0,
    },
    hasCheckin: false,
    checkinId: null,
  })),
  usePreviousExercisePerformance: jest.fn(() => ({ data: null, isLoading: false })),
  useSaveSetRecommendation: jest.fn(() => ({ mutate: mockSaveRecommendationMutate })),
  useSaveExerciseSubstitution: jest.fn(() => ({ mutate: mockSaveSubstitutionMutate })),
}));

const RECOMMENDATION = {
  id: 'rec-1',
  type: 'increase_weight' as const,
  recommendedReps: null,
  recommendedLoadKg: 65,
  recommendedRpe: null,
  recommendedRestSeconds: null,
  reason: 'You hit the top of your rep range comfortably — try a bit more weight next set.',
  confidence: 0.6,
  source: 'rule_engine' as const,
};

const SUBSTITUTION = {
  id: 'sub-1',
  exerciseId: 'ex2',
  exerciseName: 'Dumbbell Bench Press',
  reason: 'Same push horizontal pattern and chest focus — uses dumbbell instead of barbell.',
  confidence: 0.8,
  matchedOn: ['movement_pattern', 'primary_muscle', 'category'] as const,
};

jest.mock('../../../services/coaching', () => ({
  coachingEngine: {
    evaluateReadiness: jest.fn(() => ({
      score: 70,
      band: 'moderate',
      factors: [],
      recommendedIntensity: 'reduced',
      recommendedRpeRange: [6, 8],
      estimatedSessionQuality: 'good',
      summary: '',
      computedAt: new Date().toISOString(),
    })),
    recommendNextSet: jest.fn(() => RECOMMENDATION),
    recommendExerciseSubstitution: jest.fn(() => [SUBSTITUTION]),
  },
}));

import { coachingEngine } from '../../../services/coaching';
import { useLoggedSets } from '../../../services/api/queries/progress';

const mockedRecommendNextSet = coachingEngine.recommendNextSet as jest.Mock;
const mockedRecommendExerciseSubstitution = coachingEngine.recommendExerciseSubstitution as jest.Mock;
const mockedUseLoggedSets = useLoggedSets as jest.Mock;

function seedActiveWorkout() {
  useActiveWorkoutStore.setState({
    workoutLogId: 'wl-1',
    source: { type: 'programDay', id: 'day-1' },
    startedAt: Date.now(),
    restSecondsRemaining: 0,
    restRunning: false,
    exercises: [
      {
        exerciseId: 'ex1',
        exerciseName: 'Bench Press',
        targetSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 10,
        targetLoadKg: 60,
        targetRpe: 8,
        restSeconds: 90,
        metric: 'weight_kg',
        notes: '',
        sets: [
          { id: 'set-1', dbId: null, setNumber: 1, reps: 8, loadKg: 60, rpe: null, durationSeconds: null, timerStartedAt: null, isWarmup: false, completed: false },
          { id: 'set-2', dbId: null, setNumber: 2, reps: 8, loadKg: 60, rpe: null, durationSeconds: null, timerStartedAt: null, isWarmup: false, completed: false },
        ],
      },
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLogSetMutateAsync.mockResolvedValue({ id: 'dbset-1' });
  mockRequestSpotMutateAsync.mockResolvedValue({ id: 'spot-req-1', expiresAt: '2026-01-01T00:00:00Z' });
  mockUseSpotRequest.mockReturnValue({ data: undefined, isLoading: false });
  mockUseRoute.mockReturnValue({ params: { exerciseId: 'ex1' } });
  mockedRecommendNextSet.mockReturnValue(RECOMMENDATION);
  mockedRecommendExerciseSubstitution.mockReturnValue([SUBSTITUTION]);
  mockedUseLoggedSets.mockReturnValue({ data: [], isLoading: false });
  seedActiveWorkout();
});

afterEach(() => {
  // Completing a set starts the store-owned rest timer interval (real
  // setInterval, not test-doubled) — clear it so it doesn't keep ticking
  // (and keeping the Jest worker alive) past this test.
  useActiveWorkoutStore.getState().reset();
});

describe('ActiveExerciseScreen — live set recommendations', () => {
  it('shows a recommendation after completing a set, and applies it to the next set on accept', async () => {
    const { getByLabelText, getByText, queryByText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Set 1 incomplete'));

    await waitFor(() => expect(getByText(RECOMMENDATION.reason)).toBeTruthy());
    expect(getByText('Try 65kg next set')).toBeTruthy();

    await fireEvent.press(getByText('Apply to next set'));

    await waitFor(() => expect(mockSaveRecommendationMutate).toHaveBeenCalledTimes(1));
    const call = mockSaveRecommendationMutate.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: 'user-1',
      workoutLogId: 'wl-1',
      exerciseId: 'ex1',
      afterSetNumber: 1,
      accepted: true,
    });

    const secondSet = useActiveWorkoutStore.getState().exercises[0].sets[1];
    expect(secondSet.loadKg).toBe(65);
    expect(queryByText(RECOMMENDATION.reason)).toBeNull();
  });

  it('dismisses the recommendation without changing the next set when ignored', async () => {
    const { getByLabelText, getByText, queryByText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Set 1 incomplete'));
    await waitFor(() => expect(getByText(RECOMMENDATION.reason)).toBeTruthy());

    await fireEvent.press(getByText('Ignore'));

    await waitFor(() => expect(mockSaveRecommendationMutate).toHaveBeenCalledTimes(1));
    expect(mockSaveRecommendationMutate.mock.calls[0][0]).toMatchObject({ accepted: false });

    const secondSet = useActiveWorkoutStore.getState().exercises[0].sets[1];
    expect(secondSet.loadKg).toBe(60);
    expect(queryByText(RECOMMENDATION.reason)).toBeNull();
  });

  it('never shows a recommendation for a non-Pro account — Adaptive Coaching Intelligence is gated', async () => {
    const { useProfile } = jest.requireMock('../../../services/api/queries/profiles');
    (useProfile as jest.Mock).mockReturnValueOnce({
      data: { id: 'user-1', equipment_access: ['barbell', 'dumbbell'], is_premium: false },
      isLoading: false,
    });

    const { getByLabelText, queryByText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Set 1 incomplete'));
    // Wait for the press to fully settle (the set flips to "complete")
    // before asserting the recommendation banner never showed up — avoids
    // a false-positive pass from checking too early.
    await waitFor(() => expect(getByLabelText('Set 1 complete')).toBeTruthy());

    expect(queryByText(RECOMMENDATION.reason)).toBeNull();
    expect(mockSaveRecommendationMutate).not.toHaveBeenCalled();
    const secondSet = useActiveWorkoutStore.getState().exercises[0].sets[1];
    expect(secondSet.loadKg).toBe(60); // unchanged from the seeded fixture
  });

  it('keeps a completed set editable and pushes edits back to the persisted set', async () => {
    useActiveWorkoutStore.setState(state => ({
      exercises: state.exercises.map(exercise => ({
        ...exercise,
        sets: exercise.sets.map((s, i) => (i === 0 ? { ...s, completed: true, dbId: 'dbset-1' } : s)),
      })),
    }));

    const { getAllByPlaceholderText } = await render(<ActiveExerciseScreen />);

    const repsInput = getAllByPlaceholderText('Reps')[0];
    expect(repsInput.props.editable).not.toBe(false);

    await fireEvent.changeText(repsInput, '9');

    expect(useActiveWorkoutStore.getState().exercises[0].sets[0].reps).toBe(9);
    await waitFor(() =>
      expect(mockUpdateSetMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'dbset-1', reps: 9 })),
    );
  });
});

describe('ActiveExerciseScreen — real-time PR banner', () => {
  const OLD_LOGGED_AT = '2000-01-01T00:00:00.000Z'; // far more than 14 days ago, regardless of when tests run
  const RECENT_LOGGED_AT = new Date(Date.now() - 3 * 86_400_000).toISOString(); // 3 days ago

  it('fires when a completed set beats the prior best, given at least two weeks of history', async () => {
    // Prior best for ex1: 50kg x5 (e1rm ~58.3) — set-1 (60kg x8, e1rm 76) beats it.
    mockedUseLoggedSets.mockReturnValue({
      data: [{ id: 'old-1', exerciseId: 'ex1', exerciseName: 'Bench Press', reps: 5, loadKg: 50, loggedAt: OLD_LOGGED_AT }],
      isLoading: false,
    });

    const { getByLabelText, getByTestId } = await render(<ActiveExerciseScreen />);
    expect(getByTestId('pr-banner-trigger').props.children).toBe(0);

    await fireEvent.press(getByLabelText('Set 1 incomplete'));

    await waitFor(() => expect(getByTestId('pr-banner-trigger').props.children).toBe(1));
  });

  it('does not fire without two weeks of history yet, even if the set would otherwise be a PR', async () => {
    mockedUseLoggedSets.mockReturnValue({
      data: [{ id: 'old-1', exerciseId: 'ex1', exerciseName: 'Bench Press', reps: 5, loadKg: 50, loggedAt: RECENT_LOGGED_AT }],
      isLoading: false,
    });

    const { getByLabelText, getByTestId } = await render(<ActiveExerciseScreen />);
    await fireEvent.press(getByLabelText('Set 1 incomplete'));

    await waitFor(() => expect(useActiveWorkoutStore.getState().exercises[0].sets[0].completed).toBe(true));
    expect(getByTestId('pr-banner-trigger').props.children).toBe(0);
  });

  it('does not fire when the completed set doesn’t beat the prior best', async () => {
    // Prior best for ex1: 100kg x5 (e1rm ~116.7) — set-1 (60kg x8, e1rm 76) doesn't beat it.
    mockedUseLoggedSets.mockReturnValue({
      data: [{ id: 'old-1', exerciseId: 'ex1', exerciseName: 'Bench Press', reps: 5, loadKg: 100, loggedAt: OLD_LOGGED_AT }],
      isLoading: false,
    });

    const { getByLabelText, getByTestId } = await render(<ActiveExerciseScreen />);
    await fireEvent.press(getByLabelText('Set 1 incomplete'));

    await waitFor(() => expect(useActiveWorkoutStore.getState().exercises[0].sets[0].completed).toBe(true));
    expect(getByTestId('pr-banner-trigger').props.children).toBe(0);
  });
});

describe('ActiveExerciseScreen — exercise substitution', () => {
  it('swaps the exercise for this workout only and follows it to the new identity', async () => {
    const { getByLabelText, getByText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Exercise options'));
    await fireEvent.press(getByText('Find a substitute exercise'));
    await waitFor(() => expect(getByText('Dumbbell Bench Press')).toBeTruthy());
    await fireEvent.press(getByText('Dumbbell Bench Press'));
    await fireEvent.press(getByText('Swap for this workout'));

    await waitFor(() => expect(mockSaveSubstitutionMutate).toHaveBeenCalledTimes(1));
    expect(mockSaveSubstitutionMutate.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      workoutLogId: 'wl-1',
      originalExerciseId: 'ex1',
      scope: 'workout_only',
    });
    expect(mockUpdateProfileMutate).not.toHaveBeenCalled();

    const swappedExercise = useActiveWorkoutStore.getState().exercises[0];
    expect(swappedExercise.exerciseId).toBe('ex2');
    expect(swappedExercise.exerciseName).toBe('Dumbbell Bench Press');
    expect(swappedExercise.targetLoadKg).toBeNull();
    expect(swappedExercise.sets.every(s => !s.completed && s.dbId === null)).toBe(true);
    expect(mockSetParams).toHaveBeenCalledWith({ exerciseId: 'ex2' });
  });

  it('permanently removes the original equipment from the profile when that scope is chosen', async () => {
    const { getByLabelText, getByText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Exercise options'));
    await fireEvent.press(getByText('Find a substitute exercise'));
    await waitFor(() => expect(getByText('Dumbbell Bench Press')).toBeTruthy());
    await fireEvent.press(getByText('Dumbbell Bench Press'));
    await fireEvent.press(getByText('Swap + remove Barbell from my equipment'));

    await waitFor(() => expect(mockSaveSubstitutionMutate).toHaveBeenCalledTimes(1));
    expect(mockSaveSubstitutionMutate.mock.calls[0][0]).toMatchObject({ scope: 'permanent' });
    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ equipment_access: ['dumbbell'] });
  });

  it('hides the swap option once the exercise has a completed set', async () => {
    useActiveWorkoutStore.setState(state => ({
      exercises: state.exercises.map(exercise => ({
        ...exercise,
        sets: exercise.sets.map((s, i) => (i === 0 ? { ...s, completed: true, dbId: 'dbset-1' } : s)),
      })),
    }));

    const { getByLabelText, queryByText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Exercise options'));
    expect(queryByText('Find a substitute exercise')).toBeNull();
  });
});

describe('ActiveExerciseScreen — navigation', () => {
  it('the down-chevron returns to the overview without touching workout state', async () => {
    const { getByLabelText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Back to workout overview'));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(useActiveWorkoutStore.getState().workoutLogId).toBe('wl-1');
  });

  it('removing the exercise returns to the overview', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const removeButton = buttons?.find(b => b.text === 'Remove');
      removeButton?.onPress?.();
    });

    const { getByLabelText, getByText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Exercise options'));
    await fireEvent.press(getByText('Remove exercise from workout'));

    await waitFor(() => expect(useActiveWorkoutStore.getState().exercises).toHaveLength(0));
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('ActiveExerciseScreen — Request a Spot', () => {
  it('sends the first not-yet-completed set\'s number/weight, this exercise, and the active workout', async () => {
    const { getByLabelText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Request a spot'));

    await waitFor(() =>
      expect(mockRequestSpotMutateAsync).toHaveBeenCalledWith({
        userId: 'user-1',
        workoutLogId: 'wl-1',
        exerciseName: 'Bench Press',
        setNumber: 1,
        loadKg: 60,
      }),
    );
  });

  it('falls back to the last set once every set is already completed', async () => {
    seedActiveWorkout();
    useActiveWorkoutStore.setState(state => ({
      exercises: state.exercises.map(exercise => ({
        ...exercise,
        sets: exercise.sets.map(s => ({ ...s, completed: true })),
      })),
    }));

    const { getByLabelText } = await render(<ActiveExerciseScreen />);

    await fireEvent.press(getByLabelText('Request a spot'));

    await waitFor(() =>
      expect(mockRequestSpotMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ setNumber: 2, loadKg: 60 }),
      ),
    );
  });

  it('shows a live countdown instead of the CTA label while a request is active, and re-opens rather than re-sending', async () => {
    mockUseSpotRequest.mockReturnValue({
      data: {
        id: 'spot-req-1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      },
      isLoading: false,
    });

    const { getByLabelText, queryByText, getByText } = await render(<ActiveExerciseScreen />);

    expect(queryByText('Request a Spot')).toBeNull();
    expect(getByText(/Requested ·/)).toBeTruthy();

    await fireEvent.press(getByLabelText('View spot request status'));

    // Reopens the existing sheet — never fires a second request on top of
    // the one already in flight.
    expect(mockRequestSpotMutateAsync).not.toHaveBeenCalled();
  });

  it('reverts to the normal CTA once the active request resolves, and a tap sends a fresh one', async () => {
    mockUseSpotRequest.mockReturnValue({
      data: { id: 'spot-req-1', status: 'accepted', expiresAt: new Date(Date.now() + 90_000).toISOString() },
      isLoading: false,
    });

    const { getByLabelText, getByText } = await render(<ActiveExerciseScreen />);
    expect(getByText('Request a Spot')).toBeTruthy();

    await fireEvent.press(getByLabelText('Request a spot'));

    await waitFor(() => expect(mockRequestSpotMutateAsync).toHaveBeenCalled());
  });
});
