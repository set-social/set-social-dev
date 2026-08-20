import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { CompletedWorkoutCard } from '../CompletedWorkoutCard';

const mockUseUnitPreference = jest.fn();

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => mockUseUnitPreference(),
}));

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
  };
});

const mockUseWorkoutLogDetail = jest.fn();

jest.mock('../../../services/api/queries/workoutLogs', () => ({
  useWorkoutLogDetail: (...args: unknown[]) => mockUseWorkoutLogDetail(...args),
}));

const DETAIL = {
  id: 'wl-1',
  startedAt: '2026-03-04T09:00:00.000Z',
  completedAt: '2026-03-04T09:42:00.000Z',
  title: 'Push Day',
  sets: [
    {
      id: 'set-1',
      exerciseId: 'ex1',
      exerciseName: 'Bench Press',
      setNumber: 1,
      reps: 8,
      loadKg: 60,
      rpe: 7.5,
      durationSeconds: null,
      isWarmup: false,
    },
    {
      id: 'set-2',
      exerciseId: 'ex2',
      exerciseName: 'Plank',
      setNumber: 1,
      reps: 1,
      loadKg: null,
      rpe: null,
      durationSeconds: 45,
      isWarmup: false,
    },
  ],
  cardio: null,
};

const CARDIO_DETAIL = {
  id: 'wl-2',
  startedAt: '2026-03-04T09:00:00.000Z',
  completedAt: '2026-03-04T09:32:00.000Z',
  title: 'Outdoor Run',
  sets: [],
  cardio: {
    activityName: 'Outdoor Run',
    durationMinutes: 32,
    distanceKm: 5.2,
    effort: null,
    estimatedCalories: 412,
    avgPaceSecPerKm: 371,
    hasRoute: true,
  },
};

const SUMMARY = { durationMinutes: 42, totalSets: 2, totalReps: 9, totalVolumeKg: 480, exerciseCount: 2 };

async function flip(getByLabelText: (label: string) => unknown) {
  await fireEvent.press(getByLabelText('Flip to see full workout') as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWorkoutLogDetail.mockReturnValue({ data: DETAIL, isLoading: false });
  mockUseUnitPreference.mockReturnValue('kg');
});

describe('CompletedWorkoutCard', () => {
  it('shows the front-face summary and flips to a read-only back-face summary on tap', async () => {
    const { getByText, getByLabelText, queryByText } = await render(
      <CompletedWorkoutCard
        selectedDate={new Date('2026-03-04T12:00:00.000Z')}
        isSelectedToday
        workoutLogIds={['wl-1']}
        fallbackTitle="Push Day"
        isPr={false}
        summary={SUMMARY}
      />,
    );

    expect(getByText("Today's workout is done")).toBeTruthy();
    expect(getByText('42 min')).toBeTruthy();

    await flip(getByLabelText);

    expect(getByText('Bench Press')).toBeTruthy();
    expect(getByText('Plank')).toBeTruthy();
    expect(getByText('Set 1: 8 reps · 60 kg · RPE 7.5')).toBeTruthy();
    // No editable fields or delete affordances on this face — those only
    // exist on WorkoutLogDetailScreen (reached via "Edit Workout").
    expect(() => getByLabelText('Remove set 1')).toThrow();
    // The front face stays mounted (and its content queryable) until the flip
    // animation settles — it's swapped out at the rotation's edge-on midpoint,
    // not the instant the tap happens.
    await waitFor(() => expect(queryByText("Today's workout is done")).toBeNull());
  });

  it('shows weight in pounds on the back face when that is the athlete\'s unit preference, not always kg', async () => {
    mockUseUnitPreference.mockReturnValue('lb');

    const { getByText, getByLabelText } = await render(
      <CompletedWorkoutCard
        selectedDate={new Date('2026-03-04T12:00:00.000Z')}
        isSelectedToday
        workoutLogIds={['wl-1']}
        fallbackTitle="Push Day"
        isPr={false}
        summary={SUMMARY}
      />,
    );

    await flip(getByLabelText);

    // 60kg -> ~132.28lb, rounded to the nearest 0.5lb plate increment.
    expect(getByText('Set 1: 8 reps · 132.5 lb · RPE 7.5')).toBeTruthy();
  });

  it('flips back to the front summary when the back face is tapped again, no chevron needed', async () => {
    const { getByText, getByLabelText, queryByText } = await render(
      <CompletedWorkoutCard
        selectedDate={new Date('2026-03-04T12:00:00.000Z')}
        isSelectedToday
        workoutLogIds={['wl-1']}
        fallbackTitle="Push Day"
        isPr={false}
        summary={SUMMARY}
      />,
    );

    await flip(getByLabelText);
    expect(getByText('Bench Press')).toBeTruthy();

    // The whole back face is the flip-back target (no separate back-arrow
    // control) — same "Flip back to summary" label as the pre-scroll-fix
    // version, applied to the whole card again rather than a header row.
    await fireEvent.press(getByLabelText('Flip back to summary'));

    await waitFor(() => expect(queryByText('Bench Press')).toBeNull());
    expect(getByText("Today's workout is done")).toBeTruthy();
  });

  it('renders a cardio session as a run summary, not an empty exercise section', async () => {
    mockUseWorkoutLogDetail.mockReturnValue({ data: CARDIO_DETAIL, isLoading: false });

    const { getByText, getByLabelText, queryByText } = await render(
      <CompletedWorkoutCard
        selectedDate={new Date('2026-03-04T12:00:00.000Z')}
        isSelectedToday
        workoutLogIds={['wl-2']}
        fallbackTitle="Today's run"
        isPr={false}
        summary={null}
      />,
    );

    await flip(getByLabelText);

    expect(getByText('Outdoor Run')).toBeTruthy();
    expect(getByText('32 min · 5.20 km · 6:11/km · 412 cal')).toBeTruthy();
    // No stray empty exercise section for the cardio log.
    expect(queryByText('Bench Press')).toBeNull();
  });

  it('shows a PR badge when the selected day has a PR', async () => {
    const { getByText } = await render(
      <CompletedWorkoutCard
        selectedDate={new Date()}
        isSelectedToday
        workoutLogIds={['wl-1']}
        fallbackTitle="Push Day"
        isPr
        summary={SUMMARY}
      />,
    );
    expect(getByText('New PR')).toBeTruthy();
  });

  it('navigates to WorkoutLogDetail on the Training tab when Edit Workout is pressed', async () => {
    const { getByLabelText, getByText } = await render(
      <CompletedWorkoutCard
        selectedDate={new Date('2026-03-04T12:00:00.000Z')}
        isSelectedToday
        workoutLogIds={['wl-1']}
        fallbackTitle="Push Day"
        isPr={false}
        summary={SUMMARY}
      />,
    );
    await flip(getByLabelText);

    await fireEvent.press(getByText('Edit Workout'));

    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'ProgramsTab',
      params: {
        screen: 'WorkoutLogDetail',
        params: { workoutLogIds: ['wl-1'], title: 'Push Day', dateLabel: 'Wednesday, Mar 4' },
      },
    });
  });
});
