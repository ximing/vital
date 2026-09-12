import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Tag, Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { isOverdue, localDateStamp } from '../lib/format';
import { decodeEntities } from '../lib/html';
import { dueMeta, recurrenceMeta, reminderMeta } from '../lib/schedule';
import { useTheme } from '../theme/use-theme';
import { PriorityMark } from '../features/todos/priority';

export function TaskCheckbox({
  task,
  onToggle,
}: {
  task: Task;
  onToggle: (task: Task) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const done = task.status === 'done';
  const overdue = isOverdue(task);
  return (
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
  );
}

/**
 * spec §1.4 / §a 任务行解剖：24 checkbox + 优先级旗标 14px 前置 + 标题 16/22/500
 * + 备注预览 13/18 一行 tertiary + meta 12/16（日期语义色 / 清单名 / #标签最多 2 个 +N）。
 * 日期着色：逾期 statusOverdue；今天全天 statusDoing；今天带时间（临近）statusDueSoon；未来 textSecondary。
 */
export function TaskRow({
  task,
  indent = false,
  tags = [],
  listName,
  onToggle,
  onPress,
  onLongPress,
}: {
  task: Task;
  indent?: boolean;
  tags?: Tag[];
  listName?: string;
  onToggle: (task: Task) => void;
  onPress: (task: Task) => void;
  onLongPress?: (task: Task) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const done = task.status === 'done';
  const overdue = isOverdue(task);
  const due = dueMeta(task, task.timezone);
  const reminder = reminderMeta(task, task.timezone);
  const repeat = recurrenceMeta(task);
  const namedTags = tags.filter((tag) => task.tagIds.includes(tag.id)).slice(0, 2);
  const extraTags = Math.max(0, task.tagIds.length - namedTags.length);
  const note = useMemo(
    () =>
      decodeEntities(task.notes)
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/^\s*#{1,6}\s*/gm, '')
        .replace(/\*\*/g, '')
        .replaceAll(/\s+/g, ' ')
        .trim(),
    [task.notes],
  );

  const dueTone = (() => {
    if (!due) return null;
    if (overdue && !done) return styles.dueOverdue;
    const dueIso = task.dueAt ?? task.startAt;
    if (dueIso !== null) {
      const dueYmd = localDateStamp(task.timezone, new Date(dueIso));
      const todayYmd = localDateStamp(task.timezone);
      if (dueYmd === todayYmd) return task.isAllDay ? styles.dueToday : styles.dueSoon;
    }
    return styles.dueFuture;
  })();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={task.title}
      onPress={() => onPress(task)}
      onLongPress={onLongPress ? () => onLongPress(task) : undefined}
      delayLongPress={320}
      style={({ pressed }) => [styles.row, indent && styles.indent, pressed && styles.pressed]}
    >
      <TaskCheckbox task={task} onToggle={onToggle} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <PriorityMark priority={task.priority} theme={t} size={14} />
          <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
            {task.title}
          </Text>
        </View>
        {note !== '' ? (
          <Text style={[styles.note, done && styles.noteDone]} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
        {due || reminder || repeat || listName || namedTags.length > 0 ? (
          <View style={styles.meta}>
            {due && dueTone ? <Text style={[styles.metaText, dueTone]}>{due}</Text> : null}
            {reminder ? <Text style={styles.metaText}>{reminder}</Text> : null}
            {repeat ? <Text style={styles.metaText}>{repeat}</Text> : null}
            {listName ? <Text style={styles.metaText}>{listName}</Text> : null}
            {namedTags.map((tag) => (
              <Text key={tag.id} style={styles.metaText}>
                #{tag.name}
              </Text>
            ))}
            {extraTags > 0 ? <Text style={styles.metaText}>+{extraTags}</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
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
    },
    indent: { paddingLeft: t.space[10] },
    pressed: { opacity: 0.7 },
    check: {
      width: t.space[6],
      height: t.space[6],
      borderRadius: t.radius.pill,
      borderWidth: 1.5,
      borderColor: t.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    checkDone: {
      backgroundColor: t.statusDone,
      borderColor: t.statusDone,
    },
    checkOverdue: { borderColor: t.statusOverdue },
    checkMark: { color: t.fgOnAccent, fontSize: t.type.meta.fontSize, fontWeight: '700' },
    body: { flex: 1, minWidth: 0, gap: t.space[1] },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    title: {
      flex: 1,
      fontSize: t.type.section.fontSize,
      lineHeight: 22,
      fontWeight: '500',
      color: t.fgPrimary,
    },
    titleDone: { color: t.fgMuted, textDecorationLine: 'line-through' },
    note: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
    },
    noteDone: { opacity: 0.7 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    metaText: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    dueOverdue: { color: t.statusOverdue },
    dueToday: { color: t.statusDoing },
    dueSoon: { color: t.statusDueSoon },
    dueFuture: { color: t.textSecondary },
  });
