import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  TextField,
  Button,
  Header,
  SegmentedControl,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useCreateExercise } from '../../services/api/queries/exercises';
import { isYoutubeUrl } from '../../utils/youtube';
import type { ExerciseDefaultMetric } from '../../types/database';
import type { ProgramsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgramsStackParamList>;

const METRIC_OPTIONS: { value: ExerciseDefaultMetric; label: string }[] = [
  { value: 'weight_kg', label: 'Weight' },
  { value: 'reps', label: 'Reps only' },
  { value: 'time', label: 'Time' },
];

export function AddExerciseScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore(state => state.userId);
  const createExercise = useCreateExercise(userId);

  const [name, setName] = useState('');
  const [metric, setMetric] = useState<ExerciseDefaultMetric>('weight_kg');
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const trimmedVideoUrl = videoUrl.trim();
  const videoUrlInvalid =
    trimmedVideoUrl.length > 0 && !isYoutubeUrl(trimmedVideoUrl);

  const onSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || videoUrlInvalid) return;
    setError(null);
    try {
      await createExercise.mutateAsync({
        name: trimmedName,
        defaultMetric: metric,
        demoMediaUrl: trimmedVideoUrl || null,
      });
      navigation.goBack();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not add that exercise. Try again.',
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Add Exercise" />
      <KeyboardAvoider>
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            padding: theme.spacing.lg,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <TextField
            label="Title"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sled Push"
            returnKeyType="done"
          />

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              UNIT OF MEASURE
            </Text>
            <SegmentedControl
              options={METRIC_OPTIONS}
              value={metric}
              onChange={setMetric}
            />
          </View>

          <TextField
            label="YouTube link (optional)"
            value={videoUrl}
            onChangeText={setVideoUrl}
            placeholder="https://youtube.com/watch?v=..."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            error={
              videoUrlInvalid
                ? "That doesn't look like a YouTube link."
                : undefined
            }
          />

          {error ? (
            <Text
              variant="caption"
              style={{ color: theme.colors.semantic.danger }}
            >
              {error}
            </Text>
          ) : null}

          <View style={{ flex: 1, minHeight: theme.spacing.xl }} />

          <Button
            label="Add Exercise"
            onPress={onSave}
            disabled={!name.trim() || videoUrlInvalid}
            loading={createExercise.isPending}
          />
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}
