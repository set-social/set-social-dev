import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FoodEstimateCard } from '../FoodEstimateCard';

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseFoodLogEntry = jest.fn();
const mockUpdateEntryMutate = jest.fn();
const mockDeleteEntryMutate = jest.fn();
jest.mock('../../../services/api/queries/foodLog', () => ({
  useFoodLogEntry: (...args: unknown[]) => mockUseFoodLogEntry(...args),
  useUpdateFoodLogEntry: jest.fn(() => ({ mutate: mockUpdateEntryMutate, isPending: false })),
  useDeleteFoodLogEntry: jest.fn(() => ({ mutate: mockDeleteEntryMutate, isPending: false })),
}));

const PENDING_ENTRY = {
  id: 'food-1',
  name: 'Grilled chicken rice bowl',
  calories: 620,
  protein_g: 52,
  carbs_g: 60,
  fat_g: 18,
  status: 'pending' as const,
  confidence: 'high' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FoodEstimateCard', () => {
  it('shows a loading state while the entry is being fetched', async () => {
    mockUseFoodLogEntry.mockReturnValue({ data: undefined, isLoading: true });
    const { toJSON } = await render(<FoodEstimateCard foodLogEntryId="food-1" />);
    expect(toJSON()).toBeTruthy();
  });

  it('shows the estimate, confidence, and Edit/Confirm actions for a pending entry', async () => {
    mockUseFoodLogEntry.mockReturnValue({ data: PENDING_ENTRY, isLoading: false });
    const { getByText } = await render(<FoodEstimateCard foodLogEntryId="food-1" />);

    expect(getByText('Grilled chicken rice bowl')).toBeTruthy();
    expect(getByText('HIGH CONFIDENCE')).toBeTruthy();
    expect(getByText('620')).toBeTruthy();
    expect(getByText('Edit')).toBeTruthy();
    expect(getByText('Looks good')).toBeTruthy();
  });

  it('confirms the entry as-is when "Looks good" is pressed', async () => {
    mockUseFoodLogEntry.mockReturnValue({ data: PENDING_ENTRY, isLoading: false });
    const { getByText } = await render(<FoodEstimateCard foodLogEntryId="food-1" />);

    await fireEvent.press(getByText('Looks good'));
    expect(mockUpdateEntryMutate).toHaveBeenCalledWith({ id: 'food-1', status: 'confirmed' });
  });

  it('reveals editable fields on Edit and saves the edited values on Done editing', async () => {
    mockUseFoodLogEntry.mockReturnValue({ data: PENDING_ENTRY, isLoading: false });
    const { getByText, getByDisplayValue } = await render(<FoodEstimateCard foodLogEntryId="food-1" />);

    await fireEvent.press(getByText('Edit'));
    expect(getByText('Done editing')).toBeTruthy();

    const caloriesField = getByDisplayValue('620');
    await fireEvent.changeText(caloriesField, '700');
    await fireEvent.press(getByText('Done editing'));

    await waitFor(() =>
      expect(mockUpdateEntryMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'food-1', calories: 700, protein_g: 52, carbs_g: 60, fat_g: 18 }),
      ),
    );
  });

  it('shows a compact confirmed summary with no Edit/Confirm actions once confirmed', async () => {
    mockUseFoodLogEntry.mockReturnValue({ data: { ...PENDING_ENTRY, status: 'confirmed' }, isLoading: false });
    const { getByText, queryByText } = await render(<FoodEstimateCard foodLogEntryId="food-1" />);

    expect(getByText(/Logged · 620 cal/)).toBeTruthy();
    expect(queryByText('Edit')).toBeNull();
    expect(queryByText('Looks good')).toBeNull();
  });

  it('discards the estimate after confirming, deleting the row and replacing the card with a discarded notice', async () => {
    mockUseFoodLogEntry.mockReturnValue({ data: PENDING_ENTRY, isLoading: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const discardButton = buttons?.find(b => b.text === 'Discard');
      discardButton?.onPress?.();
    });

    const { getByText, getByLabelText, queryByText } = await render(<FoodEstimateCard foodLogEntryId="food-1" />);

    await fireEvent.press(getByLabelText('Discard this estimate'));
    expect(mockDeleteEntryMutate).toHaveBeenCalledWith('food-1');
    expect(getByText('Estimate discarded.')).toBeTruthy();
    expect(queryByText('Grilled chicken rice bowl')).toBeNull();

    alertSpy.mockRestore();
  });
});
