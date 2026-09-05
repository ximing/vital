import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { Button } from './Button';

export function EmptyState({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {action ? (
        <Button variant="primary" style={styles.action} onPress={action.onPress}>
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: {
      alignItems: 'center',
      paddingHorizontal: t.space[6],
      paddingVertical: t.space[10],
      gap: t.space[4],
    },
    title: {
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      color: t.fgMuted,
      textAlign: 'center',
    },
    action: { alignSelf: 'center' },
  });
