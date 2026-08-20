import { format } from 'date-fns';
import { computeStreak } from '../streak';
import type { WeeklyScheduleEntry } from '../../services/api/queries/weeklySchedule';

function daysAgo(n: number, from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d;
}

function key(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function weeklyScheduleEntry(dayOfWeek: number): WeeklyScheduleEntry {
  return {
    id: 'ws-1',
    user_id: 'user-1',
    day_of_week: dayOfWeek,
    workout_template_id: 'template-1',
    day_type: 'training',
    created_at: '2024-01-01T00:00:00.000Z',
    workout_templates: { id: 'template-1', name: 'Core Day', workout_template_exercises: [] },
  };
}

describe('computeStreak', () => {
  it('returns 0 when nothing is completed and there is no program or weekly schedule', () => {
    const today = new Date('2026-03-05T12:00:00.000Z');
    expect(computeStreak(null, new Set(), today)).toBe(0);
  });

  it('counts consecutive completed days ending today', () => {
    const today = new Date('2026-03-05T12:00:00.000Z');
    const completed = new Set([key(today), key(daysAgo(1, today)), key(daysAgo(2, today))]);
    expect(computeStreak(null, completed, today)).toBe(3);
  });

  it('does not break the streak on a missed recurring (non-program) training day', () => {
    const today = new Date('2026-03-05T12:00:00.000Z'); // Thursday
    const missedRecurringDay = daysAgo(1, today); // Wednesday, recurring day, not completed
    const completed = new Set([key(today), key(daysAgo(2, today))]);
    const weeklySchedule = [weeklyScheduleEntry(missedRecurringDay.getDay())];

    // Without weekly-schedule awareness, the missed Wednesday would be
    // treated as a rest day (no program at all) and the streak would run
    // straight through to 3. With awareness, it's a missed training day and
    // the streak stops at today's single completion.
    expect(computeStreak(null, completed, today, weeklySchedule)).toBe(1);
  });

  it('continues past a completed recurring training day, and past the rest days beyond it too', () => {
    const today = new Date('2026-03-05T12:00:00.000Z'); // Thursday
    const recurringDay = daysAgo(1, today); // Wednesday
    const completed = new Set([key(today), key(recurringDay), key(daysAgo(2, today))]);
    const weeklySchedule = [weeklyScheduleEntry(recurringDay.getDay())];

    // Only Wednesday is a configured (recurring) day here, so every other
    // weekday is a legitimate rest day by design and now also counts —
    // the walk runs Thu/Wed/Tue (completed) then Mon/Sun/Sat/Fri/Thu (rest)
    // until it reaches the *previous* Wednesday, which wasn't completed and
    // genuinely breaks the streak: 8 days total, not just the 3 completions.
    expect(computeStreak(null, completed, today, weeklySchedule)).toBe(8);
  });

  it('counts a rest day toward the streak instead of just passing through it unchanged', () => {
    const today = new Date('2026-03-03T12:00:00.000Z'); // Tuesday — has a plan, not completed yet today
    const monday = daysAgo(1, today); // completed (e.g. cardio)
    const sunday = daysAgo(2, today); // no weekly_schedule entry — a genuine rest day
    const priorTrainingDay = daysAgo(3, today); // Saturday — configured, NOT completed, bounds the streak

    const completed = new Set([key(monday)]);
    const weeklySchedule = [
      weeklyScheduleEntry(today.getDay()),
      weeklyScheduleEntry(monday.getDay()),
      weeklyScheduleEntry(priorTrainingDay.getDay()),
    ];

    // Sunday's rest and Monday's completed cardio both count — 2 — even
    // though today (a pending, not-yet-completed training day) doesn't yet.
    expect(computeStreak(null, completed, today, weeklySchedule)).toBe(2);
  });
});
