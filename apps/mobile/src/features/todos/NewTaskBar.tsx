import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowUp, Calendar, Flag, Plus, Tag as TagIcon } from 'lucide-react-native';
import {
  llmReady,
  type CreateTaskInput,
  type SimilarTaskHit,
  type Tag,
  type Task,
  type TaskPriority,
} from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { useOpenTask } from '../../components/TaskSheetHost';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import {
  addDaysYmdStamp,
  formatHumanDay,
  fromDatetimeLocal,
  localDateStamp,
  zonedLocalMidnightIso,
} from '../../lib/format';
import { markOnboarding } from '../../lib/onboarding';
import { useAuth } from '../../services/auth.service';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { TagCreateRow } from './TaskSheetFields';
import { SimilarOpenSheet } from './SimilarOpenSheet';
import { priorityColor } from './priority';

const TIMES = ['09:00', '14:00', '18:00', '21:00'] as const;
const PRIORITIES: TaskPriority[] = [0, 1, 2, 3];

type DuePick =
  | { source: 'preset' }
  | { source: 'none' }
  | { source: 'day'; ymd: string; allDay: boolean; hm: string | null };

/**
 * Today and Todos share this. A corner button opens the bar and the keyboard.
 * With a title or a chosen date, priority, or tag, tapping outside only dismisses
 * the keyboard. An empty bar closes and the button comes back.
 */
