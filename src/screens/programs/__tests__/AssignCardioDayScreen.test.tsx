import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AssignCardioDayScreen } from '../AssignCardioDayScreen';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, canGoBack: () => true }),
    useRoute: () => ({ params: { initialDayOfWeek: 2 } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockAssignCardioDayMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/weeklySchedule', () => ({
  useAssignCardioDay: jest.fn(() => ({ mutateAsync: mockAssignCardioDayMutateAsync, isPending: false })),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AssignCardioDayScreen', () => {
  it('pre-fills the day of week from route params and assigns on tap', async () => {
    const { getByText } = await render(<AssignCardioDayScreen />);
    await waitFor(() => expect(getByText('Mark as Cardio Day')).toBeTruthy());

    await fireEvent.press(getByText('Mark as Cardio Day'));

    await waitFor(() => expect(mockAssignCardioDayMutateAsync).toHaveBeenCalledWith({ userId: 'user-1', dayOfWeek: 2 }));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('has no workout/template picker — nothing to configure beyond the day', async () => {
    const { queryByText } = await render(<AssignCardioDayScreen />);
    expect(queryByText('WORKOUT')).toBeNull();
  });
});
