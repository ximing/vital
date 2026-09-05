import type { Task, TaskPriority } from '@vital/dto';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useParams, useSearchParams } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuthStore } from '@/state/auth-store';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { BoardView } from './BoardView';
import { EmptyTasks, TaskSkeleton } from './EmptyTasks';
import { LIST_FILTER_ID, useTodosKeyboard } from './keyboard';
import { ListView } from './ListView';
import {
  applyOptimisticComplete,
  circadianSlot,
  createPayload,
  filterTasks,
  flattenNodes,
  hourInZone,
  inboxList,
  listTitle,
  nestTasks,
  todayYmd,
  weekRangeIso,
  type TodoView,
} from './model';
import { QuickAdd } from './QuickAdd';
import {
  useCalendarQuery,
  useListsQuery,
  useTagsQuery,
  useTasksQuery,
  useTodoActions,
} from './queries';
import { TaskDetail } from './TaskDetail';
import { UndoToast } from './UndoToast';
import { useTodosUi } from './ui-store';
import { WeekView } from './WeekView';

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function viewHref(view: TodoView, listId: string): string {
  if (view === 'list') return `/todos/lists/${listId}`;
  if (view === 'board') return `/todos/board?list=${encodeURIComponent(listId)}`;
  return `/todos/calendar?list=${encodeURIComponent(listId)}`;
}

