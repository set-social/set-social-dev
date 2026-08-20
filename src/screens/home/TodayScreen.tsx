import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import { useTabBarScrollHandler } from '../../navigation/tabBarScroll';
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfWeek,
  format,
  isFuture,
  isSameDay,
  isSameWeek,
  isToday as isDateToday,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  Card,
  Button,
  ListRow,
  LoadingState,
  Icon,
  IconButton,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useActiveProgramTree,
  getProgramDayForDate,
  type ProgramExerciseWithExercise,
} from '../../services/api/queries/programs';
import { useProfile } from '../../services/api/queries/profiles';
import { useWorkoutLogsInRange } from '../../services/api/queries/workoutLogs';
import {
  useScheduledWorkouts,
  useStartTemplateToday,
  TODAY_RANGE_PAST_DAYS,
  TODAY_RANGE_FUTURE_DAYS,
} from '../../services/api/queries/scheduledWorkouts';
import {
  useWeeklySchedule,
  getWeeklyScheduleForDate,
  type WeeklyScheduleEntry,
} from '../../services/api/queries/weeklySchedule';
import {
  useDayOverrides,
  useClearDayOverride,
} from '../../services/api/queries/dayOverrides';
import { useFoodLogEntriesInRange } from '../../services/api/queries/foodLog';
import { useLatestBodyWeight } from '../../services/api/queries/bodyMetrics';

/** This screen doesn't know about Cardio Day yet (see dayPlan.ts for the
 * screen that does) — a cardio weekly_schedule entry has no
 * workout_template_id/workout_templates to show here, so it's treated the
 * same as no entry at all rather than crashing on the now-nullable join.
 * Narrows workout_template_id/workout_templates to non-null, which the DB's
 * weekly_schedule_template_required_for_training check constraint
 * guarantees for any day_type='training' row. */
type TrainingWeeklyEntry = WeeklyScheduleEntry & {
  workout_template_id: string;
  workout_templates: NonNullable<WeeklyScheduleEntry['workout_templates']>;
};
function asTrainingEntry(
  entry: WeeklyScheduleEntry | null,
): TrainingWeeklyEntry | null {
  if (!entry || entry.day_type === 'cardio' || !entry.workout_templates)
    return null;
  return entry as TrainingWeeklyEntry;
}
import { useWorkoutTemplate } from '../../services/api/queries/workoutTemplates';
import {
  useLoggedSets,
  computePrEvents,
  computeE1rmHistories,
} from '../../services/api/queries/progress';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import {
  useTrainingPatterns,
  useSyncTrainingPatterns,
  useDismissTrainingPattern,
} from '../../services/api/queries/coachingMemory';
import { useReadinessContext } from '../../services/api/queries/coaching';
import { useIntegrationConnections } from '../../services/api/queries/integrations';
import { useSyncWhoopMetrics } from '../../services/api/queries/whoop';
import { useSyncOuraMetrics } from '../../services/api/queries/oura';
import { useFocusModeStore } from '../../store/focusModeStore';
import { coachingEngine } from '../../services/coaching';
import { featureFlags } from '../../config/featureFlags';
import type { TodayPlanContext } from '../../services/coaching';
import { computeStreak } from '../../utils/streak';
import { estimateWorkoutMinutes } from '../../utils/workoutTiming';
import {
  calculateAge,
  computeDailyEnergyTotals,
  computeMacroTargets,
} from '../../utils/energyBalance';
import {
  navigateToStartWorkout,
  navigateToContinueWorkout,
  navigateToStartCardio,
} from '../../navigation/startWorkoutFlow';
import { useActiveWorkoutStore } from '../../store/activeWorkoutStore';
import { buildWidgetPayload } from '../../services/widget/buildWidgetPayload';
import { syncWidget } from '../../services/widget/nativeWidgetBridge';
import { WeekTimeline } from './WeekTimeline';
import { AiSummaryCard } from './AiSummaryCard';
import { TodayHeroCard } from './TodayHeroCard';
import { EnergyTodayCard } from './EnergyTodayCard';
import { CompletedWorkoutCard } from './CompletedWorkoutCard';
import { CompletedCardioCard } from './CompletedCardioCard';
import { QuickCheckinCard } from './QuickCheckinCard';
import { StreakRiskNudge } from './StreakRiskNudge';
import { StatsRail } from './StatsRail';
import { MoreForYouCard } from './MoreForYouCard';
import { useFriendsPosts } from '../../services/api/queries/posts';
import { useLiveFriendWorkouts } from '../../services/api/queries/liveWorkouts';
import { trackEvent } from '../../services/analytics/analytics';
import type {
  RootStackParamList,
  TodayStackParamList,
} from '../../navigation/types';

const RANGE_PAST_DAYS = TODAY_RANGE_PAST_DAYS;
const RANGE_FUTURE_DAYS = TODAY_RANGE_FUTURE_DAYS;

