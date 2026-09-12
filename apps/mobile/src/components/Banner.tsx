import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { withAlpha } from '../ui/color';
import { Button } from './Button';

export function Banner({
  tone = 'error',
  action,
  children,
}: {
  tone?: 'error' | 'info';
  action?: { label: string; onPress: () => void | Promise<void> };
  children: string;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [pending, setPending] = useState(false);

  async function runAction(): Promise<void> {
    if (!action || pending) return;
    setPending(true);
    try {
      await action.onPress();
    } finally {
      setPending(false);
    }
  }

  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      style={[styles.base, tone === 'error' ? styles.error : styles.info]}
    >
      <Text style={[styles.message, tone === 'error' && styles.messageError]}>{children}</Text>
      {action ? (
        <Button variant="quiet" loading={pending} onPress={() => void runAction()}>
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: t.space[3],
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[3],
    },
    error: {
      backgroundColor: withAlpha(t.danger, '14'),
      borderWidth: 1,
      borderColor: withAlpha(t.danger, '40'),
    },
    info: { backgroundColor: t.bgSurfaceMuted },
    message: { flex: 1, minWidth: 0, fontSize: t.type.meta.fontSize, color: t.fgPrimary },
    messageError: { color: t.danger },
  });