export function NewTaskBar({
  listId,
  extra,
  onCreated,
}: {
  listId: string;
  extra?: Partial<CreateTaskInput>;
  onCreated: (task: Task) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const openTask = useOpenTask();
  const tz = auth.user?.timezone ?? 'UTC';
  const inputRef = useRef<TextInput>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [due, setDue] = useState<DuePick>({ source: 'preset' });
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [dateOpen, setDateOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [similar, setSimilar] = useState<SimilarTaskHit[]>([]);
  const pendingCreated = useRef<Task | null>(null);
  const kept =
    title.trim() !== '' || due.source !== 'preset' || priority !== null || tagIds.length > 0;

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  const today = localDateStamp(tz);
  const tomorrow = addDaysYmdStamp(today, 1);
  const nextWeek = addDaysYmdStamp(today, 7);
  const impliedYmd =
    due.source === 'preset' && extra?.dueAt != null
      ? localDateStamp(tz, new Date(extra.dueAt))
      : null;
  const chosen = due.source === 'day' ? due : null;

  const dateLabel =
    chosen !== null
      ? `${formatHumanDay(chosen.ymd, tz)}${chosen.hm !== null ? ` ${chosen.hm}` : ''}`
      : impliedYmd !== null
        ? formatHumanDay(impliedYmd, tz)
        : copy.todos.composerDate;
  const dateOn = chosen !== null || impliedYmd !== null;
  const priorityOn = priority !== null && priority !== 3;
  const priorityLabel = priorityOn ? copy.todos.priorityLevel[priority] : copy.todos.priority;
  const tagOn = tagIds.length > 0;
  const tagLabel =
    tagIds.length === 0
      ? copy.todos.tags
      : tagIds.length === 1
        ? (tags.find((tag) => tag.id === tagIds[0])?.name ?? copy.todos.tags)
        : `${copy.todos.tags} ${String(tagIds.length)}`;

  function pickDay(ymd: string): void {
    setDue({ source: 'day', ymd, allDay: true, hm: null });
  }

  function resetDraft(): void {
    setTitle('');
    setDue({ source: 'preset' });
    setPriority(null);
    setTagIds([]);
    setOpen(false);
  }

  function dismiss(): void {
    if (kept) {
      inputRef.current?.blur();
      return;
    }
    setOpen(false);
  }

  async function openTags(): Promise<void> {
    setTagOpen(true);
    try {
      const res = await client.listTags();
      setTags(res.items);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async function createTag(name: string): Promise<void> {
    const created = await client.createTag({ name });
    setTags((rows) => [...rows, created]);
    setTagIds((ids) => (ids.includes(created.id) ? ids : [...ids, created.id]));
  }

  async function submit(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    try {
      const explicit = due.source !== 'preset' || priority !== null || tagIds.length > 0;
      const keepPresetDue = due.source === 'preset' && extra?.dueAt !== undefined;
      const task =
        !explicit && !keepPresetDue && llmReady(auth.user?.llm)
          ? await client.createTaskFromText({
              text: trimmed,
              listId,
              ...(tz !== 'UTC' ? { timezone: tz } : {}),
              ...(extra?.status === 'doing' || extra?.status === 'todo' ? { status: extra.status } : {}),
              ...(extra?.priority !== undefined ? { priority: extra.priority } : {}),
            })
          : await client.createTask(buildInput(trimmed));
      resetDraft();
      await markOnboarding(auth.user, auth.refreshUser, { createdTask: true });
      const hits = task.similarOpenTasks ?? [];
      if (hits.length > 0) {
        pendingCreated.current = task;
        setSimilar(hits);
      } else {
        onCreated(task);
      }
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  function buildInput(trimmed: string): CreateTaskInput {
    const input: CreateTaskInput = { title: trimmed, listId };
    if (due.source === 'preset') Object.assign(input, extra);
    if (due.source === 'day') {
      input.timezone = tz;
      if (due.allDay || due.hm === null) {
        input.dueAt = zonedLocalMidnightIso(tz, due.ymd);
        input.isAllDay = true;
      } else {
        input.dueAt = fromDatetimeLocal(`${due.ymd}T${due.hm}`, tz);
        input.isAllDay = false;
      }
    }
    if (extra?.status === 'doing' || extra?.status === 'todo') input.status = extra.status;
    if (priority !== null) input.priority = priority;
    else if (due.source === 'preset' && extra?.priority !== undefined) input.priority = extra.priority;
    if (tagIds.length > 0) input.tagIds = tagIds;
    return input;
  }

  function finishSimilar(): void {
    setSimilar([]);
    const created = pendingCreated.current;
    pendingCreated.current = null;
    if (created) onCreated(created);
  }

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {open ? (
        <>
          {kept ? null : <Pressable style={styles.backdrop} onPress={dismiss} />}
          <View style={styles.wrap}>
      <View style={styles.field}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={copy.todos.addTaskPlaceholder}
          placeholderTextColor={t.textTertiary}
          value={title}
          onChangeText={setTitle}
          editable={!busy}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          autoCapitalize="none"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.actions.add}
          disabled={title.trim() === '' || busy}
          onPress={() => void submit()}
          style={[styles.send, title.trim() !== '' && styles.sendOn]}
        >
          <Icon icon={ArrowUp} size={16} color={title.trim() === '' ? t.textTertiary : t.fgOnAccent} />
        </Pressable>
      </View>
      <View style={styles.chips}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.todos.composerDate}
          onPress={() => setDateOpen(true)}
          style={[styles.chip, dateOn && styles.chipOn]}
        >
          <Icon icon={Calendar} size={14} color={dateOn ? t.accentPrimary : t.fgMuted} />
          <Text style={[styles.chipLabel, dateOn && styles.chipLabelOn]} numberOfLines={1}>
            {dateLabel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.todos.priority}
          onPress={() => setPriorityOpen(true)}
          style={[styles.chip, priorityOn && styles.chipOn]}
        >
          <Icon
            icon={Flag}
            size={14}
            color={priorityOn && priority !== null ? priorityColor(priority, t) : t.fgMuted}
            fill={priority === 0 || priority === 1 ? priorityColor(priority, t) : 'transparent'}
          />
          <Text style={[styles.chipLabel, priorityOn && styles.chipLabelOn]} numberOfLines={1}>
            {priorityLabel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.todos.tags}
          onPress={() => void openTags()}
          style={[styles.chip, tagOn && styles.chipOn]}
        >
          <Icon icon={TagIcon} size={14} color={tagOn ? t.accentPrimary : t.fgMuted} />
          <Text style={[styles.chipLabel, tagOn && styles.chipLabelOn]} numberOfLines={1}>
            {tagLabel}
          </Text>
        </Pressable>
      </View>

      <PickerSheet visible={dateOpen} title={copy.todos.composerDate} onClose={() => setDateOpen(false)}>
        <View style={styles.sheetChips}>
          <SheetChip label={copy.todos.setToday} on={chosen?.ymd === today} onPress={() => pickDay(today)} />
          <SheetChip label={copy.todos.setTomorrow} on={chosen?.ymd === tomorrow} onPress={() => pickDay(tomorrow)} />
          <SheetChip label={copy.todos.setNextWeek} on={chosen?.ymd === nextWeek} onPress={() => pickDay(nextWeek)} />
          <SheetChip
            label={copy.todos.clearDate}
            on={due.source === 'none'}
            onPress={() => setDue({ source: 'none' })}
          />
        </View>
        {chosen !== null ? (
          <View style={styles.sheetChips}>
            <SheetChip
              label={copy.todos.allDay}
              on={chosen.allDay}
              onPress={() => setDue({ ...chosen, allDay: true, hm: null })}
            />
            {TIMES.map((hm) => (
              <SheetChip
                key={hm}
                label={hm}
                on={!chosen.allDay && chosen.hm === hm}
                onPress={() => setDue({ ...chosen, allDay: false, hm })}
              />
            ))}
          </View>
        ) : null}
      </PickerSheet>

      <PickerSheet
        visible={priorityOpen}
        title={copy.todos.priority}
        onClose={() => setPriorityOpen(false)}
      >
        {PRIORITIES.map((level) => (
          <PickerOption
            key={level}
            label={copy.todos.priorityLevel[level]}
            selected={priority === level || (priority === null && level === 3)}
            onPress={() => {
              setPriority(level === 3 ? null : level);
              setPriorityOpen(false);
            }}
          />
        ))}
      </PickerSheet>

      <PickerSheet visible={tagOpen} title={copy.todos.tags} onClose={() => setTagOpen(false)}>
        <TagCreateRow onCreate={createTag} />
        {tags.map((tag) => (
          <PickerOption
            key={tag.id}
            label={tag.name}
            selected={tagIds.includes(tag.id)}
            onPress={() =>
              setTagIds((ids) =>
                ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id],
              )
            }
          />
        ))}
      </PickerSheet>

          </View>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.actions.add}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        >
          <Icon icon={Plus} size={26} color={t.fgOnAccent} />
        </Pressable>
      )}
      <SimilarOpenSheet hits={similar} onClose={finishSimilar} onOpen={openTask} />
    </View>
  );
}

function SheetChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.sheetChip, on && styles.chipOn]}
    >
      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      justifyContent: 'flex-end',
    },
    backdrop: { ...StyleSheet.absoluteFillObject },
    fab: {
      position: 'absolute',
      right: t.space[5],
      bottom: t.space[5],
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.accentPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      ...rnShadow(t),
    },
    fabPressed: { backgroundColor: t.accentPrimaryHover },
    wrap: {
      paddingHorizontal: t.space[4],
      paddingTop: t.space[3],
      paddingBottom: t.space[3],
      gap: t.space[2],
      backgroundColor: t.bgElevated,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borderSubtle,
    },
    field: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
    },
    input: {
      flex: 1,
      minWidth: 0,
      fontSize: t.type.body.fontSize,
      color: t.fgPrimary,
      padding: 0,
    },
    send: {
      width: 28,
      height: 28,
      borderRadius: t.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.bgSurfaceMuted,
    },
    sendOn: { backgroundColor: t.accentPrimary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    chip: {
      height: 28,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgSurfaceMuted,
    },
    chipOn: { backgroundColor: t.bgAccentSubtle },
    chipLabel: { fontSize: 12, fontWeight: '500', color: t.fgMuted },
    chipLabelOn: { color: t.accentPrimary, fontWeight: '600' },
    sheetChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.space[2],
      marginBottom: t.space[3],
    },
    sheetChip: {
      height: 32,
      paddingHorizontal: 12,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgSurfaceMuted,
      justifyContent: 'center',
    },
  });
