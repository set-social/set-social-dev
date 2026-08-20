import React, { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, TextField, Button, Header, KeyboardAvoider } from '../../components/core';
import { useAuth } from '../../hooks/useAuth';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const theme = useTheme();
  const { loading, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async () => {
    setError(null);
    const result = await resetPassword(email.trim());
    if (result.error) {
      setError(result.error);
      return;
    }
    setSent(true);
  };

  return (
    <KeyboardAvoider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <Header title="" />
        <View
          style={{
            flex: 1,
            padding: theme.spacing.xl,
            paddingTop: 0,
            justifyContent: 'center',
            gap: theme.spacing.lg,
          }}
        >
          <View>
            <Text variant="title">Reset your password</Text>
            <Text variant="body" color="secondary">
              We'll email you a link to set a new one.
            </Text>
          </View>

          {sent ? (
            <Text variant="body" color="secondary">
              Check {email} for a reset link.
            </Text>
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              <TextField
                label="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                returnKeyType="send"
                onSubmitEditing={onSubmit}
              />
              {error ? (
                <Text variant="caption" style={{ color: theme.colors.semantic.danger }}>
                  {error}
                </Text>
              ) : null}
              <Button label="Send Reset Link" onPress={onSubmit} loading={loading} disabled={!email} />
            </View>
          )}

          <Text
            variant="caption"
            color="secondary"
            style={{ textAlign: 'center' }}
            onPress={() => navigation.navigate('SignIn')}
          >
            Back to Sign In
          </Text>
        </View>
      </SafeAreaView>
    </KeyboardAvoider>
  );
}
