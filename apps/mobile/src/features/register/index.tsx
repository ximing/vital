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
import { useTheme } from '../../theme/use-theme';
import { RegisterService } from './register.service';

const RegisterPageContent = observer(function RegisterPageContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const s = useService(RegisterService);

  async function onSubmit(): Promise<void> {
    if (await s.submit()) router.replace('/onboarding');
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.auth.register }} />
      <Text style={styles.title}>{copy.auth.register}</Text>
      <Field
        label={copy.auth.displayName}
        value={s.displayName}
        onChangeText={(value) => s.setDisplayName(value)}
        autoCapitalize="words"
      />
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
        autoComplete="password-new"
      />
      <ErrorText message={s.error} />
      <Button
        fullWidth
        loading={s.busy}
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
});

export const RegisterPage = bindServices(RegisterPageContent, [RegisterService]);

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
