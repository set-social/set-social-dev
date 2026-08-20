import { getWeeklyScheduleForDate, type WeeklyScheduleEntry } from '../weeklySchedule';

function entry(dayOfWeek: number): WeeklyScheduleEntry {
  return {
    id: `ws-${dayOfWeek}`,
    user_id: 'user-1',
    day_of_week: dayOfWeek,
    workout_template_id: 'template-1',
    day_type: 'training',
    created_at: '2024-01-01T00:00:00.000Z',
    workout_templates: { id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [] },
  };
}

describe('getWeeklyScheduleForDate', () => {
  it('returns null when the schedule has not loaded yet', () => {
    expect(getWeeklyScheduleForDate(undefined, new Date('2026-03-04T12:00:00.000Z'))).toBeNull();
    expect(getWeeklyScheduleForDate(null, new Date('2026-03-04T12:00:00.000Z'))).toBeNull();
  });

  it('returns null when no entry matches the date\'s weekday', () => {
    const wednesday = new Date('2026-03-04T12:00:00.000Z');
    expect(getWeeklyScheduleForDate([entry((wednesday.getDay() + 1) % 7)], wednesday)).toBeNull();
  });

  it('returns the entry whose day_of_week matches the date', () => {
    const date = new Date('2026-03-04T12:00:00.000Z');
    const match = entry(date.getDay());
    expect(getWeeklyScheduleForDate([match], date)).toBe(match);
  });
});
