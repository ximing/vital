import { useCallback, useEffect, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Columns3, List as ListIcon } from 'lucide-react-native';
import type { ListId, Task, TaskPriority } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Icon } from '../../ui/icon';
import { copy } from '../../lib/copy';
import {
  isOverdue,
  localDateStamp,
  nestTasks,
  startOfLocalDayIso,
  zonedLocalMidnightIso,
} from '../../lib/format';
import { addDaysYmd, weekDays, weekdayOfYmd } from '../../lib/calendar-grid';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonRows } from '../../components/Skeleton';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SectionHead } from '../../components/SectionHead';
import { TaskRow } from '../../components/TaskRow';
import { useOpenTask } from '../../components/TaskSheetHost';
import { toggleComplete } from './complete';
import { NewTaskBar } from './NewTaskBar';
import { TaskListService } from './task-list.service';

export type { TaskListView } from './list-meta';
import type { TaskListView } from './list-meta';

const PRIORITIES: TaskPriority[] = [0, 1, 2, 3];

function TaskListContent({
  listId,
  empty,
  createListId,
  createFromInbox = false,
  createExtra,
  showViews = true,
  hideComposer = false,
  grouped = false,
  view: controlledView,
  onViewChange,
  onOpenTask,
  onPostponeOverdue,
  onOverdueCount,
}: {
  listId: ListId;
  empty: string;
  createListId?: string;
  createFromInbox?: boolean;
  createExtra?: Parameters<typeof NewTaskBar>[0]['extra'];
  showViews?: boolean;
  hideComposer?: boolean;
  grouped?: boolean;
  /** 受控视图（入口收在 ⋯ 菜单时由父级持有状态）；不传则内部自管。 */
  view?: TaskListView;
  onViewChange?: (view: TaskListView) => void;
  onOpenTask?: (task: Task) => void;
  onPostponeOverdue?: () => void;
  onOverdueCount?: (count: number) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const s = useService(TaskListService);
  const openTask = useOpenTask();
  const doneOpen = s.doneOpen;
  const contextTask = s.contextTask;
  const movingTask = s.movingTask;
  const view = controlledView ?? s.innerView;
  const items = s.items;
  const lists = s.lists;
  const tags = s.tags;
  const cursor = s.cursor;
  const error = s.error;
  const offline = s.offline;
  const loading = s.loading;
  const refreshing = s.refreshing;
  const inboxCreateId = s.inboxCreateId;
  const tz = s.tz;
  const weekStartsOn = s.weekStartsOn;
  const weekAnchor = s.weekAnchor || localDateStamp(tz);
  const selectedDay = s.selectedDay || localDateStamp(tz);
  const instances = s.instances;
  const auth = s.auth;

  useEffect(() => {
    s.attach(listId, createFromInbox);
    s.start();
    return () => s.stop();
  }, [s, listId, createFromInbox]);

  const days = useMemo(() => weekDays(weekAnchor, weekStartsOn), [weekAnchor, weekStartsOn]);
  const today = localDateStamp(tz);

  useFocusReload(useCallback(async () => {
    await s.reloadFromFocus(view);
  }, [s, view]));

  const isSmart = String(listId).startsWith('smart:');
  const isDoneList = listId === 'smart:done';
  const isTodayList = listId === 'smart:today';
  const nested = useMemo(() => nestTasks(items.filter((row) => row.deletedAt === null)), [items]);
  const pinnedRoots = grouped
    ? nested.filter((row) => row.task.pinned && row.task.status !== 'done')
    : [];
  const overdueRoots = grouped
    ? nested.filter(
        (row) =>
          !row.task.pinned && row.task.status !== 'done' && isOverdue(row.task),
      )
    : [];
  const doneRoots =
    grouped && !isDoneList ? nested.filter((row) => row.task.status === 'done') : [];
  const restNested = grouped
    ? nested.filter((row) => {
        if (row.task.status === 'done') return isDoneList;
        if (row.task.pinned) return false;
        if (isOverdue(row.task)) return false;
        return true;
      })
    : nested;
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
  const todayMeta = `${Number(today.slice(5, 7))}月${Number(today.slice(8))}日 周${copy.todos.weekday[weekdayOfYmd(today) as 0 | 1 | 2 | 3 | 4 | 5 | 6]}`;

  useEffect(() => {
    onOverdueCount?.(overdueRoots.length);
  }, [onOverdueCount, overdueRoots.length]);

  function listNameOf(task: Task): string | undefined {
    if (!isSmart) return undefined;
    const found = lists.find((row) => row.id === task.listId);
    if (!found) return undefined;
    return found.kind === 'inbox' ? copy.lists.inbox : found.name;
  }

  function setView(next: TaskListView): void {
    if (onViewChange) onViewChange(next);
    else s.setInnerView(next);
    if (next === 'week') void s.loadWeek();
  }

  function renderRow(task: Task, indent = false) {
    return (
      <TaskRow
        task={task}
        indent={indent}
        tags={tags}
        listName={listNameOf(task)}
        onToggle={(row) =>
          void toggleComplete(row, (next) => s.applyTask(next), {
            user: auth.user,
            refreshUser: auth.refreshUser,
          })
        }
        onPress={(row) => (onOpenTask ? onOpenTask(row) : openTask(row.id))}
        onLongPress={(row) => s.openContext(row)}
      />
    );
  }

  function renderNode(node: (typeof nested)[number]) {
    return (
      <View key={node.task.id}>
        {renderRow(node.task)}
        {node.children.map((child) => (
          <View key={child.id}>{renderRow(child, true)}</View>
        ))}
      </View>
    );
  }

  if (loading && items.length === 0) {
    return (
      <View style={styles.skeleton}>
        <SkeletonRows rows={6} />
      </View>
    );
  }

  const movableLists = lists.filter((row) => row.kind !== 'smart' && !row.isArchived);

  return (
    <View style={styles.flex}>
      {offline ? <Banner tone="info">{copy.offline}</Banner> : null}
      {error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void s.load(true) }}>
          {error}
        </Banner>
      ) : null}
      {showViews ? (
      <View style={styles.views} accessibilityRole="tablist">
        {(
          [
            ['list', ListIcon, copy.todos.views.list],
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
      ) : null}
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
              onPress={() => s.shiftWeek(-7, today)}
              hitSlop={8}
            >
              <Icon icon={ChevronLeft} size={18} color={t.fgMuted} />
            </Pressable>
            <Pressable
              onPress={() => {
                s.shiftWeek(0, today);
              }}
            >
              <Text style={styles.weekHead}>{weekHeading}</Text>
            </Pressable>
            <Pressable
              onPress={() => s.shiftWeek(7, today)}
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
                  onPress={() => s.setSelectedDay(ymd)}
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
            ListEmptyComponent={<EmptyState title={empty} icon={CheckCircle2} />}
          />
        </View>
      ) : (
      <FlatList
        data={restNested}
        keyExtractor={(row) => row.task.id}
        contentContainerStyle={{ paddingBottom: 48 + Math.max(insets.bottom, 20) + 56 + 24 }}
        refreshControl={
          <RefreshControl
            tintColor={t.accentPrimary}
            refreshing={refreshing}
            onRefresh={() => void s.load(true)}
          />
        }
        ListHeaderComponent={
          grouped ? (
            <View>
              {pinnedRoots.length > 0 ? (
                <View>
                  <SectionHead first title={copy.todos.pinned} count={pinnedRoots.length} tone="accent" />
                  {pinnedRoots.map(renderNode)}
                </View>
              ) : null}
              {overdueRoots.length > 0 ? (
                <View>
                  <SectionHead
                    first={pinnedRoots.length === 0}
                    title={copy.todos.overdueGroup}
                    count={overdueRoots.length}
                    tone="danger"
                    right={
                      onPostponeOverdue ? (
                        <Pressable onPress={onPostponeOverdue} hitSlop={8} accessibilityRole="button">
                          <Text style={styles.groupAction}>{copy.today.postponeAll}</Text>
                        </Pressable>
                      ) : null
                    }
                  />
                  {overdueRoots.map(renderNode)}
                </View>
              ) : null}
              {!isDoneList && (isTodayList || pinnedRoots.length > 0 || overdueRoots.length > 0) ? (
                <SectionHead
                  first={pinnedRoots.length === 0 && overdueRoots.length === 0}
                  title={isTodayList ? copy.lists.today : copy.todos.openGroup}
                  right={isTodayList ? <Text style={styles.groupMeta}>{todayMeta}</Text> : null}
                />
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          grouped && (pinnedRoots.length > 0 || overdueRoots.length > 0) ? null : (
            <EmptyState title={empty} icon={CheckCircle2} />
          )
        }
        renderItem={({ item }) => renderNode(item)}
        ListFooterComponent={
          <View>
            {cursor ? (
              <View style={styles.more}>
                <Banner
                  tone="info"
                  action={{
                    label: copy.actions.loadMore,
                    onPress: () => void s.loadMore(),
                  }}
                >
                  {copy.actions.loadMore}
                </Banner>
              </View>
            ) : null}
            {doneRoots.length > 0 ? (
              <View>
                <SectionHead
                  title={copy.todos.doneGroup}
                  count={doneRoots.length}
                  collapsible
                  collapsed={!doneOpen}
                  onToggle={() => s.toggleDoneOpen()}
                />
                {doneOpen ? doneRoots.map(renderNode) : null}
              </View>
            ) : null}
          </View>
        }
      />
      )}
      {resolvedCreateId && !hideComposer ? (
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
            s.prepend(task);
            if (view === 'week') void s.loadWeek();
          }}
        />
      ) : null}
      <PickerSheet
        visible={contextTask !== null}
        title={contextTask?.title ?? ''}
        onClose={() => s.closeContext()}
      >
        {contextTask ? (
          <View>
            {contextTask.status === 'done' ? (
              <PickerOption
                label={copy.todos.markUndone}
                onPress={() => {
                  const task = contextTask;
                  s.closeContext();
                  void s.patchContext(task, { status: 'todo' });
                }}
              />
            ) : (
              <PickerOption
                label={copy.todos.markDone}
                onPress={() => {
                  const task = contextTask;
                  s.closeContext();
                  void toggleComplete(task, (next) => s.applyMutation(next), {
                    user: auth.user,
                    refreshUser: auth.refreshUser,
                  });
                }}
              />
            )}
            <PickerOption
              label={contextTask.pinned ? copy.todos.unpin : copy.todos.pin}
              onPress={() => {
                const task = contextTask;
                s.closeContext();
                void s.patchContext(task, { pinned: !task.pinned });
              }}
            />
            <PickerOption
              label={copy.todos.setToday}
              onPress={() => {
                const task = contextTask;
                s.closeContext();
                void s.patchContext(task, { dueAt: startOfLocalDayIso(tz), isAllDay: true, timezone: tz });
              }}
            />
            <PickerOption
              label={copy.todos.setTomorrow}
              onPress={() => {
                const task = contextTask;
                s.closeContext();
                void s.patchContext(task, {
                  dueAt: zonedLocalMidnightIso(tz, addDaysYmd(localDateStamp(tz), 1)),
                  isAllDay: true,
                  timezone: tz,
                });
              }}
            />
            {contextTask.dueAt !== null || contextTask.startAt !== null ? (
              <PickerOption
                label={copy.todos.clearDate}
                onPress={() => {
                  const task = contextTask;
                  s.closeContext();
                  void s.patchContext(task, { dueAt: null, startAt: null });
                }}
              />
            ) : null}
            {PRIORITIES.map((level) => (
              <PickerOption
                key={level}
                label={`${copy.todos.priority} · ${copy.todos.priorityLevel[level]}`}
                selected={contextTask.priority === level}
                onPress={() => {
                  const task = contextTask;
                  s.closeContext();
                  if (task.priority !== level) void s.patchContext(task, { priority: level });
                }}
              />
            ))}
            <PickerOption
              label={copy.todos.moveToList}
              onPress={() => {
                if (contextTask) s.openMove(contextTask);
              }}
            />
            <PickerOption
              label={copy.todos.deleteTask}
              destructive
              onPress={() => {
                const task = contextTask;
                s.closeContext();
                void s.removeTask(task);
              }}
            />
          </View>
        ) : null}
      </PickerSheet>
      <PickerSheet
        visible={movingTask !== null}
        title={copy.todos.moveToList}
        onClose={() => s.closeMove()}
      >
        {movingTask
          ? movableLists.map((list) => (
              <PickerOption
                key={list.id}
                label={list.kind === 'inbox' ? copy.lists.inbox : list.name}
                selected={movingTask.listId === list.id}
                onPress={() => {
                  const task = movingTask;
                  s.closeMove();
                  if (task.listId !== list.id) void s.patchContext(task, { listId: list.id });
                }}
              />
            ))
          : null}
      </PickerSheet>
    </View>
  );
}

export const TaskList = bindServices(observer(TaskListContent), [TaskListService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    skeleton: { flex: 1, backgroundColor: t.bgCanvas, padding: t.space[4] },
    more: { padding: t.space[4] },
    groupAction: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      fontWeight: '500',
      color: t.accentPrimary,
    },
    groupMeta: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    views: {
      flexDirection: 'row',
      marginHorizontal: t.space[4],
      marginBottom: t.space[2],
      gap: t.space[2],
    },
    viewTab: {
      height: 28,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space[1],
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.borderSubtle,
      backgroundColor: t.bgSurface,
    },
    viewTabActive: { backgroundColor: t.bgAccentSubtle, borderColor: t.accentPrimary },
    viewLabel: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    viewLabelActive: { color: t.accentPrimary, fontWeight: '600' },
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
