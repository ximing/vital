import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import { formatDay, isOverdue } from '../lib/format';
import { useTheme } from '../theme/use-theme';

export function TaskRow({
  task,
  indent = false,
  onToggle,
  onPress,
}: {
  task: Task;
  indent?: boolean;
  onToggle: (task: Task) => void;
  onPress: (task: Task) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const done = task.status === 'done';
  const overdue = isOverdue(task);

  return (
    <View style={[styles.row, indent && styles.indent]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={task.title}
        hitSlop={t.space[2]}
        onPress={() => onToggle(task)}
        style={[styles.check, done && styles.checkDone, overdue && !done && styles.checkOverdue]}
      >
        {done ? <Text style={styles.checkMark}>✓</Text> : null}
      </Pressable>
      <Pressable style={styles.body} onPress={() => onPress(task)}>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.meta}>
          {task.priority === 0 ? (
            <Text style={[styles.tag, { color: t.statusOverdue }]}>{copy.priority[0]}</Text>
          ) : null}
          {task.dueAt ? (
            <Text style={[styles.tag, overdue && !done ? styles.overdue : null]}>
              {formatDay(task.dueAt, task.timezone)}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: t.space[3],
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
      minHeight: t.hit,
      backgroundColor: t.bgCanvas,
    },
    indent: { paddingLeft: t.space[10] },
    check: {
      width: t.space[6],
      height: t.space[6],
      borderRadius: t.radius.pill,
      borderWidth: t.focusRingW,
      borderColor: t.borderSubtle,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    checkDone: {
      backgroundColor: t.statusDone,
      borderColor: t.statusDone,
    },
    checkOverdue: { borderColor: t.statusOverdue },
    checkMark: { color: t.fgOnAccent, fontSize: t.type.caption.fontSize, fontWeight: '700' },
    body: { flex: 1, minWidth: 0, gap: t.space[1] },
    title: {
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      color: t.fgPrimary,
    },
    titleDone: { color: t.fgMuted, textDecorationLine: 'line-through' },
    meta: { flexDirection: 'row', gap: t.space[2] },
    tag: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    overdue: { color: t.statusOverdue },
  });
