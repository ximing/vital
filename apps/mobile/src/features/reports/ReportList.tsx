import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { ReportListItem, ReportType } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError, isNetworkError } from '../../lib/errors';
import { formatDay } from '../../lib/format';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Loading } from '../../components/Loading';
import { TabHeader } from '../../components/TabHeader';

const TYPES: ReportType[] = ['daily', 'weekly', 'monthly', 'yearly'];

export function ReportList() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<ReportType | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await client.listReports();
      setItems(page.items);
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
      await load();
    }, [load]),
  );

  async function openCurrent(type: ReportType): Promise<void> {
    setOpening(type);
    try {
      const report = await client.getCurrentReport(type);
      router.push(`/reports/${report.id}`);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setOpening(null);
    }
  }

  if (loading && items.length === 0) return <Loading />;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <TabHeader title={copy.nav.reports} />
      {offline ? <Banner tone="info">{copy.offline}</Banner> : null}
      {error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: load }}>
          {error}
        </Banner>
      ) : null}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.chips}>
          {TYPES.map((type) => (
            <Button
              key={type}
              variant={type === 'daily' ? 'primary' : 'secondary'}
              loading={opening === type}
              onPress={() => void openCurrent(type)}
            >
              {copy.reports[type]}
            </Button>
          ))}
        </View>
        {items.length === 0 ? (
          <EmptyState
            title={copy.empty.reports}
            action={{ label: copy.actions.openDaily, onPress: () => void openCurrent('daily') }}
          />
        ) : (
          items.map((item) => (
            <Pressable
              key={item.id}
              style={styles.card}
              onPress={() => router.push(`/reports/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
            >
              <Text style={styles.kicker}>{copy.reports[item.type]}</Text>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>{formatDay(item.periodStart)}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    scroll: { padding: t.space[4], gap: t.space[3] },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    card: {
      padding: t.space[4],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgSurface,
      gap: t.space[1],
    },
    kicker: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    title: {
      fontSize: t.type.body.fontSize,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    meta: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
  });
