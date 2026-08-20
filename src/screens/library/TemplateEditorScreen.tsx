import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
  BottomSheet,
  EmptyState,
  LoadingState,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useWorkoutTemplate,
  useCreateWorkoutTemplate,
  useUpdateWorkoutTemplate,
  useRemoveTemplateExercise,
  useReorderTemplateExercises,
} from '../../services/api/queries/workoutTemplates';
import {
  useCreateScheduledWorkout,
  useDeleteScheduledWorkout,
} from '../../services/api/queries/scheduledWorkouts';
import { useClearDayOverride } from '../../services/api/queries/dayOverrides';
import { parseScheduleDateParam } from '../../utils/scheduleDate';
import type { ProgramsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type Route = RouteProp<ProgramsStackParamList, 'TemplateEditor'>;

export function TemplateEditorScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const templateId = params?.templateId;
  const isNew = !templateId;
  const scheduleAfterSave = params?.scheduleAfterSave ?? false;

  const { data: template, isLoading } = useWorkoutTemplate(templateId);
  const createTemplate = useCreateWorkoutTemplate();
  const updateTemplate = useUpdateWorkoutTemplate();
  const removeExercise = useRemoveTemplateExercise();
  const reorderExercises = useReorderTemplateExercises();
  const createScheduledWorkout = useCreateScheduledWorkout();
  const deleteScheduledWorkout = useDeleteScheduledWorkout();
  const clearDayOverride = useClearDayOverride();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [pickDate, setPickDate] = useState(() => parseScheduleDateParam(params?.date));
  const [scheduling, setScheduling] = useState(false);

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

  // Mirror the server value into local state once it lands (edit mode) —
  // create mode starts blank and stays purely local until the first save.
  useEffect(() => {
    if (template) {
      setName(template.name);
      setNotes(template.notes ?? '');
      setDuration(
        template.estimated_duration_minutes != null
          ? String(template.estimated_duration_minutes)
          : '',
      );
    }
  }, [template]);

  const onSaveHeader = async () => {
    if (!name.trim()) return;
    const estimatedDurationMinutes = duration.trim()
      ? parseInt(duration, 10) || null
      : null;
    if (isNew) {
      if (!userId) return;
      const created = await createTemplate.mutateAsync({
        userId,
        name: name.trim(),
        notes: notes.trim() || null,
        estimatedDurationMinutes,
      });
      navigation.setParams({ templateId: created.id });
    } else {
      updateTemplate.mutate({
        id: templateId,
        name: name.trim(),
        notes: notes.trim() || null,
        estimatedDurationMinutes,
      });
    }
  };

  const onRemoveExercise = (exerciseRowId: string, exerciseName: string) => {
    if (!templateId) return;
    Alert.alert(
      'Remove exercise?',
      `Remove ${exerciseName} from this workout?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            removeExercise.mutate({ id: exerciseRowId, templateId }),
        },
      ],
    );
  };

  const sortedExercises = template
    ? [...template.workout_template_exercises].sort(
        (a, b) => a.order_index - b.order_index,
      )
    : [];

  const onMoveExercise = (index: number, direction: -1 | 1) => {
    if (!templateId) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sortedExercises.length) return;
    const a = sortedExercises[index];
    const b = sortedExercises[targetIndex];
    reorderExercises.mutate({
      templateId,
      rows: [
        { id: a.id, order_index: b.order_index },
        { id: b.id, order_index: a.order_index },
      ],
    });
  };

  const onConfirmSchedule = async () => {
    if (!userId || !template) return;
    setScheduling(true);
    try {
      // "Create New Workout" (CalendarScreen's "Change Workout" actions)
      // passes the id of a one-off scheduled_workouts row already sitting
      // on this date — delete it first. scheduled_workouts has no unique
      // constraint on (user_id, scheduled_date), so inserting the
      // replacement without this would leave the old row behind as an
      // orphaned duplicate rather than actually replacing what's on the
      // day. Same reasoning as LibraryScreen's onConfirmSchedule.
      if (params?.replaceScheduledWorkoutId) {
        await deleteScheduledWorkout.mutateAsync(params.replaceScheduledWorkoutId);
      }
      // resolveDayPlan checks day_overrides ahead of scheduled_workouts
      // (dayPlan.ts) — a Rest/Missed/Cardio override left in place would
      // keep shadowing the workout being scheduled here. Best-effort, same
      // reasoning as LibraryScreen's onConfirmSchedule.
      try {
        await clearDayOverride.mutateAsync({ userId, date: format(pickDate, 'yyyy-MM-dd') });
      } catch (err) {
        console.error('[TemplateEditorScreen] failed to clear day override', err);
      }
      await createScheduledWorkout.mutateAsync({
        userId,
        scheduledDate: format(pickDate, 'yyyy-MM-dd'),
        name: template.name,
        sourceTemplateId: template.id,
        exercises: template.workout_template_exercises,
      });
      setScheduleSheetOpen(false);
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
      <Header
        title={isNew ? 'New Workout' : 'Edit Workout'}
        right={
          isNew ? (
            <Button
              label="Save"
              size="sm"
              onPress={onSaveHeader}
              disabled={!name.trim()}
              loading={createTemplate.isPending}
            />
          ) : undefined
        }
      />
      <KeyboardAvoider>
        {templateId && isLoading ? (
          <LoadingState />
        ) : (
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
          >
            <Card variant="elevated" style={{ gap: theme.spacing.md }}>
              <TextField
                label="Workout Name"
                value={name}
                onChangeText={setName}
                onBlur={() => {
                  if (!isNew) onSaveHeader();
                }}
                placeholder="e.g. Leg Day"
              />
              <TextField
                label="Estimated Duration (minutes, optional)"
                value={duration}
                onChangeText={setDuration}
                onBlur={() => {
                  if (!isNew) onSaveHeader();
                }}
                keyboardType="number-pad"
                placeholder="45"
              />
              <TextField
                label="Notes (optional)"
                value={notes}
                onChangeText={setNotes}
                onBlur={() => {
                  if (!isNew) onSaveHeader();
                }}
                placeholder="Anything to remember about this workout"
                multiline
              />
            </Card>

            {!isNew ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color="secondary">
                  EXERCISES
                </Text>
                {sortedExercises.length === 0 ? (
                  <EmptyState
                    icon="dumbbell"
                    title="No exercises yet"
                    description="Add exercises below to build out this workout."
                  />
                ) : (
                  sortedExercises.map((te, index) => (
                    <Card
                      key={te.id}
                      variant="elevated"
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: theme.spacing.sm,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text variant="subtitle">{te.exercises.name}</Text>
                        <Text variant="caption" color="secondary">
                          {te.target_sets} sets × {te.target_reps_min ?? '?'}
                          {te.target_reps_max &&
                          te.target_reps_max !== te.target_reps_min
                            ? `-${te.target_reps_max}`
                            : ''}{' '}
                          reps
                          {te.target_rpe ? ` @ RPE ${te.target_rpe}` : ''}
                          {te.rest_seconds ? ` · Rest ${te.rest_seconds}s` : ''}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row' }}>
                        <IconButton
                          name="chevronUp"
                          variant="ghost"
                          onPress={() => onMoveExercise(index, -1)}
                          disabled={index === 0}
                        />
                        <IconButton
                          name="chevronDown"
                          variant="ghost"
                          onPress={() => onMoveExercise(index, 1)}
                          disabled={index === sortedExercises.length - 1}
                        />
                      </View>
                      <IconButton
                        name="trash"
                        variant="ghost"
                        color={theme.colors.semantic.danger}
                        onPress={() =>
                          onRemoveExercise(te.id, te.exercises.name)
                        }
                      />
                    </Card>
                  ))
                )}

                <Button
                  label="Add Exercise"
                  icon="plus"
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate('ExercisePicker', { templateId })
                  }
                />

                {scheduleAfterSave ? (
                  <Button
                    label="Schedule This Workout"
                    icon="calendarPlus"
                    onPress={() => {
                      // Resets to the date this screen was opened with
                      // (today, unless CalendarScreen's "Change Workout"
                      // passed a specific one) — see LibraryScreen's
                      // openScheduler for the same fix/reasoning.
                      setPickDate(parseScheduleDateParam(params?.date));
                      setScheduleSheetOpen(true);
                    }}
                  />
                ) : null}
              </View>
            ) : (
              <Text
                variant="caption"
                color="secondary"
                style={{ textAlign: 'center' }}
              >
                Save the workout name first, then add exercises.
              </Text>
            )}
          </ScrollView>
        )}
      </KeyboardAvoider>

      <BottomSheet
        visible={scheduleSheetOpen}
        onClose={() => setScheduleSheetOpen(false)}
        title={template ? `Schedule "${template.name}"` : undefined}
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
