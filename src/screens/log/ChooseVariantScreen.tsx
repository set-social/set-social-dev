import React, { useMemo } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Button,
  Header,
  LoadingState,
  EmptyState,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProgramDay } from '../../services/api/queries/programs';
import { useScheduledWorkout } from '../../services/api/queries/scheduledWorkouts';
import { useExercises } from '../../services/api/queries/exercises';
import { useProfile } from '../../services/api/queries/profiles';
import {
  coachingEngine,
  type WorkoutVariantResult,
} from '../../services/coaching';
import { buildVariantSourceExercises } from '../../utils/variantSource';
import { exerciseRowToMetadata } from '../../utils/exerciseMetadata';
import { navigateToStartWorkout } from '../../navigation/startWorkoutFlow';
import type {
  ProgramsStackParamList,
  RootStackParamList,
} from '../../navigation/types';
import type { EquipmentType, WorkoutVariantType } from '../../types/database';

type Route = RouteProp<ProgramsStackParamList, 'ChooseVariant'>;
type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

const VARIANT_ORDER: WorkoutVariantType[] = [
  'full',
  'time_45',
  'time_30',
  'hotel',
  'home',
  'bodyweight',
  'low_readiness',
  'strength_focus',
  'hypertrophy_focus',
  'reduced_impact',
];

export function ChooseVariantScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const rootNavigation = useNavigation<RootNav>();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);

  const { data: programDay, isLoading: dayLoading } = useProgramDay(
    params.programDayId,
  );
  const { data: scheduledWorkout, isLoading: scheduledLoading } =
    useScheduledWorkout(params.scheduledWorkoutId);
  const { data: allExercises, isLoading: exercisesLoading } = useExercises('');
  const { data: profile } = useProfile(userId);

  const isLoading = dayLoading || scheduledLoading || exercisesLoading;

  const variants = useMemo<WorkoutVariantResult[]>(() => {
    if (!allExercises) return [];
    const targets =
      programDay?.program_exercises ??
      scheduledWorkout?.scheduled_workout_exercises ??
      [];
    if (targets.length === 0) return [];

    const source = buildVariantSourceExercises(targets, allExercises);
    const candidates = allExercises.map(exerciseRowToMetadata);
    const availableEquipment =
      (profile?.equipment_access as EquipmentType[] | undefined) ?? null;

    return VARIANT_ORDER.map(variantType =>
      coachingEngine.generateWorkoutVariant({
        source,
        variantType,
        candidates,
        availableEquipment,
      }),
    );
  }, [programDay, scheduledWorkout, allExercises, profile?.equipment_access]);

  const onSelect = (variantType: WorkoutVariantType) => {
    if (variantType === 'full') {
      navigateToStartWorkout(rootNavigation, params);
      return;
    }
    navigation.replace('ActiveWorkoutOverview', { ...params, variantType });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Choose a Workout Variant" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.md,
        }}
      >
        {isLoading ? (
          <LoadingState fill={false} />
        ) : variants.length === 0 ? (
          <EmptyState
            title="No exercises to adapt"
            description="This workout doesn't have any exercises yet."
          />
        ) : (
          variants.map(variant => (
            <Card
              key={variant.variantType}
              variant="elevated"
              style={{ gap: theme.spacing.xs }}
            >
              <Text variant="subtitle">{variant.label}</Text>
              <Text variant="body" color="secondary">
                {variant.summary}
              </Text>
              <Text variant="caption" color="tertiary">
                {variant.exercises.length} exercise
                {variant.exercises.length === 1 ? '' : 's'} · ~
                {variant.estimatedMinutes} min
              </Text>
              <Button
                label="Choose this"
                variant="secondary"
                onPress={() => onSelect(variant.variantType)}
              />
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
