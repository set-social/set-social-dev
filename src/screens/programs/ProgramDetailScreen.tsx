import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { format, addDays } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Header,
  Icon,
  IconButton,
  ListRow,
  LoadingState,
} from '../../components/core';
import {
  useProgramTree,
  useDeleteProgram,
  useSetDayType,
  type ProgramTree,
} from '../../services/api/queries/programs';
import type { ProgramsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type Route = RouteProp<ProgramsStackParamList, 'ProgramDetail'>;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Every program week always has all 7 day_of_week rows, rest days included
// (see generate-program's insert loop) - so a week's real calendar dates can
// always be recovered from the program's start_date plus which 7-day block
// this week_number is, without a separate "week start date" column. Same
// math as queries/programs.ts's getTodayProgramDay/getProgramDayForDate,
// just solved in the other direction (week + day_of_week -> date).
function weekBlockStart(program: ProgramTree, weekNumber: number): Date {
  return addDays(new Date(program.start_date), (weekNumber - 1) * 7);
}

function dateForDayOfWeek(blockStart: Date, dayOfWeek: number): Date {
  const diff = (dayOfWeek - blockStart.getDay() + 7) % 7;
  return addDays(blockStart, diff);
}

function currentWeekNumber(program: ProgramTree): number {
  const start = new Date(program.start_date);
  const today = new Date();
  const daysSinceStart = Math.floor(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86_400_000,
  );
  return Math.min(
    Math.max(Math.floor(daysSinceStart / 7) + 1, 1),
    program.weeks_count,
  );
}

export function ProgramDetailScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { data: program, isLoading } = useProgramTree(params.programId);
  const deleteProgram = useDeleteProgram();
  const setDayType = useSetDayType();

  // Starts on whichever week contains "today" (clamped to the program's
  // length) rather than always week 1 - lazily set once the program loads,
  // and never reset afterward so switching weeks survives a background
  // refetch instead of snapping back.
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  useEffect(() => {
    if (program && selectedWeek == null) {
      setSelectedWeek(currentWeekNumber(program));
    }
  }, [program, selectedWeek]);

  // Un-marks the day as rest and jumps straight into DayDetail so the
  // athlete can add exercises to it right away — same destination "Training
  // Day" rows in this list already navigate to, just reached from a
  // different starting point (a day that changed its mind about being rest).
  const onAddWorkout = (dayId: string) => {
    setDayType.mutate(
      { id: dayId, dayType: 'training' },
      {
        onSuccess: () =>
          navigation.navigate('DayDetail', { programDayId: dayId }),
      },
    );
  };

  const onDelete = () => {
    if (!program) return;
    Alert.alert(
      'Delete program?',
      "This can't be undone. Your logged workout history isn't affected.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProgram.mutateAsync(program.id);
              navigation.goBack();
            } catch (err) {
              Alert.alert(
                'Could not delete program',
                err instanceof Error ? err.message : 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  const week =
    program && selectedWeek != null
      ? program.program_weeks.find(w => w.week_number === selectedWeek)
      : undefined;
  const blockStart =
    program && selectedWeek != null
      ? weekBlockStart(program, selectedWeek)
      : null;
  const blockEnd = blockStart ? addDays(blockStart, 6) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title={program?.title ?? 'Program'} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
          flexGrow: 1,
        }}
      >
        {isLoading || !program || selectedWeek == null ? (
          <LoadingState fill={false} />
        ) : (
          <>
            <Card variant="subtle">
              <Text variant="body" color="secondary">
                {program.weeks_count} weeks · {program.days_per_week}x/week ·{' '}
                {program.goal ?? 'general'}
              </Text>
            </Card>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <IconButton
                name="chevronLeft"
                variant="ghost"
                accessibilityLabel="Previous week"
                disabled={selectedWeek <= 1}
                onPress={() => setSelectedWeek(w => Math.max((w ?? 1) - 1, 1))}
              />
              <View style={{ alignItems: 'center' }}>
                <Text variant="label" color="secondary">
                  WEEK {selectedWeek} OF {program.weeks_count}
                </Text>
                {blockStart && blockEnd ? (
                  <Text variant="caption" color="tertiary">
                    {format(blockStart, 'MMM d')}–{format(blockEnd, 'MMM d')}
                  </Text>
                ) : null}
              </View>
              <IconButton
                name="chevronRight"
                variant="ghost"
                accessibilityLabel="Next week"
                disabled={selectedWeek >= program.weeks_count}
                onPress={() =>
                  setSelectedWeek(w =>
                    Math.min((w ?? 1) + 1, program.weeks_count),
                  )
                }
              />
            </View>

            {week ? (
              <Card variant="elevated" style={{ gap: 0 }}>
                {WEEKDAY_NAMES.map((weekday, dayOfWeek) => {
                  const day = week.program_days.find(
                    d => d.day_of_week === dayOfWeek,
                  );
                  if (!day) return null;
                  const dateLabel = blockStart
                    ? format(dateForDayOfWeek(blockStart, dayOfWeek), 'MMM d')
                    : '';
                  const rowStyle =
                    dayOfWeek > 0
                      ? {
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border.subtle,
                        }
                      : undefined;

                  return day.is_rest_day ? (
                    <ListRow
                      key={day.id}
                      title={weekday}
                      subtitle={
                        <View style={{ gap: 2 }}>
                          <Text variant="caption" color="tertiary">
                            {dateLabel}
                          </Text>
                          <Text variant="caption" color="secondary">
                            Rest — tap to add a workout
                          </Text>
                        </View>
                      }
                      trailing={
                        <Icon
                          name="moon"
                          size="sm"
                          color={theme.colors.text.tertiary}
                        />
                      }
                      showChevron
                      onPress={() => onAddWorkout(day.id)}
                      style={rowStyle}
                    />
                  ) : (
                    <ListRow
                      key={day.id}
                      title={weekday}
                      subtitle={
                        <View style={{ gap: 2 }}>
                          <Text variant="caption" color="tertiary">
                            {dateLabel}
                          </Text>
                          <Text variant="caption" color="secondary">
                            {day.title ?? 'Training Day'} ·{' '}
                            {day.program_exercises.length} exercises
                          </Text>
                        </View>
                      }
                      showChevron
                      onPress={() =>
                        navigation.navigate('DayDetail', {
                          programDayId: day.id,
                        })
                      }
                      style={rowStyle}
                    />
                  );
                })}
              </Card>
            ) : null}

            <View style={{ flex: 1 }} />

            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              style={{
                alignItems: 'center',
                paddingVertical: theme.spacing.md,
              }}
            >
              <Text
                variant="body"
                style={{
                  color: theme.colors.semantic.danger,
                  fontWeight: '600',
                }}
              >
                Delete Program
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
