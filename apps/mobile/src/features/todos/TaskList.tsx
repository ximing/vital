import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, List } from 'lucide-react-native';
import type { CalendarInstance, ListId, Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Icon } from '../../ui/icon';
import { useAuth } from '../../auth/AuthProvider';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError, isNetworkError } from '../../lib/errors';
import { localDateStamp, nestTasks, zonedLocalMidnightIso } from '../../lib/format';
import { addDaysYmd, weekDays, weekdayOfYmd } from '../../lib/calendar-grid';
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
  const tz = auth.user?.timezone ?? 'UTC';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const [weekAnchor, setWeekAnchor] = useState(() => localDateStamp(tz));
  const [selectedDay, setSelectedDay] = useState(() => localDateStamp(tz));
  const [instances, setInstances] = useState<CalendarInstance[]>([]);

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

  const days = useMemo(() => weekDays(weekAnchor, weekStartsOn), [weekAnchor, weekStartsOn]);
  const today = localDateStamp(tz);

  const loadWeek = useCallback(async (anchor = weekAnchor) => {
    const start = weekDays(anchor, weekStartsOn)[0] ?? anchor;
    const from = zonedLocalMidnightIso(tz, start);
    const to = new Date(
      new Date(zonedLocalMidnightIso(tz, addDaysYmd(start, 7))).getTime() - 1,
    ).toISOString();
    try {
      const res = await client.calendar({ from, to });
      setInstances(res.instances);
    } catch {
      setInstances([]);
    }
  }, [tz, weekAnchor, weekStartsOn]);

  useFocusReload(useCallback(async () => {
    await client.syncHead().catch(() => undefined);
    await load(false);
    if (view === 'week') await loadWeek();
  }, [load, loadWeek, view]));

  const nested = useMemo(() => nestTasks(items.filter((row) => row.deletedAt === null)), [items]);
  const resolvedCreateId = createListId ?? inboxCreateId;
  const live = items.filter((row) => row.deletedAt === null);
  const dayInstances = instances.filter((inst) => {
    const ymd = localDateStamp(tz, new Date(inst.occurrenceAt));
    return ymd === selectedDay;
  });
  const mappedDayTasks = dayInstances
    .map((inst) => live.find((row) => row.id === inst.taskId))
    .filter((row): row is Task => row !== undefined);
  const dayTasks =
    mappedDayTasks.length > 0
      ? mappedDayTasks
      : live.filter(
          (row) => row.dueAt !== null && localDateStamp(tz, new Date(row.dueAt)) === selectedDay,
        );
  const start = days[0] ?? weekAnchor;
  const end = days[6] ?? weekAnchor;
  const weekHeading = `${Number(start.slice(5, 7))}月${Number(start.slice(8))}日 – ${Number(end.slice(5, 7))}月${Number(end.slice(8))}日`;

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
          extra={{
            ...createExtra,
            ...(view === 'week'
              ? {
                  dueAt: zonedLocalMidnightIso(tz, selectedDay),
                  isAllDay: true,
                  timezone: tz,
                }
              : {}),
          }}
          onCreated={(task) => {
            setItems((prev) => [task, ...prev]);
            if (view === 'week') void loadWeek();
          }}
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
              onPress={() => {
                setView(id);
                if (id === 'week') void loadWeek();
              }}
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
        <View style={styles.flex}>
          <View style={styles.weekNav}>
            <Pressable
              onPress={() => {
                const next = addDaysYmd(weekAnchor, -7);
                setWeekAnchor(next);
                setSelectedDay(next);
                void loadWeek(next);
              }}
              hitSlop={8}
            >
              <Icon icon={ChevronLeft} size={18} color={t.fgMuted} />
            </Pressable>
            <Pressable
              onPress={() => {
                setWeekAnchor(today);
                setSelectedDay(today);
                void loadWeek(today);
              }}
            >
              <Text style={styles.weekHead}>{weekHeading}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const next = addDaysYmd(weekAnchor, 7);
                setWeekAnchor(next);
                setSelectedDay(next);
                void loadWeek(next);
              }}
              hitSlop={8}
            >
              <Icon icon={ChevronRight} size={18} color={t.fgMuted} />
            </Pressable>
          </View>
          <View style={styles.weekStrip}>
            {days.map((ymd) => {
              const dow = weekdayOfYmd(ymd) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
              const isToday = ymd === today;
              const sel = ymd === selectedDay;
              const has = instances.some(
                (inst) => localDateStamp(tz, new Date(inst.occurrenceAt)) === ymd,
              );
              return (
                <Pressable
                  key={ymd}
                  onPress={() => setSelectedDay(ymd)}
                  style={styles.weekDay}
                >
                  <Text style={styles.weekDow}>{copy.todos.weekday[dow]}</Text>
                  <View
                    style={[
                      styles.weekNum,
                      isToday && styles.weekNumToday,
                      sel && !isToday && styles.weekNumSel,
                    ]}
                  >
                    <Text
                      style={[
                        styles.weekNumText,
                        (isToday || sel) && styles.weekNumTextOn,
                      ]}
                    >
                      {Number(ymd.slice(8))}
                    </Text>
                  </View>
                  {has ? <View style={styles.weekDot} /> : <View style={styles.weekDotSpacer} />}
                </Pressable>
              );
            })}
          </View>
          <FlatList
            data={dayTasks}
            keyExtractor={(row) => row.id}
            renderItem={({ item }) => renderRow(item)}
            ListEmptyComponent={<EmptyState title={empty} />}
          />
        </View>
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
    weekNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[2],
    },
    weekHead: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    weekStrip: {
      flexDirection: 'row',
      paddingHorizontal: t.space[2],
      paddingBottom: t.space[3],
    },
    weekDay: { flex: 1, alignItems: 'center', gap: t.space[1] },
    weekDow: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    weekNum: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    weekNumToday: { backgroundColor: t.accentPrimary },
    weekNumSel: { backgroundColor: t.fgPrimary },
    weekNumText: { fontSize: t.type.meta.fontSize, color: t.fgPrimary, fontWeight: '600' },
    weekNumTextOn: { color: t.fgOnAccent },
    weekDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: t.accentPrimary,
    },
    weekDotSpacer: { width: 5, height: 5 },
  });
