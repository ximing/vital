import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, useRouter } from 'expo-router';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { OnboardingService } from './onboarding.service';

const OnboardingHomeContent = observer(function OnboardingHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const s = useService(OnboardingService);
  const copyStep = copy.onboarding.steps[s.step];
  const href = s.href;
  if (!copyStep || href === undefined) return null;

  async function skipAll(): Promise<void> {
    await s.skipAll();
    router.replace('/');
  }

  function next(): void {
    if (s.next() === 'home') router.replace('/');
  }

  function goAction(): void {
    const nextHref = s.href;
    if (nextHref === undefined) return;
    s.goAction();
    router.replace(nextHref);
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.nav.onboarding }} />
      <View style={styles.art} />
      <Text style={styles.kicker}>{`${s.step + 1} / 3`}</Text>
      <Text style={styles.title}>{copyStep.title}</Text>
      <Text style={styles.body}>{copyStep.body}</Text>
      <Button fullWidth loading={s.busy} onPress={goAction}>
        {copyStep.action}
      </Button>
      <Button variant="secondary" fullWidth disabled={s.busy} onPress={next}>
        {s.step >= 2 ? copy.onboarding.start : copy.onboarding.next}
      </Button>
      <Button variant="quiet" disabled={s.busy} onPress={() => void skipAll()}>
        {copy.onboarding.skipAll}
      </Button>
    </Screen>
  );
});

export const OnboardingHome = bindServices(OnboardingHomeContent, [OnboardingService]);

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
