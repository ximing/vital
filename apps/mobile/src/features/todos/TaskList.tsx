import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { ListId, Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError, isNetworkError } from '../../lib/errors';
import { nestTasks } from '../../lib/format';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { Loading } from '../../components/Loading';
import { TaskRow } from '../../components/TaskRow';
import { toggleComplete } from './complete';
import { NewTaskBar } from './NewTaskBar';

export function TaskList({
  listId,
  empty,
  createListId,
  createFromInbox = false,
  createExtra,
}: {
  listId: ListId;
  empty: string;
  createListId?: string;
  createFromInbox?: boolean;
  createExtra?: Parameters<typeof NewTaskBar>[0]['extra'];
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [items, setItems] = useState<Task[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inboxCreateId, setInboxCreateId] = useState<string | undefined>(undefined);

  const applyTask = useCallback((next: Task) => {
    setItems((prev) => {
      const idx = prev.findIndex((row) => row.id === next.id);
      if (idx < 0) return [next, ...prev];
      const copyItems = [...prev];
      copyItems[idx] = next;
      return copyItems;
    });
  }, []);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      if (createFromInbox) {
        const lists = await client.listLists();
        setInboxCreateId(lists.items.find((row) => row.kind === 'inbox')?.id);
      }
      const page = await client.listTasks({ listId });
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
      setOffline(false);
    } catch (err) {
      setError(humanError(err));
      setOffline(isNetworkError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [createFromInbox, listId]);

  useFocusReload(useCallback(async () => {
    await client.syncHead().catch(() => undefined);
    await load(false);
  }, [load]));

  const nested = useMemo(() => nestTasks(items.filter((row) => row.deletedAt === null)), [items]);
  const resolvedCreateId = createListId ?? inboxCreateId;

  if (loading && items.length === 0) return <Loading />;

  return (
    <View style={styles.flex}>
      {offline ? <Banner tone="info">{copy.offline}</Banner> : null}
      {error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => load(true) }}>
          {error}
        </Banner>
      ) : null}
      {resolvedCreateId ? (
        <NewTaskBar
          listId={resolvedCreateId}
          extra={createExtra}
          onCreated={(task) => setItems((prev) => [task, ...prev])}
        />
      ) : null}
      <FlatList
        data={nested}
        keyExtractor={(row) => row.task.id}
        refreshControl={
          <RefreshControl
            tintColor={t.accentPrimary}
            refreshing={refreshing}
            onRefresh={() => void load(true)}
          />
        }
        ListEmptyComponent={<EmptyState title={empty} />}
        renderItem={({ item }) => (
          <View>
            <TaskRow
              task={item.task}
              onToggle={(task) => void toggleComplete(task, applyTask)}
              onPress={(task) => router.push(`/todos/task/${task.id}`)}
            />
            {item.children.map((child) => (
              <TaskRow
                key={child.id}
                task={child}
                indent
                onToggle={(task) => void toggleComplete(task, applyTask)}
                onPress={(task) => router.push(`/todos/task/${task.id}`)}
              />
            ))}
          </View>
        )}
        ListFooterComponent={
          cursor ? (
            <View style={styles.more}>
              <Banner
                tone="info"
                action={{
                  label: copy.actions.loadMore,
                  onPress: async () => {
                    const page = await client.listTasks({ listId, cursor });
                    setItems((prev) => [...prev, ...page.items]);
                    setCursor(page.nextCursor);
                  },
                }}
              >
                {copy.actions.loadMore}
              </Banner>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    more: { padding: t.space[4] },
  });
