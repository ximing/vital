import { llmReady, type Task } from '@vital/dto';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { TaskSkeleton } from '@/features/todos/EmptyTasks';
import { useTodosKeyboard } from '@/features/todos/keyboard';
import {
  applyOptimisticComplete,
  createPayload,
  formatHm,
  fromDatetimeLocal,
  inboxList,
  listVisibleIds,
  todayYmd,
  zonedLocalMidnightIso,
} from '@/features/todos/model';
import { QuickAdd, type ComposeExtras } from '@/features/todos/QuickAdd';
import { applyDraftToCreate, type ScheduleDraft } from '@/features/todos/schedule-draft';
import { TaskDetail } from '@/features/todos/TaskDetail';
import {
  useListsQuery,
  useTagsQuery,
  useTasksQuery,
  useTodoActions,
} from '@/features/todos/queries';
import { UndoToast } from '@/features/todos/UndoToast';
import { useTodosUi } from '@/features/todos/todos-ui.service';
import { OutcomeBoard } from './OutcomeBoard';
import { NowCard } from './NowCard';
import { PulseStrip } from './PulseStrip';
import { TodayTaskList } from './TodayTaskList';
import { todayKeys, useHabitsQuery, usePendingDecomposeQuery, useTodayQuery } from './queries';

const TODAY_LIST_ID = 'smart:today';
const DETAIL_COL =
  'flex h-full min-h-0 w-[clamp(24rem,40%,40rem)] shrink-0 border-l border-border/60';

function LlmSetupBanner() {
  return (
    <div
      role="status"
      className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 shadow-[var(--panel-edge)]"
    >
      <span className="text-[length:var(--text-meta)] text-muted">{t.today.llmBanner}</span>
      <Link
        to="/settings?tab=llm"
        className="ml-auto shrink-0 text-[length:var(--text-meta)] font-medium text-accent underline-offset-4 hover:underline"
      >
        {t.today.llmBannerGo}
      </Link>
    </div>
  );
}

