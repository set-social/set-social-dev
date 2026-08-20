import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { LogFoodScreen } from '../LogFoodScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => true, goBack: jest.fn() }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockCreateEntryMutateAsync = jest.fn();
jest.mock('../../../services/api/queries/foodLog', () => ({
  useCreateFoodLogEntry: () => ({ mutateAsync: mockCreateEntryMutateAsync, isPending: false }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LogFoodScreen', () => {
  it('disables Save Meal until a name and calorie count are entered', async () => {
    const { getByText, getByPlaceholderText } = await render(<LogFoodScreen />);

    const saveButton = getByText('Save Meal');
    await fireEvent.press(saveButton);
    expect(mockCreateEntryMutateAsync).not.toHaveBeenCalled();

    await fireEvent.changeText(getByPlaceholderText('Grilled chicken rice bowl'), 'Chicken rice bowl');
    await fireEvent.press(saveButton);
    expect(mockCreateEntryMutateAsync).not.toHaveBeenCalled();

    await fireEvent.changeText(getByPlaceholderText('620'), '620');
    await fireEvent.press(saveButton);
    await waitFor(() => expect(mockCreateEntryMutateAsync).toHaveBeenCalled());
  });

  it('saves the entry with the entered macros and defaults missing macros to zero', async () => {
    mockCreateEntryMutateAsync.mockResolvedValue({ id: 'f-1' });

    const { getByText, getByPlaceholderText } = await render(<LogFoodScreen />);
    await fireEvent.changeText(getByPlaceholderText('Grilled chicken rice bowl'), 'Chicken rice bowl');
    await fireEvent.changeText(getByPlaceholderText('620'), '620');
    await fireEvent.changeText(getByPlaceholderText('52'), '52');
    // Carbs/fat left blank on purpose.
    await fireEvent.press(getByText('Save Meal'));

    await waitFor(() =>
      expect(mockCreateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Chicken rice bowl',
          calories: 620,
          protein_g: 52,
          carbs_g: 0,
          fat_g: 0,
        }),
      ),
    );
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'TodayTab', params: { screen: 'Today' } });
  });

  it('defaults the meal type from the current hour and lets it be changed', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(8); // morning -> breakfast

    const { getByText } = await render(<LogFoodScreen />);
    expect(getByText('Breakfast')).toBeTruthy();

    await fireEvent.press(getByText('Dinner'));

    jest.restoreAllMocks();
  });

  it('records a zero-calorie skipped entry for the selected meal without requiring name/calories', async () => {
    mockCreateEntryMutateAsync.mockResolvedValue({ id: 'f-2' });
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(8); // morning -> breakfast

    const { getByText } = await render(<LogFoodScreen />);
    await fireEvent.press(getByText('Lunch'));
    await fireEvent.press(getByText('Skip this meal'));

    await waitFor(() =>
      expect(mockCreateEntryMutateAsync).toHaveBeenCalledWith({
        name: 'Skipped Lunch',
        meal_type: 'lunch',
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        status: 'skipped',
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'TodayTab', params: { screen: 'Today' } });

    jest.restoreAllMocks();
  });
});
