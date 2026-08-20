import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { format, addDays, startOfWeek } from 'date-fns';
import { CalendarScreen } from '../CalendarScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false }),
    // The real hook needs a live NavigationContainer to know about focus
    // events — for these tests, running the callback once like a plain
    // effect is enough to cover the reset-segment-on-focus behavior.
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseActiveProgramTree = jest.fn();
const mockUseHasEverGeneratedProgram = jest.fn();

jest.mock('../../../services/api/queries/programs', () => {
  const actual = jest.requireActual('../../../services/api/queries/programs');
  return {
    ...actual,
    useActiveProgramTree: (...args: unknown[]) => mockUseActiveProgramTree(...args),
    useHasEverGeneratedProgram: (...args: unknown[]) => mockUseHasEverGeneratedProgram(...args),
  };
});

const mockUseProfile = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

const mockUseScheduledWorkouts = jest.fn();
const mockStartTemplateTodayMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/scheduledWorkouts', () => {
  const actual = jest.requireActual('../../../services/api/queries/scheduledWorkouts');
  return {
    ...actual,
    useScheduledWorkouts: (...args: unknown[]) => mockUseScheduledWorkouts(...args),
    useStartTemplateToday: () => ({ mutateAsync: mockStartTemplateTodayMutateAsync, isPending: false }),
  };
});

const mockUseWorkoutTemplate = jest.fn();

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useWorkoutTemplate: (...args: unknown[]) => mockUseWorkoutTemplate(...args),
}));

const mockUseWeeklySchedule = jest.fn();

jest.mock('../../../services/api/queries/weeklySchedule', () => {
  const actual = jest.requireActual('../../../services/api/queries/weeklySchedule');
  return {
    ...actual,
    useWeeklySchedule: (...args: unknown[]) => mockUseWeeklySchedule(...args),
  };
});

const mockUseWorkoutLogsInRange = jest.fn();

jest.mock('../../../services/api/queries/workoutLogs', () => ({
  useWorkoutLogsInRange: (...args: unknown[]) => mockUseWorkoutLogsInRange(...args),
}));

const mockUseCardioActivities = jest.fn();

jest.mock('../../../services/api/queries/cardioLogs', () => ({
  useCardioActivities: (...args: unknown[]) => mockUseCardioActivities(...args),
}));

const mockUseDayOverrides = jest.fn();
const mockSetDayOverrideMutate = jest.fn();

jest.mock('../../../services/api/queries/dayOverrides', () => {
  const actual = jest.requireActual('../../../services/api/queries/dayOverrides');
  return {
    ...actual,
    useDayOverrides: (...args: unknown[]) => mockUseDayOverrides(...args),
    useSetDayOverride: () => ({ mutate: mockSetDayOverrideMutate, isPending: false }),
  };
});

const mockUseLoggedSets = jest.fn();

jest.mock('../../../services/api/queries/progress', () => {
  const actual = jest.requireActual('../../../services/api/queries/progress');
  return {
    ...actual,
    useLoggedSets: (...args: unknown[]) => mockUseLoggedSets(...args),
  };
});

const mockFetchWeeklyPlanSnapshot = jest.fn();

jest.mock('../../../services/api/queries/workoutShares', () => ({
  fetchWeeklyPlanSnapshot: (...args: unknown[]) => mockFetchWeeklyPlanSnapshot(...args),
}));

// Frozen to a Wednesday so "this week" has a fixed, deterministic split
// between past (Sun/Mon/Tue), today (Wed), and future (Thu-Sat) days,
// regardless of which real-world day the suite happens to run on — the
// past-day "mark as rest/missed" behavior below is conditioned on exactly
// that split.
const FAKE_TODAY = new Date(2026, 0, 14, 12, 0, 0); // Wednesday, Jan 14 2026
jest.useFakeTimers().setSystemTime(FAKE_TODAY);

