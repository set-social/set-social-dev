import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDays, format, startOfWeek } from 'date-fns';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Header,
  ListRow,
  LoadingState,
  EmptyState,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useWorkoutTemplates } from '../../services/api/queries/workoutTemplates';
import { useAssignWeeklySchedule } from '../../services/api/queries/weeklySchedule';
import { useClearDayOverride } from '../../services/api/queries/dayOverrides';
import type { ProgramsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type Route = RouteProp<ProgramsStackParamList, 'AssignTrainingDay'>;

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** "Set up a specific day" — assigns an existing workout template to a
 * weekday, recurring indefinitely (no week 1/week 2 framing). Deliberately
 * doesn't support creating a brand-new template inline: that's the Workout
 * Library's job (TemplateEditorScreen), reachable from its own "+" — this
 * screen just picks from what already exists there, keeping it
 * self-contained rather than reaching into LibraryScreen's own stateful
 * pick/schedule flow for a different purpose. */
export function AssignTrainingDayScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const { data: templates, isLoading } = useWorkoutTemplates(userId);
  const assignWeeklySchedule = useAssignWeeklySchedule();
  const clearDayOverride = useClearDayOverride();

  const [dayOfWeek, setDayOfWeek] = useState<number | null>(
    params?.initialDayOfWeek ?? null,
  );
  // Tracks which row is mid-assign (for its own inline spinner) rather than
  // a persisted "selected" template — tapping a workout assigns it
  // immediately, there's no separate confirm step to select ahead of.
  const [assigningTemplateId, setAssigningTemplateId] = useState<
    string | null
  >(null);

  const onSelectTemplate = async (templateId: string) => {
    if (dayOfWeek == null) {
      Alert.alert(
        'Pick a day first',
        'Choose which day of the week this workout belongs to.',
      );
      return;
    }
    if (!userId || assignWeeklySchedule.isPending) return;
    setAssigningTemplateId(templateId);
    try {
      await assignWeeklySchedule.mutateAsync({
        userId,
        dayOfWeek,
        workoutTemplateId: templateId,
      });
    } catch (err) {
      setAssigningTemplateId(null);
      Alert.alert(
        'Could not assign training day',
        err instanceof Error ? err.message : 'Please try again.',
      );
      return;
    }

    // Training's weekday grid checks a date's override (Rest/Missed, set via
    // "Mark as Rest"/"Mark as Missed" on that specific past or overridden
    // date) before this recurring weekly assignment — so this week's
    // occurrence of the day just assigned would otherwise keep showing as
    // Rest, indistinguishably from a day with nothing assigned at all, until
    // next week. Best-effort: there's usually nothing to clear, and this
    // shouldn't block or alarm over an assignment that already succeeded.
    const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
    const dateKey = format(addDays(thisWeekStart, dayOfWeek), 'yyyy-MM-dd');
    try {
      await clearDayOverride.mutateAsync({ userId, date: dateKey });
    } catch (err) {
      console.error('[AssignTrainingDay] failed to clear day override', err);
    }

    navigation.goBack();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Add a Training Day" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.xl,
        }}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" color="secondary">
            DAY OF WEEK
          </Text>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between' }}
          >
            {WEEKDAY_LABELS.map((label, index) => {
              const selected = dayOfWeek === index;
              return (
                <Pressable
                  key={index}
                  onPress={() => setDayOfWeek(index)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: theme.radii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected
                      ? theme.colors.accent.primary
                      : theme.colors.bg.surface,
                    borderWidth: 1,
                    borderColor: selected
                      ? theme.colors.accent.primary
                      : theme.colors.border.subtle,
                  }}
                >
                  <Text
                    variant="body"
                    color={selected ? 'onAccent' : 'primary'}
                    style={{ fontWeight: '700' }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" color="secondary">
            WORKOUT
          </Text>
          {isLoading ? (
            <LoadingState fill={false} />
          ) : !templates || templates.length === 0 ? (
            <EmptyState
              icon="dumbbell"
              title="No saved workouts yet"
              description="Create one in your Workout Library first, then come back here."
            />
          ) : (
            <View style={{ gap: theme.spacing.xs }}>
              {templates.map((template, index) => (
                <ListRow
                  key={template.id}
                  title={template.name}
                  subtitle={`${template.workout_template_exercises.length} exercises`}
                  trailing={
                    assigningTemplateId === template.id ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.accent.primary}
                      />
                    ) : undefined
                  }
                  onPress={() => onSelectTemplate(template.id)}
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
            </View>
          )}
          <Text variant="caption" color="tertiary">
            Don't see it? Create it in your Workout Library, then come back
            here.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
