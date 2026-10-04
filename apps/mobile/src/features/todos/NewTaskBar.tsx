import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowUp, Calendar, Flag, Plus, Sparkles, Tag as TagIcon } from 'lucide-react-native';
import {
  type CreateTaskInput,
  type SimilarTaskHit,
  type SmartListId,
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
import { addDaysYmdStamp, formatHumanDay, localDateStamp } from '../../lib/format';
import { markOnboarding } from '../../lib/onboarding';
import { useAuth } from '../../services/auth.service';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { TagCreateRow } from './TaskSheetFields';
import { SimilarOpenSheet } from './SimilarOpenSheet';
import { composeTaskRequest, willParseTaskText, type ComposeDue } from './compose-task';
import { priorityColor } from './priority';

const TIMES = ['09:00', '14:00', '18:00', '21:00'] as const;
const PRIORITIES: TaskPriority[] = [0, 1, 2, 3];
/**
 * Today and Todos share this. A corner button opens the bar and the keyboard.
 * With a title or a chosen date, priority, or tag, tapping outside only dismisses
 * the keyboard. An empty bar closes and the button comes back.
 */
export function NewTaskBar({
  listId,
  extra,
  smartListId,
  contextDueYmd,
  onCreated,
}: {
  listId: string;
  extra?: Partial<CreateTaskInput>;
  /** Smart list the composer is sitting on. Passed through to task.parse. */
  smartListId?: SmartListId;
  /** Week-view day. Fallback due for the parser when the user left the date chip alone. */
  contextDueYmd?: string;
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
  const [status, setStatus] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [slow, setSlow] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [due, setDue] = useState<ComposeDue>({ source: 'preset' });
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

  // AI 解析等待态：边框流光（颜色插值）+ ✦ 呼吸 + 阶段文案轮播；
  // 超过 8s（slow）表演停止，退回克制的纯文字提示。
  const [flowAnim] = useState(() => new Animated.Value(0));
  const [breathAnim] = useState(() => new Animated.Value(0));
  const [stageFade] = useState(() => new Animated.Value(1));
  const aiLive = parsing && !slow;

  useEffect(() => {
    if (!aiLive) return;
    const timer = setInterval(
      () => setStageIdx((i) => Math.min(i + 1, copy.todos.interpretingStages.length - 1)),
      1200,
    );
    return () => clearInterval(timer);
  }, [aiLive]);

  useEffect(() => {
    if (!aiLive) return;
    flowAnim.setValue(0);
    breathAnim.setValue(0);
    const flow = Animated.loop(
      Animated.timing(flowAnim, {
        toValue: 1,
        duration: 3200,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    const breath = Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathAnim, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    flow.start();
    breath.start();
    return () => {
      flow.stop();
      breath.stop();
    };
  }, [aiLive, flowAnim, breathAnim]);

  useEffect(() => {
    stageFade.setValue(0);
    Animated.timing(stageFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [stageIdx, stageFade]);

  const flowBorderColor = flowAnim.interpolate({
    inputRange: [0, 0.33, 0.66, 1],
    outputRange: [t.accentPrimary, t.aiFlowB, t.aiFlowC, t.accentPrimary],
  });
  const breathScale = breathAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const breathOpacity = breathAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  const today = localDateStamp(tz);
  const tomorrow = addDaysYmdStamp(today, 1);
  const nextWeek = addDaysYmdStamp(today, 7);
  const parses = willParseTaskText({ llm: auth.user?.llm, due, tagIds });
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
  // While the parser owns the sentence, a view due is only a fallback, not a locked chip.
  const dateOn = chosen !== null || (impliedYmd !== null && !parses);
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
    const request = composeTaskRequest({
      text: trimmed,
      listId,
      timezone: tz,
      llm: auth.user?.llm,
      due,
      priority,
      tagIds,
      ...(extra !== undefined ? { extra } : {}),
      ...(smartListId !== undefined ? { smartListId } : {}),
      ...(contextDueYmd !== undefined ? { contextDueYmd } : {}),
    });
    setBusy(true);
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    if (request.kind === 'text') {
      setParsing(true);
      setSlow(false);
      setStageIdx(0);
      waitTimer = setTimeout(() => {
        setSlow(true);
        setStatus(copy.todos.creatingWait);
      }, 8000);
    }
    try {
      const task =
        request.kind === 'text'
          ? await client.createTaskFromText(request.body)
          : await client.createTask(request.body);
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
      if (waitTimer !== undefined) clearTimeout(waitTimer);
      setStatus(null);
      setParsing(false);
      setSlow(false);
      setBusy(false);
    }
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
        {aiLive ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.aiFrame, { borderColor: flowBorderColor }]}
          />
        ) : null}
        {aiLive ? (
          <Animated.View style={{ opacity: breathOpacity, transform: [{ scale: breathScale }] }}>
            <Icon icon={Sparkles} size={14} color={t.aiFlowC} />
          </Animated.View>
        ) : null}
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={parses ? copy.todos.composeIntent : copy.todos.addTaskPlaceholder}
          placeholderTextColor={t.textTertiary}
          value={title}
          onChangeText={setTitle}
          editable={!busy}
          maxLength={parses ? 2000 : 500}
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
      {aiLive ? (
        <View style={styles.statusRow} accessibilityLiveRegion="polite">
          <Animated.View style={{ opacity: breathOpacity, transform: [{ scale: breathScale }] }}>
            <Icon icon={Sparkles} size={12} color={t.aiFlowC} />
          </Animated.View>
          <Animated.Text style={[styles.status, styles.aiStatus, { opacity: stageFade }]}>
            {copy.todos.interpretingStages[stageIdx]}
          </Animated.Text>
        </View>
      ) : status !== null ? (
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {status}
        </Text>
      ) : null}

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
    aiFrame: {
      margin: -6,
      borderWidth: 1.5,
      borderRadius: t.radius.md + 6,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    aiStatus: { color: t.fgMuted },
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
    status: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.accentPrimary,
    },
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
