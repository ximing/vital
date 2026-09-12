import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, useRouter } from 'expo-router';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { copy } from '../../lib/copy';
import { needsOnboarding } from '../../lib/onboarding';
import { useTheme } from '../../theme/use-theme';
import { LoginService } from './login.service';

const LoginPageContent = observer(function LoginPageContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const s = useService(LoginService);

  async function onSubmit(): Promise<void> {
    const user = await s.submit();
    if (!user) return;
    router.replace(needsOnboarding(user) ? '/onboarding' : '/');
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.auth.login }} />
      <Text style={styles.title}>{copy.brand.name}</Text>
      <Text style={styles.tagline}>{copy.brand.tagline}</Text>
      <Field
        label={copy.auth.email}
        value={s.email}
        onChangeText={(email) => s.setEmail(email)}
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        label={copy.auth.password}
        value={s.password}
        onChangeText={(password) => s.setPassword(password)}
        secureTextEntry
        autoComplete="password"
      />
      <ErrorText message={s.error} />
      <Button fullWidth loading={s.busy} loadingText={copy.auth.loggingIn} onPress={() => void onSubmit()}>
        {copy.auth.login}
      </Button>
      <Button variant="quiet" style={styles.link} onPress={() => router.push('/register')}>
        {copy.auth.noAccount}
      </Button>
    </Screen>
  );
});

export const LoginPage = bindServices(LoginPageContent, [LoginService]);

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
