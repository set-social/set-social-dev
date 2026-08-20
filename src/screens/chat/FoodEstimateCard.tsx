import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTheme, type Theme } from '../../theme/ThemeProvider';
import { Text, Icon, IconButton, Button, TextField, Numeral, LoadingState } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useFoodLogEntry, useUpdateFoodLogEntry, useDeleteFoodLogEntry } from '../../services/api/queries/foodLog';
import type { FoodLogConfidence } from '../../types/database';

const CONFIDENCE_LABEL: Record<FoodLogConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

function confidenceColor(theme: Theme, confidence: FoodLogConfidence | null): string {
  if (confidence === 'high') return theme.colors.semantic.success;
  if (confidence === 'medium') return theme.colors.semantic.warning;
  if (confidence === 'low') return theme.colors.semantic.danger;
  return theme.colors.text.tertiary;
}

type Draft = { name: string; calories: string; protein_g: string; carbs_g: string; fat_g: string };

function draftFromEntry(entry: { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }): Draft {
  return {
    name: entry.name,
    calories: String(entry.calories),
    protein_g: String(entry.protein_g),
    carbs_g: String(entry.carbs_g),
    fat_g: String(entry.fat_g),
  };
}

/**
 * Renders in place of a plain chat bubble whenever a chat_messages row
 * carries a food_log_entry_id — see chat-coach's log_food_estimate tool and
 * ChatBubble's branch in ChatScreen.tsx. `status: 'pending'` shows
 * Discard/Edit/Confirm and never counts toward Home's energy totals
 * (EnergyTodayCard only reads status='confirmed' rows); confirming and
 * editing are plain client-side updates against the same row, no second
 * model round-trip needed since the athlete is only correcting numbers
 * already in front of them. Discard is the one case that leaves the row
 * behind entirely — a wrong AI guess the athlete never wants counted, with
 * no edit worth making first. Already-confirmed entries (the read-only
 * branch below) are edited/deleted from Home's EnergyTodayCard instead —
 * this card doesn't manage entries once they're in the log.
 */
export function FoodEstimateCard({ foodLogEntryId }: { foodLogEntryId: string }) {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const { data: entry, isLoading } = useFoodLogEntry(foodLogEntryId);
  const updateEntry = useUpdateFoodLogEntry(userId);
  const deleteEntry = useDeleteFoodLogEntry(userId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Set the instant Discard is confirmed, before the mutation even settles —
  // once the row is gone, useFoodLogEntry's refetch (triggered by
  // useDeleteFoodLogEntry's own invalidateQueries) hits `.single()` against
  // zero rows and goes into an error state forever, not back to `data: null`.
  // Short-circuiting on local state here means this card never has to
  // render (or get stuck in) that error state at all.
  const [discarded, setDiscarded] = useState(false);

  if (discarded) {
    return (
      <View style={{ minWidth: 220, padding: theme.spacing.md }}>
        <Text variant="caption" color="secondary">
          Estimate discarded.
        </Text>
      </View>
    );
  }

  if (isLoading || !entry) {
    return (
      <View style={{ minWidth: 220, padding: theme.spacing.md }}>
        <LoadingState fill={false} />
      </View>
    );
  }

  const startEditing = () => {
    setDraft(draftFromEntry(entry));
    setEditing(true);
  };

  const onDoneEditing = () => {
    if (!draft) return;
    updateEntry.mutate({
      id: entry.id,
      name: draft.name.trim() || entry.name,
      calories: Math.max(0, Math.round(Number(draft.calories) || 0)),
      protein_g: Math.max(0, Number(draft.protein_g) || 0),
      carbs_g: Math.max(0, Number(draft.carbs_g) || 0),
      fat_g: Math.max(0, Number(draft.fat_g) || 0),
    });
    setEditing(false);
    setDraft(null);
  };

  const onConfirm = () => updateEntry.mutate({ id: entry.id, status: 'confirmed' });

  const onDiscard = () => {
    Alert.alert('Discard this estimate?', "This draft won't be logged.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setDiscarded(true);
          deleteEntry.mutate(entry.id);
        },
      },
    ]);
  };

  const cardStyle = {
    backgroundColor: theme.colors.bg.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.subtle,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    minWidth: 240,
  };

  if (entry.status === 'confirmed') {
    return (
      <View style={cardStyle}>
        <Text variant="subtitle">{entry.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
          <Icon name="circleCheck" size="sm" color={theme.colors.accent.primary} />
          <Text variant="caption" color="secondary">
            Logged · {entry.calories} cal · {Math.round(entry.protein_g)}p / {Math.round(entry.carbs_g)}c / {Math.round(entry.fat_g)}f
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={cardStyle}>
      {editing && draft ? (
        <TextField value={draft.name} onChangeText={name => setDraft({ ...draft, name })} />
      ) : (
        <View style={{ gap: theme.spacing.xxs }}>
          <Text variant="subtitle">{entry.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
            <View
              style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: confidenceColor(theme, entry.confidence) }}
            />
            <Text variant="label" style={{ color: confidenceColor(theme, entry.confidence) }}>
              {(entry.confidence ? CONFIDENCE_LABEL[entry.confidence] : 'Estimate').toUpperCase()}
            </Text>
          </View>
        </View>
      )}

      {editing && draft ? (
        <View style={{ gap: theme.spacing.sm }}>
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
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
          <Numeral value={entry.calories} size="lg" />
          <Text variant="caption" color="secondary" style={{ paddingBottom: 4 }}>
            cal · {Math.round(entry.protein_g)}p / {Math.round(entry.carbs_g)}c / {Math.round(entry.fat_g)}f
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        {editing ? (
          <View style={{ flex: 1 }}>
            <Button label="Done editing" onPress={onDoneEditing} loading={updateEntry.isPending} />
          </View>
        ) : (
          <>
            <IconButton
              name="trash"
              variant="ghost"
              accessibilityLabel="Discard this estimate"
              onPress={onDiscard}
              disabled={deleteEntry.isPending}
            />
            <Button label="Edit" variant="ghost" size="sm" onPress={startEditing} />
            <View style={{ flex: 1 }}>
              <Button label="Looks good" size="sm" onPress={onConfirm} loading={updateEntry.isPending} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}
