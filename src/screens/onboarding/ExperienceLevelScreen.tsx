import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Button, SelectableCard, StepProgress } from '../../components/core';
import { useOnboardingStore } from '../../store/onboardingStore';
import type { OnboardingStackParamList } from '../../navigation/types';
import type { ExperienceLevel } from '../../types/database';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'ExperienceLevel'>;

const OPTIONS: { value: ExperienceLevel; label: string; description: string }[] = [
  { value: 'beginner', label: 'Beginner', description: 'New to structured training, or under a year.' },
  { value: 'intermediate', label: 'Intermediate', description: '1-3 years of consistent training.' },
  { value: 'advanced', label: 'Advanced', description: '3+ years, comfortable with heavy loads.' },
];

export function ExperienceLevelScreen({ navigation }: Props) {
  const theme = useTheme();
  const experienceLevel = useOnboardingStore(state => state.experienceLevel);
  const setExperienceLevel = useOnboardingStore(state => state.setExperienceLevel);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base, padding: theme.spacing.xl, gap: theme.spacing.lg }}
    >
      <View style={{ gap: theme.spacing.md }}>
        <StepProgress step={3} total={6} />
        <Text variant="title">Experience level</Text>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        {OPTIONS.map(option => (
          <SelectableCard
            key={option.value}
            label={option.label}
            description={option.description}
            selected={experienceLevel === option.value}
            onPress={() => setExperienceLevel(option.value)}
          />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <Button
        label="Next"
        onPress={() => navigation.navigate('DaysPerWeek')}
        disabled={!experienceLevel}
      />
    </SafeAreaView>
  );
}
