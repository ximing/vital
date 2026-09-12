import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import { themeService, useThemeChoice } from '../services/theme.service';
import { THEME_CHOICE_OPTIONS } from '../theme/preference';
import { useTheme } from '../theme/use-theme';
import { rnShadow } from '../ui/card';

/**
 * 外观切换（设计稿 me.webp）：pill 槽（radius.pill + bgSurfaceMuted），
 * 选中项为白卡浮起（bgElevated + radius.pill + rnShadow 轻微）。
 */
export function ThemeToggle() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const choice = useThemeChoice();

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={copy.theme.label} style={styles.row}>
      {THEME_CHOICE_OPTIONS.map((o) => {
        const active = choice === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            hitSlop={{ top: t.space[1], bottom: t.space[1] }}
            onPress={() => themeService().setChoice(o.value)}
            style={[styles.option, active && styles.optionActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.bgSurfaceMuted,
      borderRadius: t.radius.pill,
      padding: t.space[1],
    },
    option: {
      flex: 1,
      minHeight: t.controlH,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.pill,
    },
    optionActive: { backgroundColor: t.bgElevated, ...rnShadow(t) },
    label: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    labelActive: { color: t.fgPrimary, fontWeight: '600' },
  });
