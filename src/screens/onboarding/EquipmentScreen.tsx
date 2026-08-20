import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Button, SelectableCard, StepProgress } from '../../components/core';
import { useOnboardingStore } from '../../store/onboardingStore';
import type { OnboardingStackParamList } from '../../navigation/types';
import type { EquipmentType } from '../../types/database';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Equipment'>;

const OPTIONS: { value: EquipmentType; label: string }[] = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbells' },
  { value: 'machine', label: 'Machines' },
  { value: 'cable', label: 'Cable' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'band', label: 'Resistance Bands' },
  { value: 'bodyweight', label: 'Bodyweight Only' },
];

export function EquipmentScreen({ navigation }: Props) {
  const theme = useTheme();
  const equipment = useOnboardingStore(state => state.equipment);
  const toggleEquipment = useOnboardingStore(state => state.toggleEquipment);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base, padding: theme.spacing.xl, gap: theme.spacing.lg }}
    >
      <View style={{ gap: theme.spacing.md }}>
        <StepProgress step={5} total={6} />
        <View>
          <Text variant="title">Available equipment</Text>
          <Text variant="body" color="secondary">
            Select everything you have access to.
          </Text>
        </View>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        {OPTIONS.map(option => (
          <SelectableCard
            key={option.value}
            label={option.label}
            selected={equipment.includes(option.value)}
            onPress={() => toggleEquipment(option.value)}
          />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <Button
        label="Next"
        onPress={() => navigation.navigate('Injuries')}
        disabled={equipment.length === 0}
      />
    </SafeAreaView>
  );
}
