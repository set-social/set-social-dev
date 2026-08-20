import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Alert } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Icon, TextField } from '../../components/core';
import { formatWeight, parseWeightInput } from '../../utils/units';
import { useNumericInputText } from '../../hooks/useNumericInputText';
import type { LoggedSet, SetMetric } from '../../store/activeWorkoutStore';

export function metricLabel(metric: SetMetric): string {
  switch (metric) {
    case 'weight_lb':
      return 'LB';
    case 'weight_kg':
      return 'KG';
    case 'weight_pct':
      return '%';
    case 'reps':
      return 'REPS';
    case 'time':
      return 'TIME';
  }
}

export function metricPlaceholder(metric: SetMetric): string {
  switch (metric) {
    case 'weight_lb':
      return 'lb';
    case 'weight_kg':
      return 'kg';
    case 'weight_pct':
      return '%';
    case 'reps':
      return 'reps';
    case 'time':
      return 'time';
  }
}

/** Storage stays the same `loadKg` field regardless of metric — only the two
 * weight modes convert it for display/entry; % and reps pass the raw number
 * through unconverted (there's no meaningful formula between them and kg). */
export function formatMetricValue(loadKg: number | null, metric: SetMetric): string {
  if (loadKg == null) return '';
  if (metric === 'weight_lb') return formatWeight(loadKg, 'lb');
  if (metric === 'weight_kg') return formatWeight(loadKg, 'kg');
  return String(loadKg);
}

