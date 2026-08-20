import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NotificationSettingsScreen } from '../NotificationSettingsScreen';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { nutritionTracking: true } }));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ canGoBack: () => false }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();
const mockUpdateMutate = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
  useUpdateProfile: jest.fn(() => ({ mutate: mockUpdateMutate })),
}));

const props = {
  navigation: {} as never,
  route: { key: 'notification-settings', name: 'NotificationSettings' as const, params: undefined },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProfile.mockReturnValue({
    data: { push_ai_coach_enabled: true, push_meal_reminders_enabled: true },
    isLoading: false,
  });
});

describe('NotificationSettingsScreen', () => {
  it('shows Meal reminders on when both the parent Arnold toggle and the sub-toggle are on', async () => {
    const { getByLabelText } = await render(<NotificationSettingsScreen {...props} />);
    expect(getByLabelText('Meal reminders').props.value).toBe(true);
  });

  it('toggling Meal reminders updates push_meal_reminders_enabled', async () => {
    const { getByLabelText } = await render(<NotificationSettingsScreen {...props} />);
    await fireEvent(getByLabelText('Meal reminders'), 'valueChange', false);
    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledWith({ push_meal_reminders_enabled: false }));
  });

  it('shows Meal reminders as off and locked when the parent Arnold toggle is off', async () => {
    mockUseProfile.mockReturnValue({
      data: { push_ai_coach_enabled: false, push_meal_reminders_enabled: true },
      isLoading: false,
    });

    const { getByLabelText } = await render(<NotificationSettingsScreen {...props} />);
    const mealReminders = getByLabelText('Meal reminders');
    expect(mealReminders.props.value).toBe(false);
    expect(mealReminders.props.disabled).toBe(true);
  });

  it('defaults Spot Requests on and toggling it updates push_spot_requests_enabled', async () => {
    const { getByLabelText } = await render(<NotificationSettingsScreen {...props} />);
    expect(getByLabelText('Spot Requests').props.value).toBe(true);

    await fireEvent(getByLabelText('Spot Requests'), 'valueChange', false);
    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledWith({ push_spot_requests_enabled: false }));
  });
});
