import { useCallback, useEffect, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import type { ReportType } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { ChevronDown } from 'lucide-react-native';
import { copy } from '../../lib/copy';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SearchIconButton } from '../../components/SearchIconButton';
import { SectionHead } from '../../components/SectionHead';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { ReportActionBar } from './ReportBar';
import { HeatmapCalendar } from './HeatmapCalendar';
import { formatPeriodMeta, recentTimeLabel, weekdayLabel } from './period-label';
import { ReportEditor } from './ReportEditor';
import { ReportsService } from './reports.service';

const TYPES: ReportType[] = ['daily', 'weekly', 'monthly', 'yearly'];

const ReportListContent = observer(function ReportListContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(ReportsService);
  useEffect(() => {
    s.start();
    return () => s.stop();
  }, [s]);
  useFocusReload(useCallback(() => s.reloadFromFocus(), [s]));

  const type = s.type;
  const data = s.data;
  const reportId = s.reportId;
  const editor = s.editor;
  const review = editor?.review ?? null;

  if (s.loading && data === null) return <Loading />;

  const weekday = (ymd: string) => weekdayLabel(ymd, copy.todos.weekday);
  const streakLine = data
    ? `${copy.reports.streakCompleted.replace('{n}', String(data.streaks.completedDays))} · ${
        copy.reports.streakWrote.replace('{n}', String(data.streaks.wroteDays))
      }`
    : '';

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <PageHeader
          title={copy.reports[type]}
          onTitlePress={() => s.openPicker()}
          titleAccessory={<Icon icon={ChevronDown} size={16} strokeWidth={2.2} color={t.fgMuted} />}
          trailing={<SearchIconButton />}
        />
        {s.offline ? <Banner tone="info">{copy.offline}</Banner> : null}
        {s.error ? (
          <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void s.load(type) }}>
            {s.error}
          </Banner>
        ) : null}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={s.refreshing}
              onRefresh={() => void s.refresh()}
              tintColor={t.accentPrimary}
            />
          }
        >
          {data ? (
            <View style={styles.metaRow}>
              <Text style={styles.periodMeta} numberOfLines={1}>
                {formatPeriodMeta(type, data.period.start, data.period.end, weekday)}
              </Text>
              {review ? (
                <View style={styles.metaStats}>
                  <MetaStat
                    styles={styles}
                    tone={t.statusDone}
                    value={review.completed.length}
                    label={copy.reports.completed}
                  />
                  <MetaStat
                    styles={styles}
                    tone={t.statusDoing}
                    value={review.carried.length}
                    label={copy.reports.carried}
                  />
                  <MetaStat
                    styles={styles}
                    tone={t.statusDueSoon}
                    value={review.captured.length}
                    label={copy.reports.captured}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          {reportId ? (
            <ReportEditor key={reportId} reportId={reportId} embedded />
          ) : null}
          {data ? (
            <>
              <SectionHead
                title={copy.reports.history}
                right={
                  data.heatmapGrain === 'day' ? (
                    <Text style={styles.headMeta}>{data.period.start.slice(0, 7)}</Text>
                  ) : undefined
                }
              />
              <View style={[styles.card, rnShadow(t), styles.calCard]}>
                <HeatmapCalendar
                  cells={data.heatmap}
                  grain={data.heatmapGrain}
                  selectedDate={data.period.start}
                  onPick={(date) => void s.openPeriod(date)}
                />
                <Text style={styles.hint}>{copy.reports.streakHint}</Text>
                {data.streaks.completedDays > 0 || data.streaks.wroteDays > 0 ? (
                  <View style={styles.streakRow}>
                    <Text style={styles.hint}>{streakLine}</Text>
                  </View>
                ) : null}
              </View>
              <SectionHead title={copy.reports.recentDone} />
              <View style={[styles.card, styles.recentCard]}>
                {data.recentDone.length === 0 ? (
                  <Text style={[styles.hint, styles.recentEmpty]}>{copy.reports.emptyRecent}</Text>
                ) : (
                  data.recentDone.map((item, index) => (
                    <Pressable
                      key={`${item.taskId}-${item.completedAt}`}
                      style={({ pressed }) => [
                        styles.recent,
                        index < data.recentDone.length - 1 && styles.recentBorder,
                        pressed && styles.rowPressed,
                      ]}
                      onPress={() => void s.openPeriod(data.period.start)}
                    >
                      <Text style={styles.recentTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.recentTime}>
                        {recentTimeLabel(item.completedAt, copy.reports.yesterday)}
                      </Text>
                    </Pressable>
                  ))
                )}
              </View>
            </>
          ) : null}
        </ScrollView>
        <ReportActionBar
          state={editor?.barState ?? null}
          onFill={() => void editor?.fill()}
          onGenerate={() => void editor?.generate()}
          onSave={() => void editor?.save()}
        />
        <PickerSheet
          visible={s.pickerOpen}
          title={copy.reports.pickPeriod}
          onClose={() => s.closePicker()}
        >
          {TYPES.map((item) => (
            <PickerOption
              key={item}
              label={copy.reports[item]}
              selected={item === type}
              onPress={() => {
                s.closePicker();
                void s.switchType(item);
              }}
            />
          ))}
        </PickerSheet>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

export const ReportList = bindServices(ReportListContent, [ReportsService]);

function MetaStat({
  styles,
  tone,
  value,
  label,
}: {
  styles: ReturnType<typeof createStyles>;
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.metaStat}>
      <View style={[styles.metaStatDot, { backgroundColor: tone }]} />
      <Text style={styles.metaStatValue}>{value}</Text>
      <Text style={styles.metaStatLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    scroll: { padding: t.space[4], paddingBottom: t.space[3] * 2 + t.controlH + t.space[4] },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      minHeight: 22,
      marginTop: 2,
      paddingHorizontal: 2,
    },
    periodMeta: {
      flexShrink: 1,
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    metaStats: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: t.space[3] },
    metaStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    metaStatDot: { width: 6, height: 6, borderRadius: 3 },
    metaStatValue: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
      fontVariant: ['tabular-nums'],
    },
    metaStatLabel: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textTertiary,
    },
    headMeta: {
      fontSize: t.type.caption.fontSize,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    card: {
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      padding: t.space[4],
    },
    calCard: {
      paddingTop: 14,
      paddingHorizontal: t.space[3],
      paddingBottom: t.space[3],
      gap: t.space[2],
    },
    hint: { fontSize: t.type.caption.fontSize, color: t.textTertiary },
    streakRow: {
      marginTop: t.space[2],
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borderSubtle,
    },
    recentCard: { overflow: 'hidden', paddingVertical: t.space[1], paddingHorizontal: 0 },
    recent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      paddingVertical: t.space[3],
      paddingHorizontal: t.space[4],
    },
    recentBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borderSubtle,
    },
    recentEmpty: { paddingVertical: t.space[3], paddingHorizontal: t.space[4] },
    recentTitle: { flex: 1, fontSize: t.type.body.fontSize, color: t.fgPrimary },
    recentTime: {
      fontSize: t.type.caption.fontSize,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    rowPressed: { backgroundColor: t.bgSurfaceMuted },
  });
