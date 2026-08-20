import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Card,
  Text,
  Icon,
  IconButton,
  Button,
  BottomSheet,
  ListRow,
  TextField,
  EmptyState,
  Numeral,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useUpdateFoodLogEntry, useDeleteFoodLogEntry } from '../../services/api/queries/foodLog';
import type { NutritionGoal } from '../../types/database';
import type { DailyEnergyTotals } from '../../utils/energyBalance';

export type EnergyTodayEntry = {
  id: string;
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type MacroTargets = {
  proteinTargetG: number;
  carbsTargetG: number;
  fatTargetG: number;
};

type EnergyTodayCardProps = {
  entries: EnergyTodayEntry[];
  totals: DailyEnergyTotals;
  goal: NutritionGoal;
  macroTargets: MacroTargets;
  /** Composed by coachingEngine.generateEnergySummary — this card only
   * renders it, same "engine composes, screen renders" split AiSummaryCard
   * already uses for todayFocusSummary. Only ever shown for `isSelectedToday`
   * — the copy is worded as live "today" commentary ("you're at a X cal
   * deficit today"), which reads wrong against a browsed past date's
   * numbers, so the card itself suppresses it rather than trusting callers
   * to pass an empty string. */
  insightHeadline: string;
  insightBody: string;
  onLogMeal: () => void;
  /** Same WeekTimeline-driven browsing CompletedWorkoutCard already supports
   * (selectedDate/isSelectedToday) — entries/totals/macros always reflect
   * whichever date is selected, so this card works identically whether
   * "today" or a past date is browsed. */
  selectedDate: Date;
  isSelectedToday: boolean;
};

const GOAL_PILL_LABEL: Record<NutritionGoal, string> = {
  cut: 'Cutting',
  bulk: 'Bulking',
  maintain: 'Maintaining',
};

const FLIP_DURATION = 350;

function formatSigned(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toLocaleString()}`;
}

type EntryDraft = { name: string; calories: string; protein_g: string; carbs_g: string; fat_g: string };

// Same shape/rounding convention as FoodEstimateCard's own draftFromEntry —
// two independent editors of the same table, kept consistent rather than
// shared, since one edits a still-pending AI estimate and this one edits an
// already-confirmed entry.
function draftFromEntry(entry: EnergyTodayEntry): EntryDraft {
  return {
    name: entry.name,
    calories: String(entry.calories),
    protein_g: String(entry.protein_g),
    carbs_g: String(entry.carbs_g),
    fat_g: String(entry.fat_g),
  };
}

function MacroBar({
  label,
  value,
  target,
  color,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
}) {
  const theme = useTheme();
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <View style={{ gap: theme.spacing.xxs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" color="secondary">
          {label}
        </Text>
        <Text variant="caption" style={{ fontWeight: '700' }}>
          {Math.round(value)}g / {Math.round(target)}g
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: theme.radii.xs,
          backgroundColor: theme.colors.bg.surfaceElevated,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: theme.radii.xs,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

/**
 * Home's daily energy-balance card — merges the running In/Out numbers and
 * macros into one glanceable face, the same consolidation VitalsTile uses
 * for weight/consistency/streak (now folded into MoreForYouCard). Plain
 * `Card`, not `AiCard`'s corner-bloom treatment: most of this card is raw
 * data, not AI-synthesized content, so only the one composed insight line
 * gets an accent marker rather than the whole card.
 *
 * A literal flip card once there's anything logged — front is the
 * at-a-glance summary above, back is every food item logged that day,
 * untruncated. Same mechanic as CompletedWorkoutCard (see that file's own
 * comment for the full rationale): one shared rotateY Animated.Value, the
 * "settled" (normal-flow) face swapped exactly at the 90° crossing point so
 * the height change happens while nothing is visible, front height pinned
 * so the back face scrolls internally instead of growing the card. The
 * empty state (nothing logged) stays a single plain face — there's nothing
 * to flip to.
 */
export function EnergyTodayCard({
  entries,
  totals,
  goal,
  macroTargets,
  insightHeadline,
  insightBody,
  onLogMeal,
  selectedDate,
  isSelectedToday,
}: EnergyTodayCardProps) {
  const theme = useTheme();
  const hasEntries = entries.length > 0;

  const userId = useAuthStore(state => state.userId);
  const updateEntry = useUpdateFoodLogEntry(userId);
  const deleteEntry = useDeleteFoodLogEntry(userId);
  const [editingEntry, setEditingEntry] = useState<EnergyTodayEntry | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);

  const startEditing = (entry: EnergyTodayEntry) => {
    setEditingEntry(entry);
    setDraft(draftFromEntry(entry));
  };

  const onSaveEdit = () => {
    if (!editingEntry || !draft) return;
    updateEntry.mutate({
      id: editingEntry.id,
      name: draft.name.trim() || editingEntry.name,
      calories: Math.max(0, Math.round(Number(draft.calories) || 0)),
      protein_g: Math.max(0, Number(draft.protein_g) || 0),
      carbs_g: Math.max(0, Number(draft.carbs_g) || 0),
      fat_g: Math.max(0, Number(draft.fat_g) || 0),
    });
    setEditingEntry(null);
    setDraft(null);
  };

  // Lives inside the edit sheet rather than as its own control on the row —
  // a prior version put a trash icon directly on each row, flush against
  // the card's right edge, which sat close enough to a since-retired
  // edge-docked Arnold tab that a tap meant to delete a food entry could
  // land on Arnold's tab instead and open chat. Arnold now lives in the
  // main tab bar instead (see MainTabs/ArnoldTabButton) and no longer sits
  // as a floating overlay anywhere, but the edit sheet stays a Modal
  // regardless — it renders in its own layer above the whole app, so
  // there's no touch target to collide with in here no matter what else is
  // on screen.
  const onDeleteFromSheet = () => {
    const entry = editingEntry;
    if (!entry) return;
    setEditingEntry(null);
    setDraft(null);
    Alert.alert('Delete this entry?', `"${entry.name}" will be removed from your log. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteEntry.mutate(entry.id) },
    ]);
  };

  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [targetIsBack, setTargetIsBack] = useState(false);
  const [settledIsBack, setSettledIsBack] = useState(false);
  const [cardHeight, setCardHeight] = useState<number>();
  const targetIsBackRef = useRef(targetIsBack);
  const prevValueRef = useRef(0);

  // Pinned to the front face's natural height so the back face — whose
  // content length depends on how many meals were logged — scrolls
  // internally instead of growing the card past where the front face sat.
  const onFrontLayout = (e: LayoutChangeEvent) =>
    setCardHeight(e.nativeEvent.layout.height);

  useEffect(() => {
    const id = rotateAnim.addListener(({ value }) => {
      const prev = prevValueRef.current;
      if ((prev < 90 && value >= 90) || (prev > 90 && value <= 90)) {
        setSettledIsBack(targetIsBackRef.current);
      }
      prevValueRef.current = value;
    });
    return () => rotateAnim.removeListener(id);
  }, [rotateAnim]);

  const toggleFlip = () => {
    const next = !targetIsBack;
    targetIsBackRef.current = next;
    setTargetIsBack(next);
    Animated.timing(rotateAnim, {
      toValue: next ? 180 : 0,
      duration: FLIP_DURATION,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => setSettledIsBack(targetIsBackRef.current));
  };

  const frontRotateY = rotateAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });
  const backRotateY = rotateAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const titleRow = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text variant="subtitle">
        {isSelectedToday
          ? 'Energy today'
          : `Energy · ${format(selectedDate, 'EEE, MMM d')}`}
      </Text>
      <View
        style={{
          backgroundColor: theme.colors.accent.subtle,
          borderRadius: theme.radii.pill,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xxs,
        }}
      >
        <Text variant="label" style={{ color: theme.colors.accent.primary }}>
          {GOAL_PILL_LABEL[goal].toUpperCase()}
        </Text>
      </View>
    </View>
  );

  const insightRow =
    isSelectedToday && (insightHeadline || insightBody) ? (
      <View
        style={{
          flexDirection: 'row',
          gap: theme.spacing.xs,
          alignItems: 'flex-start',
        }}
      >
        <Icon name="zap" size="sm" color={theme.colors.accent.purple} />
        <View style={{ flex: 1 }}>
          {insightHeadline ? (
            <Text variant="body" style={{ fontWeight: '700' }}>
              {insightHeadline}
            </Text>
          ) : null}
          {insightBody ? (
            <Text variant="caption" color="secondary">
              {insightBody}
            </Text>
          ) : null}
        </View>
      </View>
    ) : null;

  if (!hasEntries) {
    return (
      <Card variant="elevated" style={{ gap: theme.spacing.md }}>
        {titleRow}
        {insightRow}
        <EmptyState
          icon="flame"
          title={
            isSelectedToday
              ? 'Nothing logged yet today'
              : 'Nothing logged that day'
          }
          description={
            isSelectedToday
              ? "Log your next meal and I'll track the rest."
              : 'No meals were logged on this day.'
          }
          actionLabel={isSelectedToday ? 'Log a meal' : undefined}
          onAction={isSelectedToday ? onLogMeal : undefined}
        />
      </Card>
    );
  }

  const renderFace = (isBack: boolean, overlay: boolean) => (
    <Animated.View
      style={[
        {
          transform: [
            { perspective: 1000 },
            { rotateY: isBack ? backRotateY : frontRotateY },
          ],
          backfaceVisibility: 'hidden',
        },
        overlay ? { position: 'absolute', top: 0, left: 0, right: 0 } : null,
      ]}
      onLayout={isBack ? undefined : onFrontLayout}
    >
      {isBack ? (
        <Card
          variant="elevated"
          style={{ height: cardHeight, gap: theme.spacing.md }}
        >
          {/* Only the header is the flip-back tap target — wrapping the whole
              card (including the ScrollView below) eats the vertical pan
              gesture before the ScrollView's native scroll can claim it,
              same reason CompletedWorkoutCard's back face works this way. */}
          <Pressable
            onPress={toggleFlip}
            accessibilityRole="button"
            accessibilityLabel="Flip back to summary"
            hitSlop={8}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginHorizontal: -theme.spacing.md,
                marginTop: -theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text variant="subtitle">Food logged</Text>
            <Icon
              name="rotateCcw"
              size="sm"
              color={theme.colors.text.secondary}
            />
          </Pressable>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: theme.spacing.xxs }}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
          >
            {entries.map((entry, index) => (
              <ListRow
                key={entry.id}
                icon="flame"
                title={entry.name}
                subtitle={`${Math.round(entry.protein_g)}p / ${Math.round(entry.carbs_g)}c / ${Math.round(entry.fat_g)}f`}
                trailing={
                  <Text variant="body" style={{ fontWeight: '700' }}>
                    {entry.calories}
                  </Text>
                }
                onPress={() => startEditing(entry)}
                style={
                  index > 0
                    ? { borderTopWidth: 1, borderTopColor: theme.colors.border.subtle }
                    : undefined
                }
              />
            ))}
          </ScrollView>
          {isSelectedToday ? (
            <Button
              label="Log a meal"
              variant="secondary"
              icon="plusCircle"
              onPress={onLogMeal}
            />
          ) : null}
        </Card>
      ) : (
        <Pressable
          onPress={toggleFlip}
          accessibilityRole="button"
          accessibilityLabel="Flip to see everything logged"
        >
          <Card variant="elevated" style={{ gap: theme.spacing.md }}>
            {titleRow}
            {insightRow}

            <View>
              <Numeral
                value={formatSigned(totals.net)}
                size="xl"
                color={
                  totals.net <= 0
                    ? theme.colors.accent.primary
                    : theme.colors.accent.orange
                }
              />
              <Text variant="caption" color="tertiary">
                {isSelectedToday
                  ? 'Net today'
                  : `Net ${format(selectedDate, 'EEEE')}`}{' '}
                · In {totals.caloriesIn.toLocaleString()}
              </Text>
              <Text variant="caption" color="tertiary">
                Resting {totals.baseOut.toLocaleString()} · Workout{' '}
                {totals.workoutOut.toLocaleString()}
              </Text>
              {!totals.hasEnoughProfileData ? (
                <Text
                  variant="caption"
                  color="tertiary"
                  style={{ marginTop: theme.spacing.xxs }}
                >
                  Using an estimated baseline — add your height, weight, age and
                  sex in Stats → Body Metrics for a more accurate number.
                </Text>
              ) : null}
            </View>

            <View style={{ gap: theme.spacing.sm }}>
              <MacroBar
                label="Protein"
                value={totals.proteinG}
                target={macroTargets.proteinTargetG}
                color={theme.colors.accent.blue}
              />
              <MacroBar
                label="Carbs"
                value={totals.carbsG}
                target={macroTargets.carbsTargetG}
                color={theme.colors.accent.teal}
              />
              <MacroBar
                label="Fat"
                value={totals.fatG}
                target={macroTargets.fatTargetG}
                color={theme.colors.accent.orange}
              />
            </View>

            <Text
              variant="caption"
              color="tertiary"
              style={{ textAlign: 'center' }}
            >
              Tap to see everything logged
            </Text>
          </Card>
        </Pressable>
      )}
    </Animated.View>
  );

  // Each face keeps one fixed isBack value for its entire mounted lifetime —
  // see CompletedWorkoutCard's identical comment for why (avoids a
  // mid-flight flicker from reassigning which interpolation drives a node).
  const showFront = !settledIsBack || !targetIsBack;
  const showBack = settledIsBack || targetIsBack;

  return (
    <>
      <View style={{ position: 'relative' }}>
        {showFront ? renderFace(false, settledIsBack) : null}
        {showBack ? renderFace(true, !settledIsBack) : null}
      </View>

      <BottomSheet
        visible={editingEntry != null}
        onClose={() => {
          setEditingEntry(null);
          setDraft(null);
        }}
        title="Edit entry"
      >
        {draft ? (
          <View style={{ gap: theme.spacing.sm }}>
            <TextField label="Name" value={draft.name} onChangeText={name => setDraft({ ...draft, name })} />
            <TextField
              label="Calories"
              keyboardType="number-pad"
              value={draft.calories}
              onChangeText={calories => setDraft({ ...draft, calories })}
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Protein (g)"
                  keyboardType="number-pad"
                  value={draft.protein_g}
                  onChangeText={protein_g => setDraft({ ...draft, protein_g })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Carbs (g)"
                  keyboardType="number-pad"
                  value={draft.carbs_g}
                  onChangeText={carbs_g => setDraft({ ...draft, carbs_g })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Fat (g)"
                  keyboardType="number-pad"
                  value={draft.fat_g}
                  onChangeText={fat_g => setDraft({ ...draft, fat_g })}
                />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <IconButton
                name="trash"
                variant="ghost"
                color={theme.colors.semantic.danger}
                accessibilityLabel="Delete this entry"
                onPress={onDeleteFromSheet}
                disabled={deleteEntry.isPending}
              />
              <View style={{ flex: 1 }}>
                <Button label="Save changes" onPress={onSaveEdit} loading={updateEntry.isPending} />
              </View>
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </>
  );
}
