import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { MuscleHeatMap } from '../MuscleHeatMap';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  return {
    ...actual,
    // The real hook needs a live NavigationContainer to know about focus
    // events — running the callback once like a plain effect is enough to
    // cover the backfill-on-focus behavior here.
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

const mockBackfillMutate = jest.fn();

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) =>
    selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockUseLoggedSets = jest.fn();
jest.mock('../../../services/api/queries/progress', () => {
  const actual = jest.requireActual('../../../services/api/queries/progress');
  return {
    ...actual,
    // trainingRangeStart stays real (pure date math) — only the data fetch
    // itself is mocked.
    useLoggedSets: (...args: unknown[]) => mockUseLoggedSets(...args),
  };
});

const mockUseExercises = jest.fn();
const mockUseBackfillCustomExerciseMuscles = jest.fn();
jest.mock('../../../services/api/queries/exercises', () => ({
  useExercises: (...args: unknown[]) => mockUseExercises(...args),
  useBackfillCustomExerciseMuscles: () => mockUseBackfillCustomExerciseMuscles(),
}));

const EXERCISES = [
  { id: 'ex-chest', primary_muscle: 'chest', secondary_muscles: [] },
  { id: 'ex-quads', primary_muscle: 'quadriceps', secondary_muscles: [] },
];

beforeEach(() => {
  mockUseProfile.mockReturnValue({ data: { sex: 'female' } });
  mockUseExercises.mockReturnValue({ data: EXERCISES, isLoading: false });
  mockBackfillMutate.mockClear();
  mockUseBackfillCustomExerciseMuscles.mockReturnValue({
    mutate: mockBackfillMutate,
    isPending: false,
    isError: false,
  });
});

