import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Tag, Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { isOverdue } from '../lib/format';
import { dueMeta, isDueSoon, recurrenceMeta, reminderMeta } from '../lib/schedule';
import { useTheme } from '../theme/use-theme';
import { PriorityMark, priorityColor } from '../features/todos/priority';

export function TaskRow({
  task,
  indent = false,
  tags = [],
  listName,
  onToggle,
  onPress,
}: {
  task: Task;
  indent?: boolean;
  tags?: Tag[];
  listName?: string;
  onToggle: (task: Task) => void;
  onPress: (task: Task) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const done = task.status === 'done';
  const overdue = isOverdue(task);
  const soon = isDueSoon(task);
  const due = dueMeta(task, task.timezone);
  const reminder = reminderMeta(task, task.timezone);
  const repeat = recurrenceMeta(task);
  const namedTags = tags.filter((tag) => task.tagIds.includes(tag.id)).slice(0, 3);
  const extraTags = Math.max(0, task.tagIds.length - namedTags.length);
  const note = task.notes.replaceAll(/\s+/g, ' ').trim();

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
      {task.priority < 3 ? (
        <View style={[styles.rail, { backgroundColor: priorityColor(task.priority, t) }]} />
      ) : (
        <View style={styles.railSpacer} />
      )}
      <Pressable style={styles.body} onPress={() => onPress(task)}>
        <View style={styles.titleRow}>
          <PriorityMark priority={task.priority} theme={t} />
          <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
            {task.title}
          </Text>
        </View>
        {note !== '' ? (
          <Text style={[styles.note, done && styles.noteDone]} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
        <View style={styles.meta}>
          {due ? (
            <Text style={[styles.secondary, overdue && !done ? styles.overdue : soon ? styles.soon : null]}>
              {due}
            </Text>
          ) : null}
          {reminder ? <Text style={styles.muted}>{reminder}</Text> : null}
          {repeat ? <Text style={styles.muted}>{repeat}</Text> : null}
          {listName ? <Text style={styles.tertiary}>{listName}</Text> : null}
          {namedTags.map((tag) => (
            <Text key={tag.id} style={styles.tertiary}>
              #{tag.name}
            </Text>
          ))}
          {extraTags > 0 ? <Text style={styles.tertiary}>+{extraTags}</Text> : null}
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
    rail: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginTop: 4, marginBottom: 4 },
    railSpacer: { width: 3 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: t.space[1], minWidth: 0 },
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
      flex: 1,
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      color: t.fgPrimary,
    },
    titleDone: { color: t.fgMuted, textDecorationLine: 'line-through' },
    note: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    noteDone: { opacity: 0.7 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    secondary: { fontSize: t.type.caption.fontSize, color: t.textSecondary },
    muted: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    tertiary: { fontSize: t.type.caption.fontSize, color: t.textTertiary },
    overdue: { color: t.statusOverdue },
    soon: { color: t.statusDueSoon },
  });
