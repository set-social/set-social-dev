import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Header,
  TextField,
  Button,
  IconButton,
  ListRow,
  BottomSheet,
  EmptyState,
  LoadingState,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useWorkoutTemplates,
  useDeleteWorkoutTemplate,
  useDuplicateWorkoutTemplate,
  useCreateTemplateFromProgramDay,
  fetchWorkoutTemplate,
  type WorkoutTemplateSummary,
} from '../../services/api/queries/workoutTemplates';
import {
  useAllProgramDaysWithExercises,
  fetchProgramDay,
  type ProgramDaySummary,
} from '../../services/api/queries/programs';
import {
  useCreateScheduledWorkout,
  useDeleteScheduledWorkout,
} from '../../services/api/queries/scheduledWorkouts';
import { useClearDayOverride } from '../../services/api/queries/dayOverrides';
import { parseScheduleDateParam } from '../../utils/scheduleDate';
import type { ProgramsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type Route = RouteProp<ProgramsStackParamList, 'Library'>;

type ScheduleSource =
  | { kind: 'template'; id: string; name: string }
  | { kind: 'day'; day: ProgramDaySummary };

export function LibraryScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const pickMode = params?.pickMode ?? false;
  const userId = useAuthStore(state => state.userId);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const {
    data: templates,
    isLoading: templatesLoading,
    refetch: refetchTemplates,
  } = useWorkoutTemplates(userId, search);
  const {
    data: programDays,
    isLoading: daysLoading,
    refetch: refetchProgramDays,
  } = useAllProgramDaysWithExercises(userId);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchTemplates(), refetchProgramDays()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchTemplates, refetchProgramDays]);

  const deleteTemplate = useDeleteWorkoutTemplate();
  const duplicateTemplate = useDuplicateWorkoutTemplate();
  const createTemplateFromDay = useCreateTemplateFromProgramDay();
  const createScheduledWorkout = useCreateScheduledWorkout();
  const deleteScheduledWorkout = useDeleteScheduledWorkout();
  const clearDayOverride = useClearDayOverride();

  const [overflowTemplate, setOverflowTemplate] =
    useState<WorkoutTemplateSummary | null>(null);
  const [overflowDay, setOverflowDay] = useState<ProgramDaySummary | null>(
    null,
  );
  const [scheduleSource, setScheduleSource] = useState<ScheduleSource | null>(
    null,
  );
  const [pickDate, setPickDate] = useState(() => parseScheduleDateParam(params?.date));
  const [scheduling, setScheduling] = useState(false);
  const [savingDayId, setSavingDayId] = useState<string | null>(null);

  // Must be a stable reference, not an inline arrow function passed
  // directly to DateTimePicker — on Android the picker is an imperative
  // dialog whose show effect re-fires (reopening the dialog) whenever the
  // `onChange` prop's identity changes, and an inline arrow gets a new
  // identity on every render, including the one `setPickDate` itself
  // triggers. Picking a date reopened the same dialog immediately instead
  // of applying it. See SignUpScreen's identical fix.
  const onChangePickDate = useCallback(
    (_event: DateTimePickerEvent, date?: Date) => {
      if (date) setPickDate(date);
    },
    [],
  );

  const filteredDays = (programDays ?? []).filter(day => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      day.title.toLowerCase().includes(q) ||
      day.programTitle.toLowerCase().includes(q)
    );
  });

  const openScheduler = (source: ScheduleSource) => {
    // Resets to the date this screen was opened with (today, unless
    // CalendarScreen's "Change Workout" passed a specific one) rather than
    // unconditionally `new Date()` — otherwise picking a template would
    // silently discard the date the athlete was trying to change and
    // schedule onto today instead.
    setPickDate(parseScheduleDateParam(params?.date));
    setScheduleSource(source);
  };

  const onDeleteTemplate = (template: WorkoutTemplateSummary) => {
    setOverflowTemplate(null);
    Alert.alert(
      'Delete workout?',
      `"${template.name}" will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteTemplate.mutate(template.id),
        },
      ],
    );
  };

  const onDuplicateTemplate = async (template: WorkoutTemplateSummary) => {
    setOverflowTemplate(null);
    const tree = await queryClient.fetchQuery({
      queryKey: ['workoutTemplate', template.id],
      queryFn: () => fetchWorkoutTemplate(template.id),
    });
    duplicateTemplate.mutate(tree);
  };

  const onSaveDayAsTemplate = async (day: ProgramDaySummary) => {
    setOverflowDay(null);
    if (!userId) return;
    setSavingDayId(day.programDayId);
    try {
      const fullDay = await queryClient.fetchQuery({
        queryKey: ['programDay', day.programDayId],
        queryFn: () => fetchProgramDay(day.programDayId),
      });
      const newTemplate = await createTemplateFromDay.mutateAsync({
        userId,
        day: fullDay,
      });
      navigation.navigate('TemplateEditor', { templateId: newTemplate.id });
    } catch (err) {
      Alert.alert(
        'Could not save workout',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setSavingDayId(null);
    }
  };

  const onConfirmSchedule = async () => {
    if (!userId || !scheduleSource) return;
    setScheduling(true);
    try {
      // "Change Workout" (CalendarScreen) passes the id of a one-off
      // scheduled_workouts row already sitting on this date — delete it
      // first. scheduled_workouts has no unique constraint on
      // (user_id, scheduled_date), so inserting the replacement without
      // this would leave the old row behind as an orphaned duplicate
      // rather than actually replacing what's on the day.
      if (params?.replaceScheduledWorkoutId) {
        await deleteScheduledWorkout.mutateAsync(params.replaceScheduledWorkoutId);
      }
      // resolveDayPlan checks day_overrides ahead of scheduled_workouts
      // (dayPlan.ts) — a Rest/Missed/Cardio override left in place would
      // keep shadowing the workout being scheduled here, the same way
      // AssignTrainingDayScreen already has to clear one after reassigning
      // a recurring weekday. Best-effort: there's usually nothing to
      // clear, and this shouldn't block or alarm over a schedule that
      // already succeeded.
      try {
        await clearDayOverride.mutateAsync({ userId, date: format(pickDate, 'yyyy-MM-dd') });
      } catch (err) {
        console.error('[LibraryScreen] failed to clear day override', err);
      }
      if (scheduleSource.kind === 'template') {
        const tree = await queryClient.fetchQuery({
          queryKey: ['workoutTemplate', scheduleSource.id],
          queryFn: () => fetchWorkoutTemplate(scheduleSource.id),
        });
        await createScheduledWorkout.mutateAsync({
          userId,
          scheduledDate: format(pickDate, 'yyyy-MM-dd'),
          name: tree.name,
          sourceTemplateId: tree.id,
          exercises: tree.workout_template_exercises,
        });
      } else {
        const fullDay = await queryClient.fetchQuery({
          queryKey: ['programDay', scheduleSource.day.programDayId],
          queryFn: () => fetchProgramDay(scheduleSource.day.programDayId),
        });
        await createScheduledWorkout.mutateAsync({
          userId,
          scheduledDate: format(pickDate, 'yyyy-MM-dd'),
          name: fullDay.title ?? scheduleSource.day.title,
          exercises: fullDay.program_exercises,
        });
      }
      setScheduleSource(null);
      Alert.alert(
        'Added to calendar',
        `Scheduled for ${format(pickDate, 'MMM d, yyyy')}.`,
      );
      navigation.goBack();
    } catch (err) {
      Alert.alert(
        'Could not schedule workout',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setScheduling(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <KeyboardAvoider>
        <Header
          title="Workout Library"
          right={
            !pickMode ? (
              <IconButton
                name="plus"
                onPress={() => navigation.navigate('TemplateEditor', undefined)}
              />
            ) : undefined
          }
        />
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            paddingBottom: theme.spacing.lg + tabBarHeight,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent.primary}
            />
          }
        >
          <TextField
            placeholder="Search workouts…"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              MY WORKOUTS
            </Text>
            {templatesLoading ? (
              <LoadingState fill={false} />
            ) : !templates || templates.length === 0 ? (
              <EmptyState
                icon="dumbbell"
                title="No saved workouts yet"
                description="Create one from scratch or save an existing workout to your library."
              />
            ) : (
              templates.map(template => {
                const previewNames = [...template.workout_template_exercises]
                  .sort((a, b) => a.order_index - b.order_index)
                  .map(te => te.exercises.name);
                return (
                  <Card
                    key={template.id}
                    variant="elevated"
                    style={{ gap: theme.spacing.xs }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text variant="subtitle">{template.name}</Text>
                        <Text variant="caption" color="secondary">
                          {template.workout_template_exercises.length} exercises
                          {template.estimated_duration_minutes
                            ? ` · ${template.estimated_duration_minutes} min`
                            : ''}
                        </Text>
                      </View>
                      {!pickMode ? (
                        <IconButton
                          name="moreVertical"
                          variant="ghost"
                          onPress={() => setOverflowTemplate(template)}
                        />
                      ) : null}
                    </View>
                    {previewNames.length > 0 ? (
                      <Text
                        variant="caption"
                        color="tertiary"
                        numberOfLines={1}
                      >
                        {previewNames.join(', ')}
                      </Text>
                    ) : null}
                    {pickMode ? (
                      <Button
                        label="Add to Calendar"
                        variant="secondary"
                        size="sm"
                        onPress={() =>
                          openScheduler({
                            kind: 'template',
                            id: template.id,
                            name: template.name,
                          })
                        }
                      />
                    ) : null}
                  </Card>
                );
              })
            )}
          </View>

          {!pickMode ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="label" color="secondary">
                EXISTING WORKOUTS
              </Text>
              {daysLoading ? (
                <LoadingState fill={false} />
              ) : filteredDays.length === 0 ? (
                <EmptyState
                  icon="calendar"
                  title="Nothing here yet"
                  description="Training days from your programs will show up here."
                />
              ) : (
                filteredDays.map(day => (
                  <Card
                    key={day.programDayId}
                    variant="elevated"
                    style={{ gap: theme.spacing.xs }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text variant="subtitle">{day.title}</Text>
                        <Text variant="caption" color="secondary">
                          {day.programTitle} · {day.exerciseCount} exercises
                        </Text>
                      </View>
                      <IconButton
                        name="moreVertical"
                        variant="ghost"
                        onPress={() => setOverflowDay(day)}
                        disabled={savingDayId === day.programDayId}
                      />
                    </View>
                    {day.previewNames.length > 0 ? (
                      <Text
                        variant="caption"
                        color="tertiary"
                        numberOfLines={1}
                      >
                        {day.previewNames.join(', ')}
                      </Text>
                    ) : null}
                  </Card>
                ))
              )}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoider>

      <BottomSheet
        visible={overflowTemplate != null}
        onClose={() => setOverflowTemplate(null)}
        title={overflowTemplate?.name}
      >
        {overflowTemplate ? (
          <View style={{ gap: theme.spacing.xs }}>
            <ListRow
              title="Edit"
              icon="pencil"
              onPress={() => {
                const id = overflowTemplate.id;
                setOverflowTemplate(null);
                navigation.navigate('TemplateEditor', { templateId: id });
              }}
            />
            <ListRow
              title="Duplicate"
              icon="copy"
              onPress={() => onDuplicateTemplate(overflowTemplate)}
            />
            <ListRow
              title="Add to Calendar"
              icon="calendarPlus"
              onPress={() => {
                const { id, name } = overflowTemplate;
                setOverflowTemplate(null);
                openScheduler({ kind: 'template', id, name });
              }}
            />
            <ListRow
              title="Delete"
              icon="trash"
              onPress={() => onDeleteTemplate(overflowTemplate)}
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.colors.border.subtle,
              }}
            />
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={overflowDay != null}
        onClose={() => setOverflowDay(null)}
        title={overflowDay?.title}
      >
        {overflowDay ? (
          <View style={{ gap: theme.spacing.xs }}>
            <ListRow
              title="Add to Calendar"
              icon="calendarPlus"
              onPress={() => {
                const day = overflowDay;
                setOverflowDay(null);
                openScheduler({ kind: 'day', day });
              }}
            />
            <ListRow
              title="Save as New Template"
              icon="bookmark"
              onPress={() => onSaveDayAsTemplate(overflowDay)}
            />
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={scheduleSource != null}
        onClose={() => setScheduleSource(null)}
        title={
          scheduleSource
            ? `Schedule "${
                scheduleSource.kind === 'template'
                  ? scheduleSource.name
                  : scheduleSource.day.title
              }"`
            : undefined
        }
      >
        <View style={{ gap: theme.spacing.md, alignItems: 'center' }}>
          <DateTimePicker
            value={pickDate}
            mode="date"
            themeVariant={theme.colorScheme}
            minimumDate={new Date()}
            onChange={onChangePickDate}
          />
          <Button
            label="Confirm Date"
            onPress={onConfirmSchedule}
            loading={scheduling}
            style={{ width: '100%' }}
          />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}
