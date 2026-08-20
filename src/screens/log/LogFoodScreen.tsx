import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  Button,
  Header,
  TextField,
  SegmentedControl,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useCreateFoodLogEntry } from '../../services/api/queries/foodLog';
import type { MealType } from '../../types/database';
import type { RootStackParamList } from '../../navigation/types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;

const MEAL_TYPE_OPTIONS: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

/** Same "guess a sensible default from the clock" instinct as
 * TodayScreen's own greeting(hour) — a reasonable starting point the
 * athlete can still override, not a hard rule. */
function inferMealType(hour: number): MealType {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function parseNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Manual entry — the phase 1 stand-in for photo-based logging via Coach.
 * Same form fields a photo-driven estimate card would need to confirm/edit
 * (name, calories, protein/carbs/fat), just typed in directly instead of
 * arriving from an AI estimate. Phase 2 replaces the entry point, not the
 * data shape this saves.
 */
export function LogFoodScreen() {
  const theme = useTheme();
  const rootNavigation = useNavigation<RootNav>();
  const userId = useAuthStore(state => state.userId);
  const createEntry = useCreateFoodLogEntry(userId);

  const [name, setName] = useState('');
  const [mealType, setMealType] = useState<MealType>(() =>
    inferMealType(new Date().getHours()),
  );
  const [calories, setCalories] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [carbsG, setCarbsG] = useState('');
  const [fatG, setFatG] = useState('');
  const [pendingAction, setPendingAction] = useState<'save' | 'skip' | null>(
    null,
  );

  const caloriesValue = parseNumber(calories);
  const canSave =
    name.trim().length > 0 && caloriesValue != null && caloriesValue >= 0;

  const onSave = async () => {
    if (!canSave || caloriesValue == null) return;
    setPendingAction('save');
    try {
      await createEntry.mutateAsync({
        name: name.trim(),
        meal_type: mealType,
        calories: Math.round(caloriesValue),
        protein_g: parseNumber(proteinG) ?? 0,
        carbs_g: parseNumber(carbsG) ?? 0,
        fat_g: parseNumber(fatG) ?? 0,
      });
      rootNavigation.navigate('MainTabs', {
        screen: 'TodayTab',
        params: { screen: 'Today' },
      });
    } catch (err) {
      Alert.alert(
        'Could not save meal',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setPendingAction(null);
    }
  };

  /** Records that this meal slot was intentionally not eaten (fasting,
   * skipped breakfast, etc.) rather than just never getting logged - a
   * zero-calorie food_log_entries row with status: 'skipped', the same
   * signal Arnold's chat-based skip_meal tool writes. Neither counts toward
   * Home's totals (both stay outside the 'confirmed' filter every totals
   * query uses) but both stop the meal-gap reminder from nagging about it. */
  const onSkip = async () => {
    setPendingAction('skip');
    try {
      const label =
        MEAL_TYPE_OPTIONS.find(option => option.value === mealType)?.label ??
        mealType;
      await createEntry.mutateAsync({
        name: `Skipped ${label}`,
        meal_type: mealType,
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        status: 'skipped',
      });
      rootNavigation.navigate('MainTabs', {
        screen: 'TodayTab',
        params: { screen: 'Today' },
      });
    } catch (err) {
      Alert.alert(
        'Could not skip meal',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Log Food" />
      <KeyboardAvoider>
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={{ gap: theme.spacing.sm }}>
            <TextField
              label="What did you eat?"
              value={name}
              onChangeText={setName}
              placeholder="Grilled chicken rice bowl"
            />
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label" color="secondary">
                MEAL
              </Text>
              <SegmentedControl
                options={MEAL_TYPE_OPTIONS}
                value={mealType}
                onChange={setMealType}
              />
            </View>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              NUTRITION
            </Text>
            <TextField
              label="Calories"
              keyboardType="number-pad"
              value={calories}
              onChangeText={setCalories}
              placeholder="620"
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Protein (g)"
                  keyboardType="number-pad"
                  value={proteinG}
                  onChangeText={setProteinG}
                  placeholder="52"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Carbs (g)"
                  keyboardType="number-pad"
                  value={carbsG}
                  onChangeText={setCarbsG}
                  placeholder="60"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Fat (g)"
                  keyboardType="number-pad"
                  value={fatG}
                  onChangeText={setFatG}
                  placeholder="18"
                />
              </View>
            </View>
          </View>

          <Button
            label="Save Meal"
            onPress={onSave}
            disabled={!canSave || pendingAction != null}
            loading={pendingAction === 'save'}
          />
          <Button
            label="Skip this meal"
            variant="secondary"
            onPress={onSkip}
            disabled={pendingAction != null}
            loading={pendingAction === 'skip'}
          />
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}
