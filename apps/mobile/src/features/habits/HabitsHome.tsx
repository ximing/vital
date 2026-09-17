import { useCallback, useEffect, useMemo } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, router } from 'expo-router';
import { ChevronLeft, Ellipsis, Flame, Pencil, Pause, Play, Plus, Trash2 } from 'lucide-react-native';
import type { Habit } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { BottomSheet } from '../../components/BottomSheet';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorText } from '../../components/ErrorText';
import { Field } from '../../components/Field';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SelectField } from '../../components/SelectField';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { localDateStamp } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { cardStyle, rnShadow } from '../../ui/card';
import { HabitCheckinCalendar, HabitMonthNav } from './HabitCheckinCalendar';
import { HabitsService } from './habits.service';

/** 行内频率描述：类型 · 时间窗 · 所属线程 · 今日进度（暂停时标注）。 */
export function habitMeta(habit: Habit, threadName?: string): string {
  const parts: string[] = [
    habit.kind === 'count'
      ? copy.habits.countChip.replace('{n}', String(habit.targetCount ?? 0))
      : copy.habits.dailyChip,
  ];
  if (habit.windowStart && habit.windowEnd) parts.push(`${habit.windowStart}–${habit.windowEnd}`);
  if (threadName) parts.push(threadName);
  if (!habit.active) {
    parts.push(copy.habits.paused);
    return parts.join(' · ');
  }
  if (habit.kind === 'count') {
    const total = habit.targetCount ?? Math.max(habit.todayTotal, 1);
    parts.push(
      copy.habits.todayProgress
        .replace('{done}', String(Math.min(habit.todayDone, total)))
        .replace('{total}', String(total)),
    );
  } else {
    parts.push(
      habit.todayDone > 0
        ? copy.habits.todayDone
        : copy.habits.todayProgress
            .replace('{done}', '0')
            .replace('{total}', String(Math.max(habit.todayTotal, 1))),
    );
  }
  return parts.join(' · ');
}

