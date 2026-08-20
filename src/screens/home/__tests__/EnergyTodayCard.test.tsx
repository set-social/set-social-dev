import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { format } from 'date-fns';
import { EnergyTodayCard } from '../EnergyTodayCard';
import type { DailyEnergyTotals } from '../../../utils/energyBalance';

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUpdateEntryMutate = jest.fn();
const mockDeleteEntryMutate = jest.fn();
jest.mock('../../../services/api/queries/foodLog', () => ({
  useUpdateFoodLogEntry: jest.fn(() => ({ mutate: mockUpdateEntryMutate, isPending: false })),
  useDeleteFoodLogEntry: jest.fn(() => ({ mutate: mockDeleteEntryMutate, isPending: false })),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const TODAY = new Date();
const PAST_DATE = new Date(2024, 5, 11); // a Tuesday, fixed so formatted-string assertions are deterministic

const BASE_TOTALS: DailyEnergyTotals = {
  caloriesIn: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  bmr: 1780,
  baseOut: 2280,
  workoutOut: 0,
  caloriesOut: 2280,
  targetIntake: 1780,
  net: -2280,
  remaining: 1780,
  hasEnoughProfileData: true,
};

const MACRO_TARGETS = { proteinTargetG: 160, carbsTargetG: 180, fatTargetG: 60 };

async function flip(getByLabelText: (label: string) => unknown) {
  await fireEvent.press(getByLabelText('Flip to see everything logged') as never);
}

describe('EnergyTodayCard', () => {
  it('shows the empty state and wires the CTA to onLogMeal when nothing is logged', async () => {
    const onLogMeal = jest.fn();
    const { getByText } = await render(
      <EnergyTodayCard
        entries={[]}
        totals={BASE_TOTALS}
        goal="cut"
        macroTargets={MACRO_TARGETS}
        insightHeadline=""
        insightBody="Nothing logged yet today — snap a photo of your next meal and I'll take it from there."
        onLogMeal={onLogMeal}
        selectedDate={TODAY}
        isSelectedToday
      />,
    );

    expect(getByText('Nothing logged yet today')).toBeTruthy();
    fireEvent.press(getByText('Log a meal'));
    expect(onLogMeal).toHaveBeenCalledTimes(1);
  });

  it('shows net and macros on the front face once entries exist, with no entries yet visible', async () => {
    const totals: DailyEnergyTotals = {
      ...BASE_TOTALS,
      caloriesIn: 950,
      proteinG: 66,
      carbsG: 110,
      fatG: 25,
      net: 950 - 2280,
      remaining: 1780 - 950,
    };
    const { getByText, queryByText } = await render(
      <EnergyTodayCard
        entries={[
          { id: 'e1', name: 'Greek yogurt & granola', calories: 410, protein_g: 28, carbs_g: 52, fat_g: 9 },
          { id: 'e2', name: 'Turkey sandwich', calories: 540, protein_g: 38, carbs_g: 58, fat_g: 16 },
        ]}
        totals={totals}
        goal="cut"
        macroTargets={MACRO_TARGETS}
        insightHeadline="On pace for your cut"
        insightBody="You're at a 1330 cal deficit today."
        onLogMeal={jest.fn()}
        selectedDate={TODAY}
        isSelectedToday
      />,
    );

    expect(getByText('On pace for your cut')).toBeTruthy();
    expect(getByText('66g / 160g')).toBeTruthy();
    expect(getByText('Net today · In 950')).toBeTruthy();
    // Resting (BMR + NEAT) and workout burn are shown as two separate
    // numbers, not merged into one "Out" figure — a day with no completed
    // workout should read as 0 workout calories, not a mysteriously large
    // combined total (see the EnergyTodayCard.tsx comment on totals.baseOut).
    expect(getByText('Resting 2,280 · Workout 0')).toBeTruthy();
    // Individual food items only live on the back face now (see the flip
    // describe block below) — the front face is the at-a-glance summary.
    expect(queryByText('Greek yogurt & granola')).toBeNull();
    expect(getByText('Tap to see everything logged')).toBeTruthy();
  });

  it('shows workout burn separately from resting once a workout is completed', async () => {
    const totals: DailyEnergyTotals = {
      ...BASE_TOTALS,
      caloriesIn: 950,
      baseOut: 1780,
      workoutOut: 350,
      caloriesOut: 2130,
      net: 950 - 2130,
    };
    const { getByText } = await render(
      <EnergyTodayCard
        entries={[{ id: 'e1', name: 'Turkey sandwich', calories: 950, protein_g: 38, carbs_g: 58, fat_g: 16 }]}
        totals={totals}
        goal="cut"
        macroTargets={MACRO_TARGETS}
        insightHeadline=""
        insightBody=""
        onLogMeal={jest.fn()}
        selectedDate={TODAY}
        isSelectedToday
      />,
    );

    expect(getByText('Resting 1,780 · Workout 350')).toBeTruthy();
  });

  it('caveats the estimate when profile data is incomplete', async () => {
    const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 400, hasEnoughProfileData: false };
    const { getByText } = await render(
      <EnergyTodayCard
        entries={[{ id: 'e1', name: 'Snack', calories: 400, protein_g: 10, carbs_g: 40, fat_g: 15 }]}
        totals={totals}
        goal="maintain"
        macroTargets={MACRO_TARGETS}
        insightHeadline=""
        insightBody=""
        onLogMeal={jest.fn()}
        selectedDate={TODAY}
        isSelectedToday
      />,
    );

    expect(getByText(/Using an estimated baseline/)).toBeTruthy();
  });

  describe('flipping to see everything logged', () => {
    const ENTRIES = [
      { id: 'e1', name: 'Meal 1', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1 },
      { id: 'e2', name: 'Meal 2', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1 },
      { id: 'e3', name: 'Meal 3', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1 },
      { id: 'e4', name: 'Meal 4', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1 },
    ];

    it('shows every entry on the back face, untruncated', async () => {
      const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 400 };
      const { getByText, getByLabelText, queryByText } = await render(
        <EnergyTodayCard
          entries={ENTRIES}
          totals={totals}
          goal="bulk"
          macroTargets={MACRO_TARGETS}
          insightHeadline=""
          insightBody=""
          onLogMeal={jest.fn()}
          selectedDate={TODAY}
          isSelectedToday
        />,
      );

      await flip(getByLabelText);

      expect(getByText('Meal 1')).toBeTruthy();
      expect(getByText('Meal 4')).toBeTruthy();
      expect(queryByText(/more/)).toBeNull();
      // The front face stays mounted until the flip settles, same
      // "swapped at the rotation's midpoint" timing as CompletedWorkoutCard.
      await waitFor(() => expect(queryByText('Tap to see everything logged')).toBeNull());
    });

    it('flips back to the front summary when the back header is tapped again', async () => {
      const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 400 };
      const { getByText, getByLabelText, queryByText } = await render(
        <EnergyTodayCard
          entries={ENTRIES}
          totals={totals}
          goal="bulk"
          macroTargets={MACRO_TARGETS}
          insightHeadline=""
          insightBody=""
          onLogMeal={jest.fn()}
          selectedDate={TODAY}
          isSelectedToday
        />,
      );

      await flip(getByLabelText);
      expect(getByText('Meal 1')).toBeTruthy();

      await fireEvent.press(getByLabelText('Flip back to summary'));

      await waitFor(() => expect(queryByText('Meal 1')).toBeNull());
      expect(getByText('Tap to see everything logged')).toBeTruthy();
    });

    it('puts the Log a meal action on the back face for today, and calls onLogMeal', async () => {
      const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 400 };
      const onLogMeal = jest.fn();
      const { getByText, getByLabelText, queryByText } = await render(
        <EnergyTodayCard
          entries={ENTRIES}
          totals={totals}
          goal="bulk"
          macroTargets={MACRO_TARGETS}
          insightHeadline=""
          insightBody=""
          onLogMeal={onLogMeal}
          selectedDate={TODAY}
          isSelectedToday
        />,
      );

      // Not present on the front face at all.
      expect(queryByText('Log a meal')).toBeNull();

      await flip(getByLabelText);
      await fireEvent.press(getByText('Log a meal'));
      expect(onLogMeal).toHaveBeenCalledTimes(1);
    });

    it('opens an edit sheet prefilled with the entry, and saves the edited values', async () => {
      const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 400 };
      const { getByText, getByLabelText, getByDisplayValue } = await render(
        <EnergyTodayCard
          entries={ENTRIES}
          totals={totals}
          goal="bulk"
          macroTargets={MACRO_TARGETS}
          insightHeadline=""
          insightBody=""
          onLogMeal={jest.fn()}
          selectedDate={TODAY}
          isSelectedToday
        />,
      );

      await flip(getByLabelText);
      await fireEvent.press(getByText('Meal 1'));

      expect(getByText('Edit entry')).toBeTruthy();
      const caloriesField = getByDisplayValue('100');
      await fireEvent.changeText(caloriesField, '150');
      await fireEvent.press(getByText('Save changes'));

      await waitFor(() =>
        expect(mockUpdateEntryMutate).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'e1', name: 'Meal 1', calories: 150, protein_g: 1, carbs_g: 1, fat_g: 1 }),
        ),
      );
    });

    it('deletes from inside the edit sheet, not a control on the row itself — a prior version put a trash icon flush against the row\'s right edge, close enough to the since-retired edge-docked Arnold tab to open chat instead of deleting', async () => {
      const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 400 };
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
        const deleteButton = buttons?.find(b => b.text === 'Delete');
        deleteButton?.onPress?.();
      });

      const { getByText, getByLabelText, queryByLabelText } = await render(
        <EnergyTodayCard
          entries={ENTRIES}
          totals={totals}
          goal="bulk"
          macroTargets={MACRO_TARGETS}
          insightHeadline=""
          insightBody=""
          onLogMeal={jest.fn()}
          selectedDate={TODAY}
          isSelectedToday
        />,
      );

      // No standalone delete control on the row itself.
      await flip(getByLabelText);
      expect(queryByLabelText('Delete Meal 2')).toBeNull();

      await fireEvent.press(getByText('Meal 2'));
      await fireEvent.press(getByLabelText('Delete this entry'));

      expect(mockDeleteEntryMutate).toHaveBeenCalledWith('e2');
      alertSpy.mockRestore();
    });
  });

  describe('browsing a past date via WeekTimeline', () => {
    it('titles and captions the card with the browsed date instead of "today"', async () => {
      const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 620 };
      const { getByText } = await render(
        <EnergyTodayCard
          entries={[{ id: 'e1', name: 'Chicken bowl', calories: 620, protein_g: 40, carbs_g: 60, fat_g: 12 }]}
          totals={totals}
          goal="cut"
          macroTargets={MACRO_TARGETS}
          insightHeadline="On pace for your cut"
          insightBody="You're at a 1330 cal deficit today."
          onLogMeal={jest.fn()}
          selectedDate={PAST_DATE}
          isSelectedToday={false}
        />,
      );

      expect(getByText(`Energy · ${format(PAST_DATE, 'EEE, MMM d')}`)).toBeTruthy();
      expect(getByText(`Net ${format(PAST_DATE, 'EEEE')} · In 620`)).toBeTruthy();
    });

    it('suppresses the "today"-worded coach insight for a past date, even if passed', async () => {
      const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 620 };
      const { queryByText } = await render(
        <EnergyTodayCard
          entries={[{ id: 'e1', name: 'Chicken bowl', calories: 620, protein_g: 40, carbs_g: 60, fat_g: 12 }]}
          totals={totals}
          goal="cut"
          macroTargets={MACRO_TARGETS}
          insightHeadline="On pace for your cut"
          insightBody="You're at a 1330 cal deficit today."
          onLogMeal={jest.fn()}
          selectedDate={PAST_DATE}
          isSelectedToday={false}
        />,
      );

      expect(queryByText('On pace for your cut')).toBeNull();
      expect(queryByText(/deficit today/)).toBeNull();
    });

    it('hides the "Log a meal" CTA on the back face for a past date with entries', async () => {
      const totals: DailyEnergyTotals = { ...BASE_TOTALS, caloriesIn: 620 };
      const { getByLabelText, queryByText } = await render(
        <EnergyTodayCard
          entries={[{ id: 'e1', name: 'Chicken bowl', calories: 620, protein_g: 40, carbs_g: 60, fat_g: 12 }]}
          totals={totals}
          goal="cut"
          macroTargets={MACRO_TARGETS}
          insightHeadline=""
          insightBody=""
          onLogMeal={jest.fn()}
          selectedDate={PAST_DATE}
          isSelectedToday={false}
        />,
      );

      await flip(getByLabelText);

      expect(queryByText('Log a meal')).toBeNull();
    });

    it('shows a past-day-worded empty state with no CTA when nothing was logged that day', async () => {
      const { getByText, queryByText } = await render(
        <EnergyTodayCard
          entries={[]}
          totals={BASE_TOTALS}
          goal="cut"
          macroTargets={MACRO_TARGETS}
          insightHeadline=""
          insightBody=""
          onLogMeal={jest.fn()}
          selectedDate={PAST_DATE}
          isSelectedToday={false}
        />,
      );

      expect(getByText('Nothing logged that day')).toBeTruthy();
      expect(getByText('No meals were logged on this day.')).toBeTruthy();
      expect(queryByText('Log a meal')).toBeNull();
    });
  });
});
