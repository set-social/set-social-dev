import React from 'react';
import { addDays, format } from 'date-fns';

function addDaysFromNow(n: number): Date {
  return addDays(new Date(), n);
}
import { act } from 'react-test-renderer';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { ReactTestRendererJSON, ReactTestRendererNode } from 'react-test-renderer';
import { TodayScreen } from '../TodayScreen';
import { useCoachSummaryStore } from '../../../store/coachSummaryStore';
import { useActiveWorkoutStore } from '../../../store/activeWorkoutStore';
import { useWorkoutLogsInRange } from '../../../services/api/queries/workoutLogs';
import { useScheduledWorkouts } from '../../../services/api/queries/scheduledWorkouts';
import { useLoggedSets, computePrEvents } from '../../../services/api/queries/progress';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
  };
});

const mockUseFriendsPosts = jest.fn();

jest.mock('../../../services/api/queries/posts', () => {
  const actual = jest.requireActual('../../../services/api/queries/posts');
  return {
    ...actual,
    useFriendsPosts: (...args: unknown[]) => mockUseFriendsPosts(...args),
    useSignedPhotoUrls: jest.fn(() => ({ data: {} })),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

// The Energy Today card has its own dedicated rendering tests
// (EnergyTodayCard.test.tsx) — this file only needs to verify the gating
// ternary in TodayScreen itself, so it forces the flag off regardless of
// the real featureFlags.ts default.
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { nutritionTracking: false } }));

const mockUseFriendConsistencyPercentile = jest.fn();

jest.mock('../../../services/api/queries/community', () => ({
  useFriendConsistencyPercentile: (...args: unknown[]) => mockUseFriendConsistencyPercentile(...args),
}));

let mockFocusModeEnabled = false;

jest.mock('../../../store/focusModeStore', () => ({
  useFocusModeStore: (selector: (state: { focusModeEnabled: boolean }) => unknown) =>
    selector({ focusModeEnabled: mockFocusModeEnabled }),
}));

const mockRefetchProgram = jest.fn();
const mockRefetchWorkoutLogs = jest.fn();
const mockRefetchScheduledWorkouts = jest.fn();
const mockRefetchWeeklySchedule = jest.fn();
const mockRefetchLoggedSets = jest.fn();
const mockRefetchDayOverrides = jest.fn();

const mockUseActiveProgramTree = jest.fn();

jest.mock('../../../services/api/queries/programs', () => ({
  useActiveProgramTree: (...args: unknown[]) => mockUseActiveProgramTree(...args),
  getProgramDayForDate: jest.fn(() => null),
}));

const mockUseProfile = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

jest.mock('../../../services/api/queries/workoutLogs', () => ({
  useWorkoutLogsInRange: jest.fn(() => ({ data: [], isLoading: false, refetch: mockRefetchWorkoutLogs })),
}));

jest.mock('../../../services/api/queries/scheduledWorkouts', () => ({
  useScheduledWorkouts: jest.fn(() => ({ data: [], isLoading: false, refetch: mockRefetchScheduledWorkouts })),
  useStartTemplateToday: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  TODAY_RANGE_PAST_DAYS: 91,
  TODAY_RANGE_FUTURE_DAYS: 21,
}));

const mockUseWeeklySchedule = jest.fn();

jest.mock('../../../services/api/queries/weeklySchedule', () => {
  const actual = jest.requireActual('../../../services/api/queries/weeklySchedule');
  return {
    ...actual,
    useWeeklySchedule: (...args: unknown[]) => mockUseWeeklySchedule(...args),
  };
});

const mockClearDayOverrideMutate = jest.fn();
const mockUseDayOverrides = jest.fn();

jest.mock('../../../services/api/queries/dayOverrides', () => {
  const actual = jest.requireActual('../../../services/api/queries/dayOverrides');
  return {
    ...actual,
    useDayOverrides: (...args: unknown[]) => mockUseDayOverrides(...args),
    useClearDayOverride: jest.fn(() => ({ mutate: mockClearDayOverrideMutate, isPending: false })),
  };
});

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useWorkoutTemplate: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

jest.mock('../../../services/api/queries/progress', () => {
  const actual = jest.requireActual('../../../services/api/queries/progress');
  return {
    ...actual,
    useLoggedSets: jest.fn(() => ({ data: [], isLoading: false, refetch: mockRefetchLoggedSets })),
    computePrEvents: jest.fn(() => []),
  };
});

const mockUseIntegrationConnections = jest.fn();

jest.mock('../../../services/api/queries/integrations', () => ({
  useIntegrationConnections: (...args: unknown[]) => mockUseIntegrationConnections(...args),
}));

const mockSyncWhoopMetricsMutate = jest.fn();
const mockUseWhoopMetrics = jest.fn();

const mockUseWhoopMetricsRange = jest.fn();

jest.mock('../../../services/api/queries/whoop', () => ({
  useSyncWhoopMetrics: jest.fn(() => ({ mutate: mockSyncWhoopMetricsMutate })),
  useWhoopMetrics: (...args: unknown[]) => mockUseWhoopMetrics(...args),
  useWhoopMetricsRange: (...args: unknown[]) => mockUseWhoopMetricsRange(...args),
}));

const mockSyncOuraMetricsMutate = jest.fn();

