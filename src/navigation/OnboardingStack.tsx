import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { GoalsScreen } from '../screens/onboarding/GoalsScreen';
import { BodyProfileScreen } from '../screens/onboarding/BodyProfileScreen';
import { ExperienceLevelScreen } from '../screens/onboarding/ExperienceLevelScreen';
import { DaysPerWeekScreen } from '../screens/onboarding/DaysPerWeekScreen';
import { EquipmentScreen } from '../screens/onboarding/EquipmentScreen';
import { InjuriesScreen } from '../screens/onboarding/InjuriesScreen';
import { BuildFirstWeekScreen } from '../screens/onboarding/BuildFirstWeekScreen';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Goals" component={GoalsScreen} />
      <Stack.Screen name="BodyProfile" component={BodyProfileScreen} />
      <Stack.Screen name="ExperienceLevel" component={ExperienceLevelScreen} />
      <Stack.Screen name="DaysPerWeek" component={DaysPerWeekScreen} />
      <Stack.Screen name="Equipment" component={EquipmentScreen} />
      <Stack.Screen name="Injuries" component={InjuriesScreen} />
      <Stack.Screen name="BuildFirstWeek" component={BuildFirstWeekScreen} />
    </Stack.Navigator>
  );
}
