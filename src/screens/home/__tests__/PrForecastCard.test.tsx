import React from 'react';
import { format, addDays } from 'date-fns';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PrForecastCard } from '../PrForecastCard';
import type { PrPrediction } from '../../../services/coaching';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate }) };
});

beforeEach(() => {
  jest.clearAllMocks();
});

const PREDICTION: PrPrediction = {
  exerciseId: 'ex-1',
  exerciseName: 'Squat',
  currentBestE1rm: 300,
  predictedE1rm: 313,
  targetDate: format(addDays(new Date(), 12), 'yyyy-MM-dd'),
  confidence: 0.82,
  summary: 'Could hit a new Squat PR at this pace.',
};

describe('PrForecastCard', () => {
  it('renders nothing when there is no prediction', async () => {
    const { toJSON } = await render(<PrForecastCard prediction={null} unitPref="kg" />);
    expect(toJSON()).toBeNull();
  });

  it('shows the exercise, forecasted weight, days out, and confidence', async () => {
    const { getByText } = await render(<PrForecastCard prediction={PREDICTION} unitPref="kg" />);
    await waitFor(() => expect(getByText('On pace for a Squat PR')).toBeTruthy());
    expect(getByText(/313 kg · ~12 days out/)).toBeTruthy();
    expect(getByText('82%')).toBeTruthy();
  });

  it('converts to lb when that is the unit preference', async () => {
    const { getByText } = await render(<PrForecastCard prediction={PREDICTION} unitPref="lb" />);
    await waitFor(() => expect(getByText(/lb · ~12 days out/)).toBeTruthy());
  });

  it('navigates to PR Detail for the predicted exercise on tap', async () => {
    const { getByText } = await render(<PrForecastCard prediction={PREDICTION} unitPref="kg" />);
    await waitFor(() => expect(getByText('On pace for a Squat PR')).toBeTruthy());

    await fireEvent.press(getByText('On pace for a Squat PR'));
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'ProgressTab',
      params: { screen: 'PRDetail', params: { exerciseId: 'ex-1' } },
    });
  });

  it('floors days-out at 1 even when the target date has already passed', async () => {
    const overdue = { ...PREDICTION, targetDate: format(addDays(new Date(), -3), 'yyyy-MM-dd') };
    const { getByText } = await render(<PrForecastCard prediction={overdue} unitPref="kg" />);
    await waitFor(() => expect(getByText(/~1 day out/)).toBeTruthy());
  });
});
