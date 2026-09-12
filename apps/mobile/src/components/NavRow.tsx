import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { Icon, type LucideIcon } from '../ui/icon';

/**
 * spec §1.4 导航行：高 52，icon 20 fgMuted + 标签 15/22 fgPrimary + 右值 13 textTertiary + chevron 16。
 * divider 渲染行间发丝线：有 icon 时左缩进 48（卡片 padding 16 + icon 20 + gap 12），无 icon 缩进 16。
 * pressed 整行 bgSurfaceMuted（配合卡片 overflow hidden 裁圆角）。
 * 注：批次 1 共享组件未含 NavRow，按任务约定建在本 feature 目录。
 */
export function NavRow({
  icon,
  label,
  value,
  divider = false,
  onPress,
}: {
  icon?: LucideIcon;
  label: string;
  value?: string;
  divider?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View>
      {divider ? <View style={[styles.hairline, icon ? styles.hairlineIcon : null]} /> : null}
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {icon ? <Icon icon={icon} size={20} color={t.fgMuted} /> : null}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {value ? (
          <Text style={styles.value} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        <Icon icon={ChevronRight} size={16} color={t.textTertiary} />
      </Pressable>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    hairline: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.borderSubtle,
      marginLeft: t.space[4],
    },
    hairlineIcon: { marginLeft: t.space[4] + 20 + t.space[3] },
    row: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      paddingHorizontal: t.space[4],
    },
    pressed: { backgroundColor: t.bgSurfaceMuted },
    label: { flex: 1, fontSize: 15, lineHeight: 22, color: t.fgPrimary },
    value: {
      fontSize: t.type.meta.fontSize,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
  });