export function parseMetricValue(text: string, metric: SetMetric): number | null {
  if (metric === 'weight_lb') return parseWeightInput(text, 'lb');
  if (metric === 'weight_kg') return parseWeightInput(text, 'kg');
  if (text.trim() === '') return null;
  const parsed = parseFloat(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseReps(text: string): number | null {
  if (text === '') return null;
  return parseInt(text, 10) || null;
}

function parseRpe(text: string): number | null {
  if (text === '') return null;
  return parseFloat(text) || null;
}

/** A set counts as "populated" once it holds any data worth confirming before losing. */
export function isSetPopulated(setRow: LoggedSet): boolean {
  return (
    setRow.completed ||
    setRow.reps != null ||
    setRow.loadKg != null ||
    setRow.rpe != null ||
    setRow.durationSeconds != null
  );
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const COUNTDOWN_START_FROM = 5;
const COUNTDOWN_GO_DISPLAY_MS = 500;

/** Drives the pre-set "5, 4, 3, 2, 1, GO" countdown shown on a timed set's
 * Start button before its stopwatch actually starts — gives the athlete a
 * beat to get into position instead of the clock starting the instant they
 * tap. `count` is 5..1 while counting down, 0 while "GO" is showing, and
 * null the rest of the time (idle or already running). A single chained
 * setTimeout (rather than setInterval) makes the final, shorter "GO" beat
 * trivial to express as just one more step with its own delay. */
function useStartCountdown(onFinished: () => void) {
  const [count, setCount] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setCount(null);
  };

  useEffect(() => cancel, []); // clears any pending step if this row unmounts mid-countdown

  const step = (value: number) => {
    setCount(value);
    timeoutRef.current = setTimeout(
      () => {
        if (value > 0) {
          step(value - 1);
        } else {
          timeoutRef.current = null;
          setCount(null);
          onFinished();
        }
      },
      value > 0 ? 1000 : COUNTDOWN_GO_DISPLAY_MS,
    );
  };

  const start = () => step(COUNTDOWN_START_FROM);

  return { count, isCounting: count != null, start, cancel };
}

/** Recomputes elapsed time from a fixed start timestamp on every tick rather
 * than decrementing/incrementing a counter — the same reason the rest timer
 * moved away from a counter-based interval (see activeWorkoutStore). This
 * timer is purely a local, per-row re-render driver (not shared/global
 * state), so even a stray duplicate mount can't double-count anything. */
function useElapsedSeconds(startedAt: number | null): number {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (startedAt == null) return;
    const interval = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return startedAt == null ? 0 : Math.floor((Date.now() - startedAt) / 1000);
}

type WorkoutSetRowProps = {
  setRow: LoggedSet;
  metric: SetMetric;
  onToggle: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<Pick<LoggedSet, 'reps' | 'loadKg' | 'rpe'>>) => void;
  onStartTimer: () => void;
  onStopTimer: () => void;
  /** Present only when this row has a reps/weight value worth copying and at
   * least one later, not-yet-completed set to copy it into — see
   * ActiveExerciseScreen's canFillDown. Copies reps + weight only (not RPE,
   * which naturally varies set to set even at the same reps/weight). */
  onFillDown?: () => void;
};

/** One editable row in the focused exercise screen's set table. Inputs stay
 * editable after completion (business rule: a checked-off set can still be
 * corrected) — only their visual weight steps back so completed sets read
 * as secondary against sets still in progress. */
export function WorkoutSetRow({
  setRow,
  metric,
  onToggle,
  onRemove,
  onChange,
  onStartTimer,
  onStopTimer,
  onFillDown,
}: WorkoutSetRowProps) {
  const theme = useTheme();
  const timerRunning = setRow.timerStartedAt != null;
  const elapsedSeconds = useElapsedSeconds(setRow.timerStartedAt);
  const countdown = useStartCountdown(onStartTimer);

  const repsField = useNumericInputText(setRow.reps, reps => onChange({ reps }), { parse: parseReps });
  const loadField = useNumericInputText(setRow.loadKg, loadKg => onChange({ loadKg }), {
    format: v => formatMetricValue(v, metric),
    parse: t => parseMetricValue(t, metric),
    formatKey: metric,
  });
  const rpeField = useNumericInputText(setRow.rpe, rpe => onChange({ rpe }), { parse: parseRpe });

  // Completing the set (or someone else stopping its timer) while the
  // pre-start countdown is still running should cancel it rather than let it
  // finish and start a timer for a set that's already done.
  useEffect(() => {
    if (setRow.completed) countdown.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setRow.completed]);

  const onPressTimerControl = () => {
    if (timerRunning) {
      onStopTimer();
    } else if (countdown.isCounting) {
      countdown.cancel();
    } else {
      countdown.start();
    }
  };

  const onDeletePress = () => {
    if (!isSetPopulated(setRow)) {
      onRemove();
      return;
    }
    Alert.alert(
      'Delete set?',
      'This set has data — deleting it can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onRemove },
      ],
    );
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        opacity: setRow.completed ? 0.65 : 1,
      }}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: setRow.completed }}
        accessibilityLabel={`Set ${setRow.setNumber} ${setRow.completed ? 'complete' : 'incomplete'}`}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: theme.radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: setRow.completed ? theme.colors.accent.primary : 'transparent',
            borderWidth: setRow.completed ? 0 : 2,
            borderColor: theme.colors.border.default,
          }}
        >
          {setRow.completed ? (
            <Icon name="check" size="sm" color={theme.colors.text.onAccent} strokeWidth={3} />
          ) : null}
        </View>
      </Pressable>
      <Text variant="body" color="secondary" style={{ width: 36 }}>
        {setRow.setNumber}
      </Text>
      <View style={{ flex: 1 }}>
        <TextField
          keyboardType="number-pad"
          value={repsField.text}
          onChangeText={repsField.onChangeText}
          placeholder="Reps"
          selectTextOnFocus
        />
      </View>
      <View style={{ flex: 1 }}>
        {metric === 'time' ? (
          <Pressable
            onPress={onPressTimerControl}
            accessibilityLabel={
              timerRunning ? 'Stop timer' : countdown.isCounting ? 'Cancel countdown' : 'Start timer'
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xxs,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radii.sm,
              backgroundColor:
                timerRunning || countdown.isCounting ? theme.colors.accent.subtle : theme.colors.bg.surface,
            }}
          >
            {countdown.isCounting ? (
              <Text variant="body" style={{ color: theme.colors.accent.primary, fontWeight: '700' }}>
                {countdown.count! > 0 ? countdown.count : 'GO'}
              </Text>
            ) : (
              <>
                <Icon
                  name={timerRunning ? 'pause' : 'timer'}
                  size="sm"
                  color={timerRunning ? theme.colors.accent.primary : theme.colors.text.secondary}
                />
                {timerRunning ? (
                  <Text variant="body" style={{ color: theme.colors.accent.primary, fontWeight: '700' }}>
                    {formatDuration(elapsedSeconds)}
                  </Text>
                ) : (
                  <Text variant="body" color={setRow.durationSeconds != null ? 'primary' : 'secondary'}>
                    {setRow.durationSeconds != null ? formatDuration(setRow.durationSeconds) : 'Start'}
                  </Text>
                )}
              </>
            )}
          </Pressable>
        ) : (
          <TextField
            keyboardType={metric === 'weight_lb' || metric === 'weight_kg' ? 'decimal-pad' : 'numeric'}
            value={loadField.text}
            onChangeText={loadField.onChangeText}
            placeholder={metricPlaceholder(metric)}
            selectTextOnFocus
          />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <TextField
          keyboardType="decimal-pad"
          value={rpeField.text}
          onChangeText={rpeField.onChangeText}
          placeholder="RPE"
          selectTextOnFocus
        />
      </View>
      {onFillDown ? (
        <Pressable
          onPress={onFillDown}
          accessibilityLabel={`Fill remaining sets with set ${setRow.setNumber}'s reps and weight`}
          style={({ pressed }) => [
            { width: 32, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 1 : 0.55 },
          ]}
        >
          <Icon name="copy" size="sm" color={theme.colors.text.secondary} />
        </Pressable>
      ) : (
        // Reserves the fill-down icon's footprint even when this row isn't
        // eligible for it (e.g. the last set, or right after a Fill Down
        // completes the rest) — otherwise the row loses a fixed-width sibling
        // and the flex:1 rep/weight/RPE fields stretch to fill the gap.
        <View style={{ width: 32, height: 44 }} />
      )}
      <Pressable
        onPress={onDeletePress}
        accessibilityLabel={`Remove set ${setRow.setNumber}`}
        style={({ pressed }) => [
          { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 1 : 0.55 },
        ]}
      >
        <Icon name="trash" size="sm" color={theme.colors.semantic.danger} />
      </Pressable>
    </View>
  );
}