const thisWeekStart = startOfWeek(FAKE_TODAY, { weekStartsOn: 0 });
const thisWeekDate = (dayOfWeek: number) => addDays(thisWeekStart, dayOfWeek);

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWeeklySchedule.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
  mockUseWorkoutLogsInRange.mockReturnValue({ data: [], refetch: jest.fn() });
  mockUseScheduledWorkouts.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
  mockUseDayOverrides.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
  mockUseLoggedSets.mockReturnValue({ data: [], refetch: jest.fn() });
  mockUseWorkoutTemplate.mockReturnValue({ data: undefined, isLoading: false });
  // Fresh, never-generated-a-program user by default — matches most
  // existing scenarios here (no program set up yet) and keeps the Pro
  // gate a no-op unless a test explicitly opts into it.
  mockUseHasEverGeneratedProgram.mockReturnValue({ data: false });
  mockUseProfile.mockReturnValue({ data: { is_premium: false } });
  mockUseCardioActivities.mockReturnValue({ data: [{ id: 'ex-run', name: 'Outdoor Run' }], isLoading: false });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('CalendarScreen', () => {
  it('shows the Training header and a segmented control defaulting to This Week', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByText, getByLabelText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Training')).toBeTruthy());

    const thisWeekOption = getByLabelText('This Week');
    expect(thisWeekOption.props.accessibilityState.selected).toBe(true);
  });

  it('navigates to Library when the Library segment is tapped', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByLabelText } = await render(<CalendarScreen />);
    await fireEvent.press(getByLabelText('Library'));

    expect(mockNavigate).toHaveBeenCalledWith('Library', undefined);
  });

  it('sends a free user who has already generated a program to the paywall instead of the Ask Arnold sheet', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseHasEverGeneratedProgram.mockReturnValue({ data: true });

    const { getByLabelText, queryByText } = await render(<CalendarScreen />);
    await fireEvent.press(getByLabelText('Program'));

    expect(mockNavigate).toHaveBeenCalledWith('Paywall', { trigger: 'program_regen' });
    expect(queryByText('How many days a week do you want to train?')).toBeNull();
  });

  it('still lets a Pro user regenerate freely', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseHasEverGeneratedProgram.mockReturnValue({ data: true });
    mockUseProfile.mockReturnValue({ data: { is_premium: true } });

    const { getByLabelText, getByText } = await render(<CalendarScreen />);
    await fireEvent.press(getByLabelText('Program'));

    expect(getByText('Ask Arnold to build you a custom program')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('Paywall', expect.anything());
  });

  it('opens the Ask Arnold sheet from the Program segment when there is no active program', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByLabelText, getByText } = await render(<CalendarScreen />);
    await fireEvent.press(getByLabelText('Program'));

    expect(getByText('Build a Custom Program')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('GenerateProgram', expect.anything());
  });

  it('navigates to ProgramDetail from the Program segment when a program exists', async () => {
    mockUseActiveProgramTree.mockReturnValue({
      data: { id: 'program-1', title: 'Strength Block', weeks_count: 4, days_per_week: 3, program_weeks: [] },
      isLoading: false,
    });

    const { getByLabelText } = await render(<CalendarScreen />);
    await fireEvent.press(getByLabelText('Program'));

    expect(mockNavigate).toHaveBeenCalledWith('ProgramDetail', { programId: 'program-1' });
  });

  it('shows an empty state and an Add a Training Day button when nothing is set up', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('No training days set up yet')).toBeTruthy());

    await fireEvent.press(getByText('Add a Training Day'));
    expect(mockNavigate).toHaveBeenCalledWith('AssignTrainingDay');
  });

  it('lists all 7 weekdays once a training day is assigned; tapping the rest day offers Assign (pre-filled)', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Wednesday')).toBeTruthy());
    expect(getByText('Ultimate Core Day · 1 exercises')).toBeTruthy();
    expect(getByText(format(thisWeekDate(3), 'MMM d'))).toBeTruthy();
    expect(getByText('Sunday')).toBeTruthy();

    await fireEvent.press(getByText('Sunday'));
    expect(getByText('Assign a Workout')).toBeTruthy();
    await fireEvent.press(getByText('Assign a Workout'));
    expect(mockNavigate).toHaveBeenCalledWith('AssignTrainingDay', { initialDayOfWeek: 0 });
  });

  it('opens a "not doing today\'s workout" menu on tapping today\'s own training day, instead of navigating straight to it', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Wednesday')).toBeTruthy());

    await fireEvent.press(getByText('Wednesday'));
    expect(mockNavigate).not.toHaveBeenCalledWith('TrainingDayDetail', expect.anything());
    expect(getByText("Change today's plan")).toBeTruthy();
    expect(getByText('Choose From Library')).toBeTruthy();
    expect(getByText('Create New Workout')).toBeTruthy();
    expect(getByText('Make This a Cardio Day')).toBeTruthy();
    expect(getByText('Mark as Missed')).toBeTruthy();

    await fireEvent.press(getByText('Mark as Missed'));
    expect(mockSetDayOverrideMutate).toHaveBeenCalledWith({
      userId: 'user-1',
      date: format(thisWeekDate(3), 'yyyy-MM-dd'),
      status: 'missed',
    });
    await waitFor(() => expect(queryByText("Change today's plan")).toBeNull());
  });

  it('"Choose From Library" on today\'s recurring training day opens Library preset to today, with no scheduled workout to replace', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Wednesday')).toBeTruthy());
    await fireEvent.press(getByText('Wednesday'));
    await fireEvent.press(getByText('Choose From Library'));

    expect(mockNavigate).toHaveBeenCalledWith('Library', {
      pickMode: true,
      date: format(thisWeekDate(3), 'yyyy-MM-dd'),
      replaceScheduledWorkoutId: undefined,
    });
  });

  it('"Create New Workout" on today\'s recurring training day opens TemplateEditor preset to today', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Wednesday')).toBeTruthy());
    await fireEvent.press(getByText('Wednesday'));
    await fireEvent.press(getByText('Create New Workout'));

    expect(mockNavigate).toHaveBeenCalledWith('TemplateEditor', {
      scheduleAfterSave: true,
      date: format(thisWeekDate(3), 'yyyy-MM-dd'),
      replaceScheduledWorkoutId: undefined,
    });
  });

  it('"Make This a Cardio Day" on today\'s recurring training day sets a one-off cardio override for today, without changing the day\'s recurring type', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Wednesday')).toBeTruthy());
    await fireEvent.press(getByText('Wednesday'));
    await fireEvent.press(getByText('Make This a Cardio Day'));

    expect(mockSetDayOverrideMutate).toHaveBeenCalledWith({
      userId: 'user-1',
      date: format(thisWeekDate(3), 'yyyy-MM-dd'),
      status: 'cardio',
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('AssignCardioDay', expect.anything());
    expect(mockNavigate).not.toHaveBeenCalledWith('MainTabs', expect.anything());
  });

  it('"Choose From Library" on a one-off scheduled today passes its id to replace', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
    const thisWednesday = thisWeekDate(3);
    mockUseScheduledWorkouts.mockReturnValue({
      data: [{ id: 'sw-today-1', name: 'Recovery Mobility Flow', scheduled_date: format(thisWednesday, 'yyyy-MM-dd') }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Recovery Mobility Flow')).toBeTruthy());
    await fireEvent.press(getByText('Recovery Mobility Flow'));
    await fireEvent.press(getByText('Choose From Library'));

    expect(mockNavigate).toHaveBeenCalledWith('Library', {
      pickMode: true,
      date: format(thisWednesday, 'yyyy-MM-dd'),
      replaceScheduledWorkoutId: 'sw-today-1',
    });
  });

  it('starts today\'s training day directly from the Start button, without going through the "not doing today" menu', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });
    const TEMPLATE = {
      id: 'template-1',
      name: 'Ultimate Core Day',
      workout_template_exercises: [{ id: 'te-1', order_index: 0 }],
    };
    mockUseWorkoutTemplate.mockReturnValue({ data: TEMPLATE, isLoading: false });
    mockStartTemplateTodayMutateAsync.mockResolvedValue({ id: 'sw-today' });

    const { getByText, queryByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Start')).toBeTruthy());

    await fireEvent.press(getByText('Start'));

    await waitFor(() =>
      expect(mockStartTemplateTodayMutateAsync).toHaveBeenCalledWith({ userId: 'user-1', template: TEMPLATE }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('PreWorkoutReview', { scheduledWorkoutId: 'sw-today' });
    expect(queryByText("Change today's plan")).toBeNull();
  });

  it('offers a choice between assigning a workout or logging cardio when a rest day is tapped', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Sunday')).toBeTruthy());

    await fireEvent.press(getByText('Sunday'));
    expect(getByText('Assign a Workout')).toBeTruthy();
    expect(getByText('Log Cardio')).toBeTruthy();

    await fireEvent.press(getByText('Log Cardio'));
    expect(mockNavigate).toHaveBeenCalledWith('AssignCardioDay', { initialDayOfWeek: 0 });
  });

  it('shows a cardio weekday as "Cardio Day"; tapping today\'s own cardio day opens the menu with only Mark as Missed (no redundant Log Cardio), while Start logs it directly', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [{ id: 'ws-1', day_of_week: 3, workout_template_id: null, day_type: 'cardio' }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Wednesday')).toBeTruthy());
    expect(getByText('Cardio Day')).toBeTruthy();

    await fireEvent.press(getByText('Wednesday'));
    expect(mockNavigate).not.toHaveBeenCalledWith('MainTabs', expect.anything());
    expect(getByText("Change today's plan")).toBeTruthy();
    expect(getByText('Mark as Missed')).toBeTruthy();
    expect(queryByText('Make This a Cardio Day')).toBeNull();
    expect(queryByText('Assign a Workout')).toBeNull();

    await fireEvent.press(getByText('Start'));
    expect(mockNavigate).toHaveBeenCalledWith('LogCardio', undefined);
  });

  it('opens the change-day menu for a cardio day later this week (not past yet), with Start Cardio as the primary action', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [{ id: 'ws-1', day_of_week: 5, workout_template_id: null, day_type: 'cardio' }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Friday')).toBeTruthy());

    await fireEvent.press(getByText('Friday'));
    expect(queryByText('This day has passed')).toBeNull();
    expect(getByText('Change Friday')).toBeTruthy();

    await fireEvent.press(getByText('Start Cardio'));
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'ProgramsTab',
      params: { screen: 'LogCardio', params: { date: format(thisWeekDate(5), 'yyyy-MM-dd') } },
    });
  });

  it('offers Mark as Rest / Mark as Missed instead of starting the workout for a cardio day that has already passed', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [{ id: 'ws-1', day_of_week: 0, workout_template_id: null, day_type: 'cardio' }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Sunday')).toBeTruthy());
    expect(getByText('Cardio Day')).toBeTruthy();

    await fireEvent.press(getByText('Sunday'));
    expect(getByText('Mark as Rest')).toBeTruthy();
    expect(getByText('Mark as Missed')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('MainTabs', expect.anything());

    await fireEvent.press(getByText('Mark as Missed'));
    expect(mockSetDayOverrideMutate).toHaveBeenCalledWith({
      userId: 'user-1',
      date: format(thisWeekDate(0), 'yyyy-MM-dd'),
      status: 'missed',
    });
    expect(queryByText('Mark as Rest')).toBeNull();
  });

  it('lets a past training day be marked as rest instead of retroactively assigning a different workout', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 1,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Leg Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Monday')).toBeTruthy());

    await fireEvent.press(getByText('Monday'));
    expect(getByText('Mark as Rest')).toBeTruthy();
    await fireEvent.press(getByText('Mark as Rest'));

    expect(mockSetDayOverrideMutate).toHaveBeenCalledWith({
      userId: 'user-1',
      date: format(thisWeekDate(1), 'yyyy-MM-dd'),
      status: 'rest',
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('TrainingDayDetail', expect.anything());
  });

  it('lets today be changed back to rest after being marked missed earlier the same day', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });
    // Today (Wednesday) already has a 'missed' override — e.g. from an
    // earlier tap of "Mark as Missed" on this same day.
    mockUseDayOverrides.mockReturnValue({
      data: [{ id: 'do-1', user_id: 'user-1', date: format(thisWeekDate(3), 'yyyy-MM-dd'), status: 'missed', created_at: '' }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Missed')).toBeTruthy());

    await fireEvent.press(getByText('Wednesday'));
    // Must NOT fall through to the rest-day Assign/Cardio sheet, which has
    // no way back to "rest" at all.
    expect(queryByText('This day is set to rest')).toBeNull();
    expect(getByText('Update this day')).toBeTruthy();
    expect(getByText('Mark as Rest')).toBeTruthy();

    await fireEvent.press(getByText('Mark as Rest'));
    expect(mockSetDayOverrideMutate).toHaveBeenCalledWith({
      userId: 'user-1',
      date: format(thisWeekDate(3), 'yyyy-MM-dd'),
      status: 'rest',
    });
  });

  it('shows a day already marked missed as "Missed" with no workout to start', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [{ id: 'ws-1', day_of_week: 0, workout_template_id: null, day_type: 'cardio' }],
      isLoading: false,
      refetch: jest.fn(),
    });
    mockUseDayOverrides.mockReturnValue({
      data: [{ id: 'do-1', user_id: 'user-1', date: format(thisWeekDate(0), 'yyyy-MM-dd'), status: 'missed', created_at: '' }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Missed')).toBeTruthy());

    await fireEvent.press(getByText('Sunday'));
    expect(getByText('Mark as Rest')).toBeTruthy();
  });

  it('shows a day as Done and opens its log detail on tap, once this week\'s workout for that day is logged', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });
    const thisWednesday = thisWeekDate(3);
    mockUseWorkoutLogsInRange.mockReturnValue({
      data: [{ id: 'log-1', programDayId: null, scheduledWorkoutId: null, startedAt: '', completedAt: `${format(thisWednesday, 'yyyy-MM-dd')}T12:00:00.000Z` }],
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Done')).toBeTruthy());

    await fireEvent.press(getByText('Wednesday'));
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutLogDetail', {
      workoutLogIds: ['log-1'],
      title: 'Ultimate Core Day',
      dateLabel: format(thisWednesday, 'EEEE, MMM d'),
    });

    // A rest day is still tappable (offers the assign/cardio choice) even
    // when a different day this week is already completed.
    await fireEvent.press(getByText('Sunday'));
    await fireEvent.press(getByText('Assign a Workout'));
    expect(mockNavigate).toHaveBeenCalledWith('AssignTrainingDay', { initialDayOfWeek: 0 });
    // The completed row keeps showing its resolved title alongside the
    // "Done" trailing badge — it doesn't disappear.
    expect(queryByText('Ultimate Core Day')).toBeTruthy();
  });

  it('shows a one-off badge when an ad-hoc scheduled workout overrides a normal training day this week', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Pull Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });
    const thisWednesday = thisWeekDate(3);
    mockUseScheduledWorkouts.mockReturnValue({
      data: [{ id: 'sw-1', name: 'Recovery Mobility Flow', scheduled_date: format(thisWednesday, 'yyyy-MM-dd') }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Recovery Mobility Flow')).toBeTruthy());
    expect(getByText('ONE-OFF')).toBeTruthy();
    expect(getByText('usually Pull Day')).toBeTruthy();

    // Today's own row (even an ad-hoc one-off override) opens the "not
    // doing today" menu on tap rather than navigating straight in — Start
    // (tested separately) is the only direct path once it's today.
    await fireEvent.press(getByText('Recovery Mobility Flow'));
    expect(mockNavigate).not.toHaveBeenCalledWith('ScheduledWorkoutDetail', expect.anything());
    expect(getByText("Change today's plan")).toBeTruthy();
  });

  it('shows a one-off badge with "usually Rest" when an ad-hoc workout is added to a normally-rest day', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    const thisSaturday = thisWeekDate(6);
    mockUseScheduledWorkouts.mockReturnValue({
      data: [{ id: 'sw-2', name: 'Mobility Session', scheduled_date: format(thisSaturday, 'yyyy-MM-dd') }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Mobility Session')).toBeTruthy());
    expect(getByText('usually Rest')).toBeTruthy();
  });

  it('"View Workout" on a one-off scheduled day opens ScheduledWorkoutDetail for that session', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    const thisSaturday = thisWeekDate(6);
    mockUseScheduledWorkouts.mockReturnValue({
      data: [{ id: 'sw-2', name: 'Mobility Session', scheduled_date: format(thisSaturday, 'yyyy-MM-dd') }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Mobility Session')).toBeTruthy());

    await fireEvent.press(getByText('Mobility Session'));
    await fireEvent.press(getByText('View Workout'));

    expect(mockNavigate).toHaveBeenCalledWith('ScheduledWorkoutDetail', { scheduledWorkoutId: 'sw-2' });
  });

  it('shows an UPCOMING section only for scheduled workouts beyond this week, not within it', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    const withinThisWeek = thisWeekDate(5);
    const beyondThisWeek = addDays(thisWeekDate(6), 5);
    mockUseScheduledWorkouts.mockReturnValue({
      data: [
        { id: 'sw-within', name: 'This Week Session', scheduled_date: format(withinThisWeek, 'yyyy-MM-dd') },
        { id: 'sw-future', name: 'Future Session', scheduled_date: format(beyondThisWeek, 'yyyy-MM-dd') },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText, queryByText, getAllByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('UPCOMING')).toBeTruthy());
    expect(getByText('Future Session')).toBeTruthy();
    // "This Week Session" appears once, in its weekday row — not duplicated
    // under UPCOMING.
    expect(getAllByText('This Week Session')).toHaveLength(1);
    expect(queryByText(format(withinThisWeek, 'EEEE, MMM d'))).toBeNull();
  });

  it('shows a secondary Ask Arnold link when there is no active program', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Ask Arnold to build you a custom program')).toBeTruthy());

    await fireEvent.press(getByText('Ask Arnold to build you a custom program'));
    expect(getByText('Build a Custom Program')).toBeTruthy();
  });

  it('asks days-per-week and weeks before revealing the goal/emphasis fields, then submits everything as GenerateProgram params', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByText, queryByText, getByPlaceholderText } = await render(<CalendarScreen />);
    await fireEvent.press(getByText('Ask Arnold to build you a custom program'));

    expect(getByText('How many days a week do you want to train?')).toBeTruthy();
    // The rest of the sheet doesn't appear until both questions are answered.
    expect(queryByText('How many weeks should this block run?')).toBeNull();
    expect(queryByText('Build My Program')).toBeNull();

    await fireEvent.press(getByText('4 days'));
    expect(getByText('How many weeks should this block run?')).toBeTruthy();
    expect(queryByText('Build My Program')).toBeNull();

    await fireEvent.press(getByText('6 weeks'));
    expect(getByText('Build My Program')).toBeTruthy();

    const goalField = getByPlaceholderText(/Get stronger for climbing season/);
    await fireEvent.changeText(goalField, 'Get stronger for climbing season');
    await fireEvent.press(getByText('Chest'));
    await fireEvent.press(getByText('Shoulders'));
    await fireEvent.press(getByText('Build My Program'));

    expect(mockNavigate).toHaveBeenCalledWith('GenerateProgram', {
      daysPerWeek: 4,
      weeksCount: 6,
      focusNotes: 'Get stronger for climbing season',
      emphasisMuscleGroups: ['chest', 'shoulders'],
    });
  });

  it('lets the athlete submit the Ask Arnold sheet with the goal/emphasis fields left blank — only days/weeks are required', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByText } = await render(<CalendarScreen />);
    await fireEvent.press(getByText('Ask Arnold to build you a custom program'));
    await fireEvent.press(getByText('3 days'));
    await fireEvent.press(getByText('4 weeks'));
    await fireEvent.press(getByText('Build My Program'));

    expect(mockNavigate).toHaveBeenCalledWith('GenerateProgram', {
      daysPerWeek: 3,
      weeksCount: 4,
      focusNotes: undefined,
      emphasisMuscleGroups: undefined,
    });
  });

  it('shows the program summary card (linking into the full Program view) instead of the Ask Arnold link once a program exists', async () => {
    mockUseActiveProgramTree.mockReturnValue({
      data: {
        id: 'program-1',
        title: 'Strength Block',
        weeks_count: 4,
        days_per_week: 3,
        program_weeks: [],
      },
      isLoading: false,
    });

    const { getByText, queryByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Strength Block')).toBeTruthy());
    expect(queryByText('Ask Arnold to build you a custom program')).toBeNull();

    await fireEvent.press(getByText('Strength Block'));
    expect(mockNavigate).toHaveBeenCalledWith('ProgramDetail', { programId: 'program-1' });
  });

  it('hides Share my week when there is nothing set up yet', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByText, queryByLabelText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Training')).toBeTruthy());
    expect(queryByLabelText('Share my week')).toBeNull();
  });

  it('builds and shares a weekly-plan snapshot from Share my week', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseWeeklySchedule.mockReturnValue({
      data: [
        {
          id: 'ws-1',
          day_of_week: 3,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    });
    const snapshot = { days: [] };
    mockFetchWeeklyPlanSnapshot.mockResolvedValue(snapshot);

    const { getByLabelText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByLabelText('Share my week')).toBeTruthy());

    await fireEvent.press(getByLabelText('Share my week'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('ShareWorkout', {
        shareType: 'weekly_plan',
        title: 'My Training Week',
        payload: snapshot,
      }),
    );
  });

  it('"Start a Run" goes straight to live tracking for Outdoor Run, skipping the LogCardio picker', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Start a Run')).toBeTruthy());

    await fireEvent.press(getByText('Start a Run'));

    expect(mockNavigate).toHaveBeenCalledWith('LiveCardioTracking', {
      activityKey: 'run',
      exerciseId: 'ex-run',
      customActivityName: null,
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('LogCardio', expect.anything());
  });

  it('"Start a Run" falls back to the manual LogCardio flow if Outdoor Run hasn\'t loaded, instead of a dead button', async () => {
    mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
    mockUseCardioActivities.mockReturnValue({ data: [], isLoading: false });

    const { getByText } = await render(<CalendarScreen />);
    await waitFor(() => expect(getByText('Start a Run')).toBeTruthy());

    await fireEvent.press(getByText('Start a Run'));

    expect(mockNavigate).toHaveBeenCalledWith('LogCardio', undefined);
  });

  describe('week-by-week navigation', () => {
    const nextWeekStart = addDays(thisWeekStart, 7);
    const nextWeekDate = (dayOfWeek: number) => addDays(nextWeekStart, dayOfWeek);
    const weekLabelFor = (weekStart: Date) =>
      `${format(weekStart, 'MMM d')} – ${format(addDays(weekStart, 6), 'MMM d')}`;
    const withTrainingDayOnMonday = {
      data: [
        {
          id: 'ws-1',
          day_of_week: 1,
          workout_template_id: 'template-1',
          workout_templates: { id: 'template-1', name: 'Leg Day', workout_template_exercises: [{ order_index: 0 }] },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    };

    it('shows the current week\'s date range by default, and pages to next week\'s dates on "Next week"', async () => {
      mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
      mockUseWeeklySchedule.mockReturnValue(withTrainingDayOnMonday);

      const { getByText, getByLabelText } = await render(<CalendarScreen />);
      await waitFor(() => expect(getByText(weekLabelFor(thisWeekStart))).toBeTruthy());
      expect(getByText(format(thisWeekDate(1), 'MMM d'))).toBeTruthy();

      await fireEvent.press(getByLabelText('Next week'));

      await waitFor(() => expect(getByText(weekLabelFor(nextWeekStart))).toBeTruthy());
      expect(getByText(format(nextWeekDate(1), 'MMM d'))).toBeTruthy();
    });

    it('marks a next-week day rest against the correct future calendar date, not the current week\'s', async () => {
      mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
      mockUseWeeklySchedule.mockReturnValue(withTrainingDayOnMonday);

      const { getByText, getByLabelText } = await render(<CalendarScreen />);
      await waitFor(() => expect(getByText(weekLabelFor(thisWeekStart))).toBeTruthy());

      await fireEvent.press(getByLabelText('Next week'));
      await waitFor(() => expect(getByText(weekLabelFor(nextWeekStart))).toBeTruthy());

      // Monday is a recurring training day every week, including next week —
      // the same unified change-day menu today's own row opens (tap, not
      // long-press) must write against *next* Monday's date.
      await fireEvent.press(getByText('Monday'));
      expect(getByText('Change Monday')).toBeTruthy();
      await fireEvent.press(getByText('Mark as Rest'));

      expect(mockSetDayOverrideMutate).toHaveBeenCalledWith({
        userId: 'user-1',
        date: format(nextWeekDate(1), 'yyyy-MM-dd'),
        status: 'rest',
      });
    });

    it('tapping a future recurring training day opens the change-day menu, with View Workout, Choose From Library, Create New Workout, and Make This a Cardio Day all offered', async () => {
      mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
      mockUseWeeklySchedule.mockReturnValue(withTrainingDayOnMonday);

      const { getByText, getByLabelText } = await render(<CalendarScreen />);
      await waitFor(() => expect(getByText(weekLabelFor(thisWeekStart))).toBeTruthy());

      await fireEvent.press(getByLabelText('Next week'));
      await waitFor(() => expect(getByText(weekLabelFor(nextWeekStart))).toBeTruthy());

      await fireEvent.press(getByText('Monday'));
      expect(getByText('View Workout')).toBeTruthy();
      expect(getByText('Choose From Library')).toBeTruthy();
      expect(getByText('Create New Workout')).toBeTruthy();
      expect(getByText('Make This a Cardio Day')).toBeTruthy();
      // Not offered — Monday next week hasn't happened yet.
      expect(() => getByText('Mark as Missed')).toThrow();

      await fireEvent.press(getByText('Choose From Library'));

      expect(mockNavigate).toHaveBeenCalledWith('Library', {
        pickMode: true,
        date: format(nextWeekDate(1), 'yyyy-MM-dd'),
        replaceScheduledWorkoutId: undefined,
      });
    });

    it('"View Workout" on a future recurring training day opens TrainingDayDetail for that future date', async () => {
      mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
      mockUseWeeklySchedule.mockReturnValue(withTrainingDayOnMonday);

      const { getByText, getByLabelText } = await render(<CalendarScreen />);
      await waitFor(() => expect(getByText(weekLabelFor(thisWeekStart))).toBeTruthy());

      await fireEvent.press(getByLabelText('Next week'));
      await waitFor(() => expect(getByText(weekLabelFor(nextWeekStart))).toBeTruthy());

      await fireEvent.press(getByText('Monday'));
      await fireEvent.press(getByText('View Workout'));

      expect(mockNavigate).toHaveBeenCalledWith('TrainingDayDetail', {
        weeklyScheduleId: 'ws-1',
        workoutTemplateId: 'template-1',
        dayOfWeek: 1,
      });
    });

    it('"Make This a Cardio Day" on a future recurring training day sets a one-off cardio override for that future date', async () => {
      mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
      mockUseWeeklySchedule.mockReturnValue(withTrainingDayOnMonday);

      const { getByText, getByLabelText } = await render(<CalendarScreen />);
      await waitFor(() => expect(getByText(weekLabelFor(thisWeekStart))).toBeTruthy());

      await fireEvent.press(getByLabelText('Next week'));
      await waitFor(() => expect(getByText(weekLabelFor(nextWeekStart))).toBeTruthy());

      await fireEvent.press(getByText('Monday'));
      await fireEvent.press(getByText('Make This a Cardio Day'));

      expect(mockSetDayOverrideMutate).toHaveBeenCalledWith({
        userId: 'user-1',
        date: format(nextWeekDate(1), 'yyyy-MM-dd'),
        status: 'cardio',
      });
    });

    it('jumps straight back to the current week\'s dates when Today is pressed after paging away', async () => {
      mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });

      const { getByText, getByLabelText } = await render(<CalendarScreen />);
      await waitFor(() => expect(getByText(weekLabelFor(thisWeekStart))).toBeTruthy());

      await fireEvent.press(getByLabelText('Next week'));
      await fireEvent.press(getByLabelText('Next week'));
      await waitFor(() =>
        expect(getByText(weekLabelFor(addDays(thisWeekStart, 14)))).toBeTruthy(),
      );

      await fireEvent.press(getByText('Today'));
      await waitFor(() => expect(getByText(weekLabelFor(thisWeekStart))).toBeTruthy());
    });

    it('pages backward to last week\'s dates on "Previous week"', async () => {
      mockUseActiveProgramTree.mockReturnValue({ data: null, isLoading: false });
      mockUseWeeklySchedule.mockReturnValue(withTrainingDayOnMonday);

      const { getByText, getByLabelText } = await render(<CalendarScreen />);
      await waitFor(() => expect(getByText(weekLabelFor(thisWeekStart))).toBeTruthy());

      await fireEvent.press(getByLabelText('Previous week'));

      const lastWeekStart = addDays(thisWeekStart, -7);
      await waitFor(() => expect(getByText(weekLabelFor(lastWeekStart))).toBeTruthy());
      expect(getByText(format(lastWeekStart, 'MMM d'))).toBeTruthy();
    });
  });
});
