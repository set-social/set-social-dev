import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProgressStackParamList } from './types';
import { ProgressDashboardScreen } from '../screens/progress/ProgressDashboardScreen';
import { PRDetailScreen } from '../screens/progress/PRDetailScreen';
import { BodyMetricsScreen } from '../screens/progress/BodyMetricsScreen';
import { ProgressTimelineScreen } from '../screens/progress/ProgressTimelineScreen';
import { CoachingHistoryScreen } from '../screens/progress/CoachingHistoryScreen';
import { CoachingSummaryDetailScreen } from '../screens/progress/CoachingSummaryDetailScreen';

const Stack = createNativeStackNavigator<ProgressStackParamList>();

export function ProgressStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProgressDashboard" component={ProgressDashboardScreen} />
      <Stack.Screen name="PRDetail" component={PRDetailScreen} />
      <Stack.Screen name="BodyMetrics" component={BodyMetricsScreen} />
      <Stack.Screen name="ProgressTimeline" component={ProgressTimelineScreen} />
      <Stack.Screen name="CoachingHistory" component={CoachingHistoryScreen} />
      <Stack.Screen name="CoachingSummaryDetail" component={CoachingSummaryDetailScreen} />
    </Stack.Navigator>
  );
}
