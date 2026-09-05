import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import { useTheme } from '../theme/use-theme';

export function Loading({ label = copy.loading }: { label?: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const opacity = useMemo(() => new Animated.Value(0.4), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={t.accentPrimary} />
      <Animated.Text style={[styles.label, { opacity }]}>{label}</Animated.Text>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space[3],
      backgroundColor: t.bgCanvas,
    },
    label: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
  });
