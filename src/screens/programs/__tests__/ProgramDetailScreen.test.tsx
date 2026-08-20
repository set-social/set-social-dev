import React from 'react';
import { Alert } from 'react-native';
import { format } from 'date-fns';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ProgramDetailScreen } from '../ProgramDetailScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
    useRoute: () => ({ params: { programId: 'program-1' } }),
  };
});

const mockUseProgramTree = jest.fn();
const mockDeleteProgramMutateAsync = jest.fn();
const mockSetDayTypeMutate = jest.fn();

jest.mock('../../../services/api/queries/programs', () => ({
  useProgramTree: (...args: unknown[]) => mockUseProgramTree(...args),
  useDeleteProgram: jest.fn(() => ({ mutateAsync: mockDeleteProgramMutateAsync, isPending: false })),
  useSetDayType: jest.fn(() => ({ mutate: mockSetDayTypeMutate, isPending: false, variables: undefined })),
}));

// start_date is "today" so the screen's default week selection (clamped to
// "today"'s week, see currentWeekNumber) always lands on week 1 regardless
// of which real calendar date the test suite happens to run on. day_of_week
// values are fixed (1 = Monday, 0 = Sunday) rather than tied to today's
// actual weekday - dateForDayOfWeek resolves each to a real date within the
// same 7-day block that starts today, whatever today's weekday is.
const TODAY = format(new Date(), 'yyyy-MM-dd');

const AI_PROGRAM = {
  id: 'program-1',
  title: 'Strength Block',
  goal: 'strength',
  source: 'ai_generated' as const,
  start_date: TODAY,
  weeks_count: 2,
  days_per_week: 3,
  program_weeks: [
    {
      id: 'week-1',
      week_number: 1,
      focus: null,
      program_days: [
        { id: 'day-1', title: 'Push', is_rest_day: false, day_of_week: 1, program_exercises: [] },
        { id: 'day-2', title: null, is_rest_day: true, day_of_week: 0, program_exercises: [] },
      ],
    },
    {
      id: 'week-2',
      week_number: 2,
      focus: null,
      program_days: [
        { id: 'day-3', title: 'Push 2', is_rest_day: false, day_of_week: 1, program_exercises: [] },
        { id: 'day-4', title: null, is_rest_day: true, day_of_week: 0, program_exercises: [] },
      ],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProgramTree.mockReturnValue({ data: AI_PROGRAM, isLoading: false });
});

describe('ProgramDetailScreen', () => {
  it('shows a persistent Delete Program link, no overflow menu required', async () => {
    const { getByText } = await render(<ProgramDetailScreen />);
    await waitFor(() => expect(getByText('Strength Block')).toBeTruthy());

    expect(getByText('Delete Program')).toBeTruthy();
  });

  it('deletes the program after confirming and navigates back', async () => {
    mockDeleteProgramMutateAsync.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const deleteButton = buttons?.find(b => b.text === 'Delete');
      deleteButton?.onPress?.();
    });

    const { getByText } = await render(<ProgramDetailScreen />);
    await waitFor(() => expect(getByText('Strength Block')).toBeTruthy());

    await fireEvent.press(getByText('Delete Program'));

    await waitFor(() => expect(mockDeleteProgramMutateAsync).toHaveBeenCalledWith('program-1'));
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('labels each row by real weekday and date, tied to the current week — not a bare "Week 1" grid', async () => {
    const { getByText } = await render(<ProgramDetailScreen />);
    await waitFor(() => expect(getByText('Sunday')).toBeTruthy());

    expect(getByText('WEEK 1 OF 2')).toBeTruthy();
    expect(getByText('Monday')).toBeTruthy();
    expect(getByText(/Push · 0 exercises/)).toBeTruthy();
    expect(getByText('Rest — tap to add a workout')).toBeTruthy();
  });

  it('un-marks the day as rest and opens it for editing when the rest day row is tapped', async () => {
    mockSetDayTypeMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());

    const { getByText } = await render(<ProgramDetailScreen />);
    await waitFor(() => expect(getByText('Sunday')).toBeTruthy());

    await fireEvent.press(getByText('Sunday'));

    expect(mockSetDayTypeMutate).toHaveBeenCalledWith(
      { id: 'day-2', dayType: 'training' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('DayDetail', { programDayId: 'day-2' });
  });

  it('navigates to DayDetail when a training day row is tapped', async () => {
    const { getByText } = await render(<ProgramDetailScreen />);
    await waitFor(() => expect(getByText('Monday')).toBeTruthy());

    await fireEvent.press(getByText('Monday'));
    expect(mockNavigate).toHaveBeenCalledWith('DayDetail', { programDayId: 'day-1' });
  });

  it('switches to the next/previous week with real dates, without leaving the screen', async () => {
    const { getByText, getByLabelText } = await render(<ProgramDetailScreen />);
    await waitFor(() => expect(getByText('WEEK 1 OF 2')).toBeTruthy());
    expect(getByText(/Push · 0 exercises/)).toBeTruthy();

    await fireEvent.press(getByLabelText('Next week'));
    expect(getByText('WEEK 2 OF 2')).toBeTruthy();
    expect(getByText(/Push 2 · 0 exercises/)).toBeTruthy();

    // Previous week's arrow is disabled at week 1 — pressing it there is a
    // no-op rather than going to week 0.
    await fireEvent.press(getByLabelText('Previous week'));
    expect(getByText('WEEK 1 OF 2')).toBeTruthy();
    await fireEvent.press(getByLabelText('Previous week'));
    expect(getByText('WEEK 1 OF 2')).toBeTruthy();
  });
});
