import React from 'react';
import { View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Button, Numeral, StepProgress } from '../../components/core';
import { useOnboardingStore } from '../../store/onboardingStore';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'DaysPerWeek'>;

const OPTIONS = [2, 3, 4, 5, 6];

export function DaysPerWeekScreen({ navigation }: Props) {
  const theme = useTheme();
  const daysPerWeek = useOnboardingStore(state => state.daysPerWeek);
  const setDaysPerWeek = useOnboardingStore(state => state.setDaysPerWeek);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base, padding: theme.spacing.xl, gap: theme.spacing.lg }}
    >
      <View style={{ gap: theme.spacing.md }}>
        <StepProgress step={4} total={6} />
        <View>
          <Text variant="title">Days per week</Text>
          <Text variant="body" color="secondary">
            How many days can you train each week?
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {OPTIONS.map(day => {
          const selected = daysPerWeek === day;
          return (
            <Pressable
              key={day}
              onPress={() => setDaysPerWeek(day)}
              style={{
                width: 56,
                height: 56,
                borderRadius: theme.radii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? theme.colors.accent.primary : theme.colors.bg.surface,
                borderWidth: 1,
                borderColor: selected ? theme.colors.accent.primary : theme.colors.border.subtle,
              }}
            >
              <Numeral value={day} size="md" color={selected ? theme.colors.text.onAccent : undefined} />
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }} />

      <Button
        label="Next"
        onPress={() => navigation.navigate('Equipment')}
        disabled={!daysPerWeek}
      />
    </SafeAreaView>
  );
}