export function TodayWorkspace() {
  const user = useAuth((s) => s.user);
  const timeZone = user?.timezone ?? 'UTC';
  const weekStartsOn = user?.weekStartsOn === 0 ? 0 : 1;
  const qc = useQueryClient();

  const todayQuery = useTodayQuery();
  const habitsQuery = useHabitsQuery();
  const listsQuery = useListsQuery();
  const tagsQuery = useTagsQuery();
  const tasksQuery = useTasksQuery(TODAY_LIST_ID);
  const actions = useTodoActions();

  const selectedId = useTodosUi((s) => s.selectedId);
  const detailOpen = useTodosUi((s) => s.detailOpen);
  const completingIds = useTodosUi((s) => s.completingIds);
  const completeUndo = useTodosUi((s) => s.completeUndo);
  const [now] = useState(() => new Date());

  const dashboard = todayQuery.data;
  const outcomes = dashboard?.outcomes ?? [];
  const habits = (habitsQuery.data ?? []).filter((habit) => habit.active);
  const lists = listsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const inbox = inboxList(lists);
  const inboxId = inbox?.id ?? '';

  const showId = completeUndo?.wantUndo ? completeUndo.taskId : null;
  const tasks = applyOptimisticComplete(
    tasksQuery.data ?? dashboard?.tasks ?? [],
    new Set(completingIds),
    showId,
  );

  const selected = tasks.find((task) => task.id === selectedId);
  const detailTask = selected;

  const intent = llmReady(user?.llm, 'task.parse');
  const agentReady = llmReady(user?.llm, 'agent.headline');

  function refreshToday(): void {
    void qc.invalidateQueries({ queryKey: todayKeys.all });
  }

  async function handleComplete(task: Task) {
    try {
      await actions.complete(task);
    } finally {
      refreshToday();
    }
  }

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
    refreshToday();
  }

  async function handleCreate(name: string, draft: ScheduleDraft, extras: ComposeExtras) {
    if (!inboxId) return;
    if (intent) {
      await actions.createFromText.mutateAsync({
        text: name,
        listId: extras.listId || inboxId,
        timezone: timeZone,
        smartListId: TODAY_LIST_ID,
        ...(extras.status !== undefined ? { status: extras.status } : {}),
        ...(extras.priority !== undefined ? { priority: extras.priority } : {}),
      });
      refreshToday();
      return;
    }
    const base = createPayload(name, TODAY_LIST_ID, inboxId, timeZone, new Date());
    const next = applyDraftToCreate(base, draft, timeZone);
    if (extras.listId) next.listId = extras.listId;
    if (extras.priority !== undefined && extras.priority !== 3) next.priority = extras.priority;
    if (extras.status) next.status = extras.status;
    await actions.create.mutateAsync(next);
    refreshToday();
  }

  const persistedTasksQuery = useTasksQuery(detailTask?.listId ?? '', detailTask !== undefined);
  const subtasks = (persistedTasksQuery.data ?? tasks).filter(
    (item) => detailTask !== undefined && item.parentId === detailTask.id,
  );
  const decomposeQuery = usePendingDecomposeQuery(
    detailOpen && detailTask && detailTask.parentId === null ? detailTask.id : null,
  );
  const decomposeAction =
    (decomposeQuery.data ?? []).find((action) => action.actionType === 'task.decompose') ?? null;
  const draftAction =
    (decomposeQuery.data ?? []).find((action) => action.actionType === 'task.draft') ?? null;

  const visibleIds = listVisibleIds(TODAY_LIST_ID, tasks, timeZone);

  useTodosKeyboard({
    visibleIds,
    selected,
    onComplete: (task) => void handleComplete(task),
    onUndo: () => void actions.undoComplete().then(refreshToday),
    onPriority: (task, priority) => {
      void actions.setPriority(task, priority).then(refreshToday);
    },
  });

  const loading = todayQuery.isLoading || tasksQuery.isLoading || listsQuery.isLoading;
  const error = todayQuery.error ?? tasksQuery.error ?? listsQuery.error;
  const openCount = tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled')
    .length;

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <main
        id="main"
        data-region="today-canvas"
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[880px] px-6 pb-16 md:px-8">
          <header className="flex items-baseline justify-between gap-3 px-2 pb-2 pt-6">
            <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
              {t.today.title}
            </h1>
            <span className="shrink-0 font-mono text-[length:var(--text-caption)] uppercase tracking-wide text-tertiary">
              {todayYmd(timeZone)} ·{' '}
              {new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(new Date())}
            </span>
          </header>

          {dashboard ? <PulseStrip pulse={dashboard.pulse} /> : null}
          {dashboard ? (
            <NowCard now={dashboard.now} outcomes={outcomes} timeZone={timeZone} />
          ) : null}
          {!agentReady ? <LlmSetupBanner /> : null}

          {error ? (
            <div className="flex items-center gap-3 py-2">
              <Banner>{humanError(error)}</Banner>
              <Button variant="ghost" onClick={() => void todayQuery.refetch()}>
                {t.today.retry}
              </Button>
            </div>
          ) : null}

          {loading ? (
            <div className="pt-4">
              <TaskSkeleton />
            </div>
          ) : (
            <>
              <OutcomeBoard outcomes={outcomes} now={now} />

              <section aria-label={t.today.tasksSection}>
                <div className="mt-7 flex items-center gap-3 px-2">
                  <h2 className="eyebrow eyebrow-rule min-w-0 flex-1">
                    {t.today.tasksSection} · {openCount}
                  </h2>
                </div>

                <div className="mt-1">
                  <TodayTaskList
                    tasks={tasks}
                    habits={habits}
                    tags={tags}
                    lists={lists}
                    timeZone={timeZone}
                    onComplete={(task) => void handleComplete(task)}
                    onReorder={(input) => actions.reorder.mutate(input)}
                    onPostpone={postponeOverdue}
                  />
                </div>

                <div className="mt-3">
                  <QuickAdd
                    variant="bar"
                    onSubmit={handleCreate}
                    disabled={!inboxId}
                    listName={t.lists.today}
                    lists={lists}
                    defaultListId={inboxId}
                    zone={timeZone}
                    weekStartsOn={weekStartsOn}
                    intent={intent}
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {detailOpen && detailTask ? (
        <div data-region="detail-slot" className={DETAIL_COL}>
          <TaskDetail
            key={detailTask.id}
            task={detailTask}
            subtasks={subtasks}
            lists={lists}
            tags={tags}
            outcomes={outcomes}
            decomposeAction={decomposeAction}
            draftAction={draftAction}
            timeZone={timeZone}
            onPatch={(input) =>
              actions.patch.mutateAsync({ id: detailTask.id, input }).then(refreshToday)
            }
            onComplete={(task: Task) => void handleComplete(task)}
            onDelete={() => actions.remove.mutate(detailTask.id, { onSettled: refreshToday })}
            onAddSubtask={(name) => {
              void actions.create
                .mutateAsync({
                  title: name,
                  listId: detailTask.listId,
                  parentId: detailTask.id,
                  ...(detailTask.outcomeId ? { outcomeId: detailTask.outcomeId } : {}),
                })
                .then(refreshToday);
            }}
            onCreateTag={async (name) => actions.createTag.mutateAsync(name)}
          />
        </div>
      ) : null}

      <UndoToast onUndo={() => void actions.undoComplete().then(refreshToday)} />
    </div>
  );
}
