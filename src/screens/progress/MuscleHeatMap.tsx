import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import Body, { type ExtendedBodyPart, type Slug } from 'react-native-body-highlighter';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, SegmentedControl } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import {
  useLoggedSets,
  trainingRangeStart,
  type StrengthTrendRange,
} from '../../services/api/queries/progress';
import {
  useExercises,
  useBackfillCustomExerciseMuscles,
} from '../../services/api/queries/exercises';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatVolume, unitLabel } from '../../utils/units';
import { formatEnumLabel } from '../../utils/exerciseMetadata';

// exercises.primary_muscle values (see constants/muscleGroups.ts) that map
// onto react-native-body-highlighter's fixed Slug set. 'full_body' has no
// single region to shade, so it's intentionally left out.
const MUSCLE_TO_SLUGS: Record<string, Slug[]> = {
  chest: ['chest'],
  back: ['upper-back', 'lower-back'],
  shoulders: ['deltoids'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearm'],
  core: ['abs'],
  obliques: ['obliques'],
  quadriceps: ['quadriceps'],
  hamstrings: ['hamstring'],
  glutes: ['gluteal'],
  calves: ['calves'],
};
const TRACKED_MUSCLES = Object.keys(MUSCLE_TO_SLUGS);

const SLUG_TO_MUSCLE: Partial<Record<Slug, string>> = Object.entries(
  MUSCLE_TO_SLUGS,
).reduce<Partial<Record<Slug, string>>>((acc, [muscle, slugs]) => {
  slugs.forEach(slug => {
    acc[slug] = muscle;
  });
  return acc;
}, {});

// Fixed five-step heat ramp — independent of the app's brand accents (which
// change per theme) so this reads the same regardless of dark/light mode,
// same idea as a chart legend that shouldn't shift with rebrands.
const HEAT_COLORS = ['#3E7FB0', '#4F9A6E', '#D9A544', '#D9752E', '#C1402E'];
const HEAT_LABELS = ['Low', '2', '3', '4', 'High'];

const RANGE_OPTIONS: { value: StrengthTrendRange; label: string }[] = [
  { value: '1w', label: '1W' },
  { value: '2w', label: '2W' },
  { value: '1m', label: '1M' },
  { value: 'ytd', label: 'YTD' },
];

// How much of a set's volume a secondary muscle earns, relative to the
// primary muscle's full credit. 0.5 is the same "half-credit for indirect
// work" convention volume-landmark tracking commonly uses — enough that a
// squat-only month still shows real glutes/hamstrings work, without a squat
// outscoring a dedicated glute exercise on the glutes bar itself.
const SECONDARY_MUSCLE_WEIGHT = 0.5;

const RANGE_CAPTIONS: Record<StrengthTrendRange, string> = {
  '1w': 'Volume by muscle, last 7 days',
  '2w': 'Volume by muscle, last 14 days',
  '1m': 'Volume by muscle, last 30 days',
  ytd: 'Volume by muscle, year to date',
};

/** 0 = untrained (no color), otherwise 1-5 scaled to this period's
 * hardest-worked muscle — self-scales across bodyweights/experience levels
 * instead of needing a fixed kg threshold per user. */
function heatIntensity(volumeKg: number, maxVolumeKg: number): number {
  if (volumeKg <= 0 || maxVolumeKg <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((volumeKg / maxVolumeKg) * 5)));
}