jest.mock('../../../services/api/queries/oura', () => ({
  useSyncOuraMetrics: jest.fn(() => ({ mutate: mockSyncOuraMetricsMutate })),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockUseLiveFriendWorkouts = jest.fn();

jest.mock('../../../services/api/queries/liveWorkouts', () => ({
  useLiveFriendWorkouts: (...args: unknown[]) => mockUseLiveFriendWorkouts(...args),
}));

const mockUseMyCheckin = jest.fn();
const mockUseNearbyCheckins = jest.fn();

jest.mock('../../../services/api/queries/location', () => ({
  useMyCheckin: (...args: unknown[]) => mockUseMyCheckin(...args),
  useNearbyCheckins: (...args: unknown[]) => mockUseNearbyCheckins(...args),
}));

const mockUseBodyMetrics = jest.fn();

jest.mock('../../../services/api/queries/bodyMetrics', () => ({
  useBodyMetrics: (...args: unknown[]) => mockUseBodyMetrics(...args),
  useLatestBodyWeight: jest.fn(() => ({ data: null, isLoading: false })),
}));

jest.mock('../../../services/api/queries/foodLog', () => ({
  useFoodLogEntriesInRange: jest.fn(() => ({ data: [], isLoading: false })),
}));

const mockUseReadinessContext = jest.fn();

jest.mock('../../../services/api/queries/coaching', () => ({
  useReadinessContext: (...args: unknown[]) => mockUseReadinessContext(...args),
  useSubmitReadinessCheckin: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

const DEFAULT_READINESS_CONTEXT = {
  isLoading: false,
  inputs: {
    checkin: null,
    wearable: null,
    trainingLoad: { acuteVolumeKg: 0, chronicAvgVolumeKg: 0, loadRatio: null, classification: 'unknown' as const },
    daysSinceLastWorkout: null,
    missedWorkoutsLast14Days: 0,
  },
  hasCheckin: false,
  checkinId: null,
};

const MOCK_PATTERN = {
  id: 'pat-1',
  user_id: 'user-1',
  pattern_key: 'inconsistent_weekday:5',
  pattern_type: 'inconsistent_weekday' as const,
  confidence: 0.8,
  title: 'Friday sessions keep getting skipped',
  detail: "You've missed 3 of 4 planned Friday sessions recently.",
  evidence_summary: '3/4 Friday sessions missed',
  status: 'active' as const,
  first_detected_at: new Date().toISOString(),
  last_detected_at: new Date().toISOString(),
  dismissed_at: null,
};

const mockSyncMutate = jest.fn();
const mockDismissMutate = jest.fn();

jest.mock('../../../services/api/queries/coachingMemory', () => ({
  useTrainingPatterns: jest.fn(() => ({
    isLoading: false,
    activePatterns: [MOCK_PATTERN],
    params: { weeklySnapshots: [], missedWeekdays: [], exerciseRpeTrends: [], dismissedKeys: [] },
  })),
  useSyncTrainingPatterns: jest.fn(() => ({ mutate: mockSyncMutate })),
  useDismissTrainingPattern: jest.fn(() => ({ mutate: mockDismissMutate })),
}));

const mockGenerateTodayFocusSummary = jest.fn((..._args: unknown[]) => ({
  headline: 'Ready to train',
  summary: 'Today is a training day.',
  band: 'high' as const,
}));

const mockPredictPersonalRecords: jest.Mock = jest.fn(() => []);
const DEFAULT_READINESS = {
  score: 85,
  band: 'high' as const,
  factors: [] as Array<{
    key: string;
    label: string;
    impact: 'positive' | 'negative' | 'neutral';
    weight: number;
    detail: string;
    available: boolean;
  }>,
  recommendedIntensity: 'full' as const,
  recommendedRpeRange: [7, 9] as [number, number],
  estimatedSessionQuality: 'excellent' as const,
  summary: 'Readiness appears strong today.',
  computedAt: '2026-01-01T00:00:00.000Z',
};
const mockEvaluateReadiness: jest.Mock = jest.fn(() => DEFAULT_READINESS);
const mockGenerateEnergySummary: jest.Mock = jest.fn(() => ({ headline: '', body: '' }));

jest.mock('../../../services/coaching', () => ({
  coachingEngine: {
    detectTrainingPatterns: jest.fn(() => [
      {
        key: 'inconsistent_weekday:5',
        type: 'inconsistent_weekday',
        confidence: 0.8,
        title: MOCK_PATTERN.title,
        detail: MOCK_PATTERN.detail,
        evidenceSummary: MOCK_PATTERN.evidence_summary,
      },
    ]),
    evaluateReadiness: (...args: unknown[]) => mockEvaluateReadiness(...args),
    generateTodayFocusSummary: (...args: unknown[]) => mockGenerateTodayFocusSummary(...args),
    predictPersonalRecords: (...args: unknown[]) => mockPredictPersonalRecords(...args),
    generateEnergySummary: (...args: unknown[]) => mockGenerateEnergySummary(...args),
  },
}));

const FRIEND_POST = {
  id: 'post-1',
  user_id: 'friend-1',
  post_type: 'progress_photo' as const,
  visibility: 'friends' as const,
  caption: null,
  photo_path: 'friend-1/friends/a.jpg',
  before_photo_path: null,
  after_photo_path: null,
  created_at: '2026-01-01T00:00:00.000Z',
  displayName: 'Friend One',
  avatarUrl: null,
};

const mockedUseWorkoutLogsInRange = useWorkoutLogsInRange as jest.Mock;
const mockedUseScheduledWorkouts = useScheduledWorkouts as jest.Mock;
const mockedUseLoggedSets = useLoggedSets as jest.Mock;
const mockedComputePrEvents = computePrEvents as jest.Mock;

/** Flattens a rendered tree into its text content, in document order, so
 * relative card ordering (e.g. "Coach Insight" right under "Arnold's Summary")
 * can be asserted without depending on RNTL's DOM-adjacency helpers. */
function collectText(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | ReactTestRendererNode[] | string | null,
): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectText);
  return collectText(node.children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFriendsPosts.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: jest.fn() });
  mockedUseWorkoutLogsInRange.mockReturnValue({ data: [], isLoading: false, refetch: mockRefetchWorkoutLogs });
  mockedUseScheduledWorkouts.mockReturnValue({ data: [], isLoading: false, refetch: mockRefetchScheduledWorkouts });
  mockedUseLoggedSets.mockReturnValue({ data: [], isLoading: false, refetch: mockRefetchLoggedSets });
  mockedComputePrEvents.mockReturnValue([]);
  mockUseActiveProgramTree.mockReturnValue({
    data: { id: 'p1', days_per_week: 3, weeks_count: 4, start_date: '2024-01-01', program_weeks: [] },
    isLoading: false,
    refetch: mockRefetchProgram,
  });
  mockUseWeeklySchedule.mockReturnValue({ data: [], isLoading: false, refetch: mockRefetchWeeklySchedule });
  mockUseDayOverrides.mockReturnValue({ data: [], isLoading: false, refetch: mockRefetchDayOverrides });
  mockUseProfile.mockReturnValue({ data: null, isLoading: false });
  mockUseIntegrationConnections.mockReturnValue({ data: [], isLoading: false });
  mockUseWhoopMetrics.mockReturnValue({ data: null, isLoading: false });
  mockUseLiveFriendWorkouts.mockReturnValue({ data: [], isLoading: false });
  mockUseMyCheckin.mockReturnValue({ data: null, isLoading: false });
  mockUseNearbyCheckins.mockReturnValue({ data: [], isLoading: false });
  mockUseBodyMetrics.mockReturnValue({ data: [], isLoading: false });
  mockPredictPersonalRecords.mockReturnValue([]);
  mockUseWhoopMetricsRange.mockReturnValue({ data: [], isLoading: false });
  mockEvaluateReadiness.mockReturnValue(DEFAULT_READINESS);
  mockUseReadinessContext.mockReturnValue(DEFAULT_READINESS_CONTEXT);
  mockFocusModeEnabled = false;
  mockUseFriendConsistencyPercentile.mockReturnValue({ data: null, isLoading: false });
  // Real, non-mocked, in-memory store shared across the whole test file —
  // reset so an earlier test's dismiss doesn't leak into a later one (same
  // pattern AiSummaryCard.test.tsx uses).
  useCoachSummaryStore.setState({ dismissed: false });
});

describe('TodayScreen', () => {
  function seedSocialSectionsData() {
    mockUseLiveFriendWorkouts.mockReturnValue({
      data: [
        {
          friend: {
            id: 'friend-1',
            display_name: 'Friend One',
            avatar_url: null,
            avatar_focal_x: 0.5,
            avatar_focal_y: 0.5,
            handle: 'friendone',
            bio: null,
            hide_stats_from_friends: false,
            hide_photos_from_friends: false,
            is_private: false,
            is_premium: false,
          },
          workoutLogId: 'wl-1',
          startedAt: new Date().toISOString(),
          workoutTitle: 'Push Day',
          exerciseId: 'ex-1',
          exerciseName: 'Bench Press',
          setsDone: 2,
          bestLoadKg: 60,
          bestReps: 8,
          prLoadKg: null,
          prReps: null,
          atYourGym: false,
        },
      ],
      isLoading: false,
    });
    mockUseMyCheckin.mockReturnValue({ data: { id: 'checkin-1' }, isLoading: false });
    mockUseNearbyCheckins.mockReturnValue({ data: [{ user_id: 'friend-2', distance_meters: 10 }], isLoading: false });
  }

  it('shows Live Now, gym proximity, and Friends Activity summary rows when Focus Mode is off', async () => {
    seedSocialSectionsData();
    mockUseFriendsPosts.mockReturnValue({ data: [FRIEND_POST], isLoading: false, isError: false, refetch: jest.fn() });

    const { getByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText('Friend One is training live')).toBeTruthy());
    expect(getByText('1 friend checked in nearby')).toBeTruthy();
    expect(getByText('1 new post from friends')).toBeTruthy();
  });

  it('hides Live Now, gym proximity, and Friends Activity once Focus Mode is enabled', async () => {
    seedSocialSectionsData();
    mockUseFriendsPosts.mockReturnValue({ data: [FRIEND_POST], isLoading: false, isError: false, refetch: jest.fn() });
    mockFocusModeEnabled = true;

    const { getByText, queryByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());
    expect(queryByText(/is training live/)).toBeNull();
    expect(queryByText('1 friend checked in nearby')).toBeNull();
    expect(queryByText(/new post from friends/)).toBeNull();
  });

  it('shows the friend-consistency percentile even when Focus Mode is on', async () => {
    mockUseFriendConsistencyPercentile.mockReturnValue({ data: 82, isLoading: false });
    mockFocusModeEnabled = true;

    // Home shows the merged vitals tile's chip-style segment ("CONSISTENCY" /
    // "82%"), not the full sentence — that full copy still renders on the
    // Progress tab's own ConsistencyPercentileCard usage, covered by that
    // component's tests.
    const { getByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText('CONSISTENCY')).toBeTruthy());
    expect(getByText('82%')).toBeTruthy();
  });

  it('hides the friend-consistency percentile when there are no eligible friends', async () => {
    mockUseFriendConsistencyPercentile.mockReturnValue({ data: null, isLoading: false });

    const { getByText, queryByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());
    expect(queryByText(/More consistent than/)).toBeNull();
  });

  it('shows the quick check-in card until a check-in already exists for today', async () => {
    const { getByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText('Quick check-in')).toBeTruthy());
  });

  it('hides the quick check-in card once a check-in exists for today', async () => {
    mockUseReadinessContext.mockReturnValue({ ...DEFAULT_READINESS_CONTEXT, hasCheckin: true, checkinId: 'c-1' });

    const { queryByText, getByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());
    expect(queryByText('Quick check-in')).toBeNull();
  });

  it("renders the Arnold's Summary card from generateTodayFocusSummary", async () => {
    const { getByText } = await render(<TodayScreen />);

    await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());
    expect(getByText('Ready to train')).toBeTruthy();
    expect(getByText('Today is a training day.')).toBeTruthy();
  });

  it('hides the Energy Today card while nutritionTracking is disabled', async () => {
    const { getByText, queryByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());
    expect(queryByText('Energy today')).toBeNull();
  });

  it('refetches program, workout logs, scheduled workouts, weekly schedule, logged sets, day overrides, and friends posts on pull-to-refresh', async () => {
    const mockRefetchFriendsPosts = jest.fn();
    mockUseFriendsPosts.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetchFriendsPosts });

    const { getByTestId, getByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());

    await act(async () => {
      await getByTestId('today-scroll-view').props.refreshControl.props.onRefresh();
    });

    expect(mockRefetchProgram).toHaveBeenCalled();
    expect(mockRefetchWorkoutLogs).toHaveBeenCalled();
    expect(mockRefetchScheduledWorkouts).toHaveBeenCalled();
    expect(mockRefetchWeeklySchedule).toHaveBeenCalled();
    expect(mockRefetchLoggedSets).toHaveBeenCalled();
    expect(mockRefetchFriendsPosts).toHaveBeenCalled();
    expect(mockRefetchDayOverrides).toHaveBeenCalled();
  });

  it('renders a Friends Activity summary row from friends posts', async () => {
    mockUseFriendsPosts.mockReturnValue({ data: [FRIEND_POST], isLoading: false, isError: false, refetch: jest.fn() });

    const { getByText } = await render(<TodayScreen />);

    await waitFor(() => expect(getByText('1 new post from friends')).toBeTruthy());
  });

  it('navigates to the community posts grid when the Friends Activity row is pressed', async () => {
    mockUseFriendsPosts.mockReturnValue({ data: [FRIEND_POST], isLoading: false, isError: false, refetch: jest.fn() });

    const { getByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText('1 new post from friends')).toBeTruthy());

    await fireEvent.press(getByText('1 new post from friends'));
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'CommunityTab',
      params: { screen: 'Posts' },
    });
  });

  it('renders a Coach Insight row for an active detected pattern', async () => {
    const { getByText } = await render(<TodayScreen />);

    await waitFor(() => expect(getByText(MOCK_PATTERN.title)).toBeTruthy());
    expect(getByText(MOCK_PATTERN.detail)).toBeTruthy();
  });

  it('dismisses a pattern with its id when the dismiss button is pressed', async () => {
    const { getByLabelText } = await render(<TodayScreen />);

    await waitFor(() => expect(getByLabelText('Dismiss insight')).toBeTruthy());
    await fireEvent.press(getByLabelText('Dismiss insight'));

    expect(mockDismissMutate).toHaveBeenCalledWith({ id: 'pat-1', userId: 'user-1' });
  });

  it('renders the calendar under Arnold\'s Summary, then the plan card, then Coach Insight further down in "More for you"', async () => {
    const { toJSON, getByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText(MOCK_PATTERN.title)).toBeTruthy());

    const texts = collectText(toJSON());
    const aiSummaryIndex = texts.indexOf("Arnold's Summary");
    // "Month" is the calendar's static month-picker label — a stable anchor
    // for the WeekTimeline section, unlike its month-year header text which
    // depends on the actual current date.
    const calendarIndex = texts.indexOf('Month');
    const planCardIndex = texts.indexOf('Nothing logged');
    const coachInsightIndex = texts.indexOf(MOCK_PATTERN.title);

    expect(aiSummaryIndex).toBeGreaterThanOrEqual(0);
    expect(calendarIndex).toBeGreaterThan(aiSummaryIndex);
    // The plan card is promoted straight under the calendar now; Coach
    // Insight is demoted into the "More for you" group below it.
    expect(planCardIndex).toBeGreaterThan(calendarIndex);
    expect(coachInsightIndex).toBeGreaterThan(planCardIndex);
  });

  it('shows a real stats summary and a PR badge on a completed day, computed from workout logs and logged sets', async () => {
    const startedAt = new Date();
    startedAt.setHours(9, 0, 0, 0);
    const completedAt = new Date(startedAt.getTime() + 42 * 60_000);
    const loggedAt = new Date(startedAt.getTime() + 10 * 60_000).toISOString();

    mockedUseWorkoutLogsInRange.mockReturnValue({
      data: [
        {
          id: 'wl-1',
          programDayId: null,
          scheduledWorkoutId: null,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        },
      ],
      isLoading: false,
      refetch: mockRefetchWorkoutLogs,
    });
    mockedUseLoggedSets.mockReturnValue({
      data: [
        { id: 's1', exerciseId: 'ex1', exerciseName: 'Bench Press', reps: 8, loadKg: 60, loggedAt },
        { id: 's2', exerciseId: 'ex1', exerciseName: 'Bench Press', reps: 8, loadKg: 60, loggedAt },
      ],
      isLoading: false,
      refetch: mockRefetchLoggedSets,
    });
    mockedComputePrEvents.mockReturnValue([
      { exerciseId: 'ex1', exerciseName: 'Bench Press', loadKg: 60, reps: 8, e1rm: 76, loggedAt },
    ]);

    const { getByText } = await render(<TodayScreen />);

    await waitFor(() => expect(getByText("Today's workout is done")).toBeTruthy());
    expect(getByText('42 min')).toBeTruthy();
    expect(getByText('960 kg')).toBeTruthy();
    expect(getByText('New PR')).toBeTruthy();
  });

  it('shows cardio stats (not the strength summary) on a day whose only completed log is cardio, with no flip affordance', async () => {
    const startedAt = new Date();
    startedAt.setHours(9, 0, 0, 0);
    const completedAt = new Date(startedAt.getTime() + 30 * 60_000);

    mockedUseWorkoutLogsInRange.mockReturnValue({
      data: [
        {
          id: 'wl-1',
          programDayId: null,
          scheduledWorkoutId: null,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          cardio: {
            activityName: 'Treadmill',
            durationMinutes: 30,
            distanceKm: 5,
            effort: 'moderate',
            estimatedCalories: 320,
          },
        },
      ],
      isLoading: false,
      refetch: mockRefetchWorkoutLogs,
    });

    const { getByText, queryByText } = await render(<TodayScreen />);

    await waitFor(() => expect(getByText("Today's cardio is done")).toBeTruthy());
    expect(getByText('Treadmill')).toBeTruthy();
    expect(getByText('30 min')).toBeTruthy();
    expect(getByText('~320')).toBeTruthy();
    expect(getByText('5.0 km')).toBeTruthy();
    expect(queryByText('Tap to see the full workout')).toBeNull();
  });

  it('shows the recurring training day name for today, ahead of the AI program day', async () => {
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: new Date().getDay(),
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: mockRefetchWeeklySchedule,
    });

    const { getByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());
  });

  it('lets an explicit one-off scheduled workout for today override the recurring assignment', async () => {
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: new Date().getDay(),
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: mockRefetchWeeklySchedule,
    });
    mockedUseScheduledWorkouts.mockReturnValue({
      data: [{ id: 'sw-1', name: 'One-Off Leg Day', scheduled_date: format(new Date(), 'yyyy-MM-dd') }],
      isLoading: false,
      refetch: mockRefetchScheduledWorkouts,
    });

    const { getByText, queryByText } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText('One-Off Leg Day')).toBeTruthy());
    expect(queryByText('Ultimate Core Day')).toBeNull();
  });

  describe('Today hero card (merged AI summary + plan)', () => {
    function seedTodaysWeeklyPlan() {
      mockUseWeeklySchedule.mockReturnValue({
        data: [
          {
            id: 'ws-1',
            day_of_week: new Date().getDay(),
            workout_template_id: 'template-1',
            workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
          },
        ],
        isLoading: false,
        refetch: mockRefetchWeeklySchedule,
      });
    }

    it("merges the coach summary and today's plan into one hero card", async () => {
      seedTodaysWeeklyPlan();

      const { getByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());
      // One hero, not two separate cards — both render together.
      expect(getByText("Arnold's Summary")).toBeTruthy();
      expect(getByText('Start Workout')).toBeTruthy();
    });

    it('keeps the Start Workout CTA visible after dismissing the coach summary in the merged hero', async () => {
      seedTodaysWeeklyPlan();

      const { getByText, queryByText, getByLabelText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());

      await fireEvent.press(getByLabelText('Dismiss coach summary'));
      expect(queryByText("Arnold's Summary")).toBeNull();
      expect(getByText('Ultimate Core Day')).toBeTruthy();
      expect(getByText('Start Workout')).toBeTruthy();
    });

    describe('an in-progress session (activeWorkoutStore)', () => {
      afterEach(() => {
        useActiveWorkoutStore.getState().reset();
      });

      it('shows Continue Workout and an IN PROGRESS label when a session was started today', async () => {
        seedTodaysWeeklyPlan();
        useActiveWorkoutStore.getState().startWorkout({
          workoutLogId: 'wl-1',
          source: { type: 'freestyle', id: null },
          exercises: [],
        });

        const { getByText, queryByText } = await render(<TodayScreen />);
        await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());
        expect(getByText('IN PROGRESS')).toBeTruthy();
        expect(getByText('Continue Workout')).toBeTruthy();
        expect(queryByText('Start Workout')).toBeNull();
      });

      it('still shows Start Workout when the persisted session is from a prior day', async () => {
        seedTodaysWeeklyPlan();
        useActiveWorkoutStore.setState({
          workoutLogId: 'wl-stale',
          source: { type: 'freestyle', id: null },
          startedAt: addDaysFromNow(-1).getTime(),
        });

        const { getByText, queryByText } = await render(<TodayScreen />);
        await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());
        expect(getByText('Start Workout')).toBeTruthy();
        expect(queryByText('Continue Workout')).toBeNull();
        expect(queryByText('IN PROGRESS')).toBeNull();
      });
    });

    it("does not merge for a non-today branch — Arnold's Summary and the plan card stay separate", async () => {
      const { getByText, toJSON } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());
      expect(getByText('Nothing logged')).toBeTruthy();

      const texts = collectText(toJSON());
      expect(texts.indexOf("Arnold's Summary")).toBeLessThan(texts.indexOf('Nothing logged'));
    });

    it('shows a Cardio Day plan card for a weekly-recurring cardio day, not "nothing logged"', async () => {
      // A cardio weekly_schedule row carries no template — day_type is the
      // only signal it's cardio at all (see asTrainingEntry's own doc
      // comment in TodayScreen.tsx).
      mockUseWeeklySchedule.mockReturnValue({
        data: [
          {
            id: 'ws-1',
            day_of_week: new Date().getDay(),
            day_type: 'cardio',
            workout_template_id: null,
            workout_templates: null,
          },
        ],
        isLoading: false,
        refetch: mockRefetchWeeklySchedule,
      });

      const { getByText, queryByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText('Cardio Day')).toBeTruthy());
      expect(queryByText('Nothing logged')).toBeNull();
      expect(queryByText("No training day on today's calendar.")).toBeNull();
    });

    describe('a day marked missed via day_overrides', () => {
      it('shows a Missed state with an Add Workout Back CTA instead of Start Workout', async () => {
        seedTodaysWeeklyPlan();
        mockUseDayOverrides.mockReturnValue({
          data: [{ id: 'ov-1', user_id: 'user-1', date: format(new Date(), 'yyyy-MM-dd'), status: 'missed' }],
          isLoading: false,
          refetch: mockRefetchDayOverrides,
        });

        const { getByText, queryByText } = await render(<TodayScreen />);
        await waitFor(() => expect(getByText('MISSED')).toBeTruthy());
        expect(queryByText('Start Workout')).toBeNull();
        expect(getByText('Add Workout Back')).toBeTruthy();
      });

      it('clears the override for today when Add Workout Back is pressed', async () => {
        seedTodaysWeeklyPlan();
        mockUseDayOverrides.mockReturnValue({
          data: [{ id: 'ov-1', user_id: 'user-1', date: format(new Date(), 'yyyy-MM-dd'), status: 'missed' }],
          isLoading: false,
          refetch: mockRefetchDayOverrides,
        });

        const { getByText } = await render(<TodayScreen />);
        await waitFor(() => expect(getByText('Add Workout Back')).toBeTruthy());
        await fireEvent.press(getByText('Add Workout Back'));

        expect(mockClearDayOverrideMutate).toHaveBeenCalledWith({
          userId: 'user-1',
          date: format(new Date(), 'yyyy-MM-dd'),
        });
      });

      it('lets a completed log win over a missed override — the day still shows as done', async () => {
        seedTodaysWeeklyPlan();
        mockUseDayOverrides.mockReturnValue({
          data: [{ id: 'ov-1', user_id: 'user-1', date: format(new Date(), 'yyyy-MM-dd'), status: 'missed' }],
          isLoading: false,
          refetch: mockRefetchDayOverrides,
        });
        mockedUseWorkoutLogsInRange.mockReturnValue({
          data: [
            {
              id: 'log-1',
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              cardio: null,
            },
          ],
          isLoading: false,
          refetch: mockRefetchWorkoutLogs,
        });

        const { queryByText } = await render(<TodayScreen />);
        await waitFor(() => expect(queryByText('MISSED')).toBeNull());
      });
    });
  });

  it('still shows the calendar, day detail, and friends activity when there is no active program', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false, refetch: mockRefetchProgram });
    mockUseFriendsPosts.mockReturnValue({ data: [FRIEND_POST], isLoading: false, isError: false, refetch: jest.fn() });

    const { getByText, getAllByText } = await render(<TodayScreen />);

    // The week calendar strip renders regardless of a program (weekday letters M/T/W/etc).
    await waitFor(() => expect(getAllByText('M').length).toBeGreaterThan(0));
    // Selected-day card still resolves (to "nothing logged/scheduled") without a program.
    expect(getByText('Nothing logged')).toBeTruthy();
    // Friends activity is completely independent of program state.
    expect(getByText('1 new post from friends')).toBeTruthy();
  });

  it('shows an inline Today link next to the calendar strip\'s Month control, jumping back to today\'s plan on tap after selecting another date', async () => {
    const { getByText, getByTestId } = await render(<TodayScreen />);
    await waitFor(() => expect(getByText('Month')).toBeTruthy());
    // Always visible (matches the Training tab's Today control) rather than
    // appearing/disappearing, so it's discoverable even on first load.
    expect(getByText('Today')).toBeTruthy();
    expect(getByText('Nothing logged')).toBeTruthy();

    await fireEvent.press(getByTestId(`week-timeline-day-${format(addDaysFromNow(1), 'yyyy-MM-dd')}`));
    await fireEvent.press(getByText('Today'));

    // Back on today's own plan card, not left on the tapped future date.
    await waitFor(() => expect(getByText('Nothing logged')).toBeTruthy());
  });

  describe('Live Now', () => {
    const FRIEND = {
      id: 'friend-1',
      display_name: 'Sam K.',
      avatar_url: null,
      avatar_focal_x: 0.5,
      avatar_focal_y: 0.5,
      handle: null,
      bio: null,
      hide_stats_from_friends: false,
      hide_photos_from_friends: false,
      is_private: false,
      is_premium: false,
    };
    const LIVE_WORKOUT = {
      friend: FRIEND,
      workoutLogId: 'log-1',
      startedAt: new Date().toISOString(),
      workoutTitle: 'Push Day',
      exerciseId: 'ex-1',
      exerciseName: 'Bench Press',
      setsDone: 2,
      bestLoadKg: 100,
      bestReps: 5,
      prLoadKg: 110,
      prReps: 5,
      atYourGym: false,
    };

    it('shows nothing when no friend is currently live', async () => {
      const { queryByText } = await render(<TodayScreen />);
      await waitFor(() => {});
      expect(queryByText(/is training live/)).toBeNull();
    });

    it('renders a Live Now summary row and navigates to Community on tap', async () => {
      mockUseLiveFriendWorkouts.mockReturnValue({ data: [LIVE_WORKOUT], isLoading: false });

      const { getByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText('Sam K. is training live')).toBeTruthy());
      // Only one live friend — the subtitle is their workout title, not a "+N more" count.
      expect(getByText('Push Day')).toBeTruthy();

      await fireEvent.press(getByText('Sam K. is training live'));
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'CommunityTab',
        params: { screen: 'Posts' },
      });
    });

    it('shows a "+N more" subtitle when more than one friend is live', async () => {
      const SECOND_FRIEND = { ...FRIEND, id: 'friend-2', display_name: 'Jamie R.' };
      mockUseLiveFriendWorkouts.mockReturnValue({
        data: [LIVE_WORKOUT, { ...LIVE_WORKOUT, friend: SECOND_FRIEND, workoutLogId: 'log-2' }],
        isLoading: false,
      });

      const { getByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText('Sam K. is training live')).toBeTruthy());
      expect(getByText('+1 more')).toBeTruthy();
    });
  });

  describe('Whoop rings', () => {
    // The full recovery/sleep/strain rings dashboard (WhoopMetricsSection)
    // lives only on the Progress tab now — Home's only Whoop surface is the
    // one-line HRV callout (see the "Recovery story line (HRV)" tests
    // below), even once connected, so the rings/connect-prompt text never
    // appears here regardless of connection state.
    it('never shows the rings dashboard on Home, connected or not', async () => {
      mockUseIntegrationConnections.mockReturnValue({
        data: [{ provider: 'whoop', access_token: 'tok' }],
        isLoading: false,
      });
      mockUseWhoopMetrics.mockReturnValue({
        data: { recovery_score: 78, sleep_performance_pct: 86, strain: 11.4, score_state: 'SCORED' },
        isLoading: false,
      });

      const { queryByText } = await render(<TodayScreen />);
      await waitFor(() => {});
      expect(queryByText('Whoop')).toBeNull();
      expect(queryByText('Connect Whoop')).toBeNull();
    });
  });

  describe('Gym proximity pill', () => {
    it('shows nothing when not checked in', async () => {
      const { queryByText } = await render(<TodayScreen />);
      await waitFor(() => {});
      expect(queryByText(/checked in nearby/)).toBeNull();
    });

    it('shows nothing when checked in but no one is nearby', async () => {
      mockUseMyCheckin.mockReturnValue({
        data: { checkedInAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString() },
        isLoading: false,
      });
      mockUseNearbyCheckins.mockReturnValue({ data: [], isLoading: false });

      const { queryByText } = await render(<TodayScreen />);
      await waitFor(() => {});
      expect(queryByText(/checked in nearby/)).toBeNull();
    });

    it('shows a row and navigates to At My Gym when checked in near friends', async () => {
      mockUseMyCheckin.mockReturnValue({
        data: { checkedInAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString() },
        isLoading: false,
      });
      mockUseNearbyCheckins.mockReturnValue({
        data: [{ id: 'friend-2', display_name: 'Alex', distanceMeters: 20 }],
        isLoading: false,
      });

      const { getByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText('1 friend checked in nearby')).toBeTruthy());

      await fireEvent.press(getByText('1 friend checked in nearby'));
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'CommunityTab', params: { screen: 'AtMyGym' } });
    });
  });

  describe('Weight trend card', () => {
    it('shows nothing with fewer than two entries in the last 30 days', async () => {
      mockUseBodyMetrics.mockReturnValue({
        data: [{ id: 'm1', user_id: 'user-1', logged_at: new Date().toISOString(), weight_kg: 82.5, notes: null }],
        isLoading: false,
      });

      const { queryByText } = await render(<TodayScreen />);
      await waitFor(() => {});
      expect(queryByText(/kg$/)).toBeNull();
    });

    it('shows the latest weight and trend, and navigates to Body Metrics on tap', async () => {
      const now = Date.now();
      mockUseBodyMetrics.mockReturnValue({
        data: [
          { id: 'm1', user_id: 'user-1', logged_at: new Date(now - 20 * 86_400_000).toISOString(), weight_kg: 84, notes: null },
          { id: 'm2', user_id: 'user-1', logged_at: new Date(now - 1 * 86_400_000).toISOString(), weight_kg: 82.5, notes: null },
        ],
        isLoading: false,
      });

      const { getByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText('82.5 kg')).toBeTruthy());
      expect(getByText(/-1.5 kg \/ 30d/)).toBeTruthy();

      await fireEvent.press(getByText('82.5 kg'));
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'ProgressTab', params: { screen: 'BodyMetrics' } });
    });
  });

  describe('readiness breakdown (AiSummaryCard)', () => {
    it('does not show a "See why" toggle when no factors have real data behind them', async () => {
      const { getByText, queryByLabelText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText("Arnold's Summary")).toBeTruthy());
      expect(queryByLabelText('See why')).toBeNull();
    });

    it('expands into the underlying factors, only showing ones with real data', async () => {
      mockEvaluateReadiness.mockReturnValue({
        ...DEFAULT_READINESS,
        factors: [
          { key: 'sleep', label: 'Sleep duration', impact: 'positive', weight: 0.8, detail: 'Slept 8h.', available: true },
          { key: 'stress', label: 'Stress level', impact: 'negative', weight: 0.3, detail: 'Stress reported as high.', available: true },
          { key: 'wearable_recovery', label: 'Whoop recovery', impact: 'neutral', weight: 0, detail: '', available: false },
        ],
      });

      const { getByText, getByLabelText, queryByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByLabelText('See why')).toBeTruthy());
      expect(queryByText('Sleep duration')).toBeNull();

      await fireEvent.press(getByLabelText('See why'));
      expect(getByText('Sleep duration')).toBeTruthy();
      expect(getByText('Slept 8h.')).toBeTruthy();
      expect(getByText('Stress level')).toBeTruthy();
      // The unavailable wearable factor is filtered out, not shown as "N/A".
      expect(queryByText('Whoop recovery')).toBeNull();
    });
  });

  describe('PR forecast card', () => {
    it('shows nothing when there is no confident prediction', async () => {
      const { queryByText } = await render(<TodayScreen />);
      await waitFor(() => {});
      expect(queryByText(/On pace for a/)).toBeNull();
    });

    it('shows the top prediction and navigates to PR Detail on tap', async () => {
      mockPredictPersonalRecords.mockReturnValue([
        {
          exerciseId: 'ex-1',
          exerciseName: 'Squat',
          currentBestE1rm: 300,
          predictedE1rm: 313,
          targetDate: format(addDaysFromNow(12), 'yyyy-MM-dd'),
          confidence: 0.82,
          summary: 'Could hit a new Squat PR at this pace.',
        },
      ]);

      const { getByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText('On pace for a Squat PR')).toBeTruthy());
      expect(getByText(/313 kg · ~12 days out/)).toBeTruthy();
      expect(getByText('82%')).toBeTruthy();

      await fireEvent.press(getByText('On pace for a Squat PR'));
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'ProgressTab',
        params: { screen: 'PRDetail', params: { exerciseId: 'ex-1' } },
      });
    });
  });

  describe('Recovery story line (HRV)', () => {
    function scoredRow(daysAgo: number, hrvMs: number) {
      return {
        id: `w-${daysAgo}`,
        user_id: 'user-1',
        cycle_date: format(addDaysFromNow(-daysAgo), 'yyyy-MM-dd'),
        whoop_cycle_id: null,
        score_state: 'SCORED' as const,
        recovery_score: 70,
        sleep_performance_pct: 80,
        strain: 10,
        hrv_ms: hrvMs,
        resting_heart_rate: 55,
        synced_at: new Date().toISOString(),
      };
    }

    it('shows nothing without enough scored history, even when connected', async () => {
      mockUseIntegrationConnections.mockReturnValue({ data: [{ provider: 'whoop', access_token: 'tok' }], isLoading: false });
      mockUseWhoopMetricsRange.mockReturnValue({ data: [scoredRow(1, 60)], isLoading: false });

      const { queryByText } = await render(<TodayScreen />);
      await waitFor(() => {});
      expect(queryByText(/HRV (up|down)/)).toBeNull();
    });

    it('shows an upward HRV story vs. baseline when connected with enough history', async () => {
      mockUseIntegrationConnections.mockReturnValue({ data: [{ provider: 'whoop', access_token: 'tok' }], isLoading: false });
      const baseline = [6, 5, 4, 3, 2].map(d => scoredRow(d, 50));
      mockUseWhoopMetricsRange.mockReturnValue({ data: [...baseline, scoredRow(1, 60)], isLoading: false });

      const { getByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText(/HRV up 20%/)).toBeTruthy());
    });
  });

  describe('Streak-risk nudge', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('shows nothing earlier in the day even with an at-risk streak', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 0, 15, 10, 0, 0)); // 10am
      mockedUseWorkoutLogsInRange.mockReturnValue({
        data: [{ id: 'log-1', programDayId: null, scheduledWorkoutId: null, startedAt: '', completedAt: '2026-01-14T12:00:00.000Z', cardio: null }],
        isLoading: false,
        refetch: mockRefetchWorkoutLogs,
      });
      mockUseWeeklySchedule.mockReturnValue({
        data: [{ id: 'ws-1', day_of_week: new Date(2026, 0, 15).getDay(), workout_template_id: 'template-1', workout_templates: { id: 'template-1', name: 'Push Day', workout_template_exercises: [{ order_index: 0 }] } }],
        isLoading: false,
        refetch: mockRefetchWeeklySchedule,
      });

      const { queryByText } = await render(<TodayScreen />);
      await waitFor(() => {});
      expect(queryByText(/streak is still alive/)).toBeNull();
    });

    it('shows the nudge in the evening when today is unlogged, required, and the streak is alive', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 0, 15, 19, 0, 0)); // 7pm
      mockedUseWorkoutLogsInRange.mockReturnValue({
        data: [{ id: 'log-1', programDayId: null, scheduledWorkoutId: null, startedAt: '', completedAt: '2026-01-14T12:00:00.000Z', cardio: null }],
        isLoading: false,
        refetch: mockRefetchWorkoutLogs,
      });
      mockUseWeeklySchedule.mockReturnValue({
        data: [
          { id: 'ws-1', day_of_week: new Date(2026, 0, 14).getDay(), workout_template_id: 'template-1', workout_templates: { id: 'template-1', name: 'Push Day', workout_template_exercises: [{ order_index: 0 }] } },
          { id: 'ws-2', day_of_week: new Date(2026, 0, 15).getDay(), workout_template_id: 'template-2', workout_templates: { id: 'template-2', name: 'Pull Day', workout_template_exercises: [{ order_index: 0 }] } },
        ],
        isLoading: false,
        refetch: mockRefetchWeeklySchedule,
      });

      const { getByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText(/streak is still alive — about 5 hours left today/)).toBeTruthy());
    });
  });

  describe('Weekly progress target (More for you)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('counts weekly-schedule training days toward the weekly target, not just program.days_per_week', async () => {
      // Thursday Jan 15 2026 — the mocked program has no program_weeks data
      // (see the default mockUseActiveProgramTree above), so it contributes
      // zero resolvable training days this week despite days_per_week: 3.
      // The real commitment for this athlete lives in the weekly schedule.
      jest.useFakeTimers().setSystemTime(new Date(2026, 0, 15, 10, 0, 0));
      mockUseWeeklySchedule.mockReturnValue({
        data: [0, 1, 2, 3].map(dayOfWeek => ({
          id: `ws-${dayOfWeek}`,
          day_of_week: dayOfWeek,
          workout_template_id: `template-${dayOfWeek}`,
          workout_templates: { id: `template-${dayOfWeek}`, name: 'Push Day', workout_template_exercises: [{ order_index: 0 }] },
        })),
        isLoading: false,
        refetch: mockRefetchWeeklySchedule,
      });

      const { getByText, queryByText } = await render(<TodayScreen />);
      await waitFor(() => expect(getByText('On track this week')).toBeTruthy());
      // Thursday isn't one of the configured weekly-schedule days (Sun-Wed
      // here), so it's a legitimate rest day — computeStreak now correctly
      // counts it, hence the "1 day streak" suffix alongside the target fix
      // this test actually exists to cover.
      expect(getByText('4 sessions left · 1 day streak')).toBeTruthy();
      expect(queryByText('0 sessions left')).toBeNull();
    });
  });
});
