import React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  Button,
  SelectableCard,
  TextField,
  StepProgress,
  KeyboardAvoider,
} from '../../components/core';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useNumericInputText } from '../../hooks/useNumericInputText';
import type { OnboardingStackParamList } from '../../navigation/types';
import type { Sex } from '../../types/database';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'BodyProfile'>;

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

function toDigits(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Body stats — feeds AI-generated summaries that depend on more than just
 * "what did you lift": cardio calorie estimates (weight-driven, see
 * cardioCalories.ts) and, once known, height/sex-aware context elsewhere.
 * Weight is asked in lb here but, like the rest of the app, gets converted
 * and persisted in kg — see useCompleteOnboarding, which is where every
 * onboarding answer (this screen's included) actually gets saved.
 */
export function BodyProfileScreen({ navigation }: Props) {
  const theme = useTheme();
  const {
    sex,
    setSex,
    heightFeet,
    setHeightFeet,
    heightInches,
    setHeightInches,
    weightLb,
    setWeightLb,
  } = useOnboardingStore();

  const heightFeetField = useNumericInputText(heightFeet, setHeightFeet, {
    parse: toDigits,
  });
  const heightInchesField = useNumericInputText(heightInches, setHeightInches, {
    parse: toDigits,
  });
  const weightLbField = useNumericInputText(weightLb, setWeightLb, {
    parse: toDigits,
  });

  const heightValid =
    heightFeet != null &&
    heightFeet > 0 &&
    heightInches != null &&
    heightInches >= 0 &&
    heightInches < 12;
  const canContinue =
    sex != null && heightValid && weightLb != null && weightLb > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <KeyboardAvoider
        keyboardVerticalOffset={Platform.OS === 'ios' ? theme.spacing.xl : 0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            padding: theme.spacing.xl,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={{ gap: theme.spacing.md }}>
            <StepProgress step={2} total={6} />
            <View>
              <Text variant="title">About you</Text>
              <Text variant="body" color="secondary">
                Used to personalize things like calorie estimates on cardio
                days.
              </Text>
            </View>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              SEX
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              {SEX_OPTIONS.map(option => (
                <View key={option.value} style={{ flex: 1 }}>
                  <SelectableCard
                    label={option.label}
                    selected={sex === option.value}
                    onPress={() => setSex(option.value)}
                  />
                </View>
              ))}
            </View>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              HEIGHT
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Feet"
                  keyboardType="number-pad"
                  value={heightFeetField.text}
                  onChangeText={heightFeetField.onChangeText}
                  placeholder="5"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Inches"
                  keyboardType="number-pad"
                  value={heightInchesField.text}
                  onChangeText={heightInchesField.onChangeText}
                  placeholder="10"
                />
              </View>
            </View>
          </View>

          <TextField
            label="Weight (lb)"
            keyboardType="number-pad"
            value={weightLbField.text}
            onChangeText={weightLbField.onChangeText}
            placeholder="165"
          />

          <View style={{ flex: 1, minHeight: theme.spacing.xl }} />

          <Button
            label="Next"
            onPress={() => navigation.navigate('ExperienceLevel')}
            disabled={!canContinue}
          />
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}
