import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { NotificationSettingsScreen } from '../NotificationSettingsScreen';

// The "on" behavior (value, toggling, locked-when-parent-off) is covered in
// NotificationSettingsScreen.test.tsx (which mocks the flag on) — this file
// forces it off to guard the visibility ternary itself, independent of
// featureFlags.ts's real current default.
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { nutritionTracking: false } }));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ canGoBack: () => false }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: jest.fn(() => ({
    data: { push_ai_coach_enabled: true, push_meal_reminders_enabled: true },
    isLoading: false,
  })),
  useUpdateProfile: jest.fn(() => ({ mutate: jest.fn() })),
}));

const props = {
  navigation: {} as never,
  route: { key: 'notification-settings', name: 'NotificationSettings' as const, params: undefined },
};

describe('NotificationSettingsScreen with nutritionTracking disabled', () => {
  it('hides the Meal reminders row', async () => {
    const { getByText, queryByLabelText } = await render(<NotificationSettingsScreen {...props} />);
    await waitFor(() => expect(getByText('Arnold')).toBeTruthy());
    expect(queryByLabelText('Meal reminders')).toBeNull();
  });
});
