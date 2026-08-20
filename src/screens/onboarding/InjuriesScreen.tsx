import React, { useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  Button,
  TextField,
  StepProgress,
  KeyboardAvoider,
} from '../../components/core';
import { useOnboardingStore } from '../../store/onboardingStore';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Injuries'>;

export function InjuriesScreen({ navigation }: Props) {
  const theme = useTheme();
  const {
    sex,
    heightFeet,
    heightInches,
    weightLb,
    goal,
    experienceLevel,
    daysPerWeek,
    injuriesNotes,
    setInjuriesNotes,
  } = useOnboardingStore();
  const [error, setError] = useState<string | null>(null);

  // Saving the profile and deciding whether to generate a first week now
  // happens on BuildFirstWeekScreen — this screen only validates that every
  // earlier answer is present before handing off.
  const onNext = () => {
    if (
      !goal ||
      !experienceLevel ||
      !daysPerWeek ||
      sex == null ||
      heightFeet == null ||
      heightInches == null ||
      weightLb == null
    ) {
      setError(
        'Missing onboarding answers — please go back and complete every step.',
      );
      return;
    }
    setError(null);
    navigation.navigate('BuildFirstWeek');
  };

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
            <StepProgress step={6} total={6} />
            <View>
              <Text variant="title">Any injuries or limitations?</Text>
              <Text variant="body" color="secondary">
                Optional — Arnold will work around these.
              </Text>
            </View>
          </View>

          <TextField
            value={injuriesNotes}
            onChangeText={setInjuriesNotes}
            placeholder="e.g. cranky left shoulder, avoid overhead pressing"
            multiline
            numberOfLines={4}
            blurOnSubmit
            returnKeyType="done"
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />

          {error ? (
            <Text
              variant="caption"
              style={{ color: theme.colors.semantic.danger }}
            >
              {error}
            </Text>
          ) : null}

          <View style={{ flex: 1, minHeight: theme.spacing.xl }} />

          <Button label="Next" onPress={onNext} />
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}
