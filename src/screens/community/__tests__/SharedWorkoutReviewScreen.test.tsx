import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SharedWorkoutReviewScreen } from '../SharedWorkoutReviewScreen';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: { shareId: 'share-1' } }),
    useNavigation: () => ({ canGoBack: () => true }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'recipient-1' }),
}));

const mockUseWorkoutShare = jest.fn();
const mockAcceptMutateAsync = jest.fn();
const mockDeclineMutate = jest.fn();

jest.mock('../../../services/api/queries/workoutShares', () => ({
  useWorkoutShare: (...args: unknown[]) => mockUseWorkoutShare(...args),
  useAcceptWorkoutShare: jest.fn(() => ({ mutateAsync: mockAcceptMutateAsync, isPending: false })),
  useDeclineWorkoutShare: jest.fn(() => ({ mutate: mockDeclineMutate, isPending: false })),
}));

const EXERCISE = {
  exerciseId: 'ex-1',
  exerciseName: 'Bench Press',
  isCustom: false,
  orderIndex: 0,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetRpe: 8,
  restSeconds: 90,
  notes: null,
};

const SINGLE_SHARE = {
  id: 'share-1',
  sender_id: 'sender-1',
  recipient_id: 'recipient-1',
  share_type: 'single_workout' as const,
  title: 'Push Day',
  status: 'pending' as const,
  payload: { workout: { name: 'Push Day', notes: null, estimatedDurationMinutes: null, exercises: [EXERCISE] } },
  created_at: '2026-01-01T00:00:00.000Z',
  responded_at: null,
};

const WEEKLY_SHARE = {
  ...SINGLE_SHARE,
  share_type: 'weekly_plan' as const,
  title: 'My Training Week',
  payload: {
    days: [
      { dayOfWeek: 0, dayType: 'rest', workout: null },
      { dayOfWeek: 1, dayType: 'training', workout: { name: 'Push Day', notes: null, estimatedDurationMinutes: null, exercises: [EXERCISE] } },
      { dayOfWeek: 2, dayType: 'cardio', workout: null },
      { dayOfWeek: 3, dayType: 'rest', workout: null },
      { dayOfWeek: 4, dayType: 'rest', workout: null },
      { dayOfWeek: 5, dayType: 'rest', workout: null },
      { dayOfWeek: 6, dayType: 'rest', workout: null },
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SharedWorkoutReviewScreen', () => {
  it('shows the exercise breakdown for a single workout', async () => {
    mockUseWorkoutShare.mockReturnValue({ data: SINGLE_SHARE, isLoading: false });
    const { getByText } = await render(<SharedWorkoutReviewScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    expect(getByText(/3 sets × 8-10 reps @ RPE 8/)).toBeTruthy();
  });

  it('disables Add to My Plan until a day is picked, then accepts with that day', async () => {
    mockUseWorkoutShare.mockReturnValue({ data: SINGLE_SHARE, isLoading: false });
    mockAcceptMutateAsync.mockResolvedValue({ droppedCount: 0 });

    const { getByText } = await render(<SharedWorkoutReviewScreen />);
    await waitFor(() => expect(getByText('Add to My Plan')).toBeTruthy());

    await fireEvent.press(getByText('Add to My Plan'));
    expect(mockAcceptMutateAsync).not.toHaveBeenCalled();

    await fireEvent.press(getByText('W'));
    await fireEvent.press(getByText('Add to My Plan'));

    await waitFor(() =>
      expect(mockAcceptMutateAsync).toHaveBeenCalledWith({ share: SINGLE_SHARE, recipientId: 'recipient-1', dayOfWeek: 3 }),
    );
  });

  it('declines when "Not now" is confirmed', async () => {
    mockUseWorkoutShare.mockReturnValue({ data: SINGLE_SHARE, isLoading: false });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const notNow = buttons?.find(b => b.text === 'Not now');
      notNow?.onPress?.();
    });

    const { getByText } = await render(<SharedWorkoutReviewScreen />);
    await waitFor(() => expect(getByText('Not now')).toBeTruthy());
    await fireEvent.press(getByText('Not now'));

    expect(mockDeclineMutate).toHaveBeenCalledWith({ shareId: 'share-1' }, expect.anything());
  });

  it('renders all 7 days for a weekly plan with no day picker, and accepts the whole week at once', async () => {
    mockUseWorkoutShare.mockReturnValue({ data: WEEKLY_SHARE, isLoading: false });
    mockAcceptMutateAsync.mockResolvedValue({ droppedCount: 0 });

    const { getByText, queryByText, getAllByText } = await render(<SharedWorkoutReviewScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());

    expect(getByText('SUNDAY')).toBeTruthy();
    expect(getByText('SATURDAY')).toBeTruthy();
    expect(getAllByText('Rest').length).toBe(5);
    expect(getByText('Cardio Day')).toBeTruthy();
    expect(queryByText('ASSIGN TO DAY')).toBeNull();

    await fireEvent.press(getByText('Add to My Plan'));
    await waitFor(() =>
      expect(mockAcceptMutateAsync).toHaveBeenCalledWith({ share: WEEKLY_SHARE, recipientId: 'recipient-1', dayOfWeek: undefined }),
    );
  });

  it('shows a waiting message instead of actions when viewed by the sender', async () => {
    mockUseWorkoutShare.mockReturnValue({ data: { ...SINGLE_SHARE, recipient_id: 'someone-else' }, isLoading: false });
    const { getByText, queryByText } = await render(<SharedWorkoutReviewScreen />);
    await waitFor(() => expect(getByText('Waiting for them to review this.')).toBeTruthy());
    expect(queryByText('Add to My Plan')).toBeNull();
  });

  it('shows an accepted badge instead of actions once already accepted', async () => {
    mockUseWorkoutShare.mockReturnValue({ data: { ...SINGLE_SHARE, status: 'accepted' }, isLoading: false });
    const { getByText, queryByText } = await render(<SharedWorkoutReviewScreen />);
    await waitFor(() => expect(getByText('Added to your plan')).toBeTruthy());
    expect(queryByText('Add to My Plan')).toBeNull();
  });
});
