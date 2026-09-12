import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';

import {
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  Ellipsis,
  Flag,
  ListTodo,
  Plus,
  Tag as TagIcon,
} from 'lucide-react-native';
import type { TaskPriority } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { DateField } from '../../components/DateField';
import { Loading } from '../../components/Loading';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SectionHead } from '../../components/SectionHead';
import { TaskCheckbox } from '../../components/TaskRow';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import {
  formatHm,
  formatHumanDay,
  fromDatetimeLocal,
  isOverdue,
  localDateStamp,
  toDatetimeLocal,
  zonedLocalMidnightIso,
} from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { Icon } from '../../ui/icon';
import { rnShadow } from '../../ui/card';
import { priorityColor } from './priority';
import { ReminderPicker } from './schedule-fields';
import { AddSubtaskRow, SubtaskRow } from './subtasks';
import { TaskSheetService } from './task-sheet.service';

const PRIORITIES: TaskPriority[] = [0, 1, 2, 3];

/** spec §b 优先级段选旗标 16px：P0 红实心 / P1 琥珀实心 / P2 蓝线框 / P3 灰线框。 */
function PriorityFlag({ level, theme }: { level: TaskPriority; theme: Theme }) {
  if (level === 3) return <Icon icon={Flag} size={16} color={theme.textTertiary} />;
  const color = priorityColor(level, theme);
  return <Icon icon={Flag} size={16} color={color} fill={level === 2 ? 'transparent' : color} />;
}

/** 工具条入口视觉（图标 20 + 文字 13/500），Pressable 与否由外层决定。 */
function ToolFace({ icon, label }: { icon: typeof TagIcon; label: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 40,
        paddingHorizontal: 12,
        borderRadius: t.radius.md,
      }}
    >
      <Icon icon={icon} size={20} color={t.fgMuted} />
      <Text style={{ fontSize: 13, fontWeight: '500', color: t.fgMuted }}>{label}</Text>
    </View>
  );
}

/** 底部工具条入口按钮。 */
function ToolButton({
  icon,
  label,
  onPress,
}: {
  icon: typeof TagIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
    >
      <ToolFace icon={icon} label={label} />
    </Pressable>
  );
}

