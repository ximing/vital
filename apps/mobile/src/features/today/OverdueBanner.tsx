import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import type { Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { withAlpha } from '../../ui/color';
import { Icon } from '../../ui/icon';

const MAX_TITLES = 2;

/**
 * spec §f.4 逾期 banner：withAlpha(danger,'14') 玫瑰浅底 radius 12 padding 12 14，
 * AlertCircle 16 statusOverdue + 文案 13 fgPrimary（数量加粗着色）+ 右侧 quiet「顺延」accent。
 * 不再是 error Banner 的误用（bug 10）。
 */
export function OverdueBanner({
  tasks,
  onPostpone,
}: {
  tasks: Task[];
  onPostpone: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (tasks.length === 0) return null;
  const titles = tasks
    .slice(0, MAX_TITLES)
    .map((task) => task.title)
    .join('、');
  const template = titles === '' ? copy.today.overdueBanner : copy.today.overdueWithTitles;
  const [before, after] = template.split('{n}');
  return (
    <View testID="overdue-banner" style={styles.row}>
      <Icon icon={CircleAlert} size={16} strokeWidth={1.9} color={t.statusOverdue} />
      <Text style={styles.label} numberOfLines={2}>
        {before}
        <Text style={styles.count}>{tasks.length}</Text>
        {(after ?? '').replace('{titles}', titles)}
      </Text>
      <Pressable accessibilityRole="button" onPress={onPostpone} hitSlop={8}>
        <Text style={styles.action}>{copy.today.postponeAll}</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: t.space[3],
      marginHorizontal: t.space[4],
      paddingHorizontal: 14,
      paddingVertical: t.space[3],
      borderRadius: 12,
      backgroundColor: withAlpha(t.danger, '14'),
    },
    label: {
      flex: 1,
      minWidth: 0,
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.fgPrimary,
    },
    count: { fontWeight: '700', color: t.statusOverdue, fontVariant: ['tabular-nums'] },
    action: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.accentPrimary },
  });
