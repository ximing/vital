import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { observer, useService } from '@rabjs/react';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { Field } from '../../components/Field';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { copy } from '../../lib/copy';
import { addDaysYmdStamp, formatHumanDay, localDateStamp, toDatetimeLocal } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { RecurrenceField } from './schedule-fields';
import { TaskSheetService } from './task-sheet.service';
import { proposalDeferCount, proposalDraft, proposalSubtasks } from './task-text';

const ESTIMATES = [15, 30, 60, 120] as const;

function QuickChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipOn : null]}
    >
      <Text style={[styles.chipLabel, selected ? styles.chipLabelOn : null]}>{label}</Text>
    </Pressable>
  );
}

/** Today / tomorrow / next week / clear, plus the all-day ↔ time switch. Visible in the half sheet. */
export const QuickSchedule = observer(function QuickSchedule() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(TaskSheetService);
  const task = s.task;
  if (task === null) return null;
  const zone = s.zone;
  const today = localDateStamp(zone);
  const dueYmd = task.dueAt === null ? null : localDateStamp(zone, new Date(task.dueAt));
  const tomorrow = addDaysYmdStamp(today, 1);
  const nextWeek = addDaysYmdStamp(today, 7);
  return (
    <View style={styles.quick}>
      <QuickChip label={copy.todos.setToday} selected={dueYmd === today} onPress={() => s.scheduleOn(today)} />
      <QuickChip
        label={copy.todos.setTomorrow}
        selected={dueYmd === tomorrow}
        onPress={() => s.scheduleOn(tomorrow)}
      />
      <QuickChip
        label={copy.todos.setNextWeek}
        selected={dueYmd === nextWeek}
        onPress={() => s.scheduleOn(nextWeek)}
      />
      {task.dueAt !== null || task.startAt !== null ? (
        <QuickChip label={copy.todos.clearDate} onPress={() => s.clearSchedule()} />
      ) : null}
      {task.dueAt !== null ? (
        <QuickChip
          label={task.isAllDay ? copy.todos.addTime : copy.todos.allDay}
          onPress={() => s.setAllDay(!task.isAllDay)}
        />
      ) : null}
    </View>
  );
});

export function TagCreateRow({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [name, setName] = useState('');

  async function submit(): Promise<void> {
    const next = name.trim();
    if (next === '') return;
    await onCreate(next);
    setName('');
  }

  return (
    <View style={styles.tagCreate}>
      <Field
        label={copy.todos.addTag}
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => void submit()}
        autoCapitalize="none"
        maxLength={40}
      />
      <Button size="sm" variant="secondary" disabled={name.trim() === ''} onPress={() => void submit()}>
        {copy.todos.addTag}
      </Button>
    </View>
  );
}

