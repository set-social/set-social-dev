import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LogCardioScreen } from '../LogCardioScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => true }),
    useRoute: () => ({ params: { programDayId: 'day-1' } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseCardioActivities = jest.fn();
const mockSaveCardioLogMutateAsync = jest.fn();
jest.mock('../../../services/api/queries/cardioLogs', () => ({
  useCardioActivities: (...args: unknown[]) => mockUseCardioActivities(...args),
  useSaveCardioLog: () => ({ mutateAsync: mockSaveCardioLogMutateAsync, isPending: false }),
}));

const mockUseLatestBodyWeight = jest.fn();
const mockLogBodyMetricMutateAsync = jest.fn();
jest.mock('../../../services/api/queries/bodyMetrics', () => ({
  useLatestBodyWeight: (...args: unknown[]) => mockUseLatestBodyWeight(...args),
  useLogBodyMetric: () => ({ mutateAsync: mockLogBodyMetricMutateAsync, isPending: false }),
}));

const mockUseProfile = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

const ACTIVITIES = [
  { id: 'ex-treadmill', name: 'Treadmill' },
  { id: 'ex-bike', name: 'Stationary Bike' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseCardioActivities.mockReturnValue({ data: ACTIVITIES, isLoading: false });
  mockUseLatestBodyWeight.mockReturnValue({ data: 75, isLoading: false });
  mockUseProfile.mockReturnValue({ data: { sex: null } });
});

describe('LogCardioScreen', () => {
  it('lists cardio activities plus a Custom Activity option', async () => {
    const { getByText } = await render(<LogCardioScreen />);
    await waitFor(() => expect(getByText('Treadmill')).toBeTruthy());
    expect(getByText('Stationary Bike')).toBeTruthy();
    expect(getByText('Custom Activity')).toBeTruthy();
  });

  it('shows incline/speed fields for treadmill but not effort', async () => {
    const { getByText, queryByText } = await render(<LogCardioScreen />);
    await fireEvent.press(getByText('Treadmill'));

    expect(getByText('INCLINE (%)')).toBeTruthy();
    expect(getByText('SPEED (KM/H)')).toBeTruthy();
    expect(queryByText('AVG EFFORT')).toBeNull();
  });

  it('shows an effort control (not incline/speed) for non-treadmill activities', async () => {
    const { getByText, queryByText } = await render(<LogCardioScreen />);
    await fireEvent.press(getByText('Stationary Bike'));

    expect(getByText('AVG EFFORT')).toBeTruthy();
    expect(queryByText('INCLINE (%)')).toBeNull();
  });

  it('reveals a name field when Custom Activity is selected', async () => {
    const { getByText, getByPlaceholderText } = await render(<LogCardioScreen />);
    await fireEvent.press(getByText('Custom Activity'));
    expect(getByPlaceholderText('e.g. Hotel gym bike')).toBeTruthy();
  });

  it('computes a live calorie estimate once activity, duration, and weight are all known', async () => {
    const { getByText, getByPlaceholderText, queryByText } = await render(<LogCardioScreen />);
    expect(queryByText("ARNOLD'S ESTIMATE")).toBeNull();

    await fireEvent.press(getByText('Treadmill'));
    await fireEvent.changeText(getByPlaceholderText('30'), '32');
    await fireEvent.changeText(getByPlaceholderText('0'), '12');
    await fireEvent.changeText(getByPlaceholderText('5.6'), '5.63');

    await waitFor(() => expect(getByText("ARNOLD'S ESTIMATE")).toBeTruthy());
  });

  it('prompts to log weight when none is on file, and unblocks the estimate after saving one', async () => {
    mockUseLatestBodyWeight.mockReturnValue({ data: null, isLoading: false });
    mockLogBodyMetricMutateAsync.mockResolvedValue({});

    const { getByText, getByPlaceholderText } = await render(<LogCardioScreen />);
    expect(getByText('Log your weight to get an estimate')).toBeTruthy();

    await fireEvent.changeText(getByPlaceholderText('75'), '80');
    await fireEvent.press(getByText('Save Weight'));

    await waitFor(() => expect(mockLogBodyMetricMutateAsync).toHaveBeenCalledWith({ weightKg: 80 }));
  });

  it('saves a library-activity session and navigates to Today', async () => {
    mockSaveCardioLogMutateAsync.mockResolvedValue({ id: 'wl-1' });

    const { getByText, getByPlaceholderText } = await render(<LogCardioScreen />);
    await fireEvent.press(getByText('Treadmill'));
    await fireEvent.changeText(getByPlaceholderText('30'), '32');
    await fireEvent.changeText(getByPlaceholderText('0'), '12');
    await fireEvent.changeText(getByPlaceholderText('5.6'), '5.63');

    await waitFor(() => expect(getByText("ARNOLD'S ESTIMATE")).toBeTruthy());
    await fireEvent.press(getByText('Save Session'));

    await waitFor(() =>
      expect(mockSaveCardioLogMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          programDayId: 'day-1',
          exerciseId: 'ex-treadmill',
          customActivityName: null,
          durationMinutes: 32,
          inclinePct: 12,
          speedKmh: 5.63,
        }),
      ),
    );
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'TodayTab', params: { screen: 'Today' } });
  });

  it('does not show the Track Live/Enter Manually toggle for indoor activities', async () => {
    const { getByText, queryByText } = await render(<LogCardioScreen />);
    await fireEvent.press(getByText('Treadmill'));
    expect(queryByText('Track Live')).toBeNull();
    expect(queryByText('Enter Manually')).toBeNull();
  });

  it('shows the toggle for an outdoor run and defaults to Enter Manually (form unchanged)', async () => {
    const OUTDOOR_ACTIVITIES = [
      { id: 'ex-treadmill', name: 'Treadmill' },
      { id: 'ex-run', name: 'Outdoor Run' },
    ];
    mockUseCardioActivities.mockReturnValue({ data: OUTDOOR_ACTIVITIES, isLoading: false });
    const { getByText } = await render(<LogCardioScreen />);
    await fireEvent.press(getByText('Outdoor Run'));

    expect(getByText('Track Live')).toBeTruthy();
    expect(getByText('Enter Manually')).toBeTruthy();
    // Manual form still renders by default — nothing about the existing
    // save flow changes for a user who ignores the new toggle entirely.
    expect(getByText('DURATION (MIN)')).toBeTruthy();
  });

  it('switching to Track Live hides the manual form and navigates to LiveCardioTracking on Start', async () => {
    const OUTDOOR_ACTIVITIES = [{ id: 'ex-run', name: 'Outdoor Run' }];
    mockUseCardioActivities.mockReturnValue({ data: OUTDOOR_ACTIVITIES, isLoading: false });
    const { getByText, queryByText } = await render(<LogCardioScreen />);
    await fireEvent.press(getByText('Outdoor Run'));
    await fireEvent.press(getByText('Track Live'));

    expect(queryByText('DURATION (MIN)')).toBeNull();
    expect(queryByText('Save Session')).toBeNull();

    await fireEvent.press(getByText('Start Tracking'));
    expect(mockNavigate).toHaveBeenCalledWith('LiveCardioTracking', {
      programDayId: 'day-1',
      date: undefined,
      activityKey: 'run',
      exerciseId: 'ex-run',
      customActivityName: null,
    });
  });

  it('saves a custom-activity session with a null exerciseId', async () => {
    mockSaveCardioLogMutateAsync.mockResolvedValue({ id: 'wl-1' });

    const { getByText, getByPlaceholderText } = await render(<LogCardioScreen />);
    await fireEvent.press(getByText('Custom Activity'));
    await fireEvent.changeText(getByPlaceholderText('e.g. Hotel gym bike'), 'Hotel gym elliptical');
    await fireEvent.changeText(getByPlaceholderText('30'), '20');

    await fireEvent.press(getByText('Save Session'));

    await waitFor(() =>
      expect(mockSaveCardioLogMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          exerciseId: null,
          customActivityName: 'Hotel gym elliptical',
          durationMinutes: 20,
        }),
      ),
    );
  });
});