function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function greeting(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

function estimateMinutes(
  exercises: ProgramExerciseWithExercise[],
): number | null {
  return estimateWorkoutMinutes(
    exercises.map(pe => ({
      targetSets: pe.target_sets,
      restSeconds: pe.rest_seconds,
    })),
  );
}

function estimateWeeklyMinutes(
  exercises: { target_sets: number; rest_seconds: number | null }[],
): number | null {
  return estimateWorkoutMinutes(
    exercises.map(te => ({
      targetSets: te.target_sets,
      restSeconds: te.rest_seconds,
    })),
  );
}

export function TodayScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const userId = useAuthStore(state => state.userId);
  const {
    data: program,
    isLoading,
    refetch: refetchProgram,
  } = useActiveProgramTree(userId);
  const { data: profile } = useProfile(userId);
  // Profile lives on the root stack, not the Today tab stack — navigate()
  // bubbles up to find it since 'Profile' isn't a route in this navigator.
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const todayNavigation =
    useNavigation<NativeStackNavigationProp<TodayStackParamList>>();

  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const today = useMemo(() => new Date(), []);
  const rangeFrom = useMemo(
    () => format(addDays(today, -RANGE_PAST_DAYS), 'yyyy-MM-dd'),
    [today],
  );
  const rangeTo = useMemo(
    () => format(addDays(today, RANGE_FUTURE_DAYS), 'yyyy-MM-dd'),
    [today],
  );

  const { data: workoutLogs, refetch: refetchWorkoutLogs } =
    useWorkoutLogsInRange(userId, { from: rangeFrom, to: rangeTo });
  const { data: scheduledWorkouts, refetch: refetchScheduledWorkouts } =
    useScheduledWorkouts(userId, {
      from: rangeFrom,
      to: rangeTo,
    });
  const { data: weeklySchedule, refetch: refetchWeeklySchedule } =
    useWeeklySchedule(userId);
  const { data: dayOverrides, refetch: refetchDayOverrides } = useDayOverrides(
    userId,
    {
      from: rangeFrom,
      to: rangeTo,
    },
  );
  const { data: loggedSets, refetch: refetchLoggedSets } =
    useLoggedSets(userId);
  const { data: integrationConnections } = useIntegrationConnections(userId);
  const isWhoopConnected =
    integrationConnections?.some(
      c => c.provider === 'whoop' && c.access_token != null,
    ) ?? false;
  const syncWhoopMetrics = useSyncWhoopMetrics();
  // No Oura equivalent of RecoveryStoryLine yet (Oura's readiness
  // contributors don't expose a raw HRV value the way Whoop does) — this is
  // only used to warm oura-sync on refresh, same as isWhoopConnected below.
  const isOuraConnected =
    integrationConnections?.some(
      c => c.provider === 'oura' && c.access_token != null,
    ) ?? false;
  const syncOuraMetrics = useSyncOuraMetrics();
  const focusModeEnabled = useFocusModeStore(state => state.focusModeEnabled);
  const readinessContext = useReadinessContext(userId);
  const readiness = useMemo(
    () =>
      readinessContext.isLoading
        ? null
        : coachingEngine.evaluateReadiness(readinessContext.inputs),
    [readinessContext.isLoading, readinessContext.inputs],
  );

  const { activePatterns, params: patternParams } = useTrainingPatterns(userId);
  const syncPatterns = useSyncTrainingPatterns();
  const dismissPattern = useDismissTrainingPattern();
  const detectedPatterns = useMemo(
    () =>
      patternParams ? coachingEngine.detectTrainingPatterns(patternParams) : [],
    [patternParams],
  );
  const lastSyncSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !patternParams) return;
    const signature = JSON.stringify([
      detectedPatterns.map(p => `${p.key}:${p.confidence.toFixed(3)}`),
      patternParams.dismissedKeys,
    ]);
    if (signature === lastSyncSignatureRef.current) return;
    lastSyncSignatureRef.current = signature;
    syncPatterns.mutate({
      userId,
      detected: detectedPatterns,
      activeRows: activePatterns,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, patternParams]);

  const {
    data: friendsPosts,
    isLoading: friendsPostsLoading,
    isError: friendsPostsError,
    refetch: refetchFriendsPosts,
  } = useFriendsPosts(userId);

  const onFriendsActivityViewAll = () => {
    trackEvent('friends_posts_view_all_tapped');
    rootNavigation.navigate('MainTabs', {
      screen: 'CommunityTab',
      params: { screen: 'Posts' },
    });
  };

  // Promoted from the Community tab's own Live Now rail — same data, just
  // surfaced from Home too as a one-line summary (see MoreForYouCard). The
  // full per-friend rail with live stats stays on the Community tab, which
  // is exactly where this points.
  const { data: liveFriendWorkouts } = useLiveFriendWorkouts(userId);
  const onViewLiveNow = () => {
    rootNavigation.navigate('MainTabs', {
      screen: 'CommunityTab',
      params: { screen: 'Posts' },
    });
  };

  const completedDates = useMemo(
    () =>
      new Set(
        (workoutLogs ?? []).map(log => dateKey(new Date(log.completedAt))),
      ),
    [workoutLogs],
  );
  const cardioDates = useMemo(
    () =>
      new Set(
        (workoutLogs ?? [])
          .filter(log => log.cardio != null)
          .map(log => dateKey(new Date(log.completedAt))),
      ),
    [workoutLogs],
  );
  const scheduledByDate = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof scheduledWorkouts>[number]
    >();
    for (const sw of scheduledWorkouts ?? []) map.set(sw.scheduled_date, sw);
    return map;
  }, [scheduledWorkouts]);
  const weeklyScheduleDaysOfWeek = useMemo(
    () => new Set((weeklySchedule ?? []).map(entry => entry.day_of_week)),
    [weeklySchedule],
  );
  const dayOverridesByDate = useMemo(
    () => new Map((dayOverrides ?? []).map(o => [o.date, o.status])),
    [dayOverrides],
  );
  const prEvents = useMemo(
    () => (loggedSets ? computePrEvents(loggedSets) : []),
    [loggedSets],
  );
  const prDates = useMemo(
    () => new Set(prEvents.map(e => dateKey(new Date(e.loggedAt)))),
    [prEvents],
  );
  const unitPref = useUnitPreference();
  // Reuses the same loggedSets query this screen already fetches — the
  // single highest-confidence forecast is already sorted to the front by
  // predictPersonalRecords itself.
  const e1rmHistories = useMemo(
    () => computeE1rmHistories(loggedSets ?? []),
    [loggedSets],
  );
  const topPrPrediction = useMemo(
    () =>
      coachingEngine.predictPersonalRecords({
        exerciseHistories: e1rmHistories,
        asOf: dateKey(today),
        unitPref,
      })[0] ?? null,
    [e1rmHistories, today, unitPref],
  );
  const streak = useMemo(
    () => computeStreak(program, completedDates, today, weeklySchedule),
    [program, completedDates, today, weeklySchedule],
  );

  const weekStart = startOfWeek(today, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 0 });
  const weekStartKey = dateKey(weekStart);
  const weekEndKey = dateKey(weekEnd);
  const sessionsThisWeek = useMemo(
    // String comparison, not `new Date(key)` — completedDates' keys are bare
    // yyyy-MM-dd strings, which the native Date constructor parses as UTC
    // midnight; comparing that against weekStart/weekEnd (local-time Date
    // objects) silently misclassifies dates near either boundary in any
    // negative-UTC-offset timezone, the same class of bug called out
    // elsewhere in this file (see PrForecastCard's parseISO comment).
    // yyyy-MM-dd sorts lexicographically the same as chronologically, so a
    // plain string comparison sidesteps parsing entirely.
    () =>
      [...completedDates].filter(
        key => key >= weekStartKey && key <= weekEndKey,
      ).length,
    [completedDates, weekStartKey, weekEndKey],
  );
  // Not just program?.days_per_week — that's blind to one-off scheduled
  // workouts and the recurring weekly schedule, so an athlete using either
  // of those instead of (or alongside) an AI program would always see a
  // target of 0. Walks the same three-tier resolution todayPlan uses for a
  // single day (scheduled_workouts > weekly non-cardio entry > program
  // training day) across every day of the week instead.
  const weeklyTarget = useMemo(() => {
    let count = 0;
    for (
      let cursor = weekStart;
      cursor <= weekEnd;
      cursor = addDays(cursor, 1)
    ) {
      if (scheduledByDate.has(dateKey(cursor))) {
        count++;
        continue;
      }
      if (asTrainingEntry(getWeeklyScheduleForDate(weeklySchedule, cursor))) {
        count++;
        continue;
      }
      const resolved = getProgramDayForDate(program, cursor);
      if (resolved && !resolved.day.is_rest_day) count++;
    }
    return count;
  }, [weekStart, weekEnd, scheduledByDate, weeklySchedule, program]);

  const resolvedSelected = getProgramDayForDate(program, selectedDate);
  const scheduledSelected = scheduledByDate.get(dateKey(selectedDate));
  // Raw (unfiltered by asTrainingEntry) so a cardio day's day_type is still
  // visible here — same gap the Arnold summary card had (see
  // asTrainingEntry's own doc comment): without this, a weekly-recurring
  // cardio day falls all the way through every branch below to the generic
  // "Nothing logged / no training day on today's calendar" card, same as a
  // genuinely empty day, even though cardio is actually on the books.
  const weeklyScheduleSelectedRaw = getWeeklyScheduleForDate(
    weeklySchedule,
    selectedDate,
  );
  const weeklyScheduleSelected = asTrainingEntry(weeklyScheduleSelectedRaw);
  const isWeeklyCardioSelected = weeklyScheduleSelectedRaw?.day_type === 'cardio';
  // Only when the weekly baseline isn't itself a training day AND isn't
  // cardio either — a weekly-recurring assignment (either kind) always
  // takes precedence over the program's own day for that weekday, matching
  // resolveDayPlan's precedence in dayPlan.ts.
  const isProgramCardioSelected =
    !isWeeklyCardioSelected &&
    !weeklyScheduleSelected &&
    resolvedSelected?.day.day_type === 'cardio';
  const isCardioSelected = isWeeklyCardioSelected || isProgramCardioSelected;
  const { data: selectedWeeklyTemplate } = useWorkoutTemplate(
    weeklyScheduleSelected?.workout_template_id,
  );
  const startTemplateToday = useStartTemplateToday();
  const isSelectedCompleted = completedDates.has(dateKey(selectedDate));
  const isSelectedToday = isDateToday(selectedDate);
  const isSelectedFuture = isFuture(selectedDate) && !isSelectedToday;
  const isSelectedPr = prDates.has(dateKey(selectedDate));
  // A completed log always wins over an override (matches resolveDayPlan's
  // precedence in dayPlan.ts) — logging the workout after marking the day
  // missed should just show as done, not missed.
  const isSelectedMissed =
    dayOverridesByDate.get(dateKey(selectedDate)) === 'missed' &&
    !isSelectedCompleted;
  const clearDayOverride = useClearDayOverride();
  const onAddWorkoutBack = () => {
    if (!userId) return;
    clearDayOverride.mutate({ userId, date: dateKey(selectedDate) });
  };
  const selectedWorkoutLogIds = useMemo(
    () =>
      (workoutLogs ?? [])
        .filter(
          log => dateKey(new Date(log.completedAt)) === dateKey(selectedDate),
        )
        .map(log => log.id),
    [workoutLogs, selectedDate],
  );

  // Real summary for the completed-day card below — sourced from the same
  // workoutLogs/loggedSets queries already fetched on this screen, filtered
  // to the selected date. No separate per-workout query exists yet, so
  // duration comes from summing every workout_log completed that day and
  // set stats come from every logged set with a matching logged_at date.
  const selectedDaySummary = useMemo(() => {
    if (!isSelectedCompleted) return null;
    const dayKey = dateKey(selectedDate);
    const logsForDay = (workoutLogs ?? []).filter(
      log => dateKey(new Date(log.completedAt)) === dayKey,
    );
    const setsForDay = (loggedSets ?? []).filter(
      s => dateKey(new Date(s.loggedAt)) === dayKey,
    );

    const durationMinutes = logsForDay.reduce((sum, log) => {
      const minutes =
        (new Date(log.completedAt).getTime() -
          new Date(log.startedAt).getTime()) /
        60_000;
      return sum + Math.max(0, minutes);
    }, 0);
    const totalReps = setsForDay.reduce((sum, s) => sum + s.reps, 0);
    const totalVolumeKg = setsForDay.reduce(
      (sum, s) => sum + (s.loadKg ?? 0) * s.reps,
      0,
    );
    const exerciseCount = new Set(setsForDay.map(s => s.exerciseId)).size;

    return {
      durationMinutes: Math.round(durationMinutes),
      totalSets: setsForDay.length,
      totalReps,
      totalVolumeKg,
      exerciseCount,
    };
  }, [isSelectedCompleted, selectedDate, workoutLogs, loggedSets]);

  // A day's completed-card shows cardio stats only when every log completed
  // that day came from LogCardioScreen — a mixed cardio+strength day falls
  // back to CompletedWorkoutCard rather than trying to merge both kinds of
  // summary into one card.
  const selectedCardioSummary = useMemo(() => {
    if (!isSelectedCompleted) return null;
    const dayKey = dateKey(selectedDate);
    const logsForDay = (workoutLogs ?? []).filter(
      log => dateKey(new Date(log.completedAt)) === dayKey,
    );
    const cardioEntries = logsForDay
      .map(log => log.cardio)
      .filter((c): c is NonNullable<typeof c> => c != null);
    if (
      cardioEntries.length === 0 ||
      cardioEntries.length !== logsForDay.length
    )
      return null;

    const hasDistance = cardioEntries.some(c => c.distanceKm != null);
    return {
      activityName:
        cardioEntries.length === 1 ? cardioEntries[0].activityName : 'Cardio',
      durationMinutes: cardioEntries.reduce(
        (sum, c) => sum + c.durationMinutes,
        0,
      ),
      distanceKm: hasDistance
        ? cardioEntries.reduce((sum, c) => sum + (c.distanceKm ?? 0), 0)
        : null,
      effort: cardioEntries.length === 1 ? cardioEntries[0].effort : null,
      estimatedCalories: cardioEntries.reduce(
        (sum, c) => sum + c.estimatedCalories,
        0,
      ),
      avgPaceSecPerKm:
        cardioEntries.length === 1 ? cardioEntries[0].avgPaceSecPerKm : null,
      hasRoute: cardioEntries.some(c => c.hasRoute),
    };
  }, [isSelectedCompleted, selectedDate, workoutLogs]);

  const firstName = profile?.display_name?.trim().split(/\s+/)[0];

  const yesterday = addDays(today, -1);
  const resolvedYesterday = getProgramDayForDate(program, yesterday);
  const weeklyScheduleYesterday = asTrainingEntry(
    getWeeklyScheduleForDate(weeklySchedule, yesterday),
  );
  const missedYesterday =
    ((resolvedYesterday != null && !resolvedYesterday.day.is_rest_day) ||
      weeklyScheduleYesterday != null) &&
    !completedDates.has(dateKey(yesterday));
  const completedYesterday = completedDates.has(dateKey(yesterday));

  const recentPr = [...prEvents]
    .reverse()
    .map(e => ({
      ...e,
      // Calendar-day difference, not a raw duration-in-ms/86_400_000 floor —
      // a PR logged yesterday evening is still ~13 hours ago at 9am today,
      // which would floor to 0 ("today") under duration math even though
      // it's a different calendar day.
      daysAgo: differenceInCalendarDays(today, new Date(e.loggedAt)),
      sameCalendarWeek: isSameWeek(new Date(e.loggedAt), today, {
        weekStartsOn: 0,
      }),
    }))
    .find(e => e.daysAgo >= 0 && e.daysAgo <= 6);

  const resolvedToday = getProgramDayForDate(program, today);
  const isDeloadWeek = resolvedToday?.week.deload ?? false;

  const weeksCount = program?.weeks_count ?? 0;
  const midWeek = Math.ceil(weeksCount / 2);
  const currentWeekNumber = resolvedToday?.week.week_number;
  const isMilestoneWeek =
    weeksCount > 1 &&
    currentWeekNumber != null &&
    (currentWeekNumber === 1 ||
      currentWeekNumber === midWeek ||
      currentWeekNumber === weeksCount);

  const isTodayCompleted = completedDates.has(dateKey(today));
  const scheduledToday = scheduledByDate.get(dateKey(today));
  // Raw entry (unfiltered by asTrainingEntry) so a cardio day's day_type is
  // still visible here — asTrainingEntry deliberately nulls cardio entries
  // out for callers that only want a template to render, which used to mean
  // this plan fell all the way through to 'none' ("no plan on the books")
  // for a day that actually has cardio scheduled.
  const weeklyScheduleTodayRaw = getWeeklyScheduleForDate(
    weeklySchedule,
    today,
  );
  const weeklyScheduleToday = asTrainingEntry(weeklyScheduleTodayRaw);
  const todayPlan = useMemo<TodayPlanContext>(() => {
    if (isTodayCompleted) {
      return {
        kind: 'completed',
        dayTitle:
          scheduledToday?.name ??
          weeklyScheduleToday?.workout_templates.name ??
          resolvedToday?.day.title ??
          null,
      };
    }
    if (scheduledToday) return { kind: 'scheduled', name: scheduledToday.name };
    if (weeklyScheduleTodayRaw?.day_type === 'cardio')
      return { kind: 'cardio_day' };
    if (weeklyScheduleToday) {
      return {
        kind: 'training_day',
        dayTitle: weeklyScheduleToday.workout_templates.name,
        exerciseCount:
          weeklyScheduleToday.workout_templates.workout_template_exercises
            .length,
        isDeload: false,
      };
    }
    if (resolvedToday?.day.day_type === 'cardio') return { kind: 'cardio_day' };
    if (resolvedToday?.day.is_rest_day) return { kind: 'rest_day' };
    if (resolvedToday) {
      return {
        kind: 'training_day',
        dayTitle: resolvedToday.day.title,
        exerciseCount: resolvedToday.day.program_exercises.length,
        isDeload: isDeloadWeek,
      };
    }
    return { kind: 'none' };
  }, [
    isTodayCompleted,
    resolvedToday,
    scheduledToday,
    weeklyScheduleToday,
    weeklyScheduleTodayRaw,
    isDeloadWeek,
  ]);

  const todayFocusSummary = useMemo(
    () =>
      coachingEngine.generateTodayFocusSummary({
        readiness,
        plan: todayPlan,
        recentPr: recentPr
          ? {
              exerciseName: recentPr.exerciseName,
              loadKg: recentPr.loadKg,
              reps: recentPr.reps,
              daysAgo: recentPr.daysAgo,
              sameCalendarWeek: recentPr.sameCalendarWeek,
            }
          : null,
        missedYesterday,
        completedYesterday,
        isMilestoneWeek,
        currentWeekNumber: currentWeekNumber ?? null,
        weeksCount,
        streak,
      }),
    [
      readiness,
      todayPlan,
      recentPr,
      missedYesterday,
      completedYesterday,
      isMilestoneWeek,
      currentWeekNumber,
      weeksCount,
      streak,
    ],
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Fire-and-forget, like the Whoop metrics query's own focus-triggered
    // sync — a slow or failed Whoop round-trip shouldn't hold up the rest of
    // the pull-to-refresh. Its onSuccess invalidates the whoopMetrics query,
    // which readinessContext (and today's AI focus summary) reads from.
    if (isWhoopConnected && userId) {
      syncWhoopMetrics.mutate(userId);
    }
    if (isOuraConnected && userId) {
      syncOuraMetrics.mutate(userId);
    }
    try {
      await Promise.all([
        refetchProgram(),
        refetchWorkoutLogs(),
        refetchScheduledWorkouts(),
        refetchWeeklySchedule(),
        refetchLoggedSets(),
        refetchFriendsPosts(),
        refetchDayOverrides(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    refetchProgram,
    refetchWorkoutLogs,
    refetchScheduledWorkouts,
    refetchWeeklySchedule,
    refetchLoggedSets,
    refetchFriendsPosts,
    refetchDayOverrides,
    isWhoopConnected,
    isOuraConnected,
    userId,
    syncWhoopMetrics,
    syncOuraMetrics,
  ]);

  const goToLogWorkout = (
    programDayId?: string,
    scheduledWorkoutId?: string,
  ) => {
    navigateToStartWorkout(rootNavigation, {
      programDayId,
      scheduledWorkoutId,
    });
  };

  const goToScheduledDetail = (scheduledWorkoutId: string) => {
    rootNavigation.navigate('MainTabs', {
      screen: 'ProgramsTab',
      params: {
        screen: 'ScheduledWorkoutDetail',
        params: { scheduledWorkoutId },
      },
    });
  };

  const goToTrainingDayDetail = (
    weeklyScheduleId: string,
    workoutTemplateId: string,
    dayOfWeek: number,
  ) => {
    todayNavigation.navigate('TrainingDayDetail', {
      weeklyScheduleId,
      workoutTemplateId,
      dayOfWeek,
    });
  };

  const onStartWeeklyTemplate = async () => {
    if (!userId || !selectedWeeklyTemplate) return;
    try {
      const scheduled = await startTemplateToday.mutateAsync({
        userId,
        template: selectedWeeklyTemplate,
      });
      goToLogWorkout(undefined, scheduled.id);
    } catch (err) {
      Alert.alert(
        'Could not start workout',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  // Today's plan and the AI coach summary merge into one hero card only for
  // the common case: today is selected, it isn't already completed, and
  // there's an actual plan with a "Start Workout" CTA to attach the summary
  // to. Every other case (a rest day, nothing scheduled, or any past/future
  // date being browsed via WeekTimeline) keeps the coach summary and the
  // plan as two separate cards, exactly as before — merging AI commentary
  // into "nothing scheduled" or a browsed-past-day card doesn't make sense,
  // and isn't what the approved design shows.
  const mergeBranch: 'scheduled' | 'cardio' | 'weekly' | 'resolved' | null =
    !isSelectedToday || isSelectedCompleted || isSelectedMissed
      ? null
      : scheduledSelected
      ? 'scheduled'
      : isCardioSelected
      ? 'cardio'
      : weeklyScheduleSelected
      ? 'weekly'
      : resolvedSelected && !resolvedSelected.day.is_rest_day
      ? 'resolved'
      : null;

  // activeWorkoutStore is a single global slot (see its own file) with no
  // per-plan-branch id knowable ahead of time for the "weekly recurring"
  // origin (starting one materializes a brand-new scheduled_workouts row on
  // the fly) — so rather than id-matching against today's resolved plan,
  // "in progress for today" is just "there's an active session, and it was
  // started today." Date-scoped so an abandoned multi-day-old session never
  // misleadingly reads as in-progress for today's card.
  const activeWorkoutLogId = useActiveWorkoutStore(state => state.workoutLogId);
  const activeWorkoutSource = useActiveWorkoutStore(state => state.source);
  const activeWorkoutStartedAt = useActiveWorkoutStore(
    state => state.startedAt,
  );
  const hasInProgressWorkoutToday =
    activeWorkoutLogId != null &&
    activeWorkoutStartedAt != null &&
    isSameDay(new Date(activeWorkoutStartedAt), today);

  let heroProps: {
    planLabel: string;
    planTitle: string;
    planMeta: string | null;
    ctaLabel: string;
    onCtaPress: () => void;
    ctaLoading?: boolean;
  } | null = null;

  if (isSelectedToday && isSelectedMissed) {
    const missedPlanTitle =
      scheduledSelected?.name ??
      weeklyScheduleSelected?.workout_templates.name ??
      (isCardioSelected ? 'Cardio' : null) ??
      (resolvedSelected && !resolvedSelected.day.is_rest_day
        ? resolvedSelected.day.title
        : null) ??
      'Workout';
    heroProps = {
      planLabel: 'MISSED',
      planTitle: missedPlanTitle,
      planMeta: "You marked today's workout as missed.",
      ctaLabel: 'Add Workout Back',
      onCtaPress: onAddWorkoutBack,
      ctaLoading: clearDayOverride.isPending,
    };
  } else if (mergeBranch === 'scheduled' && scheduledSelected) {
    heroProps = {
      planLabel: 'SCHEDULED',
      planTitle: scheduledSelected.name,
      planMeta: null,
      ctaLabel: 'Start Workout',
      onCtaPress: () => goToLogWorkout(undefined, scheduledSelected.id),
    };
  } else if (mergeBranch === 'cardio') {
    heroProps = {
      planLabel: isWeeklyCardioSelected
        ? `${format(selectedDate, 'EEEE').toUpperCase()} · EVERY WEEK`
        : `WEEK ${resolvedSelected?.week.week_number ?? ''}${
            resolvedSelected?.week.deload ? ' · DELOAD' : ''
          }`,
      planTitle: 'Cardio Day',
      planMeta: null,
      ctaLabel: 'Log Cardio',
      onCtaPress: () =>
        navigateToStartCardio(rootNavigation, { date: dateKey(selectedDate) }),
    };
  } else if (mergeBranch === 'weekly' && weeklyScheduleSelected) {
    // `weeklyScheduleSelected.workout_templates.workout_template_exercises`
    // only selects order_index (see weeklySchedule.ts — it exists to count
    // exercises for WeekTimeline, not describe them); `selectedWeeklyTemplate`
    // is the same one the non-merge branch below already fetches full
    // target_sets/rest_seconds detail from via useWorkoutTemplate.
    const exerciseCount =
      weeklyScheduleSelected.workout_templates.workout_template_exercises
        .length;
    const minutes = selectedWeeklyTemplate
      ? estimateWeeklyMinutes(selectedWeeklyTemplate.workout_template_exercises)
      : null;
    heroProps = {
      planLabel: `${format(selectedDate, 'EEEE').toUpperCase()} · EVERY WEEK`,
      planTitle: weeklyScheduleSelected.workout_templates.name,
      planMeta: `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}${
        minutes ? ` · ~${minutes} min` : ''
      }`,
      ctaLabel: 'Start Workout',
      onCtaPress: onStartWeeklyTemplate,
      ctaLoading: startTemplateToday.isPending,
    };
  } else if (mergeBranch === 'resolved' && resolvedSelected) {
    const exerciseCount = resolvedSelected.day.program_exercises.length;
    const minutes = estimateMinutes(resolvedSelected.day.program_exercises);
    heroProps = {
      planLabel: `WEEK ${resolvedSelected.week.week_number}${
        resolvedSelected.week.deload ? ' · DELOAD' : ''
      }`,
      planTitle: resolvedSelected.day.title ?? 'Training Day',
      planMeta: `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}${
        minutes ? ` · ~${minutes} min` : ''
      }`,
      ctaLabel: 'Start Workout',
      onCtaPress: () => goToLogWorkout(resolvedSelected.day.id),
    };
  }

  // Overrides uniformly across whichever branch just built heroProps,
  // rather than threading this into each branch individually — a session
  // already in progress means "continue," regardless of whether it
  // originated from a one-off scheduled workout, the weekly recurring
  // schedule, or the AI-generated program.
  if (heroProps && hasInProgressWorkoutToday) {
    heroProps = {
      ...heroProps,
      planLabel: 'IN PROGRESS',
      ctaLabel: 'Continue Workout',
      ctaLoading: false,
      onCtaPress: () =>
        navigateToContinueWorkout(rootNavigation, activeWorkoutSource),
    };
  }

  // Energy-balance card data — see src/utils/energyBalance.ts. Reuses
  // workoutLogs (already fetched above for the calendar/streak) rather than
  // a second query, and only adds one new network round trip: the selected
  // day's food_log_entries. Keyed on selectedDate (not today) so browsing a
  // past day via WeekTimeline shows that day's energy stats and workout
  // burn — same selectedDate-driven browsing CompletedWorkoutCard/
  // CompletedCardioCard already support below.
  const foodRangeFrom = useMemo(
    () => startOfDay(selectedDate).toISOString(),
    [selectedDate],
  );
  const foodRangeTo = useMemo(
    () => endOfDay(selectedDate).toISOString(),
    [selectedDate],
  );
  const { data: foodEntries } = useFoodLogEntriesInRange(userId, {
    from: foodRangeFrom,
    to: foodRangeTo,
  });
  const { data: latestWeightKg } = useLatestBodyWeight(userId);

  const selectedDateWorkoutLogs = useMemo(
    () =>
      (workoutLogs ?? []).filter(
        log => dateKey(new Date(log.completedAt)) === dateKey(selectedDate),
      ),
    [workoutLogs, selectedDate],
  );
  const strengthSessions = useMemo(
    () =>
      selectedDateWorkoutLogs
        .filter(log => log.cardio == null)
        .map(log => ({
          durationMinutes: Math.max(
            0,
            (new Date(log.completedAt).getTime() -
              new Date(log.startedAt).getTime()) /
              60_000,
          ),
          estimatedCalories: log.estimatedCalories,
        })),
    [selectedDateWorkoutLogs],
  );
  const selectedDateCardioCalories = useMemo(
    () =>
      selectedDateWorkoutLogs.reduce(
        (sum, log) => sum + (log.cardio?.estimatedCalories ?? 0),
        0,
      ),
    [selectedDateWorkoutLogs],
  );

  const nutritionGoal = profile?.nutrition_goal ?? 'maintain';
  const age = profile?.birth_date ? calculateAge(profile.birth_date) : null;

  const energyTotals = useMemo(
    () =>
      computeDailyEnergyTotals({
        foodEntries: foodEntries ?? [],
        strengthSessions,
        cardioCalories: selectedDateCardioCalories,
        weightKg: latestWeightKg ?? null,
        heightCm: profile?.height_cm ?? null,
        age,
        sex: profile?.sex ?? null,
        goal: nutritionGoal,
      }),
    [
      foodEntries,
      strengthSessions,
      selectedDateCardioCalories,
      latestWeightKg,
      profile?.height_cm,
      age,
      profile?.sex,
      nutritionGoal,
    ],
  );

  // Keeps the Home Screen/Lock Screen widget in sync with whatever this
  // screen itself just showed — same headline/summary/band the hero
  // card/AiSummaryCard renders, same day-plan data CalendarScreen's "what's
  // next" reads from, same readiness/streak/calories numbers their own
  // cards show elsewhere on this screen. Fires on every refetch that lands
  // here (pull-to-refresh, refocus, a Whoop sync completing, a food log),
  // which is the "whenever the app is refreshed with latest metrics" half
  // of the widget's refresh contract — the other half (the daily 6 AM
  // rollover) lives entirely on the widget extension's own timeline policy
  // and needs nothing from this screen. Placed after energyTotals (not up
  // near todayFocusSummary/todayPlan, where this effect used to live)
  // purely because it now also reads energyTotals, which isn't computed
  // until here — no behavioral reason for the new position.
  // The widget itself is a SetSocial Pro perk — a free athlete simply
  // never gets synced, so any widget they've added via iOS's own UI just
  // sits on whatever it last showed (or its native-side empty state)
  // instead of updating with real data.
  useEffect(() => {
    if (isLoading || !profile?.is_premium) return;
    syncWidget(
      buildWidgetPayload({
        today,
        todayFocusSummary,
        isRestDay: todayPlan.kind === 'rest_day',
        program,
        weeklySchedule,
        scheduledWorkouts,
        workoutLogs,
        sessionsThisWeek,
        weeklyTarget,
        readinessScore: readiness?.score ?? null,
        streak,
        caloriesLogged: energyTotals.caloriesIn,
        calorieTarget: energyTotals.targetIntake,
      }),
    );
  }, [
    isLoading,
    profile?.is_premium,
    today,
    todayFocusSummary,
    todayPlan,
    program,
    weeklySchedule,
    scheduledWorkouts,
    workoutLogs,
    sessionsThisWeek,
    weeklyTarget,
    readiness,
    streak,
    energyTotals,
  ]);

  const macroTargets = useMemo(
    () =>
      computeMacroTargets({
        weightKg: latestWeightKg ?? null,
        targetIntake: energyTotals.targetIntake,
        goal: nutritionGoal,
      }),
    [latestWeightKg, energyTotals.targetIntake, nutritionGoal],
  );

  // Same evening cutoff StreakRiskNudge uses for "it's getting late" —
  // applied to the day's last expected meal instead of training. Reads the
  // real current hour regardless of which date is browsed (EnergyTodayCard
  // only ever shows this narrative for isSelectedToday, so it's moot for a
  // past day either way).
  const hasEveningMealGap =
    today.getHours() >= 17 &&
    !(foodEntries ?? []).some(entry => entry.meal_type === 'dinner');

  const energySummary = useMemo(
    () =>
      coachingEngine.generateEnergySummary({
        goal: nutritionGoal,
        caloriesIn: energyTotals.caloriesIn,
        caloriesOut: energyTotals.caloriesOut,
        net: energyTotals.net,
        targetIntake: energyTotals.targetIntake,
        proteinG: energyTotals.proteinG,
        proteinTargetG: macroTargets.proteinTargetG,
        entriesLoggedToday: (foodEntries ?? []).length,
        hasEveningMealGap,
      }),
    [
      nutritionGoal,
      energyTotals,
      macroTargets.proteinTargetG,
      foodEntries,
      hasEveningMealGap,
    ],
  );

  const goToLogFood = () => todayNavigation.navigate('LogFood');

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <KeyboardAvoider>
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          testID="today-scroll-view"
          {...tabBarScrollHandler}
          scrollEventThrottle={16}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingBottom: theme.spacing.lg + tabBarHeight,
            gap: theme.spacing.xl,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent.primary}
            />
          }
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: theme.spacing.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="label" color="secondary">
                {format(today, 'EEEE, MMM d').toUpperCase()}
              </Text>
              <Text variant="title" numberOfLines={1}>
                {greeting(today.getHours())}
                {firstName ? `, ${firstName}` : ''}
              </Text>
            </View>
            <IconButton
              name="menu"
              variant="ghost"
              accessibilityLabel="Settings"
              onPress={() =>
                rootNavigation.navigate('Profile', { screen: 'Settings' })
              }
            />
          </View>

          {heroProps ? (
            <TodayHeroCard
              headline={todayFocusSummary.headline}
              summary={todayFocusSummary.summary}
              band={todayFocusSummary.band}
              readiness={readiness}
              {...heroProps}
            />
          ) : (
            <AiSummaryCard
              headline={todayFocusSummary.headline}
              summary={todayFocusSummary.summary}
              band={todayFocusSummary.band}
              isRestDay={todayPlan.kind === 'rest_day'}
              readiness={readiness}
            />
          )}

          {isLoading ? (
            <LoadingState fill={false} />
          ) : (
            <WeekTimeline
              program={program}
              completedDates={completedDates}
              cardioDates={cardioDates}
              scheduledDates={new Set(scheduledByDate.keys())}
              weeklyScheduleDaysOfWeek={weeklyScheduleDaysOfWeek}
              overrides={dayOverridesByDate}
              prDates={prDates}
              streak={streak}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          )}

          {featureFlags.nutritionTracking ? (
            <EnergyTodayCard
              entries={foodEntries ?? []}
              totals={energyTotals}
              goal={nutritionGoal}
              macroTargets={macroTargets}
              insightHeadline={energySummary.headline}
              insightBody={energySummary.body}
              onLogMeal={goToLogFood}
              selectedDate={selectedDate}
              isSelectedToday={isSelectedToday}
            />
          ) : null}

          <QuickCheckinCard userId={userId} />

          {isLoading ? null : (
            <>
              {isSelectedCompleted && selectedCardioSummary ? (
                <CompletedCardioCard
                  selectedDate={selectedDate}
                  isSelectedToday={isSelectedToday}
                  summary={selectedCardioSummary}
                />
              ) : isSelectedCompleted ? (
                <CompletedWorkoutCard
                  selectedDate={selectedDate}
                  isSelectedToday={isSelectedToday}
                  workoutLogIds={selectedWorkoutLogIds}
                  fallbackTitle={
                    scheduledSelected?.name ??
                    weeklyScheduleSelected?.workout_templates.name ??
                    resolvedSelected?.day.title ??
                    null
                  }
                  isPr={isSelectedPr}
                  summary={selectedDaySummary}
                />
              ) : isSelectedMissed ? (
                // Today's missed state renders in the hero card above (heroProps)
                // — this fallback card only covers past/future days browsed via
                // WeekTimeline, which never route through the merged hero.
                isSelectedToday ? null : (
                  <Card
                    variant="elevated"
                    style={{
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      paddingVertical: theme.spacing.xl,
                    }}
                  >
                    <Icon
                      name="circleAlert"
                      size="lg"
                      color={theme.colors.semantic.danger}
                    />
                    <Text variant="subtitle">Missed</Text>
                    <Text
                      variant="body"
                      color="secondary"
                      style={{ textAlign: 'center' }}
                    >
                      This day was marked as missed.
                    </Text>
                    <Button
                      label="Add Workout Back"
                      variant="secondary"
                      onPress={onAddWorkoutBack}
                      loading={clearDayOverride.isPending}
                    />
                  </Card>
                )
              ) : mergeBranch === 'scheduled' ? null : scheduledSelected ? (
                <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
                  <View>
                    <Text variant="label" color="secondary">
                      SCHEDULED
                    </Text>
                    <Text variant="title">{scheduledSelected.name}</Text>
                  </View>
                  <Button
                    label="View Day"
                    variant="secondary"
                    onPress={() => goToScheduledDetail(scheduledSelected.id)}
                  />
                </Card>
              ) : mergeBranch === 'cardio' ? null : isCardioSelected ? (
                <Card
                  variant="elevated"
                  style={{
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.xl,
                  }}
                >
                  <Icon name="activity" size="lg" color={theme.colors.accent.teal} />
                  <Text variant="subtitle">Cardio day</Text>
                  <Text
                    variant="body"
                    color="secondary"
                    style={{ textAlign: 'center' }}
                  >
                    {isWeeklyCardioSelected
                      ? `Every ${format(selectedDate, 'EEEE')}.`
                      : "Part of this week's program."}
                  </Text>
                  <Button
                    label="Log Cardio"
                    variant="secondary"
                    onPress={() =>
                      navigateToStartCardio(rootNavigation, {
                        date: dateKey(selectedDate),
                      })
                    }
                  />
                </Card>
              ) : mergeBranch === 'weekly' ? null : weeklyScheduleSelected ? (
                <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
                  <View>
                    <Text variant="label" color="secondary">
                      {format(selectedDate, 'EEEE').toUpperCase()} · EVERY WEEK
                    </Text>
                    <Text variant="title">
                      {weeklyScheduleSelected.workout_templates.name}
                    </Text>
                    <Text variant="caption" color="secondary">
                      {
                        weeklyScheduleSelected.workout_templates
                          .workout_template_exercises.length
                      }{' '}
                      exercises
                    </Text>
                  </View>

                  {selectedWeeklyTemplate ? (
                    <View>
                      {selectedWeeklyTemplate.workout_template_exercises
                        .slice(0, 3)
                        .map((te, index) => (
                          <ListRow
                            key={te.id}
                            title={te.exercises.name}
                            trailing={
                              <Text variant="body" color="secondary">
                                {te.target_sets} × {te.target_reps_min}
                                {te.target_reps_max &&
                                te.target_reps_max !== te.target_reps_min
                                  ? `-${te.target_reps_max}`
                                  : ''}
                              </Text>
                            }
                            style={
                              index > 0
                                ? {
                                    borderTopWidth: 1,
                                    borderTopColor: theme.colors.border.subtle,
                                  }
                                : undefined
                            }
                          />
                        ))}
                      {selectedWeeklyTemplate.workout_template_exercises
                        .length > 3 ? (
                        <Text
                          variant="caption"
                          color="tertiary"
                          style={{ paddingTop: theme.spacing.xs }}
                        >
                          +{' '}
                          {selectedWeeklyTemplate.workout_template_exercises
                            .length - 3}{' '}
                          more
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  <Button
                    label="View Day"
                    variant="secondary"
                    onPress={() =>
                      goToTrainingDayDetail(
                        weeklyScheduleSelected.id,
                        weeklyScheduleSelected.workout_template_id,
                        weeklyScheduleSelected.day_of_week,
                      )
                    }
                  />
                </Card>
              ) : resolvedSelected?.day.is_rest_day ? (
                <Card
                  variant="elevated"
                  style={{
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.xl,
                  }}
                >
                  <Icon
                    name="moon"
                    size="lg"
                    color={theme.colors.text.secondary}
                  />
                  <Text variant="subtitle">Rest day</Text>
                  <Text
                    variant="body"
                    color="secondary"
                    style={{ textAlign: 'center' }}
                  >
                    Recovery is part of the program. Back at it next session.
                  </Text>
                </Card>
              ) : mergeBranch === 'resolved' ? null : resolvedSelected ? (
                <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
                  <View>
                    <Text variant="label" color="secondary">
                      WEEK {resolvedSelected.week.week_number}
                      {resolvedSelected.week.deload ? ' · DELOAD' : ''}
                    </Text>
                    <Text variant="title">
                      {resolvedSelected.day.title ?? 'Training Day'}
                    </Text>
                    <Text variant="caption" color="secondary">
                      {resolvedSelected.day.program_exercises.length} exercises
                      {estimateMinutes(resolvedSelected.day.program_exercises)
                        ? ` · ~${estimateMinutes(
                            resolvedSelected.day.program_exercises,
                          )} min`
                        : ''}
                    </Text>
                  </View>

                  <View>
                    {resolvedSelected.day.program_exercises
                      .slice(0, 3)
                      .map((pe, index) => (
                        <ListRow
                          key={pe.id}
                          title={pe.exercises.name}
                          trailing={
                            <Text variant="body" color="secondary">
                              {pe.target_sets} × {pe.target_reps_min}
                              {pe.target_reps_max &&
                              pe.target_reps_max !== pe.target_reps_min
                                ? `-${pe.target_reps_max}`
                                : ''}
                            </Text>
                          }
                          style={
                            index > 0
                              ? {
                                  borderTopWidth: 1,
                                  borderTopColor: theme.colors.border.subtle,
                                }
                              : undefined
                          }
                        />
                      ))}
                    {resolvedSelected.day.program_exercises.length > 3 ? (
                      <Text
                        variant="caption"
                        color="tertiary"
                        style={{ paddingTop: theme.spacing.xs }}
                      >
                        + {resolvedSelected.day.program_exercises.length - 3}{' '}
                        more
                      </Text>
                    ) : null}
                  </View>

                  <Button
                    label="View Day"
                    variant="secondary"
                    onPress={() =>
                      todayNavigation.navigate('DayDetail', {
                        programDayId: resolvedSelected.day.id,
                        date: dateKey(selectedDate),
                      })
                    }
                  />
                </Card>
              ) : (
                <Card
                  variant="elevated"
                  style={{
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.xl,
                  }}
                >
                  <Text variant="subtitle">
                    {isSelectedFuture ? 'Nothing scheduled' : 'Nothing logged'}
                  </Text>
                  <Text
                    variant="body"
                    color="secondary"
                    style={{ textAlign: 'center' }}
                  >
                    {isSameDay(selectedDate, today)
                      ? "No training day on today's calendar."
                      : format(selectedDate, 'EEEE, MMM d')}
                  </Text>
                </Card>
              )}

              <StatsRail prediction={topPrPrediction} unitPref={unitPref} />

              <StreakRiskNudge
                streak={streak}
                hour={today.getHours()}
                isTodayCompleted={isTodayCompleted}
                hasPlanToday={
                  todayPlan.kind === 'training_day' ||
                  todayPlan.kind === 'scheduled' ||
                  todayPlan.kind === 'cardio_day'
                }
              />

              <MoreForYouCard
                userId={userId}
                focusModeEnabled={focusModeEnabled}
                isWhoopConnected={isWhoopConnected}
                activePatterns={activePatterns}
                onDismissPattern={patternId =>
                  userId && dismissPattern.mutate({ id: patternId, userId })
                }
                hasProgram={!!program}
                sessionsThisWeek={sessionsThisWeek}
                weeklyTarget={weeklyTarget}
                streak={streak}
                liveFriendWorkouts={liveFriendWorkouts ?? []}
                onViewLiveNow={onViewLiveNow}
                friendsPostsCount={friendsPosts?.length ?? 0}
                friendsPostsLoading={friendsPostsLoading}
                friendsPostsError={friendsPostsError}
                onFriendsActivityViewAll={onFriendsActivityViewAll}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}
