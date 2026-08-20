import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { format, differenceInYears } from 'date-fns';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  TextField,
  Button,
  Header,
  BottomSheet,
  KeyboardAvoider,
} from '../../components/core';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/api/supabaseClient';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

const MIN_AGE_YEARS = 13;
const HANDLE_FORMAT = /^[a-z0-9_]{3,20}$/;

function defaultBirthDatePickerValue(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 20);
  return d;
}

/** Database['public']['Functions'] is deliberately left untyped (see
 * types/database.ts) — populating it broke unrelated embedded-relationship
 * inference elsewhere. This casts just this one call instead of the whole
 * client, so nothing else loses type safety over it.
 *
 * Casts `supabase` itself, not the extracted `supabase.rpc` reference —
 * supabase-js's rpc() relies on `this` internally, so pulling it out as a
 * standalone function before calling it drops that binding and throws a
 * TypeError at runtime (invisible to TS, since the cast bypasses type
 * checking). Calling it as client.rpc(...) keeps `this` bound to `client`
 * (the same object as `supabase`). */
async function isHandleTaken(
  handle: string,
): Promise<{ taken: boolean | null; error: string | null }> {
  const client = supabase as unknown as {
    rpc: (
      fn: 'is_handle_taken',
      args: { p_handle: string },
    ) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc('is_handle_taken', {
    p_handle: handle,
  });
  return { taken: data, error: error?.message ?? null };
}

export function SignUpScreen({ navigation }: Props) {
  const theme = useTheme();
  const { loading, signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [handle, setHandle] = useState('');
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [birthDateSheetOpen, setBirthDateSheetOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState(defaultBirthDatePickerValue);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkingHandle, setCheckingHandle] = useState(false);

  const maxBirthDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - MIN_AGE_YEARS);
    return d;
  }, []);

  const handleFormatValid = handle === '' || HANDLE_FORMAT.test(handle);

  const onChangeHandle = (text: string) => {
    // Handles are always lowercase alnum/underscore — normalize as the user
    // types rather than rejecting keystrokes with an error (matches
    // AccountScreen's handle editor).
    setHandle(text.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  };

  const onConfirmBirthDate = () => {
    setBirthDate(pickerDate);
    setBirthDateSheetOpen(false);
  };

  // Must be a stable reference, not an inline arrow function passed
  // directly to DateTimePicker — on Android the picker is an imperative
  // dialog whose `showOrUpdatePicker` effect re-fires (reopening the dialog)
  // whenever the `onChange` prop's identity changes. An inline arrow gets a
  // new identity every render, including the render `setPickerDate` itself
  // triggers, so picking a date reopened the same dialog immediately —
  // "confirm" appeared to do nothing. iOS renders a real inline view, not an
  // effect-driven dialog, so this never showed up there.
  const onChangePickerDate = useCallback(
    (_event: DateTimePickerEvent, date?: Date) => {
      if (date) setPickerDate(date);
    },
    [],
  );

  const onSubmit = async () => {
    setError(null);

    if (!fullName.trim()) {
      setError('Enter your full name.');
      return;
    }
    if (!handle || !HANDLE_FORMAT.test(handle)) {
      setError(
        'Choose a handle: 3-20 characters, letters, numbers, or underscore.',
      );
      return;
    }
    if (!birthDate) {
      setError('Enter your birth date.');
      return;
    }
    if (differenceInYears(new Date(), birthDate) < MIN_AGE_YEARS) {
      setError(
        `You must be at least ${MIN_AGE_YEARS} years old to use SetSocial.`,
      );
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // Checked before creating the account — profiles_select_own means an
    // unauthenticated client can't otherwise tell whether a handle is taken,
    // and catching it only after signUp would leave a real account behind
    // with no name/handle set (see is_handle_taken, migration 0033).
    //
    // Wrapped in try/catch/finally so an unexpected throw here (already bit
    // us once — supabase-js's rpc() needs `this` bound correctly, see
    // isHandleTaken) can't leave checkingHandle stuck true forever, which
    // reads as "Create Account spins with no result."
    let handleTaken: boolean | null;
    let handleCheckError: string | null;
    setCheckingHandle(true);
    try {
      ({ taken: handleTaken, error: handleCheckError } = await isHandleTaken(
        handle,
      ));
    } catch (err) {
      setCheckingHandle(false);
      setError(
        err instanceof Error
          ? err.message
          : 'Could not verify that handle — check your connection and try again.',
      );
      return;
    }
    setCheckingHandle(false);
    if (handleCheckError) {
      setError(
        'Could not verify that handle — check your connection and try again.',
      );
      return;
    }
    if (handleTaken) {
      setError('That handle is already taken.');
      return;
    }

    try {
      const result = await signUp(email.trim(), password);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (!result.hasSession || !result.userId) {
        // No confirmation step is expected — the project should have email
        // confirmation disabled (see supabase/config.toml's [auth.email]
        // enable_confirmations). Landing here means that setting hasn't been
        // applied to this Supabase project yet, so surface it rather than
        // leaving the user stuck on this screen with no signal why.
        setError(
          'Account created, but sign-in isn’t active yet. Please try signing in — if that fails, email confirmation needs to be disabled for this project.',
        );
        return;
      }

      // handle_new_user (migration 0001) only sets id/email on the new
      // profiles row — everything else, including these fields, is filled
      // in here. AuthProvider's onAuthStateChange may already be swapping
      // the navigator over to Onboarding at this point (a session now
      // exists), but this function keeps running regardless of whether this
      // screen is still mounted, since it isn't relying on component state
      // past this point.
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          display_name: fullName.trim(),
          handle,
          birth_date: format(birthDate, 'yyyy-MM-dd'),
        })
        .eq('id', result.userId);
      if (profileError) {
        // The account and session already exist at this point — there's no
        // clean way back to retry just this step from here, so let them into
        // the app and point them at where to finish it instead of blocking.
        Alert.alert(
          'Almost done',
          'Your account was created, but we couldn’t save your name and handle — you can set them from Settings.',
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong creating your account. Please try again.',
      );
    }
  };

  return (
    <KeyboardAvoider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <Header title="" />
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.xl,
            paddingTop: 0,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View>
            <Text variant="title">Create your account</Text>
            <Text variant="body" color="secondary">
              SetSocial will build your first program right after this.
            </Text>
          </View>

          <View style={{ gap: theme.spacing.md }}>
            <TextField
              label="Full Name"
              autoComplete="name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your name"
            />

            <View>
              <TextField
                label="Handle"
                value={handle}
                onChangeText={onChangeHandle}
                placeholder="e.g. jsmith92"
                autoCapitalize="none"
                autoCorrect={false}
                error={
                  !handleFormatValid
                    ? '3-20 characters: letters, numbers, underscore.'
                    : undefined
                }
              />
              <Text
                variant="caption"
                color="secondary"
                style={{ marginTop: theme.spacing.xs }}
              >
                Lets friends find you by @{handle || 'handle'} — used across
                SetSocial's social features.
              </Text>
            </View>

            <Pressable
              onPress={() => {
                setPickerDate(birthDate ?? defaultBirthDatePickerValue());
                setBirthDateSheetOpen(true);
              }}
            >
              <View pointerEvents="none">
                <TextField
                  label="Birth Date"
                  value={birthDate ? format(birthDate, 'MMMM d, yyyy') : ''}
                  placeholder="Select your birth date"
                  editable={false}
                />
              </View>
            </Pressable>

            <TextField
              label="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
            />
            <TextField
              label="Password"
              secureTextEntry
              autoComplete="password-new"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
            />
            <TextField
              label="Confirm Password"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="••••••••"
            />
            {error ? (
              <Text
                variant="caption"
                style={{ color: theme.colors.semantic.danger }}
              >
                {error}
              </Text>
            ) : null}
          </View>

          <Button
            label="Create Account"
            onPress={onSubmit}
            loading={loading || checkingHandle}
            disabled={
              !fullName ||
              !handle ||
              !birthDate ||
              !email ||
              !password ||
              !confirmPassword
            }
          />

          <Text
            variant="caption"
            color="secondary"
            style={{ textAlign: 'center' }}
            onPress={() => navigation.navigate('SignIn')}
          >
            Already have an account? Sign in
          </Text>
        </ScrollView>

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
              onPress={onConfirmBirthDate}
              style={{ width: '100%' }}
            />
          </View>
        </BottomSheet>
      </SafeAreaView>
    </KeyboardAvoider>
  );
}