const HabitsHomeContent = observer(function HabitsHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(HabitsService);
  useEffect(() => {
    s.start();
    return () => s.stop();
  }, [s]);
  useFocusReload(useCallback(() => s.reloadFromFocus(), [s]));

  function confirmDelete(habit: Habit): void {
    Alert.alert(copy.habits.deleteTitle, copy.habits.deleteBody, [
      { text: copy.actions.cancel, style: 'cancel' },
      {
        text: copy.habits.delete,
        style: 'destructive',
        onPress: () => void s.remove(habit),
      },
    ]);
  }

  const habits = s.habits;
  const draft = s.draft;
  const menuHabit = s.menuHabit;

  if (s.loading) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        title={copy.habits.title}
        leading={
          <IconButton icon={ChevronLeft} label={copy.back} onPress={() => router.back()} />
        }
        trailing={
          <IconButton
            icon={Plus}
            label={copy.habits.add}
            onPress={() => s.openCreate()}
          />
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={s.refreshing}
            onRefresh={() => void s.load(true)}
            tintColor={t.accentPrimary}
          />
        }
      >
        {s.error !== null && habits.length === 0 ? (
          <Banner action={{ label: copy.actions.retry, onPress: () => void s.load(false) }}>{s.error}</Banner>
        ) : habits.length === 0 ? (
          <EmptyState
            icon={Flame}
            title={copy.habits.empty}
            action={{
              label: copy.habits.add,
              onPress: () => s.openCreate(),
            }}
          />
        ) : (
          <View style={[cardStyle(t), rnShadow(t)]}>
            <HabitMonthNav
              monthCursor={s.monthCursorOrNow}
              today={s.today}
              onShift={(delta) => s.shiftMonth(delta)}
            />
            {habits.map((habit, index) => (
              <View
                key={habit.id}
                style={[index < habits.length - 1 && styles.rowBorder, !habit.active && styles.rowPaused]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={habit.name}
                  onLongPress={() => s.openMenu(habit)}
                  delayLongPress={320}
                  onPress={() => s.openMenu(habit)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <View style={styles.rowBody}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {habit.name}
                      </Text>
                      {habit.createdBy === 'agent' ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{copy.habits.agentBadge}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.meta} numberOfLines={1}>
                      {habitMeta(
                        habit,
                        s.outcomes.find((outcome) => outcome.id === habit.outcomeId)?.name,
                      )}
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel={habit.active ? copy.habits.pause : copy.habits.resume}
                    value={habit.active}
                    onValueChange={(next) => void s.setActive(habit, next)}
                    trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
                  />
                  <IconButton
                    icon={Ellipsis}
                    label={copy.todos.more}
                    size={20}
                    color={t.fgMuted}
                    onPress={() => s.openMenu(habit)}
                  />
                </Pressable>
                <View style={styles.calWrap}>
                  <HabitCheckinCalendar
                    habit={habit}
                    days={s.daysFor(habit.id)}
                    monthCursor={s.monthCursorOrNow}
                    weekStartsOn={s.weekStartsOn}
                    today={s.today}
                    createdOn={localDateStamp(s.tz, new Date(habit.createdAt))}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <PickerSheet
        visible={menuHabit !== null}
        title={menuHabit?.name ?? ''}
        onClose={() => s.closeMenu()}
      >
        {menuHabit ? (
          <>
            <PickerOption
              icon={Pencil}
              label={copy.habits.edit}
              onPress={() => s.openEdit(menuHabit)}
            />
            <PickerOption
              icon={menuHabit.active ? Pause : Play}
              label={menuHabit.active ? copy.habits.pause : copy.habits.resume}
              onPress={() => {
                const habit = menuHabit;
                s.closeMenu();
                void s.setActive(habit, !habit.active);
              }}
            />
            <PickerOption
              icon={Trash2}
              label={copy.habits.delete}
              destructive
              onPress={() => {
                const habit = menuHabit;
                s.closeMenu();
                confirmDelete(habit);
              }}
            />
          </>
        ) : null}
      </PickerSheet>

      <BottomSheet visible={draft !== null} onClose={() => s.closeDraft()}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {draft ? (
            <>
              <Text style={styles.formTitle}>
                {draft.id === null ? copy.habits.add : copy.habits.editTitle}
              </Text>
              <Field
                label={copy.habits.name}
                value={draft.name}
                onChangeText={(name) => s.patchDraft({ name })}
                placeholder={copy.habits.namePlaceholder}
                maxLength={120}
                autoCapitalize="sentences"
              />
              {draft.id === null ? (
                <SelectField
                  label={copy.habits.kind}
                  value={draft.kind}
                  options={[
                    { value: 'daily', label: copy.habits.kindDaily },
                    { value: 'count', label: copy.habits.kindCount },
                  ]}
                  onChange={(kind) =>
                    s.patchDraft({
                      kind,
                      targetCount: kind === 'count' ? draft.targetCount || '8' : draft.targetCount,
                    })
                  }
                />
              ) : (
                <Text style={styles.kindReadonly}>
                  {copy.habits.kind} · {draft.kind === 'count' ? copy.habits.kindCount : copy.habits.kindDaily}
                </Text>
              )}
              {draft.kind === 'count' ? (
                <Field
                  label={copy.habits.target}
                  value={draft.targetCount}
                  onChangeText={(text) => s.patchDraft({ targetCount: text.replaceAll(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  maxLength={2}
                />
              ) : null}
              <SelectField
                label={copy.habits.thread}
                value={draft.outcomeId ?? ''}
                options={[
                  { value: '', label: copy.habits.threadNone },
                  ...s.outcomes.map((outcome) => ({ value: outcome.id, label: outcome.name })),
                ]}
                onChange={(outcomeId) => s.patchDraft({ outcomeId: outcomeId === '' ? null : outcomeId })}
              />
              <View style={styles.windowRow}>
                <View style={styles.windowCell}>
                  <Field
                    label={`${copy.habits.window} · ${copy.habits.windowPlaceholder}`}
                    value={draft.windowStart}
                    onChangeText={(windowStart) => s.patchDraft({ windowStart })}
                    placeholder={copy.habits.windowPlaceholder}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
                <View style={styles.windowCell}>
                  <Field
                    label=" "
                    value={draft.windowEnd}
                    onChangeText={(windowEnd) => s.patchDraft({ windowEnd })}
                    placeholder="22:00"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
              </View>
              <ErrorText message={s.formError} />
              <Button
                size="lg"
                loading={s.saving}
                loadingText={copy.actions.saving}
                onPress={() => void s.saveDraft()}
              >
                {draft.id === null ? copy.habits.submit : copy.actions.save}
              </Button>
            </>
          ) : null}
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
});

export const HabitsHome = bindServices(HabitsHomeContent, [HabitsService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    content: { padding: t.space[4], paddingBottom: t.space[10], gap: t.space[3] },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borderSubtle,
    },
    rowPressed: { backgroundColor: t.bgSurfaceMuted },
    rowPaused: { opacity: 0.6 },
    calWrap: { paddingHorizontal: t.space[3], paddingBottom: t.space[3] },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    name: {
      flexShrink: 1,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    badge: {
      height: 20,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: t.space[2],
      justifyContent: 'center',
    },
    badgeText: { fontSize: 11, fontWeight: '600', color: t.accentPrimary },
    meta: { fontSize: 13, lineHeight: 18, color: t.textSecondary, fontVariant: ['tabular-nums'] },
    form: { padding: t.space[4], gap: t.space[3] },
    formTitle: {
      fontSize: t.type.section.fontSize,
      lineHeight: t.type.section.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
    kindReadonly: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    windowRow: { flexDirection: 'row', gap: t.space[3] },
    windowCell: { flex: 1 },
  });
