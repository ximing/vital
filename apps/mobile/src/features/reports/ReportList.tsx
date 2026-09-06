import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { ReportListItem, ReportType } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { markOnboarding } from '../../lib/onboarding';
import { humanError, isNetworkError } from '../../lib/errors';
import { localDateStamp } from '../../lib/format';
import {
  addDaysYmd,
  addMonthsYmd,
  monthGrid,
  startOfWeekYmd,
  ymdParts,
} from '../../lib/calendar-grid';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { Loading } from '../../components/Loading';
import { TabHeader } from '../../components/TabHeader';
import { Icon } from '../../ui/icon';

const TYPES: ReportType[] = ['daily', 'weekly', 'monthly', 'yearly'];

function periodStartOf(type: ReportType, ymd: string, weekStartsOn: 0 | 1): string {
  if (type === 'daily') return ymd;
  if (type === 'weekly') return startOfWeekYmd(ymd, weekStartsOn);
  if (type === 'monthly') return `${ymd.slice(0, 7)}-01`;
  return `${ymd.slice(0, 4)}-01-01`;
}

export function ReportList() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const tz = auth.user?.timezone ?? 'UTC';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const today = localDateStamp(tz);
  const [type, setType] = useState<ReportType>('daily');
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [cursor, setCursor] = useState(today.slice(0, 7) + '-01');
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const load = useCallback(async (nextType: ReportType) => {
    setLoading(true);
    try {
      const page = await client.listReports({ type: nextType, limit: 100 });
      setItems(page.items);
      setError(null);
      setOffline(false);
    } catch (err) {
      setError(humanError(err));
      setOffline(isNetworkError(err));
    } finally {
      setLoading(false);
    }
  }, [setError, setItems, setLoading, setOffline]);

  useFocusReload(
    useCallback(async () => {
      await client.syncHead().catch(() => undefined);
      await load(type);
    }, [load, type]),
  );

  const wrote = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.revision > 1) set.add(item.periodStart);
    }
    return set;
  }, [items]);

  async function openPeriod(at?: string): Promise<void> {
    setOpening(true);
    try {
      const report = await client.getCurrentReport(type, at);
      if (type === 'weekly') {
        await markOnboarding(auth.user, auth.refreshUser, { openedWeekly: true });
      }
      setSelected(report.periodStart);
      router.push(`/reports/${report.id}`);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setOpening(false);
    }
  }

  const { y, m } = ymdParts(cursor);
  const cells = monthGrid(y, m, weekStartsOn);
  const labels =
    weekStartsOn === 1
      ? copy.todos.weekday.slice(1).concat(copy.todos.weekday[0])
      : copy.todos.weekday;

  if (loading && items.length === 0) return <Loading />;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <TabHeader title={copy.nav.reports} />
      {offline ? <Banner tone="info">{copy.offline}</Banner> : null}
      {error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void load(type) }}>
          {error}
        </Banner>
      ) : null}
      <View style={styles.chips} accessibilityRole="tablist">
        {TYPES.map((item) => {
          const active = type === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => {
                setType(item);
                void load(item);
              }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {copy.reports[item]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {type === 'yearly' ? (
          <View style={styles.cal}>
            {Array.from({ length: 6 }, (_, i) => y - 4 + i).map((year) => {
              const start = `${year}-01-01`;
              const lit = wrote.has(start);
              const sel = selected === start;
              return (
                <Pressable
                  key={year}
                  onPress={() => void openPeriod(start)}
                  style={[styles.yearRow, sel && styles.dayOn]}
                >
                  <Text style={[styles.yearText, sel && styles.dayNumOn]}>{year}年</Text>
                  {lit ? <View style={[styles.dot, sel && styles.dotOn]} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : type === 'monthly' ? (
          <View style={styles.cal}>
            <View style={styles.calNav}>
              <Pressable onPress={() => setCursor(padYear(y - 1))} hitSlop={8}>
                <Icon icon={ChevronLeft} size={18} color={t.fgMuted} />
              </Pressable>
              <Text style={styles.calTitle}>{y}年</Text>
              <Pressable onPress={() => setCursor(padYear(y + 1))} hitSlop={8}>
                <Icon icon={ChevronRight} size={18} color={t.fgMuted} />
              </Pressable>
            </View>
            <View style={styles.monthGrid}>
              {Array.from({ length: 12 }, (_, i) => {
                const start = `${y}-${String(i + 1).padStart(2, '0')}-01`;
                const lit = wrote.has(start);
                const sel = selected === start;
                return (
                  <Pressable
                    key={start}
                    onPress={() => void openPeriod(start)}
                    style={[styles.monthCell, lit && styles.wrote, sel && styles.dayOn]}
                  >
                    <Text style={[styles.monthLabel, sel && styles.dayNumOn]}>{i + 1}月</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <View style={styles.cal}>
            <View style={styles.calNav}>
              <Pressable onPress={() => setCursor(addMonthsYmd(cursor, -1))} hitSlop={8}>
                <Icon icon={ChevronLeft} size={18} color={t.fgMuted} />
              </Pressable>
              <Text style={styles.calTitle}>
                {y}年{m}月
              </Text>
              <Pressable onPress={() => setCursor(addMonthsYmd(cursor, 1))} hitSlop={8}>
                <Icon icon={ChevronRight} size={18} color={t.fgMuted} />
              </Pressable>
            </View>
            <View style={styles.grid}>
              {labels.map((label) => (
                <Text key={label} style={styles.dow}>
                  {label}
                </Text>
              ))}
              {cells.map((ymd, i) => {
                if (ymd === null) return <View key={`e-${i}`} style={styles.day} />;
                const start = periodStartOf(type, ymd, weekStartsOn);
                const lit = wrote.has(start);
                const isToday = ymd === today;
                const inWeek =
                  type === 'weekly' && selected
                    ? ymd >= selected && ymd < addDaysYmd(selected, 7)
                    : selected === start;
                const future = ymd > today;
                return (
                  <Pressable
                    key={ymd}
                    disabled={future || opening}
                    onPress={() => void openPeriod(ymd)}
                    style={styles.day}
                  >
                    <View
                      style={[
                        styles.dayNum,
                        inWeek && styles.wrote,
                        selected === start && styles.dayOn,
                        isToday && !inWeek && styles.todayRing,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayNumText,
                          future && styles.future,
                          (selected === start || (type === 'weekly' && ymd === selected)) &&
                            styles.dayNumOn,
                        ]}
                      >
                        {Number(ymd.slice(8))}
                      </Text>
                    </View>
                    {lit && !inWeek ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>{copy.reports.streakHint}</Text>
          </View>
        )}
        {items.length === 0 ? (
          <EmptyState
            title={copy.empty.reports}
            action={{ label: copy.actions.openDaily, onPress: () => void openPeriod() }}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function padYear(y: number): string {
  return `${y}-01-01`;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    scroll: { padding: t.space[4], gap: t.space[3], paddingBottom: t.space[10] },
    chips: {
      flexDirection: 'row',
      marginHorizontal: t.space[4],
      marginBottom: t.space[2],
      padding: t.space[1],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgSurface,
      gap: t.space[1],
    },
    chip: {
      flex: 1,
      minHeight: t.space[8],
      borderRadius: t.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.bgAccentSubtle },
    chipLabel: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    chipLabelActive: { color: t.fgPrimary, fontWeight: '600' },
    cal: {
      backgroundColor: t.bgSurface,
      borderRadius: t.radius.lg,
      padding: t.space[4],
      gap: t.space[3],
    },
    calNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    calTitle: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    dow: {
      width: '14.28%',
      textAlign: 'center',
      fontSize: t.type.caption.fontSize,
      color: t.fgMuted,
      marginBottom: t.space[1],
    },
    day: { width: '14.28%', alignItems: 'center', paddingVertical: 2 },
    dayNum: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayOn: { backgroundColor: t.accentPrimary },
    wrote: { backgroundColor: t.bgAccentSubtle },
    todayRing: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.accentPrimary },
    dayNumText: { fontSize: t.type.caption.fontSize, color: t.fgPrimary },
    dayNumOn: { color: t.fgOnAccent, fontWeight: '600' },
    future: { color: t.fgMuted, opacity: 0.4 },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: t.accentPrimary,
      marginTop: 2,
    },
    dotOn: { backgroundColor: t.fgOnAccent },
    dotSpacer: { width: 5, height: 5, marginTop: 2 },
    hint: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    monthCell: {
      width: '30%',
      flexGrow: 1,
      height: 48,
      borderRadius: t.radius.lg,
      backgroundColor: t.bgCanvas,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthLabel: { fontSize: t.type.caption.fontSize, color: t.fgPrimary },
    yearRow: {
      minHeight: t.space[10],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgCanvas,
      paddingHorizontal: t.space[3],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    yearText: { fontSize: t.type.meta.fontSize, color: t.fgPrimary },
  });
