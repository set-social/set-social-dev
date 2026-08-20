import React, { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  isToday as isDateToday,
  isFuture as isDateFuture,
} from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Icon, BottomSheet } from '../../components/core';
import type { ProgramTree } from '../../services/api/queries/programs';
import { getProgramDayForDate } from '../../services/api/queries/programs';

const WEEKS_PAST = 13; // ~90 days back, matches the streak/log query window
const WEEKS_FUTURE = 3;
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const EMPTY_OVERRIDES: Map<string, 'rest' | 'missed' | 'cardio'> = new Map();

type DayStatus = 'done' | 'cardio' | 'rest' | 'missed' | 'scheduled';

function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function statusFor(
  date: Date,
  program: ProgramTree | null | undefined,
  completedDates: Set<string>,
  cardioDates: Set<string>,
  scheduledDates: Set<string>,
  weeklyScheduleDaysOfWeek: Set<number>,
  overrides: Map<string, 'rest' | 'missed' | 'cardio'>,
): DayStatus {
  const key = dateKey(date);
  if (completedDates.has(key)) return cardioDates.has(key) ? 'cardio' : 'done';

  // An explicit rest/missed/cardio override (set from the Training tab, for
  // a current/future or past date that had a plan) always wins over the
  // derived plan below — that's the whole point of it overriding. A
  // 'cardio' override maps to 'scheduled'/'missed' rather than returned
  // as-is: this component's own 'cardio' DayStatus specifically means
  // "completed cardio" (see the cardioDates branch above), which an
  // unlogged override isn't yet — same today/future-vs-past split the
  // generic hasPlan fallback below uses.
  const override = overrides.get(key);
  if (override === 'cardio') return isDateFuture(date) || isDateToday(date) ? 'scheduled' : 'missed';
  if (override) return override;

  const resolved = getProgramDayForDate(program, date);
  // A recurring weekly_schedule assignment for this weekday always counts as
  // a real training day, even on a date the AI program calls a rest day.
  // Deliberate v1 simplification: unlike getProgramDayForDate (anchored to
  // program.start_date), this set applies uniformly across the whole
  // displayed window with no anchor to when the assignment was created —
  // assigning "Wednesday = Core Day" today retroactively marks past
  // Wednesdays as missed rather than blank/none. Accepted rather than
  // plumbing created_at through this per-cell calculation.
  const hasWeeklyPlan = weeklyScheduleDaysOfWeek.has(date.getDay());
  const isProgramRestDay =
    (resolved?.day.is_rest_day ?? false) && !hasWeeklyPlan;
  const hasPlan = resolved != null || scheduledDates.has(key) || hasWeeklyPlan;

  // A day with nothing assigned at all reads as "rest" here too, matching
  // the Training tab (dayPlan.ts's resolveDayPlan folds 'programRest' and
  // 'none' into the same "Rest" label/moon icon there) — from the athlete's
  // perspective, no plan for the day *is* a rest day, not a blank cell.
  if (isProgramRestDay || !hasPlan) return 'rest';
  return isDateFuture(date) || isDateToday(date) ? 'scheduled' : 'missed';
}

type WeekTimelineProps = {
  program: ProgramTree | null | undefined;
  completedDates: Set<string>;
  cardioDates: Set<string>;
  scheduledDates: Set<string>;
  weeklyScheduleDaysOfWeek: Set<number>;
  overrides?: Map<string, 'rest' | 'missed' | 'cardio'>;
  prDates: Set<string>;
  streak: number;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
};

