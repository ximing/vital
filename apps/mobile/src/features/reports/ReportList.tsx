import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { ReportOverview, ReportType } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { markOnboarding } from '../../lib/onboarding';
import { humanError, isNetworkError } from '../../lib/errors';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { TabHeader } from '../../components/TabHeader';

const TYPES: ReportType[] = ['daily', 'weekly', 'monthly', 'yearly'];

export function ReportList() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const [type, setType] = useState<ReportType>('daily');
  const [data, setData] = useState<ReportOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async (nextType: ReportType) => {
    setLoading(true);
    try {
      const overview = await client.getReportOverview(nextType);
      setData(overview);
      setError(null);
      setOffline(false);
    } catch (err) {
      setError(humanError(err));
      setOffline(isNetworkError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusReload(
    useCallback(async () => {
      await client.syncHead().catch(() => undefined);
      await load(type);
    }, [load, type]),
  );

  async function openPeriod(at?: string): Promise<void> {
    setOpening(true);
    try {
      const report = await client.getCurrentReport(type, at);
      if (type === 'weekly') {
        await markOnboarding(auth.user, auth.refreshUser, { openedWeekly: true });
      }
      router.push(`/reports/${report.id}`);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setOpening(false);
    }
  }

  if (loading && data === null) return <Loading />;

  const maxCompleted = Math.max(1, ...(data?.heatmap.map((cell) => cell.completed) ?? [1]));

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
        {data ? (
          <>
            <Text style={styles.period}>{data.period.label}</Text>
            <View style={styles.stats}>
              <Stat styles={styles} label={copy.reports.completed} value={data.totals.completed} />
              <Stat styles={styles} label={copy.reports.wrote} value={data.totals.wrote} />
              <Stat styles={styles} label={copy.reports.carried} value={data.totals.carried} />
            </View>
            {data.streaks.completedDays > 0 ? (
              <Text style={styles.hint}>
                {copy.reports.streakCompleted.replace('{n}', String(data.streaks.completedDays))}
              </Text>
            ) : null}
            <View style={styles.cal}>
              <View style={styles.grid}>
                {data.heatmap.map((cell) => {
                  const fill = cell.completed / maxCompleted;
                  return (
                    <Pressable
                      key={cell.date}
                      disabled={opening}
                      onPress={() => void openPeriod(cell.date)}
                      style={[
                        styles.day,
                        cell.completed > 0 && { opacity: 0.35 + fill * 0.65 },
                        cell.completed > 0 && styles.dayLit,
                      ]}
                    >
                      <Text style={styles.dayNum}>
                        {data.heatmapGrain === 'year'
                          ? cell.date.slice(0, 4)
                          : data.heatmapGrain === 'month'
                            ? `${Number(cell.date.slice(5, 7))}月`
                            : String(Number(cell.date.slice(8)))}
                      </Text>
                      {cell.wrote ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>{copy.reports.streakHint}</Text>
            </View>
            <Text style={styles.kicker}>{copy.reports.recentDone}</Text>
            {data.recentDone.length === 0 ? (
              <Text style={styles.hint}>{copy.reports.emptyRecent}</Text>
            ) : (
              data.recentDone.map((item) => (
                <Pressable
                  key={`${item.taskId}-${item.completedAt}`}
                  style={styles.recent}
                  onPress={() => void openPeriod(data.period.start)}
                >
                  <Text style={styles.recentTitle}>{item.title}</Text>
                </Pressable>
              ))
            )}
            <Pressable style={styles.open} onPress={() => void openPeriod(data.period.start)}>
              <Text style={styles.openLabel}>{copy.reports.openPeriod}</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  styles,
  label,
  value,
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
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
    period: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    stats: { flexDirection: 'row', gap: t.space[2] },
    stat: {
      flex: 1,
      borderRadius: t.radius.lg,
      backgroundColor: t.bgSurface,
      padding: t.space[3],
    },
    statLabel: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    statValue: { fontSize: t.type.title.fontSize, fontWeight: '700', color: t.fgPrimary },
    cal: {
      backgroundColor: t.bgSurface,
      borderRadius: t.radius.lg,
      padding: t.space[4],
      gap: t.space[3],
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    day: { width: '14.28%', alignItems: 'center', paddingVertical: 4 },
    dayLit: { backgroundColor: t.bgAccentSubtle, borderRadius: 16 },
    dayNum: { fontSize: t.type.caption.fontSize, color: t.fgPrimary },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: t.accentPrimary,
      marginTop: 2,
    },
    dotSpacer: { width: 5, height: 5, marginTop: 2 },
    hint: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    kicker: { fontSize: t.type.caption.fontSize, color: t.fgMuted, marginTop: t.space[2] },
    recent: {
      paddingVertical: t.space[3],
      borderRadius: t.radius.md,
      backgroundColor: t.bgSurface,
      paddingHorizontal: t.space[3],
    },
    recentTitle: { fontSize: t.type.body.fontSize, color: t.fgPrimary },
    open: {
      marginTop: t.space[4],
      minHeight: t.space[10],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgAccentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    openLabel: { fontSize: t.type.body.fontSize, fontWeight: '600', color: t.fgPrimary },
  });
