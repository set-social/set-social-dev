import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  TextField,
  Button,
  Card,
  Header,
  LoadingState,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useProfile,
  useUpdateProfile,
} from '../../services/api/queries/profiles';
import { useAuth } from '../../hooks/useAuth';
import { deleteAccount } from '../../services/api/edgeFunctions';
import { supabase } from '../../services/api/supabaseClient';
import type { ProfileStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Account'>;

export function AccountScreen(_props: Props) {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const { data: profile, isLoading } = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  const { signOut, requestPasswordChange, loading: authLoading } = useAuth();

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const nameValue = displayName ?? profile?.display_name ?? '';
  const nameChanged =
    displayName !== null && displayName !== (profile?.display_name ?? '');

  const onSaveName = () => {
    if (displayName === null) return;
    updateProfile.mutate({ display_name: displayName });
  };

  const handleValue = handle ?? profile?.handle ?? '';
  const handleChanged = handle !== null && handle !== (profile?.handle ?? '');
  const handleFormatValid =
    handleValue === '' || /^[a-z0-9_]{3,20}$/.test(handleValue);

  const onChangeHandle = (text: string) => {
    setHandleError(null);
    // Handles are always lowercase alnum/underscore — normalize as the
    // user types rather than rejecting keystrokes with an error.
    setHandle(text.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  };

  const onSaveHandle = async () => {
    if (handle === null || !handleFormatValid) return;
    setHandleError(null);
    try {
      await updateProfile.mutateAsync({ handle: handle || null });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      setHandleError(
        code === '23505'
          ? 'That handle is already taken.'
          : err instanceof Error
          ? err.message
          : 'Could not save your handle.',
      );
    }
  };

  const onSavePassword = async () => {
    setPasswordError(null);
    setPasswordSaved(false);
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return;
    }
    const result = await requestPasswordChange(newPassword);
    if (result.error) {
      setPasswordError(result.error);
      return;
    }
    setNewPassword('');
    setPasswordSaved(true);
  };

  const onDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account, programs, and workout history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAccount();
              // The deleted user's JWT is now orphaned server-side; clear it
              // locally so AuthProvider/RootNavigator fall back to the Auth
              // stack instead of surfacing stale-session errors.
              await supabase.auth.signOut();
            } catch (err) {
              setDeleting(false);
              Alert.alert(
                'Could not delete account',
                err instanceof Error ? err.message : 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Account" />

      <KeyboardAvoider>
        {isLoading ? (
          <LoadingState />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              padding: theme.spacing.lg,
              paddingTop: 0,
              gap: theme.spacing.xl,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={{ gap: theme.spacing.md }}>
              <TextField
                label="Display Name"
                value={nameValue}
                onChangeText={setDisplayName}
                placeholder="Your name"
              />
              <Text variant="label" color="secondary">
                EMAIL
              </Text>
              <Text variant="body" color="secondary">
                {profile?.email}
              </Text>
              <Button
                label="Save Name"
                variant="secondary"
                onPress={onSaveName}
                disabled={!nameChanged}
                loading={updateProfile.isPending}
              />
            </View>

            <View style={{ gap: theme.spacing.md }}>
              <TextField
                label="Handle"
                value={handleValue}
                onChangeText={onChangeHandle}
                placeholder="e.g. jsmith92"
                autoCapitalize="none"
                autoCorrect={false}
                error={
                  handleError ??
                  (!handleFormatValid
                    ? '3-20 characters: letters, numbers, underscore.'
                    : undefined)
                }
              />
              <Text variant="caption" color="secondary">
                Lets friends find you by @{handleValue || 'handle'} in search.
              </Text>
              <Button
                label="Save Handle"
                variant="secondary"
                onPress={onSaveHandle}
                disabled={!handleChanged || !handleFormatValid}
                loading={updateProfile.isPending}
              />
            </View>

            <View style={{ gap: theme.spacing.md }}>
              <Text variant="label" color="secondary">
                CHANGE PASSWORD
              </Text>
              <TextField
                label="New Password"
                secureTextEntry
                autoComplete="password-new"
                value={newPassword}
                onChangeText={text => {
                  setNewPassword(text);
                  setPasswordSaved(false);
                }}
                placeholder="At least 6 characters"
              />
              {passwordError ? (
                <Text
                  variant="caption"
                  style={{ color: theme.colors.semantic.danger }}
                >
                  {passwordError}
                </Text>
              ) : passwordSaved ? (
                <Text
                  variant="caption"
                  style={{ color: theme.colors.semantic.success }}
                >
                  Check {profile?.email} for a confirmation link — your
                  password won't change until you tap it, and you'll need to
                  log back in afterward.
                </Text>
              ) : null}
              <Button
                label="Update Password"
                variant="secondary"
                onPress={onSavePassword}
                disabled={!newPassword}
                loading={authLoading}
              />
            </View>

            <Button
              label="Sign Out"
              variant="ghost"
              icon="logOut"
              onPress={() => signOut()}
            />

            <Card
              variant="elevated"
              style={{
                gap: theme.spacing.sm,
                borderColor: theme.colors.semantic.danger,
              }}
            >
              <Text
                variant="subtitle"
                style={{ color: theme.colors.semantic.danger }}
              >
                Danger Zone
              </Text>
              <Text variant="caption" color="secondary">
                Permanently delete your account and all of your data.
              </Text>
              <Button
                label="Delete Account"
                variant="secondary"
                onPress={onDeleteAccount}
                loading={deleting}
                style={{ borderColor: theme.colors.semantic.danger }}
              />
            </Card>
          </ScrollView>
        )}
      </KeyboardAvoider>
    </SafeAreaView>
  );
}
