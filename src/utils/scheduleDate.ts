/**
 * Parses a 'yyyy-MM-dd' route param (CalendarScreen's "Change Workout"
 * actions pass one to preset which date a schedule-a-workout flow targets)
 * into a local Date — explicit y/m/d construction, not `new Date(dateString)`,
 * so a negative-UTC-offset timezone can't shift it back a day. Falls back
 * to today when no param was given, which is every other place a
 * schedule-workout screen (LibraryScreen, TemplateEditorScreen) is reached.
 * Shared so both screens parse this the same way rather than drifting.
 */
export function parseScheduleDateParam(dateParam: string | undefined): Date {
  if (!dateParam) return new Date();
  const [year, month, day] = dateParam.split('-').map(Number);
  return new Date(year, month - 1, day);
}
