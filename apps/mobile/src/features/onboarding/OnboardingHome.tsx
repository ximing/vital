import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { copy } from '../../lib/copy';
import { markOnboarding } from '../../lib/onboarding';
import { useTheme } from '../../theme/use-theme';

const HREFS = ['/inbox', '/', '/reports'] as const;

export function OnboardingHome() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const copyStep = copy.onboarding.steps[step];
  const nextHref = HREFS[step];
  if (!copyStep || nextHref === undefined) return null;
  const href: string = nextHref;

  async function skipAll(): Promise<void> {
    setBusy(true);
    try {
      await markOnboarding(auth.user, auth.refreshUser, { dismissed: true });
      router.replace('/');
    } finally {
      setBusy(false);
    }
  }

  function next(): void {
    if (step >= HREFS.length - 1) {
      router.replace('/');
      return;
    }
    setStep((n) => n + 1);
  }

  function goAction(): void {
    if (href === '/reports') {
      void markOnboarding(auth.user, auth.refreshUser, { openedWeekly: true });
    }
    router.replace(href);
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.nav.onboarding }} />
      <View style={styles.art} />
      <Text style={styles.kicker}>{`${step + 1} / 3`}</Text>
      <Text style={styles.title}>{copyStep.title}</Text>
      <Text style={styles.body}>{copyStep.body}</Text>
      <Button fullWidth loading={busy} onPress={goAction}>
        {copyStep.action}
      </Button>
      <Button variant="secondary" fullWidth disabled={busy} onPress={next}>
        {step >= HREFS.length - 1 ? copy.onboarding.start : copy.onboarding.next}
      </Button>
      <Button variant="quiet" disabled={busy} onPress={() => void skipAll()}>
        {copy.onboarding.skipAll}
      </Button>
    </Screen>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    art: {
      width: theme.space[12],
      height: theme.space[12],
      borderRadius: theme.radius.pill,
      backgroundColor: theme.bgAccentSubtle,
      borderWidth: 2,
      borderColor: theme.accentPrimary,
      alignSelf: 'center',
      marginTop: theme.space[6],
    },
    kicker: {
      fontSize: theme.type.caption.fontSize,
      color: theme.fgMuted,
      textAlign: 'center',
    },
    title: {
      fontSize: theme.type.title.fontSize,
      lineHeight: theme.type.title.lineHeight,
      fontWeight: '700',
      color: theme.fgPrimary,
      textAlign: 'center',
    },
    body: {
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      color: theme.fgMuted,
      textAlign: 'center',
    },
  });
