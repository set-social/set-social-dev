import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { WorkoutLogDetailScreen } from '../WorkoutLogDetailScreen';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockCanGoBack = true;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate, canGoBack: () => mockCanGoBack }),
    useRoute: () => ({ params: { workoutLogIds: ['wl-1'], title: 'Push Day', dateLabel: 'Monday, Mar 4' } }),
  };
});

const mockUseWorkoutLogDetail = jest.fn();
const mockUpdateSetMutate = jest.fn();
const mockDeleteSetMutate = jest.fn();
const mockDeleteWorkoutLogMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/workoutLogs', () => ({
  useWorkoutLogDetail: (...args: unknown[]) => mockUseWorkoutLogDetail(...args),
  useUpdateSet: () => ({ mutate: mockUpdateSetMutate }),
  useDeleteSet: () => ({ mutate: mockDeleteSetMutate }),
  useDeleteWorkoutLog: () => ({ mutateAsync: mockDeleteWorkoutLogMutateAsync }),
}));

const mockUseUnitPreference = jest.fn();

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => mockUseUnitPreference(),
}));

// Completed "now" (rather than a fixed past date) so the bulk of these tests
// exercise the normal, still-editable path — locking only kicks in once
// local midnight has passed since completion (see the dedicated lock tests
// below), and a hardcoded past date would make every test here run against
// the locked state instead.
const DETAIL = {
  id: 'wl-1',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
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
  ],
  cardio: null,
};

const CARDIO_DETAIL = {
  id: 'wl-2',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockUseWorkoutLogDetail.mockReturnValue({ data: DETAIL, isLoading: false });
  mockUseUnitPreference.mockReturnValue('kg');
});

