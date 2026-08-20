import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TodayStackParamList } from './types';
import { TodayScreen } from '../screens/home/TodayScreen';
import { ProgramDetailScreen } from '../screens/programs/ProgramDetailScreen';
import { DayDetailScreen } from '../screens/programs/DayDetailScreen';
import { ExerciseDetailScreen } from '../screens/exercises/ExerciseDetailScreen';
import { TrainingDayDetailScreen } from '../screens/programs/TrainingDayDetailScreen';
import { LogFoodScreen } from '../screens/log/LogFoodScreen';

const Stack = createNativeStackNavigator<TodayStackParamList>();

export function TodayStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Today" component={TodayScreen} />
      <Stack.Screen name="ProgramDetail" component={ProgramDetailScreen} />
      <Stack.Screen name="DayDetail" component={DayDetailScreen} />
      <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} />
      <Stack.Screen name="TrainingDayDetail" component={TrainingDayDetailScreen} />
      <Stack.Screen name="LogFood" component={LogFoodScreen} options={{ presentation: 'fullScreenModal' }} />
    </Stack.Navigator>
  );
}
