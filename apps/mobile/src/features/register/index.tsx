import { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { registerInputSchema } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/use-theme';

export function RegisterPage() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(): Promise<void> {
    const parsed = registerInputSchema.safeParse({ displayName, email, password });
    if (!parsed.success) {
      setError(copy.auth.invalidRegister);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await auth.register(parsed.data);
      router.replace('/onboarding');
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.auth.register }} />
      <Text style={styles.title}>{copy.auth.register}</Text>
      <Field label={copy.auth.displayName} value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      <Field
        label={copy.auth.email}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        label={copy.auth.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password-new"
      />
      <ErrorText message={error} />
      <Button
        fullWidth
        loading={busy}
        loadingText={copy.auth.registering}
        onPress={() => void onSubmit()}
      >
        {copy.auth.register}
      </Button>
      <Button variant="quiet" style={styles.link} onPress={() => router.back()}>
        {copy.auth.hasAccount}
      </Button>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    title: {
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
      textAlign: 'center',
      marginVertical: t.space[4],
    },
    link: { alignSelf: 'center', marginTop: t.space[2] },
  });