/** Fields the half sheet clips: start, repeat, thread, estimate, agent draft, decompose. */
export const TaskSheetExtras = observer(function TaskSheetExtras({ full }: { full: boolean }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(TaskSheetService);
  const draftStatus = s.draft?.status ?? null;
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');

  useEffect(() => {
    if (draftStatus !== 'queued') return;
    const timer = setInterval(() => {
      void s.refreshDraft();
    }, 3000);
    return () => clearInterval(timer);
  }, [draftStatus, s]);

  const task = s.task;
  if (!full || task === null) return null;

  const zone = s.zone;
  const weekStartsOn = s.weekStartsOn;
  const startValue =
    task.startAt === null
      ? ''
      : task.isAllDay
        ? localDateStamp(zone, new Date(task.startAt))
        : toDatetimeLocal(task.startAt, zone);
  const startSummary =
    task.startAt === null
      ? copy.todos.addDate
      : task.isAllDay
        ? formatHumanDay(localDateStamp(zone, new Date(task.startAt)), zone)
        : `${formatHumanDay(localDateStamp(zone, new Date(task.startAt)), zone)} ${toDatetimeLocal(task.startAt, zone).slice(11, 16)}`;
  const outcomeName = s.outcomes.find((row) => row.id === task.outcomeId)?.name ?? copy.todos.noOutcome;
  const estimateLabel =
    task.estimateMinutes === null
      ? copy.todos.estimateNone
      : copy.todos.estimateMinutes.replace('{n}', String(task.estimateMinutes));
  const draftable = task.status === 'todo' || task.status === 'doing';
  const proposal = s.draft?.action ?? null;
  const draftText = proposal === null ? '' : proposalDraft(proposal.payload).trim();
  const draftSubs = proposal === null ? [] : proposalSubtasks(proposal.payload);
  const hasProposal = draftText !== '' || draftSubs.length > 0;
  const waiting = draftStatus === 'queued' && proposal === null;
  const failed = draftStatus === 'failed' && proposal === null;
  const decomposeSubs = s.decompose === null ? [] : proposalSubtasks(s.decompose.payload);
  const deferCount = s.decompose === null ? null : proposalDeferCount(s.decompose.payload);

  function applyCustomEstimate(): void {
    const minutes = Number(customMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 100000) return;
    s.setEstimate(minutes);
    setCustomMinutes('');
    setEstimateOpen(false);
  }

  return (
    <View style={styles.extras}>
      <DateField
        label={copy.todos.start}
        value={startValue}
        kind={task.isAllDay ? 'date' : 'datetime-local'}
        zone={zone}
        weekStartsOn={weekStartsOn}
        onChange={(value) => s.setStart(value)}
        trigger={
          <View style={styles.prop}>
            <Text style={styles.propLabel}>{copy.todos.start}</Text>
            <Text style={[styles.propValue, task.startAt === null && styles.propMuted]} numberOfLines={1}>
              {startSummary}
            </Text>
          </View>
        }
      />
      <RecurrenceField task={task} onPatch={(input) => void s.patch(input)} />
      <Pressable accessibilityRole="button" onPress={() => setOutcomeOpen(true)} style={styles.prop}>
        <Text style={styles.propLabel}>{copy.todos.outcome}</Text>
        <Text style={styles.propValue} numberOfLines={1}>
          {outcomeName}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => setEstimateOpen(true)} style={styles.prop}>
        <Text style={styles.propLabel}>{copy.todos.estimate}</Text>
        <Text style={styles.propValue} numberOfLines={1}>
          {estimateLabel}
        </Text>
      </Pressable>

      {task.parentId === null && s.decompose !== null && decomposeSubs.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {copy.today.decomposeTitle.replace('{n}', String(deferCount ?? 3))}
          </Text>
          <Text style={styles.cardHint}>{copy.today.decomposeHint}</Text>
          {decomposeSubs.map((row, index) => (
            <Text key={`${String(index)}-${row.title}`} style={styles.cardLine}>
              {index + 1}. {row.title}
            </Text>
          ))}
          <View style={styles.cardActions}>
            <Button size="sm" loading={s.agentBusy} onPress={() => void s.settleDecompose('accepted')}>
              {copy.today.decomposeAccept}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={s.agentBusy}
              onPress={() => void s.settleDecompose('dismissed')}
            >
              {copy.today.decomposeDismiss}
            </Button>
          </View>
        </View>
      ) : null}

      {draftable ? (
        <View style={styles.draft}>
          <View style={styles.switchRow}>
            <Text style={styles.propValue}>{copy.todos.delegable}</Text>
            <Switch
              accessibilityLabel={copy.todos.delegable}
              value={task.delegable}
              trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              ios_backgroundColor={t.bgSurfaceMuted}
              onValueChange={(value) => s.setDelegable(value)}
            />
          </View>
          {task.delegable && !hasProposal ? (
            <Text style={styles.cardHint}>{copy.todos.delegableHint}</Text>
          ) : null}
          {task.delegable && !hasProposal && !failed ? (
            <Button
              size="sm"
              variant="quiet"
              loading={waiting || s.agentBusy}
              onPress={() => void s.triggerDraft()}
            >
              {waiting ? copy.todos.draftWaiting : copy.todos.draftTrigger}
            </Button>
          ) : null}
          {task.delegable && failed ? (
            <View style={styles.cardActions}>
              <Text style={styles.cardHint}>{copy.todos.draftFailed}</Text>
              <Button size="sm" variant="quiet" onPress={() => void s.triggerDraft()}>
                {copy.todos.draftRetry}
              </Button>
            </View>
          ) : null}
          {task.delegable && hasProposal ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{copy.todos.draftTitle}</Text>
              <Text style={styles.cardHint}>
                {draftSubs.length > 0 ? copy.todos.draftHintWithSubtasks : copy.todos.draftHint}
              </Text>
              {draftText !== '' ? <Text style={styles.draftBody}>{draftText}</Text> : null}
              {draftSubs.length > 0 ? (
                <View>
                  <Text style={styles.cardHint}>{copy.todos.draftSubtasks}</Text>
                  {draftSubs.map((row, index) => (
                    <Text key={`${String(index)}-${row.title}`} style={styles.cardLine}>
                      {index + 1}. {row.title}
                      {row.estimateMinutes !== null
                        ? ` · ${copy.todos.estimateMinutes.replace('{n}', String(row.estimateMinutes))}`
                        : ''}
                    </Text>
                  ))}
                </View>
              ) : null}
              <View style={styles.cardActions}>
                {draftText !== '' ? (
                  <Button size="sm" loading={s.agentBusy} onPress={() => void s.acceptDraft()}>
                    {copy.todos.draftApply}
                  </Button>
                ) : null}
                {draftSubs.length > 0 ? (
                  <Button
                    size="sm"
                    variant={draftText !== '' ? 'quiet' : 'primary'}
                    loading={s.agentBusy}
                    onPress={() => void s.acceptDraft()}
                  >
                    {copy.todos.draftApplySubtasks}
                  </Button>
                ) : null}
                <Button size="sm" variant="quiet" disabled={s.agentBusy} onPress={() => void s.dismissDraft()}>
                  {copy.todos.draftDismiss}
                </Button>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <PickerSheet visible={outcomeOpen} title={copy.todos.outcome} onClose={() => setOutcomeOpen(false)}>
        <PickerOption
          label={copy.todos.noOutcome}
          selected={task.outcomeId === null}
          onPress={() => {
            s.setOutcome(null);
            setOutcomeOpen(false);
          }}
        />
        {s.outcomes.map((row) => (
          <PickerOption
            key={row.id}
            label={row.name}
            selected={task.outcomeId === row.id}
            onPress={() => {
              s.setOutcome(row.id);
              setOutcomeOpen(false);
            }}
          />
        ))}
      </PickerSheet>

      <PickerSheet visible={estimateOpen} title={copy.todos.estimate} onClose={() => setEstimateOpen(false)}>
        <PickerOption
          label={copy.todos.estimateNone}
          selected={task.estimateMinutes === null}
          onPress={() => {
            s.setEstimate(null);
            setEstimateOpen(false);
          }}
        />
        {ESTIMATES.map((minutes) => (
          <PickerOption
            key={minutes}
            label={copy.todos.estimateMinutes.replace('{n}', String(minutes))}
            selected={task.estimateMinutes === minutes}
            onPress={() => {
              s.setEstimate(minutes);
              setEstimateOpen(false);
            }}
          />
        ))}
        <View style={styles.tagCreate}>
          <TextInput
            value={customMinutes}
            onChangeText={(value) => setCustomMinutes(value.replaceAll(/[^0-9]/g, ''))}
            onSubmitEditing={applyCustomEstimate}
            keyboardType="number-pad"
            maxLength={6}
            placeholder={copy.todos.estimateCustomPlaceholder}
            placeholderTextColor={t.textTertiary}
            style={styles.minutes}
          />
          <Button size="sm" variant="secondary" disabled={customMinutes.trim() === ''} onPress={applyCustomEstimate}>
            {copy.todos.estimateApply}
          </Button>
        </View>
      </PickerSheet>
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    quick: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.space[2],
      marginTop: t.space[2],
    },
    chip: {
      height: 32,
      paddingHorizontal: 12,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgSurfaceMuted,
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: t.bgAccentSubtle },
    chipLabel: { fontSize: 13, fontWeight: '500', color: t.fgMuted },
    chipLabelOn: { color: t.accentPrimary, fontWeight: '600' },
    extras: { marginTop: t.space[4], gap: t.space[3] },
    prop: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
    },
    propLabel: { width: 64, fontSize: 13, color: t.textTertiary },
    propValue: { flex: 1, textAlign: 'right', fontSize: 14, color: t.fgPrimary },
    propMuted: { color: t.textTertiary },
    card: {
      borderRadius: t.radius.lg,
      backgroundColor: t.bgAccentSubtle,
      padding: t.space[3],
      gap: t.space[2],
    },
    cardTitle: { fontSize: 14, fontWeight: '600', color: t.fgPrimary },
    cardHint: { fontSize: 12, lineHeight: 18, color: t.fgMuted },
    cardLine: { fontSize: 14, color: t.fgPrimary },
    cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2], alignItems: 'center' },
    draft: { gap: t.space[2] },
    draftBody: { fontSize: 14, lineHeight: 21, color: t.fgPrimary },
    switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: t.space[3] },
    tagCreate: { padding: t.space[3], gap: t.space[2] },
    minutes: {
      minHeight: t.controlH,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      fontSize: 14,
      color: t.fgPrimary,
      backgroundColor: t.bgSurfaceMuted,
    },
  });
