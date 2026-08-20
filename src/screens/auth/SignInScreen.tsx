import React, { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, TextField, Button, Header, KeyboardAvoider } from '../../components/core';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../store/authStore';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

const PASSWORD_CHANGE_MESSAGES = {
  success: 'Your password was changed — log in with your new one.',
  expired: 'That confirmation link expired. Change your password again from Account to get a new one.',
  error: "Something went wrong confirming your password change. Try again from Account, or reach us at support@setsocial.app.",
};

export function SignInScreen({ navigation }: Props) {
  const theme = useTheme();
  const { loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Set once by usePasswordChangeDeepLink when the athlete taps the "Confirm
  // password change" email link and lands back here signed out — read once
  // and cleared so it doesn't linger across an unrelated sign-in error.
  const passwordChangeResult = useAuthStore(state => state.passwordChangeResult);
  const setPasswordChangeResult = useAuthStore(state => state.setPasswordChangeResult);

  const onSubmit = async () => {
    setError(null);
    setPasswordChangeResult(null);
    const result = await signIn(email.trim(), password);
    if (result.error) setError(result.error);
    // On success, supabase.auth.onAuthStateChange (wired in Milestone 2's
    // authStore integration) flips RootNavigator over to Onboarding/MainTabs.
  };

  return (
    <KeyboardAvoider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <Header title="" />
        <View style={{ flex: 1, padding: theme.spacing.xl, paddingTop: 0, justifyContent: 'center', gap: theme.spacing.lg }}>
          <View>
            <Text variant="title">Welcome back</Text>
            <Text variant="body" color="secondary">
              Sign in to keep training.
            </Text>
          </View>

          {passwordChangeResult ? (
            <Text
              variant="caption"
              style={{
                color:
                  passwordChangeResult === 'success'
                    ? theme.colors.semantic.success
                    : theme.colors.semantic.danger,
              }}
            >
              {PASSWORD_CHANGE_MESSAGES[passwordChangeResult]}
            </Text>
          ) : null}

          <View style={{ gap: theme.spacing.md }}>
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
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
            />
            {error ? (
              <Text variant="caption" style={{ color: theme.colors.semantic.danger }}>
                {error}
              </Text>
            ) : null}
          </View>

          <Button
            label="Sign In"
            onPress={onSubmit}
            loading={loading}
            disabled={!email || !password}
          />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" color="secondary" onPress={() => navigation.navigate('ForgotPassword')}>
              Forgot password?
            </Text>
            <Text variant="caption" color="secondary" onPress={() => navigation.navigate('SignUp')}>
              Create an account
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </KeyboardAvoider>
  );
}