describe('WorkoutLogDetailScreen', () => {
  it('has a working back arrow that goes back when this stack has history', async () => {
    const { getByLabelText } = await render(<WorkoutLogDetailScreen />);

    await fireEvent.press(getByLabelText('Back'));

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('falls back to Today when reached cross-tab with no back history on this stack', async () => {
    mockCanGoBack = false;

    const { getByLabelText } = await render(<WorkoutLogDetailScreen />);

    await fireEvent.press(getByLabelText('Back'));

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'TodayTab', params: { screen: 'Today' } });
  });

  it('shows the date label and per-set editable fields', async () => {
    const { getByText, getByDisplayValue } = await render(<WorkoutLogDetailScreen />);

    expect(getByText('Monday, Mar 4')).toBeTruthy();
    expect(getByText('Bench Press')).toBeTruthy();
    expect(getByDisplayValue('8')).toBeTruthy();
  });

  it('saves an edited rep count on blur', async () => {
    const { getByDisplayValue } = await render(<WorkoutLogDetailScreen />);

    const repsField = getByDisplayValue('8');
    await fireEvent.changeText(repsField, '10');
    await fireEvent(repsField, 'blur');

    expect(mockUpdateSetMutate).toHaveBeenCalledWith({ id: 'set-1', reps: 10 });
  });

  it('shows weight in kg by default, matching the KG column label', async () => {
    const { getByText, getByDisplayValue } = await render(<WorkoutLogDetailScreen />);

    expect(getByText('KG')).toBeTruthy();
    expect(getByDisplayValue('60')).toBeTruthy();
  });

  it('shows and edits weight in pounds when that is the athlete\'s unit preference', async () => {
    mockUseUnitPreference.mockReturnValue('lb');

    const { getByText, getByDisplayValue } = await render(<WorkoutLogDetailScreen />);

    expect(getByText('LB')).toBeTruthy();
    // 60kg -> ~132.28lb, rounded to the nearest 0.5lb plate increment.
    const weightField = getByDisplayValue('132.5');
    expect(weightField).toBeTruthy();

    await fireEvent.changeText(weightField, '135');
    await fireEvent(weightField, 'blur');

    // 135lb back to kg for storage.
    expect(mockUpdateSetMutate).toHaveBeenCalledWith({ id: 'set-1', load_kg: 135 * 0.45359237 });
  });

  it('does not re-save an untouched weight field purely due to kg<->lb rounding', async () => {
    mockUseUnitPreference.mockReturnValue('lb');

    const { getByDisplayValue } = await render(<WorkoutLogDetailScreen />);

    const weightField = getByDisplayValue('132.5');
    await fireEvent(weightField, 'blur');

    expect(mockUpdateSetMutate).not.toHaveBeenCalled();
  });

  it('deletes a set', async () => {
    const { getByLabelText } = await render(<WorkoutLogDetailScreen />);

    await fireEvent.press(getByLabelText('Remove set 1'));

    expect(mockDeleteSetMutate).toHaveBeenCalledWith('set-1');
  });

  it('deletes the whole workout after confirming, then goes back', async () => {
    mockDeleteWorkoutLogMutateAsync.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const deleteButton = buttons?.find(b => b.text === 'Delete');
      deleteButton?.onPress?.();
    });

    const { getByText } = await render(<WorkoutLogDetailScreen />);
    await fireEvent.press(getByText('Delete Workout'));

    await waitFor(() => expect(mockDeleteWorkoutLogMutateAsync).toHaveBeenCalledWith('wl-1'));
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  describe('a cardio session (added via "Add a Run", or logged standalone)', () => {
    beforeEach(() => {
      mockUseWorkoutLogDetail.mockReturnValue({ data: CARDIO_DETAIL, isLoading: false });
    });

    it('renders distance/duration/pace and calories instead of an empty exercise list', async () => {
      const { getByText, queryByDisplayValue } = await render(<WorkoutLogDetailScreen />);

      expect(getByText('Outdoor Run')).toBeTruthy();
      expect(getByText('32 min')).toBeTruthy();
      expect(getByText('5.20 km')).toBeTruthy();
      expect(getByText('6:11/km')).toBeTruthy();
      expect(getByText('412 calories burned')).toBeTruthy();
      // No editable set rows — this isn't a strength session.
      expect(queryByDisplayValue('8')).toBeNull();
    });

    it('shows a route indicator when the session was GPS-tracked', async () => {
      const { getByText } = await render(<WorkoutLogDetailScreen />);
      expect(getByText('Route recorded')).toBeTruthy();
    });

    it('hides the route indicator for a manually-entered session', async () => {
      mockUseWorkoutLogDetail.mockReturnValue({
        data: { ...CARDIO_DETAIL, cardio: { ...CARDIO_DETAIL.cardio, hasRoute: false, avgPaceSecPerKm: null } },
        isLoading: false,
      });
      const { queryByText } = await render(<WorkoutLogDetailScreen />);
      expect(queryByText('Route recorded')).toBeNull();
    });

    it('still deletes the whole session after confirming', async () => {
      mockDeleteWorkoutLogMutateAsync.mockResolvedValue(undefined);
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
        const deleteButton = buttons?.find(b => b.text === 'Delete');
        deleteButton?.onPress?.();
      });

      const { getByText } = await render(<WorkoutLogDetailScreen />);
      await fireEvent.press(getByText('Delete Workout'));

      // The route param id (WorkoutLogSection's own prop), not detail.id —
      // this test's route mock is fixed to workoutLogIds: ['wl-1'].
      await waitFor(() => expect(mockDeleteWorkoutLogMutateAsync).toHaveBeenCalledWith('wl-1'));
      alertSpy.mockRestore();
    });
  });

  describe('a workout completed on a previous day', () => {
    beforeEach(() => {
      mockUseWorkoutLogDetail.mockReturnValue({
        data: { ...DETAIL, completedAt: '2020-01-01T09:42:00.000Z' },
        isLoading: false,
      });
    });

    it('shows a locked banner', async () => {
      const { getByText } = await render(<WorkoutLogDetailScreen />);

      expect(getByText(/can no longer be edited/i)).toBeTruthy();
    });

    it('makes set fields read-only', async () => {
      const { getByDisplayValue } = await render(<WorkoutLogDetailScreen />);

      expect(getByDisplayValue('8').props.editable).toBe(false);
    });

    it('hides the per-set delete action', async () => {
      const { queryByLabelText } = await render(<WorkoutLogDetailScreen />);

      expect(queryByLabelText('Remove set 1')).toBeNull();
    });

    it('hides Delete Workout', async () => {
      const { queryByText } = await render(<WorkoutLogDetailScreen />);

      expect(queryByText('Delete Workout')).toBeNull();
    });
  });
});
