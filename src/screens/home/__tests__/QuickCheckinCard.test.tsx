import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QuickCheckinCard } from '../QuickCheckinCard';

const mockUseReadinessContext = jest.fn();
const mockSubmitMutate = jest.fn();

jest.mock('../../../services/api/queries/coaching', () => ({
  useReadinessContext: (...args: unknown[]) => mockUseReadinessContext(...args),
  useSubmitReadinessCheckin: jest.fn(() => ({ mutate: mockSubmitMutate, isPending: false })),
}));

const mockParseCheckinText = jest.fn();

jest.mock('../../../services/api/edgeFunctions', () => {
  const actual = jest.requireActual('../../../services/api/edgeFunctions');
  return { ...actual, parseCheckinText: (...args: unknown[]) => mockParseCheckinText(...args) };
});

const PARSED = {
  sleepHours: 5,
  sleepQuality: 2,
  soreness: 4,
  stress: 3,
  hasPain: true,
  painNotes: 'shoulders',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReadinessContext.mockReturnValue({ isLoading: false, hasCheckin: false, inputs: {}, checkinId: null });
});

describe('QuickCheckinCard', () => {
  it('renders nothing while readiness is loading or a check-in already exists today', async () => {
    mockUseReadinessContext.mockReturnValue({ isLoading: true, hasCheckin: false, inputs: {}, checkinId: null });
    const loading = await render(<QuickCheckinCard userId="user-1" />);
    expect(loading.toJSON()).toBeNull();

    mockUseReadinessContext.mockReturnValue({ isLoading: false, hasCheckin: true, inputs: {}, checkinId: 'c-1' });
    const checkedIn = await render(<QuickCheckinCard userId="user-1" />);
    expect(checkedIn.toJSON()).toBeNull();
  });

  it('parses free text into an editable, pre-filled confirmation form', async () => {
    mockParseCheckinText.mockResolvedValue(PARSED);

    const { getByPlaceholderText, getByText } = await render(<QuickCheckinCard userId="user-1" />);

    await fireEvent.changeText(
      getByPlaceholderText('e.g. Slept like garbage, 5 hours, shoulders are sore'),
      'Slept like garbage, 5 hours, shoulders are sore',
    );
    await fireEvent.press(getByText('Send to Arnold'));

    await waitFor(() => expect(getByText('Does this look right?')).toBeTruthy());
    expect(mockParseCheckinText).toHaveBeenCalledWith('Slept like garbage, 5 hours, shoulders are sore');
    expect(getByPlaceholderText('Where does it hurt?').props.value).toBe('shoulders');
  });

  it('submits the confirmed fields via useSubmitReadinessCheckin, not a direct write from the parse step', async () => {
    mockParseCheckinText.mockResolvedValue(PARSED);

    const { getByPlaceholderText, getByText } = await render(<QuickCheckinCard userId="user-1" />);
    await fireEvent.changeText(getByPlaceholderText('e.g. Slept like garbage, 5 hours, shoulders are sore'), 'text');
    await fireEvent.press(getByText('Send to Arnold'));
    await waitFor(() => expect(getByText('Does this look right?')).toBeTruthy());

    await fireEvent.press(getByText('Save check-in'));

    expect(mockSubmitMutate).toHaveBeenCalledWith(
      {
        sleepHours: 5,
        sleepQuality: 2,
        soreness: 4,
        stress: 3,
        hasPain: true,
        painNotes: 'shoulders',
        notes: 'text',
      },
      expect.anything(),
    );
  });

  it('alerts and stays on the input step when parsing fails', async () => {
    const { EdgeFunctionError } = jest.requireActual('../../../services/api/edgeFunctions');
    mockParseCheckinText.mockRejectedValue(new EdgeFunctionError('Missing check-in text'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByPlaceholderText, getByText, queryByText } = await render(<QuickCheckinCard userId="user-1" />);
    await fireEvent.changeText(getByPlaceholderText('e.g. Slept like garbage, 5 hours, shoulders are sore'), 'text');
    await fireEvent.press(getByText('Send to Arnold'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not parse that', 'Missing check-in text'));
    expect(queryByText('Does this look right?')).toBeNull();
  });
});
