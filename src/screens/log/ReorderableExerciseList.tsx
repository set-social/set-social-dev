import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { WorkoutExerciseRow } from './WorkoutExerciseRow';
import { triggerHaptic } from '../../utils/haptics';
import type { ActiveExercise } from '../../store/activeWorkoutStore';
import type { UnitPreference } from '../../types/database';

/** Used for any row not yet measured (first paint, before its onLayout has
 * fired) so the list has a sane initial height/spacing instead of collapsing
 * to zero. Real rows settle to their true measured height within a frame. */
const DEFAULT_ROW_HEIGHT = 96;
/** How long a row must be held before it starts following the finger — the
 * "hard press to activate" gesture the reorder feature was asked for. */
const LONG_PRESS_MS = 350;

function cumulativeOffsetForSlot(
  orderIds: string[],
  heights: Record<string, number>,
  slot: number,
  gap: number,
) {
  'worklet';
  let y = 0;
  for (let i = 0; i < slot; i++) {
    y += (heights[orderIds[i]] ?? DEFAULT_ROW_HEIGHT) + gap;
  }
  return y;
}

/** Which slot a dragged row's current vertical center falls into, given the
 * other rows' resting offsets — i.e. which neighbor it's about to swap past. */
function slotForCenterY(
  orderIds: string[],
  heights: Record<string, number>,
  gap: number,
  centerY: number,
) {
  'worklet';
  let y = 0;
  for (let i = 0; i < orderIds.length; i++) {
    const h = heights[orderIds[i]] ?? DEFAULT_ROW_HEIGHT;
    if (centerY < y + h) return i;
    y += h + gap;
  }
  return orderIds.length - 1;
}

type DraggableRowProps = {
  exercise: ActiveExercise;
  order: number;
  isNext: boolean;
  unitPref: UnitPreference;
  onNavigate: (exerciseId: string) => void;
  gap: number;
  orderSV: SharedValue<string[]>;
  heightsSV: SharedValue<Record<string, number>>;
  draggingIdSV: SharedValue<string | null>;
  onMeasured: (exerciseId: string, height: number) => void;
  onDropped: (finalOrder: string[]) => void;
};

function DraggableRow({
  exercise,
  order,
  isNext,
  unitPref,
  onNavigate,
  gap,
  orderSV,
  heightsSV,
  draggingIdSV,
  onMeasured,
  onDropped,
}: DraggableRowProps) {
  const id = exercise.exerciseId;
  const [isDragging, setIsDragging] = useState(false);
  const startOffsetY = useSharedValue(0);
  const translateY = useSharedValue(
    cumulativeOffsetForSlot(orderSV.value, heightsSV.value, orderSV.value.indexOf(id), gap),
  );

  // Everyone but the row actively being dragged: whenever the visual order
  // (or a sibling's measured height) changes their target slot, ease into
  // it. The dragged row's own translateY is driven directly by the gesture
  // below instead, so it's excluded here.
  useAnimatedReaction(
    () => {
      if (draggingIdSV.value === id) return null;
      const slot = orderSV.value.indexOf(id);
      return slot === -1 ? null : cumulativeOffsetForSlot(orderSV.value, heightsSV.value, slot, gap);
    },
    (next, prev) => {
      if (next != null && next !== prev) {
        translateY.value = withTiming(next, { duration: 220 });
      }
    },
  );

  const pan = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      const slot = orderSV.value.indexOf(id);
      startOffsetY.value = cumulativeOffsetForSlot(orderSV.value, heightsSV.value, slot, gap);
      translateY.value = startOffsetY.value;
      draggingIdSV.value = id;
      runOnJS(triggerHaptic)('impactMedium');
      runOnJS(setIsDragging)(true);
    })
    .onUpdate(event => {
      translateY.value = startOffsetY.value + event.translationY;
      const height = heightsSV.value[id] ?? DEFAULT_ROW_HEIGHT;
      const center = translateY.value + height / 2;
      const newSlot = slotForCenterY(orderSV.value, heightsSV.value, gap, center);
      const curSlot = orderSV.value.indexOf(id);
      if (newSlot !== curSlot) {
        const next = [...orderSV.value];
        next.splice(curSlot, 1);
        next.splice(newSlot, 0, id);
        orderSV.value = next;
      }
    })
    .onEnd(() => {
      const slot = orderSV.value.indexOf(id);
      translateY.value = withTiming(cumulativeOffsetForSlot(orderSV.value, heightsSV.value, slot, gap), {
        duration: 220,
      });
      draggingIdSV.value = null;
      runOnJS(setIsDragging)(false);
      runOnJS(onDropped)(orderSV.value.slice());
    })
    .onFinalize(() => {
      // Safety net for a cancelled gesture (e.g. an OS-level interruption
      // mid-drag) — without this, draggingIdSV could stay pointed at this
      // row forever, freezing every other row's own reaction above.
      if (draggingIdSV.value === id) {
        draggingIdSV.value = null;
        runOnJS(setIsDragging)(false);
      }
    });

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    transform: [{ translateY: translateY.value }],
    zIndex: draggingIdSV.value === id ? 10 : 1,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style} onLayout={(e: LayoutChangeEvent) => onMeasured(id, e.nativeEvent.layout.height)}>
        <WorkoutExerciseRow
          exercise={exercise}
          order={order}
          isNext={isNext}
          unitPref={unitPref}
          onNavigate={onNavigate}
          isDragging={isDragging}
        />
      </Animated.View>
    </GestureDetector>
  );
}

