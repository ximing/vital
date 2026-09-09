import { llmReady, SMART_LIST_IDS, type SmartListId, type Task, type TaskPriority } from '@vital/dto';
import { CalendarDays, Columns3, Ellipsis, EyeOff, List, PanelRightClose } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useParams, useSearchParams } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { BoardView } from './BoardView';
import { TaskSkeleton } from './EmptyTasks';
import { LIST_FILTER_ID, useTodosKeyboard } from './keyboard';
import { ListView } from './ListView';
import {
  applyOptimisticComplete,
  boardVisibleIds,
  createPayload,
  filterTasks,
  formatHm,
  formatHumanDay,
  fromDatetimeLocal,
  inboxList,
  listTitle,
  listVisibleIds,
  todayYmd,
  weekRangeIso,
  zonedLocalMidnightIso,
  type TodoView,
} from './model';
import { applyDraftToCreate, type ScheduleDraft } from './schedule-draft';
import { QuickAdd, type ComposeExtras } from './QuickAdd';
import { TaskContextMenu } from './TaskContextMenu';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { usePopover } from '@/ui/use-popover';
import {
  useCalendarQuery,
  useListsQuery,
  useTagsQuery,
  useTasksQuery,
  useTodoActions,
} from './queries';
import { TaskDetail } from './TaskDetail';
import { UndoToast } from './UndoToast';
import { todosUi, useTodosUi } from './todos-ui.service';
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

const DETAIL_COL =
  'flex h-full min-h-0 w-[clamp(24rem,40%,40rem)] shrink-0 border-l border-border/60';

