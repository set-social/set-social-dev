import { isSameDay } from 'date-fns';
import { walkScheduledDays } from '../trainingScheduleWalk';
import type { ProgramTree } from '../../services/api/queries/programs';

function buildProgram(restDaysByWeekday: Record<number, boolean>): ProgramTree {
  const days = Object.entries(restDaysByWeekday).map(([weekday, isRestDay]) => ({
    id: `day-${weekday}`,
    day_of_week: Number(weekday),
    is_rest_day: isRestDay,
    program_exercises: [],
  }));
  const weeks = Array.from({ length: 20 }, (_, i) => ({
    id: `week-${i + 1}`,
    week_number: i + 1,
    program_days: days,
  }));
  return {
    id: 'program-1',
    start_date: '2024-01-01',
    weeks_count: 20,
    program_weeks: weeks,
  } as unknown as ProgramTree;
}

// Local-time constructors throughout — avoids the UTC-midnight-parse shift
// that ISO date-only strings (`new Date('2024-01-01')`) are subject to,
// which would make weekday assertions timezone-dependent.
const day1 = new Date(2024, 0, 1); // a Monday
const day2 = new Date(2024, 0, 2); // a Tuesday

describe('walkScheduledDays', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('tags each day with its weekday and marks rest days as not-training', () => {
    const program = buildProgram({ [day1.getDay()]: false, [day2.getDay()]: true });
    const entries = walkScheduledDays(program, new Set(), day1, day2);

    expect(entries).toHaveLength(2);
    expect(entries[0].weekday).toBe(day1.getDay());
    expect(entries[0].isTrainingDay).toBe(true);
    expect(entries[1].weekday).toBe(day2.getDay());
    expect(entries[1].isTrainingDay).toBe(false);
  });

  it('marks a day completed only when its date key is in completedDates', () => {
    const program = buildProgram({ [day1.getDay()]: false });
    const completedDates = new Set(['2024-01-01']);
    const entries = walkScheduledDays(program, completedDates, day1, day1);

    expect(entries[0].completed).toBe(true);
  });

  it('treats every day as not-training when there is no active program', () => {
    const entries = walkScheduledDays(null, new Set(), day1, day2);
    expect(entries.every(e => !e.isTrainingDay)).toBe(true);
  });

  it('never walks past today, even when `to` is in the future', () => {
    const fakeToday = new Date(2024, 0, 10, 12, 0, 0);
    jest.useFakeTimers().setSystemTime(fakeToday);
    const program = buildProgram({ [day1.getDay()]: false });

    const from = new Date(2024, 0, 8);
    const farFuture = new Date(2024, 0, 20);
    const entries = walkScheduledDays(program, new Set(), from, farFuture);

    expect(entries).toHaveLength(3); // Jan 8, 9, 10 — stops at "today"
    expect(isSameDay(entries[entries.length - 1].date, fakeToday)).toBe(true);
  });
});
