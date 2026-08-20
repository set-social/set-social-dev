import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';

export type DayOverride = Database['public']['Tables']['day_overrides']['Row'];
export type DayOverrideStatus = DayOverride['status'];

async function fetchDayOverrides(userId: string, from: string, to: string): Promise<DayOverride[]> {
  const { data, error } = await supabase
    .from('day_overrides')
    .select('*')
    .eq('user_id', userId)
    .gte('date', from)
    .lte('date', to);
  if (error) throw error;
  return data;
}

export function useDayOverrides(userId: string | null, range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['dayOverrides', userId, range.from, range.to],
    queryFn: () => fetchDayOverrides(userId as string, range.from, range.to),
    enabled: userId != null,
  });
}

/** Same shape/spirit as getWeeklyScheduleForDate (weeklySchedule.ts) —
 * pure lookup, no fetching. */
export function getDayOverrideForDate(overrides: DayOverride[] | null | undefined, date: Date): DayOverride | null {
  const key = format(date, 'yyyy-MM-dd');
  return (overrides ?? []).find(o => o.date === key) ?? null;
}

/** Upsert on the (user_id, date) unique constraint — re-marking the same
 * past date (rest -> missed, or vice versa) just replaces the prior
 * override rather than erroring or leaving both around. */
export function useSetDayOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { userId: string; date: string; status: DayOverrideStatus }) => {
      const { data, error } = await supabase
        .from('day_overrides')
        .upsert(
          { user_id: params.userId, date: params.date, status: params.status },
          { onConflict: 'user_id,date' },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['dayOverrides', params.userId] });
    },
  });
}

/** Deletes a specific date's override, if one exists. resolveDayPlan
 * (dayPlan.ts) checks day_overrides ahead of weekly_schedule, so a date
 * previously marked Rest/Missed keeps showing that override even after a
 * fresh recurring assignment for its weekday - callers that want a new
 * assignment to take visible effect immediately (AssignTrainingDayScreen)
 * should clear that date's override right after. No-ops if there was
 * nothing to clear. */
export async function clearDayOverride(params: { userId: string; date: string }): Promise<void> {
  const { error } = await supabase
    .from('day_overrides')
    .delete()
    .eq('user_id', params.userId)
    .eq('date', params.date);
  if (error) throw error;
}

export function useClearDayOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearDayOverride,
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['dayOverrides', params.userId] });
    },
  });
}
