import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { featureFlags } from '../config/featureFlags';
import type { WorkoutSource } from '../store/activeWorkoutStore';
import type { ProgramsStackParamList, RootStackParamList } from './types';

type Source = { programDayId?: string; scheduledWorkoutId?: string };

/** Inverse of ActiveWorkoutOverviewScreen's own route-params -> WorkoutSource
 * derivation. Shared by CalendarScreen's auto-resume-on-hydrate effect and
 * navigateToContinueWorkout below, so there's exactly one place that knows
 * how to map a persisted session's source back onto route params. */
export function sourceToActiveWorkoutParams(source: WorkoutSource | null): ProgramsStackParamList['ActiveWorkoutOverview'] {
  if (!source) return undefined;
  switch (source.type) {
    case 'programDay':
      return { programDayId: source.id };
    case 'scheduledWorkout':
      return { scheduledWorkoutId: source.id };
    case 'template':
      return { templateId: source.id };
    case 'freestyle':
      return undefined;
  }
}

/**
 * Jumps straight back into an already-in-progress session — skips
 * PreWorkoutReview/ChooseVariant entirely (unlike navigateToStartWorkout
 * below), since those are fresh-start flows and continuing shouldn't
 * re-trigger a readiness/adaptation review for a workout already underway.
 * Mirrors CalendarScreen's own auto-resume effect, just reachable from a
 * manual "Continue Workout" tap (e.g. Home) instead of firing on mount.
 */
export function navigateToContinueWorkout(
  rootNavigation: NativeStackNavigationProp<RootStackParamList>,
  source: WorkoutSource | null,
): void {
  rootNavigation.navigate('MainTabs', {
    screen: 'ProgramsTab',
    params: { screen: 'ActiveWorkoutOverview', params: sourceToActiveWorkoutParams(source) },
  });
}

/**
 * Single entry point for "start this workout" across Today/DayDetail/
 * ScheduledWorkoutDetail — routes through the readiness/adaptation review
 * when AI coaching is enabled, otherwise goes straight to ActiveWorkoutOverview
 * (today's pre-coaching behavior, unchanged).
 */
export function navigateToStartWorkout(
  rootNavigation: NativeStackNavigationProp<RootStackParamList>,
  source: Source,
): void {
  if (!featureFlags.aiCoaching) {
    rootNavigation.navigate('MainTabs', {
      screen: 'ProgramsTab',
      params: { screen: 'ActiveWorkoutOverview', params: source },
    });
    return;
  }

  rootNavigation.navigate('MainTabs', {
    screen: 'ProgramsTab',
    params: { screen: 'PreWorkoutReview', params: source },
  });
}

/**
 * Entry point for "choose a workout variant" (time budget / equipment /
 * training emphasis) — a deliberate, explicit user choice, distinct from
 * (and not gated by) featureFlags.aiCoaching's readiness-adaptation path.
 */
export function navigateToChooseVariant(
  rootNavigation: NativeStackNavigationProp<RootStackParamList>,
  source: Source,
): void {
  rootNavigation.navigate('MainTabs', {
    screen: 'ProgramsTab',
    params: { screen: 'ChooseVariant', params: source },
  });
}

/**
 * Cardio's equivalent of navigateToStartWorkout — always goes straight to
 * LogCardio, skipping PreWorkoutReview/ChooseVariant regardless of
 * featureFlags.aiCoaching. Those screens are strength-specific (readiness
 * adaptation, exercise variants); a cardio session has neither.
 */
export function navigateToStartCardio(
  rootNavigation: NativeStackNavigationProp<RootStackParamList>,
  source: { programDayId?: string; date?: string } = {},
): void {
  rootNavigation.navigate('MainTabs', {
    screen: 'ProgramsTab',
    params: { screen: 'LogCardio', params: source },
  });
}
