import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { InboxItem } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError, isNetworkError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Loading } from '../../components/Loading';
import { TabHeader } from '../../components/TabHeader';

export function InboxList() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const page = await client.listInbox();
      setItems(page.items.filter((row) => row.deletedAt === null && row.status !== 'archived'));
      setError(null);
      setOffline(false);
    } catch (err) {
      setError(humanError(err));
      setOffline(isNetworkError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusReload(
    useCallback(async () => {
      await client.syncHead().catch(() => undefined);
      await load(false);
    }, [load]),
  );

  if (loading && items.length === 0) return <Loading />;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <TabHeader
        title={copy.nav.inbox}
        right={
          <Button variant="secondary" onPress={() => router.push('/inbox/new')}>
            {copy.actions.create}
          </Button>
        }
      />
      {offline ? <Banner tone="info">{copy.offline}</Banner> : null}
      {error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => load(true) }}>
          {error}
        </Banner>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(row) => row.id}
        refreshControl={
          <RefreshControl
            tintColor={t.accentPrimary}
            refreshing={refreshing}
            onRefresh={() => void load(true)}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title={copy.empty.inbox}
            action={{ label: copy.actions.create, onPress: () => router.push('/inbox/new') }}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/inbox/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={item.title}
          >
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            {item.excerpt ? (
              <Text style={styles.excerpt} numberOfLines={2}>
                {item.excerpt}
              </Text>
            ) : null}
            <Text style={styles.meta}>
              {item.siteName ?? item.source}
              {` · ${formatDateTime(item.capturedAt)}`}
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    card: {
      marginHorizontal: t.space[4],
      marginBottom: t.space[3],
      padding: t.space[4],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgSurface,
      gap: t.space[1],
    },
    title: {
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    excerpt: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    meta: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
  });
