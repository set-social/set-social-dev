import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { CardioRunSummaryScreen } from '../CardioRunSummaryScreen';
import { useActiveCardioStore } from '../../../store/activeCardioStore';

const mockNavigate = jest.fn();
const mockPopToTop = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, popToTop: mockPopToTop, canGoBack: () => true }),
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
jest.mock('../../../services/api/queries/bodyMetrics', () => ({
  useLatestBodyWeight: (...args: unknown[]) => mockUseLatestBodyWeight(...args),
}));

const mockUseProfile = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

const ACTIVITIES = [{ id: 'ex-run', name: 'Outdoor Run' }];

// A ~1.11km-per-step-north 3km route over 18 minutes (six 3-minute, 500m
// legs) — long enough to produce whole-km splits without a fussy fixture.
function seedFinishedRun() {
  const start = 0;
  const points = [];
  for (let i = 0; i <= 6; i++) {
    points.push({
      latitude: (0.001 / 0.11119) * 0.5 * i,
      longitude: 0,
      recordedAt: start + i * 180_000,
    });
  }
  useActiveCardioStore.setState({
    status: 'finished',
    source: { programDayId: 'day-1' },
    activityKey: 'run',
    exerciseId: 'ex-run',
    customActivityName: null,
    startedAt: start,
    pausedAt: null,
    pausedMs: 0,
    finishedAt: start + 6 * 180_000,
    points,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useActiveCardioStore.getState().reset();
  mockUseCardioActivities.mockReturnValue({ data: ACTIVITIES, isLoading: false });
  mockUseLatestBodyWeight.mockReturnValue({ data: 75, isLoading: false });
  mockUseProfile.mockReturnValue({ data: { sex: null } });
});

afterEach(() => {
  useActiveCardioStore.getState().reset();
});

describe('CardioRunSummaryScreen', () => {
  it('renders distance/duration/pace stats computed from the finished session', async () => {
    seedFinishedRun();
    const { getByText } = await render(<CardioRunSummaryScreen />);

    expect(getByText('3.00')).toBeTruthy();
    expect(getByText('18:00')).toBeTruthy();
  });

  it('renders one split row per completed km', async () => {
    seedFinishedRun();
    const { getAllByText } = await render(<CardioRunSummaryScreen />);
    // Six 500m legs = 3 completed km splits.
    expect(getAllByText('BEST')).toHaveLength(1);
  });

  it('renders a calorie estimate once bodyweight is known', async () => {
    seedFinishedRun();
    const { getByText } = await render(<CardioRunSummaryScreen />);
    await waitFor(() => expect(getByText("ARNOLD'S ESTIMATE")).toBeTruthy());
  });

  it('Save calls useSaveCardioLog with a route payload and navigates to Today', async () => {
    seedFinishedRun();
    mockSaveCardioLogMutateAsync.mockResolvedValue({ id: 'wl-1' });

    const { getByText } = await render(<CardioRunSummaryScreen />);
    await fireEvent.press(getByText('Save Session'));

    await waitFor(() =>
      expect(mockSaveCardioLogMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          programDayId: 'day-1',
          exerciseId: 'ex-run',
          customActivityName: null,
          route: expect.objectContaining({ points: expect.any(Array) }),
        }),
      ),
    );
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'TodayTab', params: { screen: 'Today' } });
    expect(useActiveCardioStore.getState().status).toBe('idle');
  });

  it('Discard confirms, clears the session, and pops to the top of the stack', async () => {
    seedFinishedRun();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const discardButton = buttons?.find(b => b.text === 'Discard');
      discardButton?.onPress?.();
    });

    const { getByText } = await render(<CardioRunSummaryScreen />);
    await fireEvent.press(getByText('Discard'));

    expect(alertSpy).toHaveBeenCalled();
    expect(useActiveCardioStore.getState().status).toBe('idle');
    expect(mockPopToTop).toHaveBeenCalled();
  });
});