export function WeekTimeline({
  program,
  completedDates,
  cardioDates,
  scheduledDates,
  weeklyScheduleDaysOfWeek,
  overrides,
  prDates,
  streak,
  selectedDate,
  onSelectDate,
}: WeekTimelineProps) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [visibleMonthLabel, setVisibleMonthLabel] = useState(() =>
    format(new Date(), 'MMMM yyyy'),
  );
  const [monthSheetOpen, setMonthSheetOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() =>
    startOfMonth(new Date()),
  );

  const today = useMemo(() => new Date(), []);
  const weekStarts = useMemo(() => {
    const firstWeekStart = startOfWeek(addWeeks(today, -WEEKS_PAST), {
      weekStartsOn: 0,
    });
    return Array.from({ length: WEEKS_PAST + WEEKS_FUTURE + 1 }, (_, i) =>
      addWeeks(firstWeekStart, i),
    );
  }, [today]);
  const todayWeekIndex = WEEKS_PAST;

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (containerWidth === 0) return;
    const index = Math.round(
      event.nativeEvent.contentOffset.x / containerWidth,
    );
    const weekStart =
      weekStarts[Math.max(0, Math.min(weekStarts.length - 1, index))];
    if (weekStart) setVisibleMonthLabel(format(weekStart, 'MMMM yyyy'));
  };

  const jumpToDate = (date: Date) => {
    const weekStart = startOfWeek(date, { weekStartsOn: 0 });
    const index = weekStarts.findIndex(w => isSameDay(w, weekStart));
    if (index >= 0 && containerWidth > 0) {
      scrollRef.current?.scrollTo({
        x: index * containerWidth,
        animated: true,
      });
      setVisibleMonthLabel(format(weekStart, 'MMMM yyyy'));
    }
    onSelectDate(date);
  };

  const monthGridDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthCursor), {
      weekStartsOn: 0,
    });
    const gridEnd = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [monthCursor]);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Text variant="label" color="secondary">
            {visibleMonthLabel.toUpperCase()}
          </Text>
          {streak > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                backgroundColor: theme.colors.accent.subtle,
                borderRadius: theme.radii.pill,
                paddingVertical: 3,
                paddingHorizontal: theme.spacing.sm,
              }}
            >
              <Icon
                name="flame"
                size={12}
                color={theme.colors.accent.primary}
              />
              <Text
                variant="caption"
                style={{
                  color: theme.colors.accent.primary,
                  fontWeight: '700',
                }}
              >
                {streak >= 90 ? '90+' : streak}
              </Text>
            </View>
          ) : null}
        </View>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
        >
          <Pressable
            onPress={() => jumpToDate(new Date())}
            disabled={isDateToday(selectedDate)}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
          >
            <Icon
              name="rotateCcw"
              size={12}
              color={
                isDateToday(selectedDate)
                  ? theme.colors.text.tertiary
                  : theme.colors.text.secondary
              }
            />
            <Text
              variant="caption"
              style={{
                // Deliberately not accent.primary — that's the same green
                // the day cells below use to mark "this date is today", so
                // coloring this button green while browsing a future/past
                // date read as "you're still on today" instead of "tap to
                // go back to today".
                color: isDateToday(selectedDate)
                  ? theme.colors.text.tertiary
                  : theme.colors.text.secondary,
                fontWeight: '600',
              }}
            >
              Today
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMonthCursor(startOfMonth(selectedDate));
              setMonthSheetOpen(true);
            }}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <Text
              variant="caption"
              color="tertiary"
              style={{ fontWeight: '600' }}
            >
              Month
            </Text>
            <Icon
              name="chevronDown"
              size={12}
              color={theme.colors.text.tertiary}
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onLayout={e => {
          const width = e.nativeEvent.layout.width;
          setContainerWidth(width);
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({
              x: todayWeekIndex * width,
              animated: false,
            });
          });
        }}
        onMomentumScrollEnd={onScrollEnd}
      >
        {weekStarts.map((weekStart, weekIndex) => (
          <View
            key={weekIndex}
            style={{
              width: containerWidth || undefined,
              flexDirection: 'row',
              gap: theme.spacing.xs,
            }}
          >
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map(
              date => {
                const status = statusFor(
                  date,
                  program,
                  completedDates,
                  cardioDates,
                  scheduledDates,
                  weeklyScheduleDaysOfWeek,
                  overrides ?? EMPTY_OVERRIDES,
                );
                const isToday = isDateToday(date);
                const isSelected = isSameDay(date, selectedDate);
                const hasPr = prDates.has(dateKey(date));

                return (
                  <Pressable
                    key={date.toISOString()}
                    testID={`week-timeline-day-${dateKey(date)}`}
                    onPress={() => onSelectDate(date)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: theme.spacing.sm,
                      borderRadius: theme.radii.md,
                      backgroundColor: isToday
                        ? theme.colors.accent.subtle
                        : 'transparent',
                      borderWidth: isSelected && !isToday ? 1 : 0,
                      borderColor: theme.colors.border.default,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{
                        color: isToday
                          ? theme.colors.accent.primary
                          : theme.colors.text.tertiary,
                        fontWeight: '600',
                      }}
                    >
                      {DOW_LABELS[date.getDay()]}
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      <Text
                        variant="body"
                        style={{
                          fontWeight: '700',
                          color:
                            status === 'rest'
                              ? theme.colors.text.tertiary
                              : theme.colors.text.primary,
                        }}
                      >
                        {format(date, 'd')}
                      </Text>
                      {hasPr ? (
                        <Icon
                          name="star"
                          size={9}
                          color={theme.colors.accent.primary}
                        />
                      ) : null}
                    </View>
                    <StatusMark status={status} />
                  </Pressable>
                );
              },
            )}
          </View>
        ))}
      </ScrollView>

      <BottomSheet
        visible={monthSheetOpen}
        onClose={() => setMonthSheetOpen(false)}
        title={format(monthCursor, 'MMMM yyyy')}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {DOW_LABELS.map((label, i) => (
            <Text
              key={i}
              variant="caption"
              color="tertiary"
              style={{
                width: `${100 / 7}%`,
                textAlign: 'center',
                marginBottom: theme.spacing.sm,
                fontWeight: '600',
              }}
            >
              {label}
            </Text>
          ))}
          {monthGridDays.map(date => {
            const inMonth = isSameMonth(date, monthCursor);
            const isToday = isDateToday(date);
            return (
              <Pressable
                key={date.toISOString()}
                onPress={() => {
                  setMonthSheetOpen(false);
                  jumpToDate(date);
                }}
                style={{
                  width: `${100 / 7}%`,
                  aspectRatio: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: theme.radii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isToday
                      ? theme.colors.accent.subtle
                      : 'transparent',
                  }}
                >
                  <Text
                    variant="caption"
                    style={{
                      fontWeight: isToday ? '700' : '500',
                      color: !inMonth
                        ? theme.colors.text.tertiary
                        : isToday
                        ? theme.colors.accent.primary
                        : theme.colors.text.primary,
                    }}
                  >
                    {format(date, 'd')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </View>
  );
}

function StatusMark({ status }: { status: DayStatus }) {
  const theme = useTheme();
  if (status === 'rest') {
    return (
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.accent.purple,
        }}
      />
    );
  }
  if (status === 'done') {
    return (
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.accent.primary,
        }}
      />
    );
  }
  if (status === 'cardio') {
    return (
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.accent.orange,
        }}
      />
    );
  }
  if (status === 'missed') {
    return (
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.semantic.danger,
        }}
      />
    );
  }
  // scheduled
  return (
    <View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        borderWidth: 1.4,
        borderColor: theme.colors.accent.subtle,
      }}
    />
  );
}
