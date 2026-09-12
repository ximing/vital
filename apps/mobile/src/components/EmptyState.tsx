import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CircleDashed } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { Icon, type LucideIcon } from '../ui/icon';
import { Button } from './Button';

/**
 * spec §1.7 空态：48×48 bgAccentSubtle 圆 + 22px lucide 图标 accentPrimary，
 * 文案 14/21 fgMuted 最多两行，可挂 13/18 textTertiary 辅助行，动作为 ghost 按钮。
 * 各页图标：收集 BookOpen、待办 CheckCircle2、复盘 CalendarDays（由调用方传入）。
 */
export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.wrap}>
      <View style={styles.art}>
        <Icon icon={icon ?? CircleDashed} size={22} color={t.accentPrimary} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {action ? (
        <Button variant="ghost" style={styles.action} onPress={action.onPress}>
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
      paddingVertical: t.space[14],
      gap: t.space[3],
    },
    art: {
      width: t.space[12],
      height: t.space[12],
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      color: t.fgMuted,
      textAlign: 'center',
    },
    hint: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
      textAlign: 'center',
    },
    action: { alignSelf: 'center' },
  });
