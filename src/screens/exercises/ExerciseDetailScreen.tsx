import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Header,
  IconButton,
  Icon,
  ListRow,
  LoadingState,
  BottomSheet,
  TextField,
  Button,
  SegmentedControl,
} from '../../components/core';
import {
  useExercise,
  useExercises,
  useUpdateExercise,
} from '../../services/api/queries/exercises';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import { coachingEngine } from '../../services/coaching';
import {
  exerciseRowToMetadata,
  formatEnumLabel,
} from '../../utils/exerciseMetadata';
import {
  extractYoutubeVideoId,
  isYoutubeUrl,
  youtubeThumbnailUrl,
} from '../../utils/youtube';
import type {
  ProgramsStackParamList,
  TodayStackParamList,
} from '../../navigation/types';
import type {
  EquipmentType,
  ExerciseDefaultMetric,
} from '../../types/database';

type Route = RouteProp<
  ProgramsStackParamList | TodayStackParamList,
  'ExerciseDetail'
>;
type Nav = NativeStackNavigationProp<ProgramsStackParamList | TodayStackParamList>;

const METRIC_OPTIONS: { value: ExerciseDefaultMetric; label: string }[] = [
  { value: 'weight_kg', label: 'Weight' },
  { value: 'reps', label: 'Reps only' },
  { value: 'time', label: 'Time' },
];