function MuscleBar({
  label,
  trailing,
  percent,
  color,
}: {
  label: string;
  trailing: string;
  percent: number;
  color: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <Text variant="caption" color="primary">
          {label}
        </Text>
        <Text variant="caption" color="tertiary">
          {trailing}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.bg.surface,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${percent}%`,
            borderRadius: theme.radii.pill,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

export function MuscleHeatMap() {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const { data: sets, isLoading: setsLoading } = useLoggedSets(userId);
  const { data: exercises, isLoading: exercisesLoading } = useExercises('');
  const unitPref = useUnitPreference();
  const [range, setRange] = useState<StrengthTrendRange>('1w');
  const [view, setView] = useState<'front' | 'back'>('front');
  const [selected, setSelected] = useState<{
    muscle: string;
    volumeKg: number;
  } | null>(null);

  const gender: 'male' | 'female' = profile?.sex === 'female' ? 'female' : 'male';

  // Library exercises are all pre-classified at seed time (see
  // constants/muscleGroups.ts), but a user's own custom exercises start on
  // the 'Custom' placeholder until the AI classifier
  // (classify-exercise-muscle) runs — without this, their sets would just
  // silently vanish from the volume totals below instead of being counted
  // against the right muscle group. Runs on focus as a fire-and-forget
  // background pass, not Pro-gated here since the heat map itself isn't.
  const backfillMuscles = useBackfillCustomExerciseMuscles();
  useFocusEffect(
    useCallback(() => {
      if (userId) backfillMuscles.mutate(userId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]),
  );

  const { volumeByMuscle, unclassifiedVolumeKg } = useMemo(() => {
    const totals = new Map<string, number>();
    let unclassified = 0;
    if (!sets || !exercises) return { volumeByMuscle: totals, unclassifiedVolumeKg: 0 };
    const exerciseById = new Map(exercises.map(exercise => [exercise.id, exercise]));
    const start = trainingRangeStart(range, new Date());
    for (const set of sets) {
      if (new Date(set.loggedAt) < start) continue;
      const exercise = exerciseById.get(set.exerciseId);
      if (!exercise) continue; // exercise no longer exists — nothing to attribute
      const { primary_muscle: primary, secondary_muscles: secondary } = exercise;
      const volume = (set.loadKg ?? 0) * set.reps;
      if (primary === 'Custom') {
        // Still waiting on the AI classifier above (or its next focus pass).
        unclassified += volume;
        continue;
      }
      // Most exercises drive one dominant muscle but load others too — e.g.
      // every squat variant in the library lists 'quadriceps' as primary and
      // {glutes, hamstrings, core} as secondary_muscles (see
      // 0014_exercise_substitutions.sql). Crediting only the primary muscle
      // made squats invisible to glutes/hamstrings entirely — a real
      // undercount, not a display nuance. Secondary muscles count at half
      // credit so the primary target still reads as the dominant bar.
      if (MUSCLE_TO_SLUGS[primary]) {
        totals.set(primary, (totals.get(primary) ?? 0) + volume);
      }
      for (const muscle of secondary) {
        if (muscle === primary || !MUSCLE_TO_SLUGS[muscle]) continue;
        totals.set(muscle, (totals.get(muscle) ?? 0) + volume * SECONDARY_MUSCLE_WEIGHT);
      }
    }
    return { volumeByMuscle: totals, unclassifiedVolumeKg: unclassified };
  }, [sets, exercises, range]);

  const maxVolume = useMemo(
    () => Math.max(0, ...Array.from(volumeByMuscle.values())),
    [volumeByMuscle],
  );

  const bodyData = useMemo<ExtendedBodyPart[]>(() => {
    if (maxVolume <= 0) return [];
    const data: ExtendedBodyPart[] = [];
    volumeByMuscle.forEach((volumeKg, muscle) => {
      const intensity = heatIntensity(volumeKg, maxVolume);
      if (intensity <= 0) return;
      for (const slug of MUSCLE_TO_SLUGS[muscle] ?? []) {
        data.push({ slug, intensity });
      }
    });
    return data;
  }, [volumeByMuscle, maxVolume]);

  const muscleBars = useMemo(
    () =>
      TRACKED_MUSCLES.map(muscle => {
        const volumeKg = volumeByMuscle.get(muscle) ?? 0;
        const intensity = heatIntensity(volumeKg, maxVolume);
        return {
          muscle,
          volumeKg,
          percent: maxVolume > 0 ? (volumeKg / maxVolume) * 100 : 0,
          color: intensity > 0 ? HEAT_COLORS[intensity - 1] : theme.colors.border.default,
        };
      }).sort((a, b) => b.volumeKg - a.volumeKg),
    [volumeByMuscle, maxVolume, theme.colors.border.default],
  );

  const trainedCount = muscleBars.filter(b => b.volumeKg > 0).length;
  const coveragePercent =
    TRACKED_MUSCLES.length > 0
      ? Math.round((trainedCount / TRACKED_MUSCLES.length) * 100)
      : 0;

  const isLoading = setsLoading || exercisesLoading;
  const hasData = maxVolume > 0;
  const hasPendingOnly = !hasData && unclassifiedVolumeKg > 0;
  const unclassifiedNote =
    unclassifiedVolumeKg > 0
      ? backfillMuscles.isPending
        ? `${formatVolume(unclassifiedVolumeKg, unitPref)} ${unitLabel(unitPref)} from custom exercises is being classified now — check back shortly.`
        : backfillMuscles.isError
        ? `${formatVolume(unclassifiedVolumeKg, unitPref)} ${unitLabel(unitPref)} from custom exercises couldn't be categorized automatically — it'll retry the next time you open Stats.`
        : `${formatVolume(unclassifiedVolumeKg, unitPref)} ${unitLabel(unitPref)} from custom exercises is not yet categorized — check back shortly.`
      : null;

  return (
    <Card variant="elevated" style={{ gap: theme.spacing.md }}>
      <View>
        <Text variant="subtitle">Muscle Heat Map</Text>
        <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
          {RANGE_CAPTIONS[range]}
        </Text>
      </View>

      <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} />

      {unclassifiedNote ? (
        <Text variant="caption" color="tertiary">
          {unclassifiedNote}
        </Text>
      ) : null}

      {isLoading ? null : hasPendingOnly ? (
        <Text variant="body" color="secondary">
          Classifying your custom exercises — this will fill in shortly.
        </Text>
      ) : !hasData ? (
        <Text variant="body" color="secondary">
          No sets logged in this period — train something to see it light up.
        </Text>
      ) : (
        <>
          <SegmentedControl
            options={[
              { value: 'front', label: 'Front' },
              { value: 'back', label: 'Back' },
            ]}
            value={view}
            onChange={setView}
          />

          <View style={{ alignItems: 'center' }}>
            <Body
              data={bodyData}
              gender={gender}
              side={view}
              colors={HEAT_COLORS}
              scale={1.5}
              border={theme.colors.border.subtle}
              defaultFill={theme.colors.border.default}
              onBodyPartPress={bodyPart => {
                const muscle = bodyPart.slug ? SLUG_TO_MUSCLE[bodyPart.slug] : undefined;
                if (!muscle) return;
                setSelected({ muscle, volumeKg: volumeByMuscle.get(muscle) ?? 0 });
              }}
            />
          </View>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: theme.spacing.sm,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: theme.colors.border.default,
                }}
              />
              <Text variant="caption" color="tertiary">
                Untrained
              </Text>
            </View>
            {HEAT_COLORS.map((color, index) => (
              <View
                key={color}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    backgroundColor: color,
                  }}
                />
                <Text variant="caption" color="tertiary">
                  {HEAT_LABELS[index]}
                </Text>
              </View>
            ))}
          </View>

          {selected ? (
            <Text variant="caption" color="secondary">
              {formatEnumLabel(selected.muscle)} ·{' '}
              {formatVolume(selected.volumeKg, unitPref)} {unitLabel(unitPref)}{' '}
              this period
            </Text>
          ) : (
            <Text variant="caption" color="tertiary">
              Tap a muscle for its exact volume
            </Text>
          )}

          <View
            style={{
              gap: theme.spacing.sm,
              paddingTop: theme.spacing.sm,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border.subtle,
            }}
          >
            <View>
              <Text variant="subtitle">Muscle balance</Text>
              <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
                Relative to your hardest-worked muscle this period · secondary
                muscles (e.g. glutes on a squat) count at half credit
              </Text>
            </View>

            <MuscleBar
              label={`Muscle groups trained — ${trainedCount} of ${TRACKED_MUSCLES.length}`}
              trailing={`${coveragePercent}%`}
              percent={coveragePercent}
              color={theme.colors.accent.primary}
            />

            <View style={{ gap: theme.spacing.sm }}>
              {muscleBars.map(bar => (
                <MuscleBar
                  key={bar.muscle}
                  label={formatEnumLabel(bar.muscle)}
                  trailing={
                    bar.volumeKg > 0
                      ? `${formatVolume(bar.volumeKg, unitPref)} ${unitLabel(unitPref)}`
                      : '—'
                  }
                  percent={bar.percent}
                  color={bar.color}
                />
              ))}
            </View>
          </View>
        </>
      )}
    </Card>
  );
}
