import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, differenceInYears } from 'date-fns';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  StatTile,
  Button,
  TextField,
  TrendChart,
  Header,
  LoadingState,
  KeyboardAvoider,
  SelectableCard,
  BottomSheet,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useBodyMetrics,
  useLogBodyMetric,
} from '../../services/api/queries/bodyMetrics';
import {
  useProfile,
  useUpdateProfile,
} from '../../services/api/queries/profiles';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { useNumericInputText } from '../../hooks/useNumericInputText';
import {
  formatWeight,
  parseWeightInput,
  unitLabel,
  kgToLb,
  roundForDisplay,
  feetInchesToCm,
  cmToFeetInches,
} from '../../utils/units';
import type { Sex } from '../../types/database';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

// Same values SignUpScreen uses for its own birth-date picker (13+, no
// shared constants module for a single duplicated number) — this screen
// enforces the identical floor client-side rather than letting the DB's own
// check constraint (0033_profile_birth_date.sql) surface a raw Postgres
// error.
const MIN_AGE_YEARS = 13;

function defaultBirthDatePickerValue(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 20);
  return d;
}

function toDigits(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function BodyMetricsScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const userId = useAuthStore(state => state.userId);
  const { data: metrics, isLoading, refetch } = useBodyMetrics(userId);
  const { data: profile } = useProfile(userId);
  const logMetric = useLogBodyMetric(userId);
  const updateProfile = useUpdateProfile(userId);
  const unitPref = useUnitPreference();
  const [weight, setWeight] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Local overrides, null until the athlete actually touches that field —
  // same "defer to the server value until edited" shape as AccountScreen's
  // displayName/handle editors. Kept separate from a single combined draft
  // object so each field's own effective-value derivation stays simple.
  const [sex, setSex] = useState<Sex | null>(null);
  const [heightFeet, setHeightFeet] = useState<number | null>(null);
  const [heightInches, setHeightInches] = useState<number | null>(null);
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [birthDateSheetOpen, setBirthDateSheetOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState(defaultBirthDatePickerValue);
  const [bodyProfileError, setBodyProfileError] = useState<string | null>(null);
  const maxBirthDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - MIN_AGE_YEARS);
    return d;
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const latest =
    metrics && metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const first = metrics && metrics.length > 0 ? metrics[0] : null;
  const hasTrend = latest != null && first != null && latest.id !== first.id;
  const trendKg = hasTrend ? latest.weight_kg - first.weight_kg : 0;
  const trendDisplay = unitPref === 'kg' ? trendKg : kgToLb(trendKg);

  const heightCm = profile?.height_cm ?? null;
  const bmi =
    latest != null && heightCm != null
      ? latest.weight_kg / (heightCm / 100) ** 2
      : null;

  const onLog = async () => {
    const value = parseWeightInput(weight, unitPref);
    if (!value || value <= 0) {
      setError('Enter a valid weight.');
      return;
    }
    setError(null);
    try {
      await logMetric.mutateAsync({ weightKg: value });
      setWeight('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save that entry.',
      );
    }
  };

  // Effective (displayed) values: the local override once touched, else
  // whatever the profile already has. Height's "touched" check is on the
  // local feet/inches state directly rather than a re-derived-cm equality
  // check — cm -> feet/inches -> cm is lossy (rounds to the nearest whole
  // inch), so comparing derived values back against profile.height_cm could
  // register a false "changed" purely from that round-trip.
  const profileHeight =
    profile?.height_cm != null ? cmToFeetInches(profile.height_cm) : null;
  const effectiveFeet = heightFeet ?? profileHeight?.feet ?? null;
  const effectiveInches = heightInches ?? profileHeight?.inches ?? null;
  const effectiveSex = sex ?? profile?.sex ?? null;
  // T00:00:00 with no zone offset — parsed as local midnight, not UTC
  // midnight. A bare date-only string (`new Date('1996-04-12')`) parses as
  // UTC per spec, which shifts to the previous calendar day once formatted
  // in any negative-UTC-offset timezone (a real, reproducible bug, not
  // theoretical — this is date-fns's own `format`, which always renders in
  // local time).
  const effectiveBirthDate =
    birthDate ??
    (profile?.birth_date ? new Date(`${profile.birth_date}T00:00:00`) : null);

  const heightFeetField = useNumericInputText(effectiveFeet, setHeightFeet, {
    parse: toDigits,
  });
  const heightInchesField = useNumericInputText(
    effectiveInches,
    setHeightInches,
    { parse: toDigits },
  );

  const sexChanged = sex !== null;
  const heightChanged = heightFeet !== null || heightInches !== null;
  const birthDateChanged = birthDate !== null;
  const bodyProfileChanged = sexChanged || heightChanged || birthDateChanged;

  const onSaveBodyProfile = () => {
    setBodyProfileError(null);
    if (
      birthDateChanged &&
      effectiveBirthDate &&
      differenceInYears(new Date(), effectiveBirthDate) < MIN_AGE_YEARS
    ) {
      setBodyProfileError(`You must be at least ${MIN_AGE_YEARS} years old.`);
      return;
    }

    const updates: { sex?: Sex; height_cm?: number; birth_date?: string } = {};
    if (sexChanged && effectiveSex) updates.sex = effectiveSex;
    if (heightChanged && effectiveFeet != null && effectiveInches != null) {
      updates.height_cm =
        Math.round(feetInchesToCm(effectiveFeet, effectiveInches) * 10) / 10;
    }
    if (birthDateChanged && effectiveBirthDate) {
      updates.birth_date = format(effectiveBirthDate, 'yyyy-MM-dd');
    }
    if (Object.keys(updates).length === 0) return;

    updateProfile.mutate(updates, {
      onSuccess: () => {
        // Back to "defer to the server value" now that the server value
        // (profile, refetched by useUpdateProfile's own onSuccess) matches
        // what was just saved.
        setSex(null);
        setHeightFeet(null);
        setHeightInches(null);
        setBirthDate(null);
      },
    });
  };

  // Same stable-callback-identity note as SignUpScreen's own birth-date
  // picker: an inline arrow here would get a new identity on every render
  // (including the one setPickerDate itself triggers), which reopens
  // Android's imperative picker dialog immediately after confirming.
  const onChangePickerDate = useCallback(
    (_event: DateTimePickerEvent, date?: Date) => {
      if (date) setPickerDate(date);
    },
    [],
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title="Body Metrics" />
      <KeyboardAvoider>
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            paddingBottom: theme.spacing.lg + tabBarHeight,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent.primary}
            />
          }
        >
          {isLoading ? (
            <LoadingState fill={false} />
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <StatTile
                    label="Current Weight"
                    value={
                      latest
                        ? `${formatWeight(
                            latest.weight_kg,
                            unitPref,
                          )} ${unitLabel(unitPref)}`
                        : '—'
                    }
                    trend={
                      hasTrend
                        ? {
                            direction:
                              trendKg > 0
                                ? 'up'
                                : trendKg < 0
                                ? 'down'
                                : 'flat',
                            label: `${roundForDisplay(
                              Math.abs(trendDisplay),
                              unitPref,
                            )} ${unitLabel(unitPref)} since first log`,
                          }
                        : undefined
                    }
                  />
                </View>
                {bmi != null ? (
                  <View style={{ flex: 1 }}>
                    <StatTile label="BMI" value={bmi.toFixed(1)} />
                  </View>
                ) : null}
              </View>

              <Card variant="elevated" style={{ gap: theme.spacing.md }}>
                <View>
                  <Text variant="subtitle">Body profile</Text>
                  <Text variant="caption" color="secondary">
                    Used for a personalized calorie-burn estimate on Home and in
                    Arnold's answers.
                  </Text>
                </View>

                <View style={{ gap: theme.spacing.sm }}>
                  <Text variant="label" color="secondary">
                    SEX
                  </Text>
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    {SEX_OPTIONS.map(option => (
                      <View key={option.value} style={{ flex: 1 }}>
                        <SelectableCard
                          label={option.label}
                          selected={effectiveSex === option.value}
                          onPress={() => setSex(option.value)}
                        />
                      </View>
                    ))}
                  </View>
                </View>

                <View style={{ gap: theme.spacing.sm }}>
                  <Text variant="label" color="secondary">
                    HEIGHT
                  </Text>
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <TextField
                        label="Feet"
                        keyboardType="number-pad"
                        value={heightFeetField.text}
                        onChangeText={heightFeetField.onChangeText}
                        placeholder="5"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField
                        label="Inches"
                        keyboardType="number-pad"
                        value={heightInchesField.text}
                        onChangeText={heightInchesField.onChangeText}
                        placeholder="10"
                      />
                    </View>
                  </View>
                </View>

                <Pressable
                  onPress={() => {
                    setPickerDate(
                      effectiveBirthDate ?? defaultBirthDatePickerValue(),
                    );
                    setBirthDateSheetOpen(true);
                  }}
                >
                  <View pointerEvents="none">
                    <TextField
                      label="Birth Date"
                      value={
                        effectiveBirthDate
                          ? format(effectiveBirthDate, 'MMMM d, yyyy')
                          : ''
                      }
                      placeholder="Select your birth date"
                      editable={false}
                    />
                  </View>
                </Pressable>

                {bodyProfileError ? (
                  <Text
                    variant="caption"
                    style={{ color: theme.colors.semantic.danger }}
                  >
                    {bodyProfileError}
                  </Text>
                ) : null}

                <Button
                  label="Save"
                  variant="secondary"
                  onPress={onSaveBodyProfile}
                  disabled={!bodyProfileChanged}
                  loading={updateProfile.isPending}
                />
              </Card>

              <Card variant="elevated">
                <Text variant="subtitle">Weight trend</Text>
                <View style={{ marginTop: theme.spacing.md }}>
                  <TrendChart
                    points={(metrics ?? []).map(m => m.weight_kg)}
                    emptyLabel="Log a couple of entries to see your trend"
                  />
                </View>
              </Card>

              <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
                <Text variant="subtitle">Log today's weight</Text>
                <TextField
                  label={`Weight (${unitLabel(unitPref)})`}
                  keyboardType="decimal-pad"
                  value={weight}
                  onChangeText={setWeight}
                  placeholder="72.5"
                  error={error ?? undefined}
                />
                <Button
                  label="Log Weight"
                  onPress={onLog}
                  loading={logMetric.isPending}
                />
              </Card>

              {metrics && metrics.length > 0 ? (
                <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
                  <Text variant="subtitle">History</Text>
                  {[...metrics].reverse().map((m, index) => (
                    <View
                      key={m.id}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        paddingVertical: theme.spacing.xs,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: theme.colors.border.subtle,
                      }}
                    >
                      <Text variant="body" color="secondary">
                        {format(new Date(m.logged_at), 'MMM d, yyyy')}
                      </Text>
                      <Text variant="body">
                        {formatWeight(m.weight_kg, unitPref)}{' '}
                        {unitLabel(unitPref)}
                      </Text>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoider>

      <BottomSheet
        visible={birthDateSheetOpen}
        onClose={() => setBirthDateSheetOpen(false)}
        title="Birth date"
      >
        <View style={{ gap: theme.spacing.md, alignItems: 'center' }}>
          <DateTimePicker
            value={pickerDate}
            mode="date"
            display="spinner"
            themeVariant={theme.colorScheme}
            maximumDate={maxBirthDate}
            onChange={onChangePickerDate}
          />
          <Button
            label="Confirm"
            onPress={() => {
              setBirthDate(pickerDate);
              setBirthDateSheetOpen(false);
            }}
            style={{ width: '100%' }}
          />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}
