import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import type { List, PatchTaskInput, Tag, Task, TaskPriority, TimeBucket } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { Field } from '../../components/Field';
import { Loading } from '../../components/Loading';
import { Screen } from '../../components/Screen';
import { SelectField } from '../../components/SelectField';
import { toast } from '../../components/toast';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { fromDatetimeLocal, localDateStamp, toDatetimeLocal, zonedLocalMidnightIso } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { toggleComplete } from './complete';
import { NotesField } from './NotesField';
import { PriorityMark } from './priority';
import { RecurrenceField, ReminderField } from './schedule-fields';

export function TaskDetail({ taskId }: { taskId: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [next, listRes, tagRes] = await Promise.all([
        client.getTask(taskId),
        client.listLists(),
        client.listTags(),
      ]);
      setTask(next);
      setTitle(next.title);
      setNotes(next.notes);
      setLists(listRes.items.filter((row) => row.kind === 'user' || row.kind === 'inbox'));
      setTags(tagRes.items);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, [taskId]);

  useFocusReload(load);

  if (task === null && error === null) return <Loading />;
  if (task === null) {
    return (
      <Screen scroll>
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: load }}>
          {error ?? copy.empty.upcoming}
        </Banner>
      </Screen>
    );
  }

  const zone = task.timezone || auth.user?.timezone || 'UTC';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const allDay = task.isAllDay;
  const dueValue =
    task.dueAt === null ? '' : allDay ? localDateStamp(zone, new Date(task.dueAt)) : toDatetimeLocal(task.dueAt, zone);
  const startValue =
    task.startAt === null
      ? ''
      : allDay
        ? localDateStamp(zone, new Date(task.startAt))
        : toDatetimeLocal(task.startAt, zone);

  async function patch(input: PatchTaskInput): Promise<void> {
    if (task === null) return;
    try {
      const next = await client.patchTask(task.id, input);
      setTask(next);
      setTitle(next.title);
      setNotes(next.notes);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async function saveTitle(): Promise<void> {
    if (task === null) return;
    const next = title.trim();
    if (next !== '' && next !== task.title) await patch({ title: next });
    else setTitle(task.title);
  }

  async function save(): Promise<void> {
    if (task === null) return;
    setBusy(true);
    try {
      await patch({ title: title.trim() || task.title, notes });
      toast(copy.toast.saved);
    } finally {
      setBusy(false);
    }
  }

  async function addTag(): Promise<void> {
    const name = tagDraft.trim();
    if (name === '' || task === null) return;
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    try {
      if (existing) {
        if (!task.tagIds.includes(existing.id)) {
          await patch({ tagIds: [...task.tagIds, existing.id] });
        }
      } else {
        const created = await client.createTag({ name });
        setTags((prev) => [...prev, created]);
        await patch({ tagIds: [...task.tagIds, created.id] });
      }
      setTagDraft('');
    } catch (err) {
      toast(humanError(err));
    }
  }

  function setStamp(field: 'dueAt' | 'startAt', value: string): void {
    if (value === '') {
      void patch({ [field]: null });
      return;
    }
    const iso = allDay ? zonedLocalMidnightIso(zone, value) : fromDatetimeLocal(value, zone);
    void patch({ [field]: iso, isAllDay: allDay });
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: task.title }} />
      <Field
        label={copy.fields.title}
        value={title}
        onChangeText={setTitle}
        onBlur={() => void saveTitle()}
        autoCapitalize="sentences"
      />

      <Text style={styles.label}>{copy.todos.priority}</Text>
      <View style={styles.chipRow}>
        {([0, 1, 2, 3] as TaskPriority[]).map((p) => {
          const active = task.priority === p;
          return (
            <Pressable
              key={p}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => void patch({ priority: p })}
            >
              <View style={styles.chipInner}>
                <PriorityMark priority={p} theme={t} />
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{copy.priority[p]}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>{copy.todos.list}</Text>
      <View style={styles.chipRow}>
        {lists.map((list) => {
          const active = task.listId === list.id;
          const label = list.kind === 'inbox' ? copy.lists.inbox : list.name;
          return (
            <Pressable
              key={list.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => void patch({ listId: list.id })}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {task.status !== 'done' ? (
        <>
          <Text style={styles.label}>{copy.todos.status.todo}</Text>
          <View style={styles.chipRow}>
            {(['todo', 'doing'] as const).map((status) => {
              const active = (task.status === 'doing' ? 'doing' : 'todo') === status;
              return (
                <Pressable
                  key={status}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => void patch({ status })}
                >
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {copy.todos.status[status]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{copy.todos.allDay}</Text>
        <Switch value={allDay} onValueChange={(next) => void patch({ isAllDay: next })} />
      </View>

      <DateField
        label={copy.todos.due}
        value={dueValue}
        kind={allDay ? 'date' : 'datetime-local'}
        zone={zone}
        weekStartsOn={weekStartsOn}
        onChange={(next) => setStamp('dueAt', next)}
      />
      <DateField
        label={copy.todos.start}
        value={startValue}
        kind={allDay ? 'date' : 'datetime-local'}
        zone={zone}
        weekStartsOn={weekStartsOn}
        onChange={(next) => setStamp('startAt', next)}
      />

      {task.dueAt === null && task.startAt === null ? (
        <SelectField
          label={copy.todos.timeBucket}
          value={task.timeBucket}
          options={[
            { value: 'anytime', label: copy.lists.anytime },
            { value: 'someday', label: copy.lists.someday },
            { value: 'dated', label: copy.todos.due },
          ]}
          onChange={(timeBucket) => void patch({ timeBucket: timeBucket as TimeBucket, dueAt: null, startAt: null })}
        />
      ) : null}

      <RecurrenceField task={task} onPatch={(input) => void patch(input)} />
      <ReminderField
        task={task}
        zone={zone}
        weekStartsOn={weekStartsOn}
        onPatch={(input) => void patch(input)}
      />

      <Text style={styles.label}>{copy.todos.tags}</Text>
      <View style={styles.chipRow}>
        {tags.map((tag) => {
          const on = task.tagIds.includes(tag.id);
          return (
            <Pressable
              key={tag.id}
              style={[styles.chip, on && styles.chipActive]}
              onPress={() => {
                const tagIds = on ? task.tagIds.filter((id) => id !== tag.id) : [...task.tagIds, tag.id];
                void patch({ tagIds });
              }}
            >
              <Text style={[styles.chipLabel, on && styles.chipLabelActive]}>#{tag.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field
        label={copy.todos.addTag}
        value={tagDraft}
        onChangeText={setTagDraft}
        onSubmitEditing={() => void addTag()}
        returnKeyType="done"
      />

      <NotesField value={notes} onChange={setNotes} />

      <View style={styles.actions}>
        <Button loading={busy} loadingText={copy.actions.saving} onPress={() => void save()}>
          {copy.actions.save}
        </Button>
        {task.status !== 'done' ? (
          <Button
            variant="secondary"
            onPress={() =>
              void toggleComplete(task, setTask, { user: auth.user, refreshUser: auth.refreshUser })
            }
          >
            {copy.actions.completed}
          </Button>
        ) : null}
      </View>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    label: { fontSize: t.type.meta.fontSize, color: t.fgMuted, marginTop: t.space[2] },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    chip: {
      minHeight: t.space[8],
      paddingHorizontal: t.space[3],
      borderRadius: t.radius.pill,
      backgroundColor: t.bgSurfaceMuted,
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.bgAccentSubtle },
    chipLabel: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    chipLabelActive: { color: t.fgPrimary, fontWeight: '600' },
    chipInner: { flexDirection: 'row', alignItems: 'center', gap: t.space[1] },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: t.hit,
    },
    switchLabel: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    actions: { flexDirection: 'row', gap: t.space[2], flexWrap: 'wrap', marginTop: t.space[2] },
  });