export function ExerciseDetailScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { data: exercise, isLoading } = useExercise(params.exerciseId);
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const { data: allExercises } = useExercises('');
  const updateExercise = useUpdateExercise();

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editMetric, setEditMetric] =
    useState<ExerciseDefaultMetric>('weight_kg');
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const canEdit =
    exercise != null && exercise.is_custom && exercise.created_by === userId;

  useEffect(() => {
    if (!exercise) return;
    setEditName(exercise.name);
    setEditMetric(exercise.default_metric ?? 'weight_kg');
    setEditVideoUrl(exercise.demo_media_url ?? '');
  }, [exercise]);

  const trimmedEditVideoUrl = editVideoUrl.trim();
  const editVideoUrlInvalid =
    trimmedEditVideoUrl.length > 0 && !isYoutubeUrl(trimmedEditVideoUrl);

  const onSaveEdit = async () => {
    if (!exercise || !editName.trim() || editVideoUrlInvalid) return;
    setEditError(null);
    try {
      await updateExercise.mutateAsync({
        exerciseId: exercise.id,
        name: editName.trim(),
        defaultMetric: editMetric,
        demoMediaUrl: trimmedEditVideoUrl || null,
      });
      setEditOpen(false);
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : 'Could not save changes. Try again.',
      );
    }
  };

  const videoId = exercise?.demo_media_url
    ? extractYoutubeVideoId(exercise.demo_media_url)
    : null;

  const alternatives = useMemo(() => {
    if (!exercise || !allExercises) return [];
    return coachingEngine.recommendExerciseSubstitution({
      exercise: exerciseRowToMetadata(exercise),
      candidates: allExercises.map(exerciseRowToMetadata),
      availableEquipment:
        (profile?.equipment_access as EquipmentType[] | undefined) ?? null,
    });
  }, [exercise, allExercises, profile?.equipment_access]);

  const explanation = useMemo(() => {
    if (!exercise) return null;
    return coachingEngine.generateExerciseExplanation({
      exercise: exerciseRowToMetadata(exercise),
    });
  }, [exercise]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header
        title={exercise?.name ?? 'Exercise'}
        right={
          canEdit ? (
            <IconButton
              name="pencil"
              variant="ghost"
              accessibilityLabel="Edit exercise"
              onPress={() => setEditOpen(true)}
            />
          ) : undefined
        }
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
        }}
      >
        {isLoading || !exercise ? (
          <LoadingState fill={false} />
        ) : (
          <>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: theme.spacing.lg,
              }}
            >
              <View>
                <Text variant="label" color="secondary">
                  CATEGORY
                </Text>
                <Text variant="body">{formatEnumLabel(exercise.category)}</Text>
              </View>
              <View>
                <Text variant="label" color="secondary">
                  EQUIPMENT
                </Text>
                <Text variant="body">
                  {formatEnumLabel(exercise.equipment)}
                </Text>
              </View>
              <View>
                <Text variant="label" color="secondary">
                  MUSCLE
                </Text>
                <Text variant="body">
                  {formatEnumLabel(exercise.primary_muscle)}
                </Text>
              </View>
              {exercise.movement_pattern ? (
                <View>
                  <Text variant="label" color="secondary">
                    PATTERN
                  </Text>
                  <Text variant="body">
                    {formatEnumLabel(exercise.movement_pattern)}
                  </Text>
                </View>
              ) : null}
              {exercise.difficulty ? (
                <View>
                  <Text variant="label" color="secondary">
                    DIFFICULTY
                  </Text>
                  <Text variant="body">
                    {formatEnumLabel(exercise.difficulty)}
                  </Text>
                </View>
              ) : null}
              {exercise.joint_stress ? (
                <View>
                  <Text variant="label" color="secondary">
                    JOINT STRESS
                  </Text>
                  <Text variant="body">
                    {formatEnumLabel(exercise.joint_stress)}
                  </Text>
                </View>
              ) : null}
            </View>

            {exercise.secondary_muscles.length > 0 ? (
              <Text variant="caption" color="tertiary">
                Also works:{' '}
                {exercise.secondary_muscles.map(formatEnumLabel).join(', ')}
              </Text>
            ) : null}

            <Card variant="elevated">
              <Text variant="subtitle">How to perform it</Text>
              <Text
                variant="body"
                color="secondary"
                style={{ marginTop: theme.spacing.xs }}
              >
                {exercise.instructions ?? 'No instructions yet.'}
              </Text>
            </Card>

            {videoId ? (
              <Pressable
                onPress={() =>
                  exercise.demo_media_url &&
                  Linking.openURL(exercise.demo_media_url)
                }
                accessibilityRole="button"
                accessibilityLabel="Play demo video on YouTube"
                style={{
                  width: '100%',
                  aspectRatio: 16 / 9,
                  borderRadius: theme.radii.md,
                  overflow: 'hidden',
                  backgroundColor: theme.colors.bg.surface,
                }}
              >
                <Image
                  source={{ uri: youtubeThumbnailUrl(videoId) }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                  accessibilityLabel="YouTube video thumbnail"
                />
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: theme.radii.pill,
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon
                      name="play"
                      size="lg"
                      color={theme.colors.text.onAccent}
                      strokeWidth={2.25}
                    />
                  </View>
                </View>
              </Pressable>
            ) : !exercise.demo_media_url ? (
              <Text variant="caption" color="tertiary">
                Demo video/image coming later — this exercise doesn't have one
                yet.
              </Text>
            ) : null}

            {explanation && explanation.purpose ? (
              <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
                <Text variant="subtitle">Why this exercise</Text>
                <Text variant="body" color="secondary">
                  {explanation.purpose}
                </Text>
                <View>
                  <Text variant="label" color="secondary">
                    WHEN TO PROGRESS
                  </Text>
                  <Text
                    variant="body"
                    color="secondary"
                    style={{ marginTop: 2 }}
                  >
                    {explanation.progressionCriteria}
                  </Text>
                </View>
                <View>
                  <Text variant="label" color="secondary">
                    WHEN TO SCALE BACK
                  </Text>
                  <Text
                    variant="body"
                    color="secondary"
                    style={{ marginTop: 2 }}
                  >
                    {explanation.regressionCriteria}
                  </Text>
                </View>
              </Card>
            ) : null}

            {alternatives.length > 0 ? (
              <Card variant="flat" style={{ gap: theme.spacing.xs }}>
                <Text variant="subtitle">Suitable alternatives</Text>
                {alternatives.map(alt => (
                  <ListRow
                    key={alt.exerciseId}
                    title={alt.exerciseName}
                    subtitle={alt.reason}
                    showChevron
                    onPress={() =>
                      navigation.push('ExerciseDetail', {
                        exerciseId: alt.exerciseId,
                      })
                    }
                  />
                ))}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>

      <BottomSheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Exercise"
      >
        <View style={{ gap: theme.spacing.lg }}>
          <TextField
            label="Title"
            value={editName}
            onChangeText={setEditName}
            returnKeyType="done"
          />

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              UNIT OF MEASURE
            </Text>
            <SegmentedControl
              options={METRIC_OPTIONS}
              value={editMetric}
              onChange={setEditMetric}
            />
          </View>

          <TextField
            label="YouTube link (optional)"
            value={editVideoUrl}
            onChangeText={setEditVideoUrl}
            placeholder="https://youtube.com/watch?v=..."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            error={
              editVideoUrlInvalid
                ? "That doesn't look like a YouTube link."
                : undefined
            }
          />

          {editError ? (
            <Text
              variant="caption"
              style={{ color: theme.colors.semantic.danger }}
            >
              {editError}
            </Text>
          ) : null}

          <Button
            label="Save Changes"
            onPress={onSaveEdit}
            disabled={!editName.trim() || editVideoUrlInvalid}
            loading={updateExercise.isPending}
          />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}
