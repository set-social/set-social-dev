import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProgramsStackParamList } from './types';
import { CalendarScreen } from '../screens/programs/CalendarScreen';
import { ProgramDetailScreen } from '../screens/programs/ProgramDetailScreen';
import { DayDetailScreen } from '../screens/programs/DayDetailScreen';
import { ExercisePickerScreen } from '../screens/log/ExercisePickerScreen';
import { AddExerciseScreen } from '../screens/log/AddExerciseScreen';
import { ExerciseDetailScreen } from '../screens/exercises/ExerciseDetailScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { TemplateEditorScreen } from '../screens/library/TemplateEditorScreen';
import { ScheduledWorkoutDetailScreen } from '../screens/library/ScheduledWorkoutDetailScreen';
import { GenerateProgramScreen } from '../screens/programs/GenerateProgramScreen';
import { AssignTrainingDayScreen } from '../screens/programs/AssignTrainingDayScreen';
import { AssignCardioDayScreen } from '../screens/programs/AssignCardioDayScreen';
import { TrainingDayDetailScreen } from '../screens/programs/TrainingDayDetailScreen';
import { WorkoutLogDetailScreen } from '../screens/programs/WorkoutLogDetailScreen';
import { ShareWorkoutScreen } from '../screens/programs/ShareWorkoutScreen';
import { PreWorkoutReviewScreen } from '../screens/log/PreWorkoutReviewScreen';
import { ChooseVariantScreen } from '../screens/log/ChooseVariantScreen';
import { ActiveWorkoutOverviewScreen } from '../screens/log/ActiveWorkoutOverviewScreen';
import { LogCardioScreen } from '../screens/log/LogCardioScreen';
import { LiveCardioTrackingScreen } from '../screens/log/LiveCardioTrackingScreen';
import { CardioRunSummaryScreen } from '../screens/log/CardioRunSummaryScreen';
import { ActiveExerciseScreen } from '../screens/log/ActiveExerciseScreen';
import { FormCheckScreen } from '../screens/log/FormCheckScreen';
import { WorkoutSummaryScreen } from '../screens/log/WorkoutSummaryScreen';

const Stack = createNativeStackNavigator<ProgramsStackParamList>();

export function ProgramsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Calendar" component={CalendarScreen} />
      <Stack.Screen name="ProgramDetail" component={ProgramDetailScreen} />
      <Stack.Screen name="DayDetail" component={DayDetailScreen} />
      <Stack.Screen name="ExercisePicker" component={ExercisePickerScreen} />
      <Stack.Screen name="AddExercise" component={AddExerciseScreen} options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} />
      <Stack.Screen name="Library" component={LibraryScreen} />
      <Stack.Screen name="TemplateEditor" component={TemplateEditorScreen} />
      <Stack.Screen name="ScheduledWorkoutDetail" component={ScheduledWorkoutDetailScreen} />
      <Stack.Screen name="GenerateProgram" component={GenerateProgramScreen} />
      <Stack.Screen name="AssignTrainingDay" component={AssignTrainingDayScreen} />
      <Stack.Screen name="AssignCardioDay" component={AssignCardioDayScreen} />
      <Stack.Screen name="TrainingDayDetail" component={TrainingDayDetailScreen} />
      <Stack.Screen name="WorkoutLogDetail" component={WorkoutLogDetailScreen} />
      <Stack.Screen name="ShareWorkout" component={ShareWorkoutScreen} />
      <Stack.Screen name="PreWorkoutReview" component={PreWorkoutReviewScreen} />
      <Stack.Screen name="ChooseVariant" component={ChooseVariantScreen} />
      <Stack.Screen name="ActiveWorkoutOverview" component={ActiveWorkoutOverviewScreen} />
      <Stack.Screen name="LogCardio" component={LogCardioScreen} />
      <Stack.Screen name="LiveCardioTracking" component={LiveCardioTrackingScreen} />
      <Stack.Screen name="CardioRunSummary" component={CardioRunSummaryScreen} />
      <Stack.Screen name="ActiveExercise" component={ActiveExerciseScreen} />
      <Stack.Screen name="FormCheck" component={FormCheckScreen} options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="WorkoutSummary" component={WorkoutSummaryScreen} />
    </Stack.Navigator>
  );
}
