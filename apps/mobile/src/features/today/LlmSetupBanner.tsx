import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';

export function LlmSetupBanner() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={[styles.row, rnShadow(t)]}>
      <Text style={styles.text}>{copy.today.llmBanner}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/me')}
        hitSlop={8}
      >
        <Text style={styles.go}>{copy.today.llmBannerGo}</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    // spec §1.2 内容卡：bgElevated + radius.lg，无描边。
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      marginTop: t.space[3],
      marginHorizontal: t.space[4],
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
    },
    text: { flex: 1, minWidth: 0, fontSize: t.type.meta.fontSize, color: t.fgMuted },
    go: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.accentPrimary },
  });