export function TodosWorkspace({ view }: { view: TodoView }) {
  const params = useParams();
  const [search] = useSearchParams();
  const listId = params.listId ?? search.get('list') ?? 'smart:today';
  const user = useAuthStore((s) => s.user);
  const timeZone = user?.timezone ?? 'UTC';
  const weekStartsOn = user?.weekStartsOn === 0 ? 0 : 1;
  const online = useOnline();

  const listsQuery = useListsQuery();
  const tasksQuery = useTasksQuery(listId);
  const tagsQuery = useTagsQuery();
  const actions = useTodoActions();

  const [weekAnchor, setWeekAnchor] = useState(() => todayYmd(timeZone));
  const range = useMemo(
    () => weekRangeIso(weekAnchor, weekStartsOn, timeZone),
    [weekAnchor, weekStartsOn, timeZone],
  );
  const calendarQuery = useCalendarQuery(range.from, range.to, view === 'week');

  const selectedId = useTodosUi((s) => s.selectedId);
  const detailOpen = useTodosUi((s) => s.detailOpen);
  const openDetail = useTodosUi((s) => s.openDetail);
  const listFilter = useTodosUi((s) => s.listFilter);
  const setListFilter = useTodosUi((s) => s.setListFilter);
  const filterFocusNonce = useTodosUi((s) => s.filterFocusNonce);
  const completingIds = useTodosUi((s) => s.completingIds);
  const completeUndo = useTodosUi((s) => s.completeUndo);

  useEffect(() => {
    if (filterFocusNonce > 0) document.getElementById(LIST_FILTER_ID)?.focus();
  }, [filterFocusNonce]);

  const lists = listsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const inbox = inboxList(lists);
  const showId = completeUndo?.wantUndo ? completeUndo.taskId : null;
  const rawTasks = applyOptimisticComplete(tasksQuery.data ?? [], new Set(completingIds), showId);
  const tasks = filterTasks(rawTasks, listFilter);
  const visibleIds = flattenNodes(nestTasks(tasks)).map((item) => item.task.id);
  const selected =
    tasks.find((task) => task.id === selectedId) ??
    (tasksQuery.data ?? []).find((task) => task.id === selectedId);
  const detailTask = selected;

  const title = listTitle(
    listId,
    lists,
    listId === 'smart:today'
      ? t.lists.today
      : listId === 'smart:upcoming'
        ? t.lists.upcoming
        : listId === 'smart:inbox'
          ? t.lists.inbox
          : listId === 'smart:anytime'
            ? t.lists.anytime
            : listId === 'smart:someday'
              ? t.lists.someday
              : listId === 'smart:done'
                ? t.lists.done
                : t.nav.todos,
  );

  const kicker = t.todos.circadian[circadianSlot(hourInZone(timeZone))];

  useTodosKeyboard({
    visibleIds,
    selected,
    onComplete: (task) => void actions.complete(task),
    onUndo: () => void actions.undoComplete(),
    onPriority: (task, priority) => void actions.setPriority(task, priority),
  });

  const inboxId = inbox?.id;
  async function handleCreate(name: string) {
    if (!inboxId) return;
    await actions.create.mutateAsync(createPayload(name, listId, inboxId, timeZone));
  }

  const persistedTasksQuery = useTasksQuery(detailTask?.listId ?? '', Boolean(detailTask));
  const subtasks = (persistedTasksQuery.data ?? tasks).filter(
    (item) => detailTask !== undefined && item.parentId === detailTask.id,
  );

  const instances = (calendarQuery.data ?? []).filter((inst) => {
    if (listId.startsWith('smart:')) {
      if (listId === 'smart:inbox' && inbox) return inst.listId === inbox.id;
      return true;
    }
    return inst.listId === listId;
  });

  const loading = tasksQuery.isLoading || listsQuery.isLoading;
  const error = tasksQuery.error ?? listsQuery.error;
  const viewTabs: TodoView[] = ['list', 'board', 'week'];

  return (
    <div className="flex min-h-screen bg-canvas">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-end justify-between gap-3 px-4 pb-2 pt-6">
          <div>
            <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              {kicker}
            </p>
            <h1 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
              {title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex rounded-md bg-surface p-0.5"
              role="tablist"
              aria-label={t.nav.todos}
            >
              {viewTabs.map((tab) => (
                <NavLink
                  key={tab}
                  to={viewHref(tab, listId)}
                  role="tab"
                  aria-selected={view === tab}
                  className={`min-h-[var(--touch-min)] rounded-md px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] ${
                    view === tab ? 'bg-accent-subtle text-fg' : 'text-muted hover:text-fg'
                  }`}
                >
                  {t.todos.views[tab]}
                </NavLink>
              ))}
            </div>
            <input
              id={LIST_FILTER_ID}
              type="search"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder={t.todos.filterPlaceholder}
              aria-label={t.todos.filterPlaceholder}
              className="h-[var(--control-h)] w-44 rounded-md border border-border bg-surface px-3 text-[length:var(--text-meta)] text-fg placeholder:text-muted"
            />
          </div>
        </header>

        {!online ? (
          <div className="px-4">
            <Banner>{t.todos.offline}</Banner>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-center gap-3 px-4 py-2">
            <Banner>{humanError(error)}</Banner>
            <Button variant="ghost" onClick={() => void tasksQuery.refetch()}>
              {t.todos.retry}
            </Button>
          </div>
        ) : null}

        <QuickAdd onSubmit={handleCreate} disabled={!online || !inboxId} />

        <div className="min-h-0 flex-1 overflow-y-auto pb-24">
          {loading ? (
            <TaskSkeleton />
          ) : view === 'list' ? (
            <ListView
              listId={listId}
              tasks={tasks}
              tags={tags}
              timeZone={timeZone}
              onComplete={(task) => void actions.complete(task)}
              onReorder={(input) => actions.reorder.mutate(input)}
            />
          ) : view === 'board' ? (
            <BoardView
              listId={listId}
              tasks={tasks}
              tags={tags}
              timeZone={timeZone}
              onComplete={(task) => void actions.complete(task)}
              onStatus={(task, status) => void actions.setStatus(task, status)}
              onPriority={(task, priority: TaskPriority) =>
                void actions.setPriority(task, priority)
              }
            />
          ) : calendarQuery.isLoading ? (
            <TaskSkeleton />
          ) : calendarQuery.error ? (
            <div className="px-4">
              <Banner>{humanError(calendarQuery.error)}</Banner>
            </div>
          ) : instances.length === 0 ? (
            <EmptyTasks listId={listId} kind="week" />
          ) : (
            <WeekView
              listId={listId}
              days={range.days}
              instances={instances}
              timeZone={timeZone}
              onSelectDay={setWeekAnchor}
              onOpen={openDetail}
            />
          )}
        </div>
      </div>

      {detailOpen && detailTask ? (
        <TaskDetail
          key={detailTask.id}
          task={detailTask}
          subtasks={subtasks}
          lists={lists}
          tags={tags}
          timeZone={timeZone}
          onPatch={(input) => actions.patch.mutate({ id: detailTask.id, input })}
          onComplete={(task: Task) => void actions.complete(task)}
          onDelete={() => actions.remove.mutate(detailTask.id)}
          onAddSubtask={(name) => {
            void actions.create.mutateAsync({
              title: name,
              listId: detailTask.listId,
              parentId: detailTask.id,
            });
          }}
          onCreateTag={async (name) => actions.createTag.mutateAsync(name)}
        />
      ) : null}

      <UndoToast onUndo={() => void actions.undoComplete()} />
    </div>
  );
}
