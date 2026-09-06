import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarDays, Columns3, List } from 'lucide-react-native';
import type { ListId, Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Icon } from '../../ui/icon';
import { useAuth } from '../../auth/AuthProvider';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError, isNetworkError } from '../../lib/errors';
import { formatDay, localDateStamp, nestTasks } from '../../lib/format';
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
  const auth = useAuth();
  const [items, setItems] = useState<Task[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inboxCreateId, setInboxCreateId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<'list' | 'board' | 'week'>('list');

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
  const live = items.filter((row) => row.deletedAt === null);
  const tz = auth.user?.timezone ?? 'UTC';

  function renderRow(task: Task, indent = false) {
    return (
      <TaskRow
        task={task}
        indent={indent}
        onToggle={(row) =>
          void toggleComplete(row, applyTask, {
            user: auth.user,
            refreshUser: auth.refreshUser,
          })
        }
        onPress={(row) => router.push(`/todos/task/${row.id}`)}
      />
    );
  }

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
      <View style={styles.views} accessibilityRole="tablist">
        {(
          [
            ['list', List, copy.todos.views.list],
            ['board', Columns3, copy.todos.views.board],
            ['week', CalendarDays, copy.todos.views.week],
          ] as const
        ).map(([id, glyph, label]) => {
          const active = view === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setView(id)}
              style={[styles.viewTab, active && styles.viewTabActive]}
            >
              <Icon icon={glyph} size={16} color={active ? t.fgPrimary : t.fgMuted} />
              <Text style={[styles.viewLabel, active && styles.viewLabelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {view === 'board' ? (
        <ScrollView horizontal contentContainerStyle={styles.board}>
          {(['todo', 'doing', 'done'] as const).map((status) => (
            <View key={status} style={styles.column}>
              <Text style={styles.colTitle}>
                {status === 'todo'
                  ? copy.todos.status.todo
                  : status === 'doing'
                    ? copy.todos.status.doing
                    : copy.empty.done}
              </Text>
              {live
                .filter((row) => (status === 'done' ? row.status === 'done' : row.status === status))
                .map((row) => (
                  <View key={row.id}>{renderRow(row)}</View>
                ))}
            </View>
          ))}
        </ScrollView>
      ) : view === 'week' ? (
        <FlatList
          data={groupByDay(live, tz)}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => (
            <View>
              <Text style={styles.dayHead}>{item.label}</Text>
              {item.tasks.map((task) => (
                <View key={task.id}>{renderRow(task)}</View>
              ))}
            </View>
          )}
          ListEmptyComponent={<EmptyState title={empty} />}
        />
      ) : (
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
              onToggle={(task) =>
                void toggleComplete(task, applyTask, {
                  user: auth.user,
                  refreshUser: auth.refreshUser,
                })
              }
              onPress={(task) => router.push(`/todos/task/${task.id}`)}
            />
            {item.children.map((child) => (
              <TaskRow
                key={child.id}
                task={child}
                indent
                onToggle={(task) =>
                void toggleComplete(task, applyTask, {
                  user: auth.user,
                  refreshUser: auth.refreshUser,
                })
              }
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
      )}
    </View>
  );
}

function groupByDay(
  tasks: Task[],
  tz: string,
): { key: string; label: string; tasks: Task[] }[] {
  const buckets = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.dueAt ? localDateStamp(tz, new Date(task.dueAt)) : 'none';
    const list = buckets.get(key) ?? [];
    list.push(task);
    buckets.set(key, list);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === 'none') return 1;
    if (b === 'none') return -1;
    return a.localeCompare(b);
  });
  return keys.map((key) => ({
    key,
    label: key === 'none' ? copy.lists.anytime : formatDay(key + 'T00:00:00.000Z', tz),
    tasks: buckets.get(key) ?? [],
  }));
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    more: { padding: t.space[4] },
    views: {
      flexDirection: 'row',
      marginHorizontal: t.space[4],
      marginBottom: t.space[2],
      padding: t.space[1],
      borderRadius: t.radius.md,
      backgroundColor: t.bgSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borderSubtle,
    },
    viewTab: {
      flex: 1,
      minHeight: t.space[8],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space[1],
      borderRadius: t.radius.sm,
    },
    viewTabActive: { backgroundColor: t.bgAccentSubtle },
    viewLabel: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    viewLabelActive: { color: t.fgPrimary, fontWeight: '600' },
    board: { paddingHorizontal: t.space[4], gap: t.space[3] },
    column: {
      width: 280,
      backgroundColor: t.bgSurface,
      borderRadius: t.radius.md,
      paddingVertical: t.space[2],
    },
    colTitle: {
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[2],
      fontSize: t.type.meta.fontSize,
      fontWeight: '600',
      color: t.fgMuted,
    },
    dayHead: {
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[2],
      fontSize: t.type.meta.fontSize,
      fontWeight: '600',
      color: t.fgMuted,
    },
  });
