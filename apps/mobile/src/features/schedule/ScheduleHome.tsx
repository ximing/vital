import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { IconButton } from '../../components/IconButton';
import { PageHeader } from '../../components/PageHeader';
import { useOpenTask } from '../../components/TaskSheetHost';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { localDateStamp } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { scheduleRangeLabel, type ScheduleCreateRange } from './gesture';
import { toScheduleOccurrence } from './map';
import { MonthGrid } from './MonthGrid';
import { placeSchedule, type MonthPlacement, type ScheduleView, type WeekPlacement } from './place';
import { ScheduleService } from './schedule.service';
import { WeekGrid } from './WeekGrid';

function dayHeading(ymd: string): string {
  return `${Number(ymd.slice(0, 4))}年${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
}

function periodHeading(placement: WeekPlacement | MonthPlacement): string {
  if (placement.view === 'month') return `${placement.year}年${placement.month}月`;
  const start = placement.startYmd;
  const end = placement.endYmd;
  const full = dayHeading;
  if (placement.view === 'day') return full(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const endText = sameYear
    ? `${Number(end.slice(5, 7))}月${Number(end.slice(8, 10))}日`
    : full(end);
  return `${full(start)} – ${endText}`;
}

const VIEWS: ScheduleView[] = ['day', 'week', 'month'];

const ScheduleHomeContent = observer(function ScheduleHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(ScheduleService);
  const openTask = useOpenTask();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    s.start();
    return () => s.stop();
  }, [s]);
  useFocusReload(useCallback(() => s.reloadFromFocus(), [s]));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const timeZone = s.timeZone;
  const today = localDateStamp(timeZone, now);
  const cursor = s.cursorYmd === '' ? today : s.cursorYmd;
  const placement = useMemo(
    () =>
      placeSchedule({
        occurrences: s.instances.map(toScheduleOccurrence),
        timeZone,
        weekStartsOn: s.weekStartsOn,
        cursorYmd: cursor,
        view: s.view,
      }),
    [s.instances, s.weekStartsOn, s.view, timeZone, cursor],
  );

  const prevLabel =
    s.view === 'day' ? copy.schedule.prevDay : s.view === 'week' ? copy.schedule.prevWeek : copy.schedule.prevMonth;
  const nextLabel =
    s.view === 'day' ? copy.schedule.nextDay : s.view === 'week' ? copy.schedule.nextWeek : copy.schedule.nextMonth;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <PageHeader title={copy.schedule.title} />
        <View style={styles.toolbar}>
          <IconButton icon={ChevronLeft} label={prevLabel} onPress={() => s.shift(-1)} />
          <Pressable accessibilityRole="button" onPress={() => s.goToday()} style={styles.today}>
            <Text style={styles.todayText}>{copy.schedule.today}</Text>
          </Pressable>
          <IconButton icon={ChevronRight} label={nextLabel} onPress={() => s.shift(1)} />
          <Text style={styles.heading} numberOfLines={1} testID="schedule-heading">
            {periodHeading(placement)}
          </Text>
          <View accessibilityRole="tablist" style={styles.switcher}>
            {VIEWS.map((view) => {
              const selected = s.view === view;
              return (
                <Pressable
                  key={view}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={copy.schedule[view]}
                  onPress={() => s.setView(view)}
                  style={[styles.switchBtn, selected && styles.switchBtnOn]}
                  testID={`schedule-view-${view}`}
                >
                  <Text style={[styles.switchText, selected && styles.switchTextOn]}>{copy.schedule[view]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {s.error ? (
          <Banner tone="error" action={{ label: copy.schedule.retry, onPress: () => s.reload() }}>
            {copy.schedule.loadError}
          </Banner>
        ) : null}
        <View style={styles.flex} testID="schedule-pane">
          {placement.view === 'month' ? (
            <MonthGrid
              model={placement}
              today={today}
              timeZone={timeZone}
              weekStartsOn={s.weekStartsOn}
              draft={s.draft}
              onDraft={(range) => s.setDraft(range)}
              onEdit={(edit) => void s.applyEdit(edit)}
              onOpen={openTask}
              onOpenDay={(ymd) => s.openDay(ymd)}
              onMore={(ymd, chips) => s.openMore(ymd, chips)}
            />
          ) : (
            <WeekGrid
              model={placement}
              today={today}
              timeZone={timeZone}
              now={now}
              draft={s.draft}
              onDraft={(range) => s.setDraft(range)}
              onEdit={(edit) => void s.applyEdit(edit)}
              onOpen={openTask}
              onOpenDay={(ymd) => s.openDay(ymd)}
            />
          )}
        </View>
        {s.draft ? (
          <CreateDock
            draft={s.draft}
            title={s.draftTitle}
            saving={s.saving}
            onTitle={(value) => s.setDraftTitle(value)}
            onCancel={() => s.setDraft(null)}
            onSubmit={() => void s.submitDraft()}
          />
        ) : null}
      </KeyboardAvoidingView>
      <BottomSheet visible={s.more !== null} onClose={() => s.closeMore()}>
        <View style={styles.moreSheet}>
          <Text style={styles.moreTitle}>{s.more ? dayHeading(s.more.ymd) : ''}</Text>
          {s.more?.chips.map((chip) => (
            <Pressable
              key={chip.key}
              accessibilityRole="button"
              accessibilityLabel={chip.title}
              onPress={() => {
                const taskId = chip.taskId;
                s.closeMore();
                openTask(taskId);
              }}
              style={styles.moreRow}
            >
              <Text numberOfLines={1} style={styles.moreText}>
                {chip.timeLabel ? `${chip.timeLabel} ` : ''}
                {chip.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
});

function CreateDock({
  draft,
  title,
  saving,
  onTitle,
  onCancel,
  onSubmit,
}: {
  draft: ScheduleCreateRange;
  title: string;
  saving: boolean;
  onTitle: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.dock} testID="schedule-create">
      <Text style={styles.dockLabel}>{scheduleRangeLabel(draft)}</Text>
      <Field
        value={title}
        onChangeText={onTitle}
        placeholder={copy.schedule.addTask}
        accessibilityLabel={copy.schedule.addTask}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
      />
      <View style={styles.dockActions}>
        <Button variant="quiet" onPress={onCancel}>
          {copy.actions.cancel}
        </Button>
        <Button disabled={title.trim() === ''} loading={saving} onPress={onSubmit}>
          {copy.schedule.add}
        </Button>
      </View>
    </View>
  );
}

export const ScheduleHome = bindServices(ScheduleHomeContent, [ScheduleService]);

function createStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[1],
      paddingRight: t.space[3],
      paddingBottom: t.space[2],
    },
    today: { paddingHorizontal: t.space[2], height: 32, justifyContent: 'center' },
    todayText: { fontSize: 14, color: t.fgPrimary },
    heading: { flex: 1, fontSize: 13, color: t.fgPrimary, fontVariant: ['tabular-nums'] },
    switcher: {
      flexDirection: 'row',
      backgroundColor: t.bgSurfaceMuted,
      borderRadius: t.radius.md,
      padding: 2,
    },
    switchBtn: {
      height: 28,
      paddingHorizontal: t.space[2],
      borderRadius: t.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    switchBtnOn: { backgroundColor: t.bgSurface },
    switchText: { fontSize: 13, color: t.fgMuted },
    switchTextOn: { color: t.fgPrimary, fontWeight: '600' },
    dock: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borderSubtle,
      backgroundColor: t.bgSurface,
      paddingHorizontal: t.space[4],
      paddingTop: t.space[3],
      paddingBottom: t.space[3],
      gap: t.space[2],
    },
    dockLabel: { fontSize: 13, color: t.fgMuted, fontVariant: ['tabular-nums'] },
    dockActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: t.space[2] },
    moreSheet: { padding: t.space[4], gap: t.space[2] },
    moreTitle: { fontSize: 16, fontWeight: '600', color: t.fgPrimary },
    moreRow: { minHeight: 44, justifyContent: 'center' },
    moreText: { fontSize: 15, color: t.fgPrimary },
  });
}
