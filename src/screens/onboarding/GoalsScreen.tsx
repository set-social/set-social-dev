import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Button, SelectableCard, StepProgress } from '../../components/core';
import { useOnboardingStore } from '../../store/onboardingStore';
import type { OnboardingStackParamList } from '../../navigation/types';
import type { TrainingGoal } from '../../types/database';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Goals'>;

const OPTIONS: { value: TrainingGoal; label: string; description: string }[] = [
  { value: 'strength', label: 'Strength', description: 'Get as strong as possible on key lifts.' },
  { value: 'hypertrophy', label: 'Hypertrophy', description: 'Build muscle size.' },
  { value: 'endurance', label: 'Endurance', description: 'Improve stamina and conditioning.' },
  { value: 'general_fitness', label: 'General Fitness', description: 'A balanced, sustainable routine.' },
];

export function GoalsScreen({ navigation }: Props) {
  const theme = useTheme();
  const goal = useOnboardingStore(state => state.goal);
  const setGoal = useOnboardingStore(state => state.setGoal);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base, padding: theme.spacing.xl, gap: theme.spacing.lg }}
    >
      <View style={{ gap: theme.spacing.md }}>
        <StepProgress step={1} total={6} />
        <Text variant="title">What's your goal?</Text>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        {OPTIONS.map(option => (
          <SelectableCard
            key={option.value}
            label={option.label}
            description={option.description}
            selected={goal === option.value}
            onPress={() => setGoal(option.value)}
          />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <Button label="Next" onPress={() => navigation.navigate('BodyProfile')} disabled={!goal} />
    </SafeAreaView>
  );
}
