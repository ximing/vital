import { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { loginInputSchema } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/use-theme';

export function LoginPage() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(): Promise<void> {
    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(copy.auth.invalidLogin);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await auth.login(parsed.data);
      router.replace('/');
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.auth.login }} />
      <Text style={styles.title}>{copy.brand.name}</Text>
      <Text style={styles.tagline}>{copy.brand.tagline}</Text>
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
        autoComplete="password"
      />
      <ErrorText message={error} />
      <Button fullWidth loading={busy} loadingText={copy.auth.loggingIn} onPress={() => void onSubmit()}>
        {copy.auth.login}
      </Button>
      <Button variant="quiet" style={styles.link} onPress={() => router.push('/register')}>
        {copy.auth.noAccount}
      </Button>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    title: {
      fontSize: t.type.display.fontSize,
      lineHeight: t.type.display.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
      textAlign: 'center',
      marginTop: t.space[6],
    },
    tagline: {
      fontSize: t.type.meta.fontSize,
      color: t.fgMuted,
      textAlign: 'center',
      marginBottom: t.space[4],
    },
    link: { alignSelf: 'center', marginTop: t.space[2] },
  });