type ReorderableExerciseListProps = {
  exercises: ActiveExercise[];
  nextExerciseId: string | null;
  unitPref: UnitPreference;
  onNavigate: (exerciseId: string) => void;
  onReorder: (exercises: ActiveExercise[]) => void;
};

/** Absolutely-positions every exercise row inside a fixed-height container
 * and drives each one's vertical offset from a single shared "visual order"
 * array — rather than actually reordering React children — so a drag never
 * has to survive a JS re-render mid-gesture (the gesture is only ever
 * recreated between drags, never during one). Holding a row past
 * LONG_PRESS_MS picks it up (with a haptic tap); dragging it past a
 * neighbor's midpoint swaps them live; releasing commits the new order back
 * to the active workout store. Meant to sit inside the overview screen's
 * existing ScrollView, exactly where the plain exercise list used to be. */
export function ReorderableExerciseList({
  exercises,
  nextExerciseId,
  unitPref,
  onNavigate,
  onReorder,
}: ReorderableExerciseListProps) {
  const theme = useTheme();
  const gap = theme.spacing.sm;

  const orderSV = useSharedValue<string[]>(exercises.map(e => e.exerciseId));
  const heightsSV = useSharedValue<Record<string, number>>({});
  const draggingIdSV = useSharedValue<string | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;

  // Resyncs the shared visual order whenever the underlying exercise set
  // changes for a reason other than this list's own drag-to-reorder (an
  // exercise added/removed/substituted, or a fresh workout start) — guarded
  // so an in-flight drag's optimistic order is never clobbered mid-gesture.
  useEffect(() => {
    if (draggingIdSV.value != null) return;
    const ids = exercises.map(e => e.exerciseId);
    const current = orderSV.value;
    const same = current.length === ids.length && current.every((id, i) => id === ids[i]);
    if (!same) orderSV.value = ids;
  }, [exercises, orderSV, draggingIdSV]);

  const handleMeasured = useCallback(
    (id: string, height: number) => {
      heightsSV.value = { ...heightsSV.value, [id]: height };
      setHeights(prev => (prev[id] === height ? prev : { ...prev, [id]: height }));
    },
    [heightsSV],
  );

  const handleDropped = useCallback(
    (finalOrderIds: string[]) => {
      const byId = new Map(exercisesRef.current.map(e => [e.exerciseId, e]));
      const reordered = finalOrderIds.map(id => byId.get(id)).filter((e): e is ActiveExercise => e != null);
      // Guards a drop landing right as an unrelated store change came in (an
      // exercise added/removed mid-drag) — falls back to the current store
      // order rather than silently dropping an exercise.
      onReorder(reordered.length === exercisesRef.current.length ? reordered : exercisesRef.current);
    },
    [onReorder],
  );

  const totalHeight = useMemo(
    () =>
      exercises.reduce((sum, e) => sum + (heights[e.exerciseId] ?? DEFAULT_ROW_HEIGHT), 0) +
      gap * Math.max(0, exercises.length - 1),
    [exercises, heights, gap],
  );

  return (
    // The app root (App.tsx) already provides one GestureHandlerRootView,
    // but this component needs to render standalone in isolated screen
    // tests too — same self-contained approach AvatarPositionScreen already
    // uses for its own Gesture.Pan(). Nested roots are harmless.
    <GestureHandlerRootView style={{ height: totalHeight }}>
      {exercises.map((exercise, index) => (
        <DraggableRow
          key={exercise.exerciseId}
          exercise={exercise}
          order={index + 1}
          isNext={exercise.exerciseId === nextExerciseId}
          unitPref={unitPref}
          onNavigate={onNavigate}
          gap={gap}
          orderSV={orderSV}
          heightsSV={heightsSV}
          draggingIdSV={draggingIdSV}
          onMeasured={handleMeasured}
          onDropped={handleDropped}
        />
      ))}
    </GestureHandlerRootView>
  );
}
