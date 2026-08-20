import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { BuildFirstWeekScreen } from '../BuildFirstWeekScreen';
import { useOnboardingStore } from '../../../store/onboardingStore';

const navigation = {} as never;
const route = { key: 'build-first-week', name: 'BuildFirstWeek' as const, params: undefined };

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockBuildFirstWeekMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/firstWeek', () => ({
  useBuildFirstWeek: jest.fn(() => ({ mutateAsync: mockBuildFirstWeekMutateAsync, isPending: false })),
}));

const mockComplete = jest.fn();

jest.mock('../useCompleteOnboarding', () => ({
  useCompleteOnboarding: jest.fn(() => ({ complete: mockComplete, isPending: false, error: null })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useOnboardingStore.setState({ daysPerWeek: 3 });
});

describe('BuildFirstWeekScreen', () => {
  it('shows the coach ask with the plan derived from days-per-week', async () => {
    const { getByText } = await render(<BuildFirstWeekScreen navigation={navigation} route={route} />);
    expect(getByText(/3 days, one muscle group a day/i)).toBeTruthy();
    expect(getByText('Push → Pull → Legs')).toBeTruthy();
  });

  it('builds the week then completes onboarding when the user accepts', async () => {
    mockBuildFirstWeekMutateAsync.mockResolvedValue(undefined);
    mockComplete.mockResolvedValue(undefined);

    const { getByText } = await render(<BuildFirstWeekScreen navigation={navigation} route={route} />);
    await fireEvent.press(getByText('Build my week'));

    await waitFor(() =>
      expect(mockBuildFirstWeekMutateAsync).toHaveBeenCalledWith({ userId: 'user-1', daysPerWeek: 3 }),
    );
    expect(mockComplete).toHaveBeenCalled();
  });

  it('completes onboarding directly, skipping generation, when the user declines', async () => {
    mockComplete.mockResolvedValue(undefined);

    const { getByText } = await render(<BuildFirstWeekScreen navigation={navigation} route={route} />);
    await fireEvent.press(getByText("I'll pick my own days"));

    await waitFor(() => expect(mockComplete).toHaveBeenCalled());
    expect(mockBuildFirstWeekMutateAsync).not.toHaveBeenCalled();
  });
});