const TaskSheetContent = observer(function TaskSheetContent({
  taskId,
  full,
  onClose,
}: {
  taskId: string;
  full: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(TaskSheetService);
  useFocusReload(
    useCallback(async () => {
      s.configure(taskId);
      await s.load();
    }, [s, taskId]),
  );

  const task = s.task;
  if (task === null) return <Loading />;

  const zone = s.zone;
  const weekStartsOn = s.weekStartsOn;
  const lists = s.lists;
  const tags = s.tags;
  const list = lists.find((row) => row.id === task.listId);
  const listName = list?.kind === 'inbox' ? copy.lists.inbox : (list?.name ?? copy.todos.list);
  const namedTags = s.namedTags;
  const done = task.status === 'done';
  const overdue = isOverdue(task);
  const allDay = task.isAllDay;

  const todayYmd = localDateStamp(zone);
  const dueYmd = task.dueAt === null ? null : localDateStamp(zone, new Date(task.dueAt));
  const dueText = (() => {
    if (task.dueAt === null || dueYmd === null) return copy.todos.addDate;
    const day = formatHumanDay(dueYmd, zone);
    return allDay ? day : `${day} ${formatHm(task.dueAt, zone)}`;
  })();
  const dueColor = (() => {
    if (task.dueAt === null) return t.textTertiary;
    if (overdue && !done) return t.statusOverdue;
    if (dueYmd === todayYmd) return allDay ? t.statusDoing : t.statusDueSoon;
    return t.fgMuted;
  })();
  const dueValue =
    task.dueAt === null
      ? ''
      : allDay
        ? localDateStamp(zone, new Date(task.dueAt))
        : toDatetimeLocal(task.dueAt, zone);

  function setDue(value: string): void {
    if (value === '') {
      void s.patch({ dueAt: null });
      return;
    }
    const iso = allDay ? zonedLocalMidnightIso(zone, value) : fromDatetimeLocal(value, zone);
    void s.patch({ dueAt: iso, isAllDay: allDay });
  }

  const doneSubtasks = s.doneSubtasks;

  return (
    <View style={styles.wrap}>
      {/* sheet 头行：清单 chip + 优先级段选 + ⋯（全屏档左侧加 ‹） */}
      <View style={styles.header}>
        {full ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.back}
            onPress={onClose}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Icon icon={ChevronLeft} size={22} color={t.fgPrimary} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.todos.list}
          onPress={() => s.openList()}
          style={styles.listChip}
        >
          <Text style={styles.listChipLabel} numberOfLines={1}>
            {listName}
          </Text>
          <Icon icon={ChevronDown} size={14} color={t.fgMuted} />
        </Pressable>
        <View style={styles.headerRight}>
          <View style={styles.prio} accessibilityRole="radiogroup">
            {PRIORITIES.map((level) => {
              const on = task.priority === level;
              return (
                <Pressable
                  key={level}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={copy.todos.priorityLevel[level]}
                  onPress={() => void s.patch({ priority: level })}
                  style={[styles.prioBtn, on && styles.prioOn]}
                >
                  <PriorityFlag level={level} theme={t} />
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.todos.more}
            onPress={() => s.openMore()}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Icon icon={Ellipsis} size={20} color={t.fgMuted} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.main}
        scrollEnabled={full}
        nestedScrollEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.mainContent}
      >
        {/* 日期行：checkbox + 语义色日期文本 */}
        <View style={styles.dueRow}>
          <TaskCheckbox task={task} onToggle={() => void s.complete()} />
          <DateField
            label={copy.todos.due}
            value={dueValue}
            kind={allDay ? 'date' : 'datetime-local'}
            zone={zone}
            weekStartsOn={weekStartsOn}
            onChange={setDue}
            trigger={
              <Text style={[styles.due, { color: dueColor }]} numberOfLines={1}>
                {dueText}
              </Text>
            }
          />
        </View>

        <TextInput
          value={s.title}
          onChangeText={(title) => s.setTitle(title)}
          onEndEditing={() => void s.saveTitle()}
          multiline
          scrollEnabled={full}
          style={[styles.title, done && styles.titleDone]}
          placeholder={copy.fields.title}
          placeholderTextColor={t.textTertiary}
        />
        <TextInput
          value={s.notes}
          onChangeText={(notes) => s.setNotes(notes)}
          onEndEditing={() => void s.saveNotes()}
          multiline
          scrollEnabled={full}
          style={[styles.notes, full ? styles.notesFull : styles.notesHalf]}
          placeholder={copy.todos.addNotes}
          placeholderTextColor={t.textTertiary}
        />

        {/* 标签 chips + 虚线「+ 标签」 */}
        <View style={styles.tags}>
          {namedTags.map((tag) => (
            <View key={tag.id} style={styles.tagChip}>
              <Text style={styles.tagLabel}>{tag.name}</Text>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.todos.addTag}
            onPress={() => s.openTags()}
            style={({ pressed }) => [styles.tagAdd, pressed && styles.pressed]}
          >
            <Plus size={12} color={t.textTertiary} />
            <Text style={styles.tagAddLabel}>{copy.todos.tags}</Text>
          </Pressable>
        </View>

        {/* 全屏档：子任务区 */}
        {full && task.parentId === null ? (
          <View style={styles.subtasks}>
            <SectionHead
              first
              title={
                s.subtasks.length > 0
                  ? `${copy.todos.subtasks} ${doneSubtasks}/${s.subtasks.length}`
                  : copy.todos.subtasks
              }
            />
            {s.subtasks.map((row) => (
              <SubtaskRow key={row.id} row={row} onToggle={(item) => void s.toggleSubtask(item)} />
            ))}
            <AddSubtaskRow onAdd={(title) => s.addSubtask(title)} openToken={s.subAddToken} />
          </View>
        ) : null}
      </ScrollView>

      {/* 底部工具条：标签 / 子任务 / 提醒 / 排期 */}
      <View style={styles.toolbar}>
        <ToolButton icon={TagIcon} label={copy.todos.tags} onPress={() => s.openTags()} />
        <ToolButton
          icon={ListTodo}
          label={copy.todos.subtasks}
          onPress={() => {
            if (!full) {
              s.hintSubtasksHalf();
              return;
            }
            s.bumpSubAdd();
          }}
        />
        <ReminderPicker task={task} onPatch={(input) => void s.patch(input)}>
          {(openReminder) => (
            <ToolButton icon={Bell} label={copy.todos.remind} onPress={openReminder} />
          )}
        </ReminderPicker>
        <DateField
          label={copy.todos.schedule}
          value={dueValue}
          kind={allDay ? 'date' : 'datetime-local'}
          zone={zone}
          weekStartsOn={weekStartsOn}
          onChange={setDue}
          trigger={<ToolFace icon={CalendarClock} label={copy.todos.schedule} />}
        />
      </View>

      <PickerSheet visible={s.listOpen} title={copy.todos.list} onClose={() => s.closeList()}>
        {lists.map((row) => (
          <PickerOption
            key={row.id}
            label={row.kind === 'inbox' ? copy.lists.inbox : row.name}
            selected={task.listId === row.id}
            onPress={() => void s.selectList(row.id)}
          />
        ))}
      </PickerSheet>

      <PickerSheet visible={s.tagOpen} title={copy.todos.tags} onClose={() => s.closeTags()}>
        {tags.map((tag) => {
          const on = task.tagIds.includes(tag.id);
          return (
            <PickerOption
              key={tag.id}
              label={`#${tag.name}`}
              selected={on}
              onPress={() => void s.toggleTag(tag.id)}
            />
          );
        })}
      </PickerSheet>

      <PickerSheet visible={s.moreOpen} title={copy.todos.more} onClose={() => s.closeMore()}>
        <PickerOption
          label={task.pinned ? copy.todos.unpin : copy.todos.pin}
          onPress={() => void s.togglePin()}
        />
        {task.status !== 'canceled' ? (
          <PickerOption
            label={copy.todos.abandon}
            onPress={() => {
              void s.abandon().then((ok) => {
                if (ok) onClose();
              });
            }}
          />
        ) : null}
        <PickerOption
          label={copy.todos.deleteTask}
          destructive
          onPress={() => {
            void s.remove().then((ok) => {
              if (ok) onClose();
            });
          }}
        />
      </PickerSheet>
    </View>
  );
});

export const TaskSheet = bindServices(TaskSheetContent, [TaskSheetService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { flex: 1, minHeight: 0 },
    main: { flex: 1, minHeight: 0 },
    mainContent: { paddingHorizontal: 20, paddingBottom: t.space[4] },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 44,
      paddingHorizontal: t.space[2],
    },
    iconBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.5 },
    listChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 32,
      maxWidth: 160,
      paddingHorizontal: 12,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgSurfaceMuted,
    },
    listChipLabel: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: t.fgPrimary },
    headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
    prio: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      backgroundColor: t.bgSurfaceMuted,
      borderRadius: 10,
      padding: 2,
    },
    prioBtn: {
      width: 30,
      height: 30,
      borderRadius: t.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: 0.4,
    },
    prioOn: { opacity: 1, backgroundColor: t.bgElevated, ...rnShadow(t) },
    dueRow: { flexDirection: 'row', alignItems: 'center', gap: t.space[3], minHeight: 40, marginTop: 2 },
    due: { fontSize: 14, lineHeight: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
    title: {
      fontSize: 22,
      lineHeight: 30,
      fontWeight: '700',
      color: t.fgPrimary,
      marginTop: 10,
      marginBottom: t.space[2],
      padding: 0,
    },
    titleDone: { color: t.fgMuted, textDecorationLine: 'line-through' },
    notes: {
      fontSize: 14,
      lineHeight: 21,
      color: t.fgMuted,
      padding: 0,
    },
    notesHalf: { maxHeight: 63 },
    notesFull: { minHeight: 120 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2], marginTop: 14 },
    tagChip: {
      height: 28,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: 12,
      justifyContent: 'center',
    },
    tagLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: t.accentPrimary },
    tagAdd: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 28,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: t.textTertiary,
      paddingHorizontal: 12,
    },
    tagAddLabel: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: t.textTertiary },
    subtasks: { marginTop: t.space[2] },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      minHeight: 56,
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[1],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borderSubtle,
    },
  });