describe('MuscleHeatMap', () => {
  it('shows an empty state and a range control when nothing was logged', async () => {
    mockUseLoggedSets.mockReturnValue({ data: [], isLoading: false });

    const { getByText } = await render(<MuscleHeatMap />);

    await waitFor(() =>
      expect(
        getByText('No sets logged in this period — train something to see it light up.'),
      ).toBeTruthy(),
    );
    expect(getByText('1W')).toBeTruthy();
    expect(getByText('2W')).toBeTruthy();
    expect(getByText('1M')).toBeTruthy();
    expect(getByText('YTD')).toBeTruthy();
  });

  it('renders the figure, view toggle, and muscle balance bars once there is volume', async () => {
    mockUseLoggedSets.mockReturnValue({
      data: [
        // In range — counts.
        { id: 's1', exerciseId: 'ex-chest', reps: 8, loadKg: 60, loggedAt: new Date().toISOString() },
        { id: 's2', exerciseId: 'ex-quads', reps: 5, loadKg: 100, loggedAt: new Date().toISOString() },
        // Well outside every range — must be excluded from the totals.
        { id: 's3', exerciseId: 'ex-chest', reps: 8, loadKg: 60, loggedAt: '2000-01-01T00:00:00.000Z' },
      ],
      isLoading: false,
    });

    const { getByText, getAllByText } = await render(<MuscleHeatMap />);

    await waitFor(() => expect(getByText('Front')).toBeTruthy());
    // "Back" is ambiguous here: it's both the view-toggle button and a
    // muscle-balance row label (formatEnumLabel('back')).
    expect(getAllByText('Back').length).toBeGreaterThanOrEqual(2);
    expect(getByText('Untrained')).toBeTruthy();
    expect(getByText('Tap a muscle for its exact volume')).toBeTruthy();

    // Muscle balance: overall coverage plus a bar per tracked muscle group,
    // including ones with zero volume this period.
    expect(getByText('Muscle balance')).toBeTruthy();
    expect(getByText('Muscle groups trained — 2 of 12')).toBeTruthy();
    expect(getByText('17%')).toBeTruthy();
    expect(getByText('Quadriceps')).toBeTruthy();
    expect(getByText('500 kg')).toBeTruthy();
    expect(getByText('Calves')).toBeTruthy();
  });

  it('keeps working when the range is switched to a wider window', async () => {
    mockUseLoggedSets.mockReturnValue({
      data: [
        { id: 's1', exerciseId: 'ex-chest', reps: 8, loadKg: 60, loggedAt: new Date().toISOString() },
      ],
      isLoading: false,
    });

    const { getByText } = await render(<MuscleHeatMap />);
    await waitFor(() => expect(getByText('Front')).toBeTruthy());

    await fireEvent.press(getByText('1M'));

    await waitFor(() => expect(getByText('Volume by muscle, last 30 days')).toBeTruthy());
    expect(getByText('Front')).toBeTruthy();
  });

  it('triggers the AI classifier for this user on focus, so custom exercises get attributed', async () => {
    mockUseLoggedSets.mockReturnValue({ data: [], isLoading: false });

    await render(<MuscleHeatMap />);

    await waitFor(() => expect(mockBackfillMutate).toHaveBeenCalledWith('user-1'));
  });

  it('surfaces still-unclassified custom-exercise volume instead of silently dropping it', async () => {
    mockUseExercises.mockReturnValue({
      data: [...EXERCISES, { id: 'ex-custom', primary_muscle: 'Custom' }],
      isLoading: false,
    });
    mockUseLoggedSets.mockReturnValue({
      data: [
        { id: 's1', exerciseId: 'ex-chest', reps: 8, loadKg: 60, loggedAt: new Date().toISOString() },
        // Not yet classified — must show up as pending, not vanish or get
        // attributed to the wrong muscle.
        { id: 's2', exerciseId: 'ex-custom', reps: 10, loadKg: 20, loggedAt: new Date().toISOString() },
      ],
      isLoading: false,
    });

    const { getByText } = await render(<MuscleHeatMap />);

    await waitFor(() =>
      expect(
        getByText('200 kg from custom exercises is not yet categorized — check back shortly.'),
      ).toBeTruthy(),
    );
    // Only the classified set counts toward coverage — the pending one
    // doesn't inflate "muscle groups trained".
    expect(getByText('Muscle groups trained — 1 of 12')).toBeTruthy();
  });

  it('tells the truth when the AI classifier is failing, instead of claiming it will resolve shortly forever', async () => {
    mockUseBackfillCustomExerciseMuscles.mockReturnValue({
      mutate: mockBackfillMutate,
      isPending: false,
      isError: true,
    });
    mockUseExercises.mockReturnValue({
      data: [...EXERCISES, { id: 'ex-custom', primary_muscle: 'Custom' }],
      isLoading: false,
    });
    mockUseLoggedSets.mockReturnValue({
      data: [
        { id: 's1', exerciseId: 'ex-chest', reps: 8, loadKg: 60, loggedAt: new Date().toISOString() },
        { id: 's2', exerciseId: 'ex-custom', reps: 10, loadKg: 20, loggedAt: new Date().toISOString() },
      ],
      isLoading: false,
    });

    const { getByText, queryByText } = await render(<MuscleHeatMap />);

    await waitFor(() =>
      expect(
        getByText(
          "200 kg from custom exercises couldn't be categorized automatically — it'll retry the next time you open Stats.",
        ),
      ).toBeTruthy(),
    );
    expect(queryByText(/is not yet categorized — check back shortly/)).toBeNull();
  });

  it('credits secondary muscles at half volume, so squats also count toward glutes/hamstrings', async () => {
    // Matches the real library data (0014_exercise_substitutions.sql):
    // Barbell Back Squat is primary 'quadriceps' with secondary_muscles
    // {glutes, hamstrings} — a month of squats should never leave glutes
    // reading as literally untrained.
    mockUseExercises.mockReturnValue({
      data: [
        {
          id: 'ex-squat',
          primary_muscle: 'quadriceps',
          secondary_muscles: ['glutes', 'hamstrings'],
        },
      ],
      isLoading: false,
    });
    mockUseLoggedSets.mockReturnValue({
      data: [
        // 100kg x 5 reps = 500kg
        { id: 's1', exerciseId: 'ex-squat', reps: 5, loadKg: 100, loggedAt: new Date().toISOString() },
      ],
      isLoading: false,
    });

    const { getByText, getAllByText } = await render(<MuscleHeatMap />);

    await waitFor(() => expect(getByText('Quadriceps')).toBeTruthy());
    expect(getByText('500 kg')).toBeTruthy(); // primary: full credit
    expect(getByText('Glutes')).toBeTruthy();
    expect(getByText('Hamstrings')).toBeTruthy();
    // secondary: half credit — glutes and hamstrings both land on 250kg
    expect(getAllByText('250 kg').length).toBe(2);
    expect(getByText('Muscle groups trained — 3 of 12')).toBeTruthy();
  });
});
