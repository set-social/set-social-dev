import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  View,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import { useTabBarScrollHandler } from '../../navigation/tabBarScroll';
import {
  Text,
  Card,
  Header,
  Icon,
  IconButton,
  ListRow,
  BottomSheet,
  EmptyState,
  LoadingState,
  Button,
  SegmentedControl,
  TextField,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import {
  useActiveProgramTree,
  useHasEverGeneratedProgram,
} from '../../services/api/queries/programs';
import {
  useScheduledWorkouts,
  useStartTemplateToday,
  TODAY_RANGE_PAST_DAYS,
  TODAY_RANGE_FUTURE_DAYS,
} from '../../services/api/queries/scheduledWorkouts';
import { useWorkoutLogsInRange } from '../../services/api/queries/workoutLogs';
import {
  useWeeklySchedule,
  getWeeklyScheduleForDate,
} from '../../services/api/queries/weeklySchedule';
import {
  useDayOverrides,
  useSetDayOverride,
} from '../../services/api/queries/dayOverrides';
import { useWorkoutTemplate } from '../../services/api/queries/workoutTemplates';
import { useCardioActivities } from '../../services/api/queries/cardioLogs';
import {
  resolveDayPlan,
  getOneOffBaseline,
  type ResolvedDayPlan,
} from '../../utils/dayPlan';
import { fetchWeeklyPlanSnapshot } from '../../services/api/queries/workoutShares';
import {
  navigateToStartCardio,
  sourceToActiveWorkoutParams,
} from '../../navigation/startWorkoutFlow';
import { useActiveWorkoutStore } from '../../store/activeWorkoutStore';
import { featureFlags } from '../../config/featureFlags';
import { MUSCLE_GROUPS, type MuscleGroup } from '../../constants/muscleGroups';
import { formatEnumLabel } from '../../utils/exerciseMetadata';
import type {
  ProgramsStackParamList,
  RootStackParamList,
} from '../../navigation/types';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const ASK_DAYS_OPTIONS = [3, 4, 5, 6];
const ASK_WEEKS_OPTIONS = [4, 6, 8];

function planLineFor(resolved: ResolvedDayPlan): string {
  switch (resolved.kind) {
    case 'completed':
      return resolved.title ?? 'Workout';
    case 'scheduled':
      return resolved.scheduledWorkout.name;
    case 'weeklyRecurring':
      return resolved.entry.workout_templates
        ? `${resolved.entry.workout_templates.name} · ${resolved.entry.workout_templates.workout_template_exercises.length} exercises`
        : 'Workout';
    case 'weeklyCardio':
      return 'Cardio Day';
    case 'programTraining':
      return `${resolved.day.title ?? 'Training Day'} · ${
        resolved.day.program_exercises.length
      } exercises`;
    case 'programCardio':
    case 'overrideCardio':
      return 'Cardio Day';
    case 'programRest':
    case 'none':
    case 'overrideRest':
      return 'Rest';
    case 'missed':
      return 'Missed';
  }
}

// Kinds that mean "this date actually had a workout planned" — the ones a
// past-day tap should offer to reclassify as rest/missed, as opposed to an
// already-empty rest day (nothing there to change).
const PLAN_KINDS = new Set<ResolvedDayPlan['kind']>([
  'scheduled',
  'weeklyRecurring',
  'weeklyCardio',
  'programTraining',
  'programCardio',
  'overrideCardio',
]);

type Segment = 'thisWeek' | 'library' | 'program';

export function CalendarScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const {
    data: program,
    isLoading,
    refetch: refetchProgram,
  } = useActiveProgramTree(userId);
  const { data: hasEverGeneratedProgram } = useHasEverGeneratedProgram(userId);
  // For "Start a Run" below — looked up by name rather than hardcoding an id,
  // since seeded exercise ids aren't stable across environments.
  const { data: cardioActivities } = useCardioActivities();
  const outdoorRunActivity = (cardioActivities ?? []).find(a => a.name === 'Outdoor Run');
  const {
    data: weeklySchedule,
    isLoading: weeklyScheduleLoading,
    refetch: refetchWeeklySchedule,
  } = useWeeklySchedule(userId);
  const navigation =
    useNavigation<NativeStackNavigationProp<ProgramsStackParamList>>();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // Set when a rest-day row is tapped — offers a choice (assign a workout,
  // or mark the day cardio) instead of jumping straight to AssignTrainingDay.
  const [restDayChoiceFor, setRestDayChoiceFor] = useState<number | null>(null);
  // "Ask Coach to build you a custom program" — a short back-and-forth
  // (answered by tap, not typed) that asks the two questions a generated
  // program can't be right without — days/week and how many weeks — before
  // revealing the optional goal/emphasis fields and handing off to
  // GenerateProgramScreen. Previously these two were silently pulled from
  // the profile (or the model guessed the week count), which is how a
  // program could come back shaped nothing like what the athlete wanted.
  const [generateProgramSheetOpen, setGenerateProgramSheetOpen] =
    useState(false);
  const [askDaysPerWeek, setAskDaysPerWeek] = useState<number | null>(null);
  const [askWeeksCount, setAskWeeksCount] = useState<number | null>(null);
  const [focusNotes, setFocusNotes] = useState('');
  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<
    MuscleGroup[]
  >([]);

  const [segment, setSegment] = useState<Segment>('thisWeek');
  useFocusEffect(useCallback(() => setSegment('thisWeek'), []));
  const [sharingWeek, setSharingWeek] = useState(false);

  const today = new Date();
  // Anchors which week the prev/next/Today controls have navigated to —
  // defaults to today, and moving it is what lets the TRAINING DAYS grid
  // below show and be edited for a week other than the real current one.
  // Kept fully separate from `today` itself: anything that means "the real
  // current day" (isToday checks, the "Start" CTA, Share my week) must keep
  // using `today`, never this.
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  // Same window TodayScreen's WeekTimeline fetches (91 days back / 21
  // forward) — anchored to the real `today`, not `selectedDate`, so paging
  // through weeks doesn't itself trigger new network requests, and reusing
  // the exact same query keys means this screen rides TodayScreen's
  // already-warm cache instead of duplicating it. A week navigated to
  // beyond this window (rare — 3+ months out) still resolves correctly for
  // a recurring weekly_schedule day (that table isn't date-ranged), just
  // without any one-off scheduled_workouts/day_overrides for that far out.
  const rangeFrom = format(addDays(today, -TODAY_RANGE_PAST_DAYS), 'yyyy-MM-dd');
  const rangeTo = format(addDays(today, TODAY_RANGE_FUTURE_DAYS), 'yyyy-MM-dd');

  const {
    data: scheduledWorkouts,
    isLoading: scheduledLoading,
    refetch: refetchScheduled,
  } = useScheduledWorkouts(userId, { from: rangeFrom, to: rangeTo });

  // This week's Sun-Sat range — recomputed from `today` on every render (same
  // convention TodayScreen uses), so once Sunday arrives the next visit to
  // this screen naturally sees a fresh week with nothing completed yet. Used
  // for things that are specifically about the real current week (the
  // "nothing set up yet" check, Share my week) regardless of which week the
  // strip/grid below is currently showing.
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 0 });
  const thisWeekDates = Array.from({ length: 7 }, (_, dayOfWeek) =>
    addDays(thisWeekStart, dayOfWeek),
  );
  // The week currently navigated to via the prev/next/Today controls — this
  // is what the TRAINING DAYS grid and its row actions actually read/write
  // against, so assigning or marking a day always targets the calendar date
  // being looked at, not silently the real current week.
  const selectedWeekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const selectedWeekDates = Array.from({ length: 7 }, (_, dayOfWeek) =>
    addDays(selectedWeekStart, dayOfWeek),
  );
  const isCurrentWeek = isSameDay(selectedWeekStart, thisWeekStart);
  // Always the concrete date range, never a relative "This/Next/Last Week"
  // label — the segmented control right above this already has its own
  // "This Week" tab, and echoing that same phrase here for the browsed week
  // read as two different things sharing one label. The disabled Today
  // button already signals "you're on the current week" without it.
  const weekLabel = `${format(selectedWeekStart, 'MMM d')} – ${format(selectedWeekDates[6], 'MMM d')}`;
  const { data: workoutLogs, refetch: refetchWorkoutLogs } =
    useWorkoutLogsInRange(userId, { from: rangeFrom, to: rangeTo });
  const { data: dayOverrides, refetch: refetchDayOverrides } = useDayOverrides(
    userId,
    { from: rangeFrom, to: rangeTo },
  );
  const setDayOverride = useSetDayOverride();
  // Set when a past, already-planned day is tapped — offers "Mark as Rest"
  // or "Mark as Missed" instead of letting the athlete retroactively change
  // or start the workout itself (see isPastDay below).
  const [pastDayActionFor, setPastDayActionFor] = useState<number | null>(null);
  // Set on a plain tap of any today-or-future row that already has a plan
  // on it (cardio or workout, any kind) — one menu regardless of whether
  // it's today or a future day, since those used to open two different
  // sheets with two different option sets (today's own row via tap; a
  // future day only via long-press, and missing Mark as Rest). Carries the
  // resolved plan itself (not just the day index) so the sheet can offer a
  // kind-appropriate "View Workout"/"Start Cardio" row and know whether to
  // show "Make This a Cardio Day"/pass a replaceScheduledWorkoutId. Today's
  // dedicated Start button (a separate Pressable nested in the same row —
  // see trailing below) still starts it directly, bypassing this menu.
  const [dayActionFor, setDayActionFor] = useState<{
    dayOfWeek: number;
    resolved: ResolvedDayPlan;
  } | null>(null);

  // Absorbed from the old standalone Log tab (see LogLandingScreen, now
  // deleted) when the tab bar was redesigned to make room for a permanent
  // Arnold slot — Training is now the one place that both shows the week
  // and offers to start today's session.
  const activeWorkoutHasHydrated = useActiveWorkoutStore(state => state.hasHydrated);
  const activeWorkoutLogId = useActiveWorkoutStore(state => state.workoutLogId);
  const activeWorkoutSource = useActiveWorkoutStore(state => state.source);
  const activeWorkoutStartedAt = useActiveWorkoutStore(state => state.startedAt);
  // Date-scoped like TodayScreen's hasInProgressWorkoutToday: activeWorkoutStore
  // is a single global slot, so an abandoned session from a previous day (or a
  // different day's workout) must not paint today's row as "in progress".
  const hasActiveWorkout =
    activeWorkoutHasHydrated &&
    activeWorkoutLogId != null &&
    activeWorkoutStartedAt != null &&
    format(new Date(activeWorkoutStartedAt), 'yyyy-MM-dd') ===
      format(today, 'yyyy-MM-dd');

  // Reuses the exact same inputs the per-day loop below resolves each row
  // with, just pinned to `today` specifically — so this can never disagree
  // with what today's own row in that loop shows.
  const todayResolved = useMemo(
    () =>
      resolveDayPlan({
        date: today,
        program,
        weeklySchedule,
        scheduledWorkouts,
        workoutLogs,
        dayOverrides,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [program, weeklySchedule, scheduledWorkouts, workoutLogs, dayOverrides],
  );
  const hasTodayTarget =
    todayResolved.kind === 'scheduled' ||
    todayResolved.kind === 'weeklyRecurring' ||
    todayResolved.kind === 'programTraining' ||
    todayResolved.kind === 'weeklyCardio' ||
    todayResolved.kind === 'programCardio' ||
    todayResolved.kind === 'overrideCardio';
  // hasTodayTarget's own kind checks already exclude 'completed'.
  const showTodayStartCta = hasTodayTarget && !hasActiveWorkout;

  // A weekly-recurring day has no scheduled_workouts row of its own yet —
  // starting it means materializing "today's instance" first, the same way
  // TodayScreen's onStartWeeklyTemplate does.
  const { data: todayWeeklyTemplate } = useWorkoutTemplate(
    todayResolved.kind === 'weeklyRecurring'
      ? todayResolved.entry.workout_template_id ?? undefined
      : undefined,
  );
  const startTemplateToday = useStartTemplateToday();

  const onStartToday = async () => {
    if (todayResolved.kind === 'weeklyCardio' || todayResolved.kind === 'overrideCardio') {
      navigation.navigate('LogCardio', undefined);
      return;
    }
    if (todayResolved.kind === 'programCardio') {
      navigation.navigate('LogCardio', { programDayId: todayResolved.day.id });
      return;
    }

    let source: { programDayId: string } | { scheduledWorkoutId: string } | null = null;

    if (todayResolved.kind === 'scheduled') {
      source = { scheduledWorkoutId: todayResolved.scheduledWorkout.id };
    } else if (todayResolved.kind === 'programTraining') {
      source = { programDayId: todayResolved.day.id };
    } else if (todayResolved.kind === 'weeklyRecurring') {
      if (!userId || !todayWeeklyTemplate) return;
      try {
        const scheduled = await startTemplateToday.mutateAsync({
          userId,
          template: todayWeeklyTemplate,
        });
        source = { scheduledWorkoutId: scheduled.id };
      } catch (err) {
        Alert.alert(
          'Could not start workout',
          err instanceof Error ? err.message : 'Please try again.',
        );
        return;
      }
    }
    if (!source) return;

    if (featureFlags.aiCoaching) {
      navigation.navigate('PreWorkoutReview', source);
    } else {
      navigation.navigate('ActiveWorkoutOverview', source);
    }
  };

  const onStartFreestyle = () => navigation.navigate('ActiveWorkoutOverview', undefined);
  // Goes straight into live tracking — skipping LogCardio's activity/
  // manual-vs-live picker entirely, since tapping "Start a Run" already
  // answers both questions. Falls back to the manual LogCardio flow only if
  // the seeded "Outdoor Run" row hasn't loaded/isn't found, so this is never
  // a dead button. A one-off session (no programDayId/date) — it's saved as
  // its own workout_logs row alongside whatever else is scheduled today,
  // never replacing it. See docs/gps-cardio.md.
  const onStartRun = () => {
    if (!outdoorRunActivity) {
      navigation.navigate('LogCardio', undefined);
      return;
    }
    navigation.navigate('LiveCardioTracking', {
      activityKey: 'run',
      exerciseId: outdoorRunActivity.id,
      customActivityName: null,
    });
  };
  const onResumeWorkout = () =>
    navigation.navigate('ActiveWorkoutOverview', sourceToActiveWorkoutParams(activeWorkoutSource));

  const upcomingScheduled = useMemo(
    () =>
      (scheduledWorkouts ?? []).filter(
        sw => sw.scheduled_date > format(thisWeekDates[6], 'yyyy-MM-dd'),
      ),
    [scheduledWorkouts, thisWeekDates],
  );
  // A day can now have a plan without a weekly_schedule entry at all (an
  // ad-hoc scheduled workout, or an active program's day) — so the "nothing
  // set up yet" nudge should only show when there's truly nothing to show
  // across the whole week, not just when the recurring schedule is empty.
  const hasScheduledThisWeek = (scheduledWorkouts ?? []).some(sw =>
    thisWeekDates.some(
      date => format(date, 'yyyy-MM-dd') === sw.scheduled_date,
    ),
  );
  const hasNothingSetUp =
    (!weeklySchedule || weeklySchedule.length === 0) &&
    !program &&
    !hasScheduledThisWeek;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchProgram(),
        refetchScheduled(),
        refetchWeeklySchedule(),
        refetchWorkoutLogs(),
        refetchDayOverrides(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    refetchProgram,
    refetchScheduled,
    refetchWeeklySchedule,
    refetchWorkoutLogs,
    refetchDayOverrides,
  ]);

  const toggleMuscleGroup = (group: MuscleGroup) => {
    setSelectedMuscleGroups(current =>
      current.includes(group)
        ? current.filter(g => g !== group)
        : [...current, group],
    );
  };

  const onSubmitGenerateProgram = () => {
    if (askDaysPerWeek == null || askWeeksCount == null) return;
    setGenerateProgramSheetOpen(false);
    navigation.navigate('GenerateProgram', {
      daysPerWeek: askDaysPerWeek,
      weeksCount: askWeeksCount,
      focusNotes: focusNotes.trim() || undefined,
      emphasisMuscleGroups:
        selectedMuscleGroups.length > 0 ? selectedMuscleGroups : undefined,
    });
    setAskDaysPerWeek(null);
    setAskWeeksCount(null);
    setFocusNotes('');
    setSelectedMuscleGroups([]);
  };

  // Coach's own message — left-aligned, chat-bubble styled — used for both
  // questions in the Ask Coach sheet below.
  const renderCoachBubble = (message: string) => (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: '90%',
        backgroundColor: theme.colors.bg.surface,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: theme.radii.lg,
        borderBottomLeftRadius: 4,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <Text variant="body">{message}</Text>
    </View>
  );

  // The athlete's tapped answer, replayed back as a sent bubble once chosen
  // — so the sheet reads as a short exchange rather than a form resetting
  // itself after every tap.
  const renderAnswerBubble = (label: string) => (
    <View
      style={{
        alignSelf: 'flex-end',
        backgroundColor: theme.colors.accent.primary,
        borderRadius: theme.radii.lg,
        borderBottomRightRadius: 4,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <Text
        variant="body"
        style={{ color: theme.colors.text.onAccent, fontWeight: '600' }}
      >
        {label}
      </Text>
    </View>
  );

  const renderChipRow = (
    options: number[],
    selected: number | null,
    suffix: string,
    onSelect: (n: number) => void,
  ) => (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
    >
      {options.map(n => {
        const isSelected = selected === n;
        return (
          <Pressable
            key={n}
            onPress={() => onSelect(n)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            style={{
              paddingHorizontal: theme.spacing.md,
              paddingVertical: 7,
              borderRadius: theme.radii.pill,
              backgroundColor: isSelected
                ? theme.colors.accent.subtle
                : theme.colors.bg.surface,
              borderWidth: 1,
              borderColor: isSelected
                ? theme.colors.accent.primary
                : theme.colors.border.default,
            }}
          >
            <Text
              variant="caption"
              style={{
                color: isSelected
                  ? theme.colors.accent.primary
                  : theme.colors.text.secondary,
                fontWeight: isSelected ? '600' : '400',
              }}
            >
              {n} {suffix}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  // The first AI program (however it's reached) is free; every one after
  // that is a Pro "rebuild your program" action — see
  // useHasEverGeneratedProgram's own comment for why a plain existence
  // check on `programs` is enough, no separate tracking column needed.
  const openGenerateProgramFlow = () => {
    if (hasEverGeneratedProgram && !profile?.is_premium) {
      rootNavigation.navigate('Paywall', { trigger: 'program_regen' });
      return;
    }
    setGenerateProgramSheetOpen(true);
  };

  const onShareWeek = async () => {
    if (sharingWeek) return;
    setSharingWeek(true);
    try {
      const payload = await fetchWeeklyPlanSnapshot({
        program,
        weeklySchedule,
        scheduledWorkouts,
        weekDates: thisWeekDates,
      });
      navigation.navigate('ShareWorkout', {
        shareType: 'weekly_plan',
        title: 'My Training Week',
        payload,
      });
    } catch (err) {
      Alert.alert(
        'Could not prepare this week to share',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setSharingWeek(false);
    }
  };

  const onChangeSegment = (value: Segment) => {
    setSegment(value);
    if (value === 'library') {
      navigation.navigate('Library', undefined);
    } else if (value === 'program') {
      if (program) {
        navigation.navigate('ProgramDetail', { programId: program.id });
      } else {
        openGenerateProgramFlow();
      }
    }
  };

  // Drives both the unified day-action sheet's title ("Change today's
  // plan" vs "Change {Weekday}") and whether it offers "Mark as Missed" —
  // only meaningful for today, see the sheet's own comment on that row.
  const dayActionIsToday =
    dayActionFor != null &&
    format(selectedWeekDates[dayActionFor.dayOfWeek], 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');

  // The sheet's kind-appropriate first row — "View Workout" for anything
  // with a real detail screen, "Start Cardio" for a cardio-kind day, which
  // has no detail screen of its own to view.
  const dayActionPrimaryRow = (() => {
    if (dayActionFor == null) return null;
    const { dayOfWeek, resolved } = dayActionFor;
    const dateKey = format(selectedWeekDates[dayOfWeek], 'yyyy-MM-dd');
    if (resolved.kind === 'scheduled') {
      return {
        title: 'View Workout',
        icon: 'eye' as const,
        onPress: () => navigation.navigate('ScheduledWorkoutDetail', { scheduledWorkoutId: resolved.scheduledWorkout.id }),
      };
    }
    if (resolved.kind === 'weeklyRecurring') {
      return {
        title: 'View Workout',
        icon: 'eye' as const,
        onPress: () =>
          navigation.navigate('TrainingDayDetail', {
            weeklyScheduleId: resolved.entry.id,
            workoutTemplateId: resolved.entry.workout_template_id as string,
            dayOfWeek,
          }),
      };
    }
    if (resolved.kind === 'programTraining') {
      return {
        title: 'View Workout',
        icon: 'eye' as const,
        onPress: () => navigation.navigate('DayDetail', { programDayId: resolved.day.id, date: dateKey }),
      };
    }
    if (resolved.kind === 'weeklyCardio' || resolved.kind === 'programCardio' || resolved.kind === 'overrideCardio') {
      return {
        title: 'Start Cardio',
        icon: 'flame' as const,
        onPress: () =>
          navigateToStartCardio(rootNavigation, {
            ...(resolved.kind === 'programCardio' ? { programDayId: resolved.day.id } : null),
            date: dateKey,
          }),
      };
    }
    return null;
  })();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header
        title="Training"
        showBack={false}
        right={
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
            }}
          >
            {segment === 'thisWeek' && !hasNothingSetUp ? (
              <IconButton
                name="share"
                variant="ghost"
                accessibilityLabel="Share my week"
                onPress={onShareWeek}
                disabled={sharingWeek}
              />
            ) : null}
            <IconButton name="plus" onPress={() => setAddSheetOpen(true)} />
          </View>
        }
      />
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        }}
      >
        <SegmentedControl
          options={[
            { value: 'thisWeek', label: 'This Week' },
            { value: 'library', label: 'Library' },
            { value: 'program', label: 'Program' },
          ]}
          value={segment}
          onChange={onChangeSegment}
        />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        {...tabBarScrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
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
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}
          >
            <IconButton
              name="chevronLeft"
              variant="ghost"
              accessibilityLabel="Previous week"
              onPress={() => setSelectedDate(current => addDays(current, -7))}
            />
            <Text variant="subtitle" style={{ minWidth: 116, textAlign: 'center' }}>
              {weekLabel}
            </Text>
            <IconButton
              name="chevronRight"
              variant="ghost"
              accessibilityLabel="Next week"
              onPress={() => setSelectedDate(current => addDays(current, 7))}
            />
          </View>
          <Button
            label="Today"
            size="sm"
            variant="secondary"
            onPress={() => setSelectedDate(new Date())}
            disabled={isCurrentWeek}
          />
        </View>

        {hasActiveWorkout ? (
          <Pressable onPress={onResumeWorkout}>
            <Card
              variant="elevated"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                borderColor: theme.colors.accent.purple,
              }}
            >
              <Icon name="zap" size="md" color={theme.colors.accent.purple} />
              <View style={{ flex: 1 }}>
                <Text variant="subtitle">Workout in progress</Text>
                <Text variant="caption" color="secondary">
                  Tap to resume where you left off
                </Text>
              </View>
              <Icon name="chevronRight" size="sm" color={theme.colors.text.tertiary} />
            </Card>
          </Pressable>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text variant="label" color="secondary">
              TRAINING DAYS
            </Text>
            {weeklySchedule && weeklySchedule.length > 0 ? (
              <IconButton
                name="plus"
                variant="ghost"
                accessibilityLabel="Add a training day"
                onPress={() => navigation.navigate('AssignTrainingDay')}
              />
            ) : null}
          </View>

          {weeklyScheduleLoading ? (
            <LoadingState fill={false} />
          ) : hasNothingSetUp ? (
            <View style={{ gap: theme.spacing.md }}>
              <EmptyState
                icon="calendarPlus"
                title="No training days set up yet"
                description="Assign a workout to a day of the week — it'll repeat every week."
              />
              <Button
                label="Add a Training Day"
                onPress={() => navigation.navigate('AssignTrainingDay')}
              />
            </View>
          ) : (
            // padding: 0 rather than Card's default inset — "today"'s green
            // wash is a per-row background color, and with the card's own
            // padding still in place that wash sat inside a 12px margin on
            // every side instead of reaching the card's actual edges, reading
            // as a rectangle cut off short of where the card itself ends.
            // Each row now carries its own horizontal padding instead (see
            // below), so normal rows still look inset the same as before —
            // only a highlighted row's background actually reaches edge to
            // edge.
            <Card variant="elevated" style={{ gap: 0, padding: 0 }}>
              {WEEKDAY_NAMES.map((weekday, dayOfWeek) => {
                const date = selectedWeekDates[dayOfWeek];
                const isToday =
                  format(date, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');
                const resolved = resolveDayPlan({
                  date,
                  program,
                  weeklySchedule,
                  scheduledWorkouts,
                  workoutLogs,
                  dayOverrides,
                });
                const oneOffBaseline = getOneOffBaseline(
                  resolved,
                  getWeeklyScheduleForDate(weeklySchedule, date),
                );

                // A day that's already passed can't have its workout
                // started or changed anymore — the only thing left to do is
                // reclassify it as rest or missed. Only offered when there
                // was actually a plan for the date (PLAN_KINDS) or it's
                // already been reclassified once (so the athlete can change
                // their mind) — an ordinary empty rest day has nothing to
                // reclassify.
                const isPastDay =
                  format(date, 'yyyy-MM-dd') < format(today, 'yyyy-MM-dd');
                // 'missed' is always a reclassify target regardless of
                // isPastDay — it only ever exists because of an explicit
                // override (resolveDayPlan never derives it from a date
                // just being in the past), including one set on TODAY's own
                // row via the "not doing today" menu below. Gating this on
                // isPastDay too meant a same-day "Mark as Missed" had no way
                // back to "Mark as Rest" until the day actually ended — it
                // fell through to the rest-day Assign/Cardio sheet instead,
                // which has no rest option at all.
                const showPastDayAction =
                  resolved.kind === 'missed' ||
                  (isPastDay &&
                    (PLAN_KINDS.has(resolved.kind) ||
                      resolved.kind === 'overrideRest'));

                const onPress =
                  resolved.kind === 'completed'
                    ? () =>
                        navigation.navigate('WorkoutLogDetail', {
                          workoutLogIds: resolved.workoutLogIds,
                          title: resolved.title,
                          dateLabel: format(date, 'EEEE, MMM d'),
                        })
                    : showPastDayAction
                    ? () => setPastDayActionFor(dayOfWeek)
                    : // Any today-or-future row with a plan on it (any kind)
                      // opens the same "change this day" menu — one menu,
                      // one gesture, regardless of whether it's today or a
                      // future day. Today's dedicated Start button (trailing,
                      // below) is the only way to jump straight into it.
                      PLAN_KINDS.has(resolved.kind)
                    ? () => setDayActionFor({ dayOfWeek, resolved })
                    : () => setRestDayChoiceFor(dayOfWeek);

                const trailing =
                  resolved.kind === 'completed' ? (
                    // A soft-tinted pill rather than a solid icon + bold label —
                    // "today" already washes the whole row green (see isToday
                    // below), so a completed day that's also today doesn't need
                    // a second, louder green signal stacked on top of it.
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: theme.spacing.xxs,
                        paddingHorizontal: theme.spacing.sm,
                        paddingVertical: 3,
                        borderRadius: theme.radii.pill,
                        backgroundColor: 'rgba(0,227,142,0.10)',
                        borderWidth: 1,
                        borderColor: 'rgba(0,227,142,0.32)',
                      }}
                    >
                      <Icon
                        name="check"
                        size={12}
                        color={theme.colors.accent.primary}
                        strokeWidth={3}
                      />
                      <Text
                        variant="caption"
                        style={{
                          color: theme.colors.accent.primary,
                          fontWeight: '700',
                          fontSize: 11,
                          letterSpacing: 0.2,
                        }}
                      >
                        Done
                      </Text>
                    </View>
                  ) : isToday && hasActiveWorkout ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: theme.spacing.xxs,
                        paddingHorizontal: theme.spacing.sm,
                        paddingVertical: 3,
                        borderRadius: theme.radii.pill,
                        backgroundColor: 'rgba(120,97,255,0.12)',
                        borderWidth: 1,
                        borderColor: 'rgba(120,97,255,0.35)',
                      }}
                    >
                      <Text
                        variant="caption"
                        style={{
                          color: theme.colors.accent.purple,
                          fontWeight: '700',
                          fontSize: 11,
                          letterSpacing: 0.2,
                        }}
                      >
                        In progress
                      </Text>
                    </View>
                  ) : isToday && showTodayStartCta ? (
                    <Button
                      label="Start"
                      size="sm"
                      onPress={onStartToday}
                      loading={startTemplateToday.isPending}
                    />
                  ) : resolved.kind === 'weeklyCardio' ||
                    resolved.kind === 'programCardio' ||
                    resolved.kind === 'overrideCardio' ? (
                    <Icon
                      name="flame"
                      size="sm"
                      color={theme.colors.accent.orange}
                    />
                  ) : resolved.kind === 'missed' ? (
                    <View
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 7,
                        backgroundColor: theme.colors.semantic.danger,
                      }}
                    />
                  ) : resolved.kind === 'programRest' ||
                    resolved.kind === 'none' ||
                    resolved.kind === 'overrideRest' ? (
                    <Icon
                      name="moon"
                      size="sm"
                      color={theme.colors.text.tertiary}
                    />
                  ) : undefined;

                return (
                  <ListRow
                    key={dayOfWeek}
                    title={weekday}
                    subtitle={
                      <View style={{ gap: 2 }}>
                        <Text variant="caption" color="tertiary">
                          {format(date, 'MMM d')}
                        </Text>
                        <Text variant="caption" color="secondary">
                          {planLineFor(resolved)}
                        </Text>
                        {oneOffBaseline ? (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: theme.spacing.xs,
                              marginTop: 2,
                            }}
                          >
                            <View
                              style={{
                                paddingHorizontal: theme.spacing.xs,
                                paddingVertical: 2,
                                borderRadius: theme.radii.pill,
                                backgroundColor: 'rgba(255,180,84,0.15)',
                              }}
                            >
                              <Text
                                style={{
                                  color: theme.colors.semantic.warning,
                                  fontSize: 9,
                                  fontWeight: '700',
                                  letterSpacing: 0.4,
                                }}
                              >
                                ONE-OFF
                              </Text>
                            </View>
                            <Text variant="caption" color="tertiary">
                              usually {oneOffBaseline}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    }
                    trailing={trailing}
                    showChevron={
                      !(isToday && showTodayStartCta) &&
                      (showPastDayAction ||
                        resolved.kind === 'scheduled' ||
                        resolved.kind === 'weeklyRecurring' ||
                        resolved.kind === 'programTraining' ||
                        resolved.kind === 'weeklyCardio' ||
                        resolved.kind === 'programCardio' ||
                        resolved.kind === 'overrideCardio')
                    }
                    onPress={onPress}
                    style={{
                      paddingHorizontal: theme.spacing.md,
                      ...(dayOfWeek > 0
                        ? {
                            borderTopWidth: 1,
                            borderTopColor: theme.colors.border.subtle,
                          }
                        : null),
                      ...(isToday
                        ? {
                            backgroundColor: theme.colors.accent.subtle,
                            // Matches the card's own corner radius exactly when
                            // "today" lands on the first/last row, so the wash's
                            // corners round together with the card instead of a
                            // square edge poking past the card's curve.
                            ...(dayOfWeek === 0
                              ? {
                                  borderTopLeftRadius: theme.radii.lg,
                                  borderTopRightRadius: theme.radii.lg,
                                }
                              : null),
                            ...(dayOfWeek === 6
                              ? {
                                  borderBottomLeftRadius: theme.radii.lg,
                                  borderBottomRightRadius: theme.radii.lg,
                                }
                              : null),
                          }
                        : null),
                    }}
                  />
                );
              })}
            </Card>
          )}
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" color="secondary">
            OR START SOMETHING ELSE
          </Text>
          <Button
            label="Start a Freestyle Workout"
            variant="secondary"
            icon="plus"
            onPress={onStartFreestyle}
          />
          <Button
            label="Start a Run"
            variant="secondary"
            icon="flame"
            onPress={onStartRun}
          />
        </View>

        {scheduledLoading ? null : upcomingScheduled.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              UPCOMING
            </Text>
            <Card variant="elevated" style={{ gap: 0 }}>
              {upcomingScheduled.map((sw, index) => (
                <ListRow
                  key={sw.id}
                  title={sw.name}
                  subtitle={format(new Date(sw.scheduled_date), 'EEEE, MMM d')}
                  showChevron
                  onPress={() =>
                    navigation.navigate('ScheduledWorkoutDetail', {
                      scheduledWorkoutId: sw.id,
                    })
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
            </Card>
          </View>
        ) : null}

        {isLoading ? (
          <LoadingState fill={false} />
        ) : !program ? (
          <ListRow
            title="Ask Arnold to build you a custom program"
            icon="messageCircle"
            showChevron
            onPress={openGenerateProgramFlow}
          />
        ) : (
          <Pressable
            onPress={() =>
              navigation.navigate('ProgramDetail', { programId: program.id })
            }
          >
            <Card variant="elevated">
              <Text variant="subtitle">{program.title}</Text>
              <Text variant="body" color="secondary">
                {program.weeks_count} weeks · {program.days_per_week}x/week ·
                view all weeks
              </Text>
            </Card>
          </Pressable>
        )}
      </ScrollView>

      <BottomSheet
        visible={restDayChoiceFor != null}
        onClose={() => setRestDayChoiceFor(null)}
        title="This day is set to rest"
      >
        <View style={{ gap: theme.spacing.xs }}>
          <ListRow
            title="Assign a Workout"
            icon="dumbbell"
            onPress={() => {
              const dayOfWeek = restDayChoiceFor;
              setRestDayChoiceFor(null);
              if (dayOfWeek != null)
                navigation.navigate('AssignTrainingDay', {
                  initialDayOfWeek: dayOfWeek,
                });
            }}
          />
          <ListRow
            title="Log Cardio"
            icon="flame"
            onPress={() => {
              const dayOfWeek = restDayChoiceFor;
              setRestDayChoiceFor(null);
              if (dayOfWeek != null)
                navigation.navigate('AssignCardioDay', {
                  initialDayOfWeek: dayOfWeek,
                });
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={pastDayActionFor != null}
        onClose={() => setPastDayActionFor(null)}
        title={
          // This sheet now also opens for a same-day 'missed' override (see
          // showPastDayAction above), which "This day has passed" would
          // misdescribe while it's still today.
          pastDayActionFor != null &&
          format(selectedWeekDates[pastDayActionFor], 'yyyy-MM-dd') <
            format(today, 'yyyy-MM-dd')
            ? 'This day has passed'
            : 'Update this day'
        }
      >
        <View style={{ gap: theme.spacing.xs }}>
          <ListRow
            title="Mark as Rest"
            icon="moon"
            onPress={() => {
              const dayOfWeek = pastDayActionFor;
              setPastDayActionFor(null);
              if (dayOfWeek == null || !userId) return;
              setDayOverride.mutate({
                userId,
                date: format(selectedWeekDates[dayOfWeek], 'yyyy-MM-dd'),
                status: 'rest',
              });
            }}
          />
          <ListRow
            title="Mark as Missed"
            icon="circleAlert"
            onPress={() => {
              const dayOfWeek = pastDayActionFor;
              setPastDayActionFor(null);
              if (dayOfWeek == null || !userId) return;
              setDayOverride.mutate({
                userId,
                date: format(selectedWeekDates[dayOfWeek], 'yyyy-MM-dd'),
                status: 'missed',
              });
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={dayActionFor != null}
        onClose={() => setDayActionFor(null)}
        title={
          dayActionFor == null
            ? 'Change day'
            : dayActionIsToday
            ? "Change today's plan"
            : `Change ${WEEKDAY_NAMES[dayActionFor.dayOfWeek]}`
        }
      >
        <View style={{ gap: theme.spacing.xs }}>
          {dayActionPrimaryRow ? (
            <ListRow
              title={dayActionPrimaryRow.title}
              icon={dayActionPrimaryRow.icon}
              onPress={() => {
                setDayActionFor(null);
                dayActionPrimaryRow.onPress();
              }}
            />
          ) : null}
          <ListRow
            title="Choose From Library"
            icon="dumbbell"
            onPress={() => {
              const target = dayActionFor;
              setDayActionFor(null);
              if (target == null) return;
              navigation.navigate('Library', {
                pickMode: true,
                date: format(selectedWeekDates[target.dayOfWeek], 'yyyy-MM-dd'),
                replaceScheduledWorkoutId:
                  target.resolved.kind === 'scheduled' ? target.resolved.scheduledWorkout.id : undefined,
              });
            }}
          />
          <ListRow
            title="Create New Workout"
            icon="plus"
            onPress={() => {
              const target = dayActionFor;
              setDayActionFor(null);
              if (target == null) return;
              navigation.navigate('TemplateEditor', {
                scheduleAfterSave: true,
                date: format(selectedWeekDates[target.dayOfWeek], 'yyyy-MM-dd'),
                replaceScheduledWorkoutId:
                  target.resolved.kind === 'scheduled' ? target.resolved.scheduledWorkout.id : undefined,
              });
            }}
          />
          {/* Offering to make it a cardio day again when it already IS one
              is redundant — the primary row above already covers "start
              it" for that case. */}
          {dayActionFor != null &&
          dayActionFor.resolved.kind !== 'weeklyCardio' &&
          dayActionFor.resolved.kind !== 'programCardio' &&
          dayActionFor.resolved.kind !== 'overrideCardio' ? (
            <ListRow
              title="Make This a Cardio Day"
              icon="flame"
              onPress={() => {
                const target = dayActionFor;
                setDayActionFor(null);
                if (target == null || !userId) return;
                setDayOverride.mutate({
                  userId,
                  date: format(selectedWeekDates[target.dayOfWeek], 'yyyy-MM-dd'),
                  status: 'cardio',
                });
              }}
            />
          ) : null}
          <ListRow
            title="Mark as Rest"
            icon="moon"
            onPress={() => {
              const target = dayActionFor;
              setDayActionFor(null);
              if (target == null || !userId) return;
              setDayOverride.mutate({
                userId,
                date: format(selectedWeekDates[target.dayOfWeek], 'yyyy-MM-dd'),
                status: 'rest',
              });
            }}
          />
          {/* Only offered for today — a future day hasn't happened yet, so
              it can't have been "missed"; a past day gets there via
              pastDayActionFor instead (reached by tapping directly, not
              through this menu). */}
          {dayActionIsToday ? (
            <ListRow
              title="Mark as Missed"
              icon="circleAlert"
              onPress={() => {
                const target = dayActionFor;
                setDayActionFor(null);
                if (target == null || !userId) return;
                setDayOverride.mutate({
                  userId,
                  date: format(selectedWeekDates[target.dayOfWeek], 'yyyy-MM-dd'),
                  status: 'missed',
                });
              }}
            />
          ) : null}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title="Add a Workout"
      >
        <View style={{ gap: theme.spacing.xs }}>
          <ListRow
            title="Create New Workout"
            icon="plus"
            onPress={() => {
              setAddSheetOpen(false);
              navigation.navigate('TemplateEditor', {
                scheduleAfterSave: true,
              });
            }}
          />
          <ListRow
            title="Add From Library"
            icon="dumbbell"
            onPress={() => {
              setAddSheetOpen(false);
              navigation.navigate('Library', { pickMode: true });
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={generateProgramSheetOpen}
        onClose={() => setGenerateProgramSheetOpen(false)}
        title="Build a Custom Program"
      >
        <View style={{ gap: theme.spacing.md }}>
          {renderCoachBubble('How many days a week do you want to train?')}
          {renderChipRow(
            ASK_DAYS_OPTIONS,
            askDaysPerWeek,
            'days',
            setAskDaysPerWeek,
          )}

          {askDaysPerWeek != null ? (
            <>
              {renderAnswerBubble(`${askDaysPerWeek} days`)}
              {renderCoachBubble('How many weeks should this block run?')}
              {renderChipRow(
                ASK_WEEKS_OPTIONS,
                askWeeksCount,
                'weeks',
                setAskWeeksCount,
              )}
            </>
          ) : null}

          {askDaysPerWeek != null && askWeeksCount != null ? (
            <>
              {renderAnswerBubble(`${askWeeksCount} weeks`)}
              <TextField
                label="Anything specific this program should accomplish? (optional)"
                value={focusNotes}
                onChangeText={setFocusNotes}
                placeholder="Get stronger for climbing season, build a bigger chest, train for a 5K…"
                multiline
              />
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color="secondary">
                  MUSCLE GROUPS TO EMPHASIZE (OPTIONAL)
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: theme.spacing.xs,
                  }}
                >
                  {MUSCLE_GROUPS.map(group => {
                    const selected = selectedMuscleGroups.includes(group);
                    return (
                      <Pressable
                        key={group}
                        onPress={() => toggleMuscleGroup(group)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.xxs,
                          paddingHorizontal: theme.spacing.sm,
                          paddingVertical: 7,
                          borderRadius: theme.radii.pill,
                          backgroundColor: selected
                            ? theme.colors.accent.subtle
                            : theme.colors.bg.surface,
                          borderWidth: 1,
                          borderColor: selected
                            ? theme.colors.accent.primary
                            : theme.colors.border.default,
                        }}
                      >
                        {selected ? (
                          <Icon
                            name="check"
                            size={11}
                            color={theme.colors.accent.primary}
                            strokeWidth={3}
                          />
                        ) : null}
                        <Text
                          variant="caption"
                          style={{
                            color: selected
                              ? theme.colors.accent.primary
                              : theme.colors.text.secondary,
                            fontWeight: selected ? '600' : '400',
                          }}
                        >
                          {formatEnumLabel(group)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Button
                label="Build My Program"
                onPress={onSubmitGenerateProgram}
              />
            </>
          ) : null}
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}