export function TodosWorkspace({ view }: { view: TodoView }) {
  const params = useParams();
  const [search] = useSearchParams();
  const listId = params.listId ?? search.get('list') ?? 'smart:today';
  const user = useAuth((s) => s.user);
  const timeZone = user?.timezone ?? 'UTC';
  const weekStartsOn = user?.weekStartsOn === 0 ? 0 : 1;
  const online = useOnline();

  const listsQuery = useListsQuery();
  const tasksQuery = useTasksQuery(listId);
  const tagsQuery = useTagsQuery();
  const actions = useTodoActions();

  const [weekAnchor, setWeekAnchor] = useState(() => todayYmd(timeZone));
  const [composeDay, setComposeDay] = useState<string | null>(null);
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
  const boardMode = useTodosUi((s) => s.boardMode);
  const hideCompleted = useTodosUi((s) => s.hideCompleted);
  const closeDetail = useTodosUi((s) => s.closeDetail);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const viewMenu = usePopover(viewMenuRef);
  const [taskMenu, setTaskMenu] = useState<{ task: Task; x: number; y: number } | null>(null);

  useEffect(() => {
    if (filterFocusNonce > 0) document.getElementById(LIST_FILTER_ID)?.focus();
  }, [filterFocusNonce]);

  const taskParam = search.get('task');
  useEffect(() => {
    if (taskParam) openDetail(taskParam);
  }, [openDetail, taskParam]);

  const lists = listsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const inbox = inboxList(lists);
  const showId = completeUndo?.wantUndo ? completeUndo.taskId : null;
  const rawTasks = applyOptimisticComplete(tasksQuery.data ?? [], new Set(completingIds), showId);
  const filtered = filterTasks(rawTasks, listFilter);
  const tasks =
    hideCompleted && listId !== 'smart:done'
      ? filtered.filter((task) => task.status !== 'done')
      : filtered;
  const visibleIds =
    view === 'board' ? boardVisibleIds(tasks, boardMode) : listVisibleIds(listId, tasks, timeZone);
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
          : listId === 'smart:someday'
            ? t.lists.someday
            : listId === 'smart:done'
              ? t.lists.done
              : t.nav.todos,
  );

  useTodosKeyboard({
    visibleIds,
    selected,
    onComplete: (task) => void actions.complete(task),
    onUndo: () => void actions.undoComplete(),
    onPriority: (task, priority) => void actions.setPriority(task, priority),
  });

  const inboxId = inbox?.id;
  const defaultListId = listId.startsWith('smart:') ? (inboxId ?? '') : listId;

  /** Push every overdue task's due date to today, keeping its time-of-day. */
  function postponeOverdue(overdue: Task[]) {
    const today = todayYmd(timeZone);
    for (const task of overdue) {
      if (task.dueAt === null || task.status === 'done' || task.status === 'canceled') continue;
      const dueAt = task.isAllDay
        ? zonedLocalMidnightIso(today, timeZone)
        : fromDatetimeLocal(`${today}T${formatHm(task.dueAt, timeZone)}`, timeZone);
      actions.patch.mutate({ id: task.id, input: { dueAt } });
    }
  }

  const intent = llmReady(user?.llm);

  async function handleCreate(name: string, draft: ScheduleDraft, extras: ComposeExtras) {
    if (!inboxId) return;
    if (intent) {
      await actions.createFromText.mutateAsync({
        text: name,
        listId: extras.listId || inboxId,
        timezone: timeZone,
        ...((SMART_LIST_IDS as readonly string[]).includes(listId)
          ? { smartListId: listId as SmartListId }
          : {}),
        ...(extras.status !== undefined ? { status: extras.status } : {}),
        ...(extras.priority !== undefined ? { priority: extras.priority } : {}),
        ...(composeDay ? { dueYmd: composeDay } : {}),
      });
      setComposeDay(null);
      return;
    }
    const base = createPayload(name, listId, inboxId, timeZone, new Date(), composeDay ?? undefined);
    const next = applyDraftToCreate(base, draft, timeZone);
    if (extras.listId) next.listId = extras.listId;
    if (extras.priority !== undefined && extras.priority !== 3) next.priority = extras.priority;
    if (extras.status) next.status = extras.status;
    await actions.create.mutateAsync(next);
    setComposeDay(null);
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
  const viewTabs: { id: TodoView; icon: typeof List }[] = [
    { id: 'list', icon: List },
    { id: 'board', icon: Columns3 },
    { id: 'week', icon: CalendarDays },
  ];

  const detailPanel =
    detailOpen && detailTask ? (
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
    ) : null;

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <main id="main" data-region="focus-canvas" className="flex h-full min-h-0 min-w-0 flex-1 flex-col px-6 md:px-8">
          <header className="flex items-baseline justify-between gap-3 px-2 pb-4 pt-5">
            <div className="flex min-w-0 items-baseline gap-3">
              <h1 className="font-display truncate text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
                {title}
              </h1>
              <span className="shrink-0 font-mono text-[length:var(--text-caption)] uppercase tracking-wide text-tertiary">
                {todayYmd(timeZone)} · {new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(new Date())}
              </span>
            </div>
            <div ref={viewMenuRef} className="relative">
              <button
                type="button"
                aria-label={t.todos.viewMenu}
                aria-expanded={viewMenu.open}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
                onClick={() => viewMenu.toggle()}
              >
                <Icon icon={Ellipsis} size={16} />
              </button>
              {viewMenu.open ? (
                <div
                  role="menu"
                  className={`absolute right-0 z-[var(--z-dropdown)] mt-1 w-52 ${FIELD_POPOVER_CLASS} p-1`}
                >
                  <p className="px-2 py-1 text-[length:var(--text-caption)] text-muted">
                    {t.todos.viewMenu}
                  </p>
                  <div className="mb-1 flex rounded-md bg-surface-muted p-0.5">
                    {viewTabs.map((tab) => (
                      <NavLink
                        key={tab.id}
                        to={viewHref(tab.id, listId)}
                        role="menuitem"
                        aria-label={t.todos.views[tab.id]}
                        className={`inline-flex h-8 flex-1 items-center justify-center rounded-md ${
                          view === tab.id ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
                        }`}
                        onClick={() => viewMenu.close()}
                      >
                        <Icon icon={tab.icon} size={14} />
                      </NavLink>
                    ))}
                  </div>
                  {view === 'board' ? (
                    <div className="mb-1 flex rounded-md bg-surface-muted p-0.5">
                      {(['status', 'priority'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="menuitem"
                          className={`h-8 flex-1 rounded-md text-[length:var(--text-caption)] ${
                            boardMode === mode ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
                          }`}
                          onClick={() => todosUi().setBoardMode(mode)}
                        >
                          {mode === 'status' ? t.todos.boardByStatus : t.todos.boardByPriority}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[length:var(--text-caption)] text-fg hover:bg-surface-muted"
                    onClick={() => {
                      todosUi().setHideCompleted(!hideCompleted);
                      viewMenu.close();
                    }}
                  >
                    <Icon icon={EyeOff} size={14} className="text-muted" />
                    {hideCompleted ? t.todos.showCompleted : t.todos.hideCompleted}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[length:var(--text-caption)] text-fg hover:bg-surface-muted"
                    onClick={() => {
                      closeDetail();
                      viewMenu.close();
                    }}
                  >
                    <Icon icon={PanelRightClose} size={14} className="text-muted" />
                    {t.todos.hideDetail}
                  </button>
                </div>
              ) : null}
            </div>
            <input
              id={LIST_FILTER_ID}
              type="search"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              className="sr-only"
              aria-label={t.todos.filterPlaceholder}
            />
          </header>

          {!online ? (
            <div className="pt-2">
              <Banner>{t.todos.offline}</Banner>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-center gap-3 py-2">
              <Banner>{humanError(error)}</Banner>
              <Button variant="ghost" onClick={() => void tasksQuery.refetch()}>
                {t.todos.retry}
              </Button>
            </div>
          ) : null}

          {view !== 'board' ? (
            <QuickAdd
              variant="bar"
              onSubmit={handleCreate}
              disabled={!online || !inboxId || defaultListId === ''}
              listName={title}
              lists={lists}
              defaultListId={defaultListId}
              zone={timeZone}
              weekStartsOn={weekStartsOn}
              intent={intent}
              hint={
                composeDay
                  ? `${t.todos.addOnDay} ${formatHumanDay(composeDay, timeZone)}`
                  : undefined
              }
            />
          ) : null}

          <div
            className={`flex min-h-0 flex-1 flex-col ${
              view === 'list' ? 'overflow-y-auto pb-16' : 'pb-6'
            }`}
          >
            {loading ? (
              <TaskSkeleton />
            ) : view === 'list' ? (
              <ListView
                listId={listId}
                tasks={tasks}
                tags={tags}
                lists={lists}
                timeZone={timeZone}
                onComplete={(task) => void actions.complete(task)}
                onReorder={(input) => actions.reorder.mutate(input)}
                onPostpone={postponeOverdue}
                onTaskMenu={(task, x, y) => setTaskMenu({ task, x, y })}
              />
            ) : view === 'board' ? (
              <BoardView
                listId={listId}
                tasks={tasks}
                tags={tags}
                lists={lists}
                timeZone={timeZone}
                weekStartsOn={weekStartsOn}
                defaultListId={defaultListId}
                listName={title}
                disabled={!online || defaultListId === ''}
                onComplete={(task) => void actions.complete(task)}
                onStatus={(task, status) => void actions.setStatus(task, status)}
                onPriority={(task, priority: TaskPriority) =>
                  void actions.setPriority(task, priority)
                }
                onCreate={handleCreate}
                intent={intent}
                onTaskMenu={(task, x, y) => setTaskMenu({ task, x, y })}
              />
            ) : calendarQuery.isLoading ? (
              <TaskSkeleton />
            ) : calendarQuery.error ? (
              <div className="px-4">
                <Banner>{humanError(calendarQuery.error)}</Banner>
              </div>
            ) : (
              <WeekView
                listId={listId}
                days={range.days}
                instances={instances}
                timeZone={timeZone}
                composeDay={composeDay}
                onSelectDay={(ymd) => {
                  setWeekAnchor(ymd);
                  setComposeDay(null);
                }}
                onAddDay={(ymd) => {
                  setComposeDay(ymd);
                  todosUi().requestQuickAdd();
                }}
                onOpen={openDetail}
              />
            )}
          </div>
      </main>

      {view === 'list' ? (
        <div data-region="detail-slot" className={DETAIL_COL}>
          {detailPanel}
        </div>
      ) : detailPanel ? (
        <TaskDetailHost view={view} onClose={closeDetail}>
          {detailPanel}
        </TaskDetailHost>
      ) : null}

      {taskMenu ? (
        <TaskContextMenu
          task={taskMenu.task}
          x={taskMenu.x}
          y={taskMenu.y}
          lists={lists}
          timeZone={timeZone}
          onClose={() => setTaskMenu(null)}
          onOpen={() => openDetail(taskMenu.task.id)}
          onComplete={(task) => void actions.complete(task)}
          onPatch={(task, input) => actions.patch.mutate({ id: task.id, input })}
          onDelete={(task) => actions.remove.mutate(task.id)}
        />
      ) : null}

      <UndoToast onUndo={() => void actions.undoComplete()} />
    </div>
  );
}

function TaskDetailHost({
  view,
  onClose,
  children,
}: {
  view: TodoView;
  onClose: () => void;
  children: ReactNode;
}) {
  if (view === 'list') return children;
  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex justify-end bg-fg/25"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-[40rem] bg-surface shadow-[var(--shadow)]"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
