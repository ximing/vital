import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';

export function ErrorText({ message }: { message: string | null }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    error: { color: t.danger, fontSize: t.type.meta.fontSize },
  });
