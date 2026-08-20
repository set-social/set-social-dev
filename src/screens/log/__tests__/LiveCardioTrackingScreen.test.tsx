import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LiveCardioTrackingScreen } from '../LiveCardioTrackingScreen';
import { useActiveCardioStore } from '../../../store/activeCardioStore';

// SlideToCancelBar's GestureDetector requires a GestureHandlerRootView
// ancestor — normally provided once at the real app root (App.tsx), which
// doesn't exist in an isolated test render tree.
function renderScreen() {
  return render(<LiveCardioTrackingScreen />, {
    wrapper: ({ children }) => <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>,
  });
}

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
const mockUseRoute = jest.fn(() => ({
  params: {
    programDayId: 'day-1',
    activityKey: 'run' as const,
    exerciseId: 'ex-run',
    customActivityName: null as string | null,
  },
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      replace: mockReplace,
      goBack: mockGoBack,
      canGoBack: () => true,
    }),
    useRoute: () => mockUseRoute(),
  };
});

const mockRequestPermission = jest.fn();
const mockStartRouteTracking = jest.fn();
const mockStopRouteTracking = jest.fn();

jest.mock('../../../services/location/routeTracking', () => ({
  requestCardioTrackingPermission: (...args: unknown[]) => mockRequestPermission(...args),
  startRouteTracking: (...args: unknown[]) => mockStartRouteTracking(...args),
  stopRouteTracking: (...args: unknown[]) => mockStopRouteTracking(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useActiveCardioStore.getState().reset();
  mockRequestPermission.mockResolvedValue({ foreground: true, background: true });
  mockStartRouteTracking.mockReturnValue(42);
});

afterEach(() => {
  useActiveCardioStore.getState().reset();
});

describe('LiveCardioTrackingScreen — permission granted', () => {
  it('starts a session and begins the GPS watch', async () => {
    await renderScreen();
    await waitFor(() => expect(useActiveCardioStore.getState().status).toBe('tracking'));
    expect(useActiveCardioStore.getState().activityKey).toBe('run');
    expect(useActiveCardioStore.getState().exerciseId).toBe('ex-run');
    await waitFor(() => expect(mockStartRouteTracking).toHaveBeenCalled());
  });

  it('does not restart an already in-progress session on mount', async () => {
    useActiveCardioStore.getState().startSession({
      source: { programDayId: 'day-1' },
      activityKey: 'run',
      exerciseId: 'ex-run',
      customActivityName: null,
    });
    useActiveCardioStore.getState().addPoint({ latitude: 1, longitude: 1, recordedAt: Date.now() });

    await renderScreen();
    await waitFor(() => expect(mockStartRouteTracking).toHaveBeenCalled());
    // The point recorded before mount must survive — a fresh startSession
    // call would have wiped it back to an empty points array.
    expect(useActiveCardioStore.getState().points).toHaveLength(1);
  });

  // Regression coverage for the reported bug: a brand new run immediately
  // showed an already-enormous duration/pace, because a leftover session
  // from a previous run (never properly cleared) was silently resumed
  // instead of a fresh one being started.
  it('discards a leftover "finished" session on mount instead of resuming it', async () => {
    const staleFinishedAt = Date.now() - 5 * 24 * 60 * 60 * 1000; // 5 days ago
    useActiveCardioStore.setState({
      status: 'finished',
      source: { programDayId: 'day-1' },
      activityKey: 'run',
      exerciseId: 'ex-run',
      customActivityName: null,
      startedAt: staleFinishedAt - 30 * 60 * 1000,
      pausedAt: null,
      pausedMs: 0,
      finishedAt: staleFinishedAt,
      points: [{ latitude: 1, longitude: 1, recordedAt: staleFinishedAt - 60_000 }],
    });

    await renderScreen();
    await waitFor(() => expect(useActiveCardioStore.getState().status).toBe('tracking'));

    const state = useActiveCardioStore.getState();
    expect(state.points).toHaveLength(0);
    expect(state.finishedAt).toBeNull();
    expect(Date.now() - (state.startedAt ?? 0)).toBeLessThan(1000);
  });

  it('discards a stale "tracking" session (crash/force-quit) older than the plausible-session ceiling', async () => {
    const ancientStartedAt = Date.now() - 12 * 24 * 60 * 60 * 1000; // 12 days ago
    useActiveCardioStore.setState({
      status: 'tracking',
      source: { programDayId: 'day-1' },
      activityKey: 'run',
      exerciseId: 'ex-run',
      customActivityName: null,
      startedAt: ancientStartedAt,
      pausedAt: null,
      pausedMs: 0,
      finishedAt: null,
      points: [{ latitude: 1, longitude: 1, recordedAt: ancientStartedAt + 60_000 }],
    });

    await renderScreen();
    await waitFor(() => expect(mockStartRouteTracking).toHaveBeenCalled());

    const state = useActiveCardioStore.getState();
    expect(state.points).toHaveLength(0);
    expect(Date.now() - (state.startedAt ?? 0)).toBeLessThan(1000);
  });

  it('resumes a recent "tracking" session (e.g. around a backgrounding event) rather than discarding it', async () => {
    const recentStartedAt = Date.now() - 5 * 60 * 1000; // 5 minutes ago — plausible
    useActiveCardioStore.setState({
      status: 'tracking',
      source: { programDayId: 'day-1' },
      activityKey: 'run',
      exerciseId: 'ex-run',
      customActivityName: null,
      startedAt: recentStartedAt,
      pausedAt: null,
      pausedMs: 0,
      finishedAt: null,
      points: [{ latitude: 1, longitude: 1, recordedAt: recentStartedAt + 60_000 }],
    });

    await renderScreen();
    await waitFor(() => expect(mockStartRouteTracking).toHaveBeenCalled());

    const state = useActiveCardioStore.getState();
    expect(state.points).toHaveLength(1);
    expect(state.startedAt).toBe(recentStartedAt);
  });

  it('wires an onPoint callback into startRouteTracking that appends to the store', async () => {
    await renderScreen();
    await waitFor(() => expect(mockStartRouteTracking).toHaveBeenCalled());

    const onPoint = mockStartRouteTracking.mock.calls[0][0] as (p: unknown) => void;
    await act(async () => {
      onPoint({ latitude: 10, longitude: 20, recordedAt: Date.now() });
      await Promise.resolve();
    });

    expect(useActiveCardioStore.getState().points).toHaveLength(1);
  });

  it('Pause/Resume toggle the session status', async () => {
    const { getByText } = await renderScreen();
    await waitFor(() => expect(useActiveCardioStore.getState().status).toBe('tracking'));

    await fireEvent.press(getByText('Pause'));
    expect(useActiveCardioStore.getState().status).toBe('paused');

    await fireEvent.press(getByText('Resume'));
    expect(useActiveCardioStore.getState().status).toBe('tracking');
  });

  it('does not stop/restart the native GPS watch when pausing and resuming', async () => {
    const { getByText } = await renderScreen();
    await waitFor(() => expect(mockStartRouteTracking).toHaveBeenCalledTimes(1));

    await fireEvent.press(getByText('Pause'));
    await fireEvent.press(getByText('Resume'));

    expect(mockStartRouteTracking).toHaveBeenCalledTimes(1);
    expect(mockStopRouteTracking).not.toHaveBeenCalled();
  });

  it('Finish stops tracking, finishes the session, and replaces with CardioRunSummary', async () => {
    const { getByText } = await renderScreen();
    await waitFor(() => expect(useActiveCardioStore.getState().status).toBe('tracking'));

    await fireEvent.press(getByText('Complete Run'));

    expect(mockStopRouteTracking).toHaveBeenCalledWith(42);
    expect(useActiveCardioStore.getState().status).toBe('finished');
    expect(mockReplace).toHaveBeenCalledWith('CardioRunSummary');
  });

  it('a confirmed slide on SlideToCancelBar stops tracking and clears the session with no confirmation dialog', async () => {
    const { getByLabelText } = await renderScreen();
    await waitFor(() => expect(useActiveCardioStore.getState().status).toBe('tracking'));

    // The bar's own drag gesture is the confirmation (no Alert on top of
    // it) — exercised here via its accessibility "activate" action, the
    // same fallback path a screen reader user would trigger, rather than
    // simulating a raw pan gesture.
    fireEvent(getByLabelText('Cancel run'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });

    expect(mockStopRouteTracking).toHaveBeenCalledWith(42);
    expect(useActiveCardioStore.getState().status).toBe('idle');
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('LiveCardioTrackingScreen — permission denied', () => {
  it('shows a manual-entry fallback and never starts a session or the GPS watch', async () => {
    mockRequestPermission.mockResolvedValue({ foreground: false, background: false });

    const { getByText, queryByTestId } = await renderScreen();
    await waitFor(() => expect(getByText('Location access needed')).toBeTruthy());

    expect(queryByTestId('live-map-container')).toBeNull();
    expect(useActiveCardioStore.getState().status).toBe('idle');
    expect(mockStartRouteTracking).not.toHaveBeenCalled();

    await fireEvent.press(getByText('Enter Manually'));
    expect(mockGoBack).toHaveBeenCalled();
  });
});
