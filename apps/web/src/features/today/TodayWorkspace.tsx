import { llmReady, type Task } from '@vital/dto';
import { bindServices, useService } from '@rabjs/react';
import type { FC } from 'react';
import { Link } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { TaskSkeleton } from '@/features/todos/EmptyTasks';
import { useTodosKeyboard } from '@/features/todos/keyboard';
import { applyOptimisticComplete, inboxList, isOverdue, listVisibleIds } from '@/features/todos/model';
import { QuickAdd } from '@/features/todos/QuickAdd';
import { TaskDetail } from '@/features/todos/TaskDetail';
import {
  useDetailTask,
  useListsQuery,
  useTagsQuery,
  useTasksQuery,
  useTodoActions,
} from '@/features/todos/queries';
import { UndoToast } from '@/features/todos/UndoToast';
import { TodosUiService } from '@/features/todos/todos-ui.service';
import { OutcomeBoard } from './OutcomeBoard';
import { NowCard } from './NowCard';
import { PulseStrip } from './PulseStrip';
import { AgentProposalsCard } from './AgentProposalsCard';
import { TodaySectionHead } from './SectionHead';
import { TodayTaskList } from './TodayTaskList';
import { TodayPageService } from './today-page.service';
import { useHabitsQuery, usePendingDecomposeQuery, useTodayQuery } from './queries';

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

function TodayWorkspaceContent() {
  const page = useService(TodayPageService);
  const todos = useService(TodosUiService);
  const auth = useService(AuthService);
  const user = auth.user;
  const timeZone = page.timeZone;
  const weekStartsOn = page.weekStartsOn;

  const todayQuery = useTodayQuery();
  const habitsQuery = useHabitsQuery();
  const listsQuery = useListsQuery();
  const tagsQuery = useTagsQuery();
  const tasksQuery = useTasksQuery(TODAY_LIST_ID);
  const actions = useTodoActions();

  const selectedId = todos.selectedId;
  const detailOpen = todos.detailOpen;
  const completingIds = todos.completingIds;
  const completeUndo = todos.completeUndo;
  const now = page.now;

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
  const detailTask = useDetailTask(detailOpen ? selectedId : null, tasks);

  const intent = llmReady(user?.llm, 'task.parse');
  const agentReady = llmReady(user?.llm, 'agent.headline');

  async function handleComplete(task: Task) {
    try {
      await actions.complete(task);
    } finally {
      await page.refresh();
    }
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
    onUndo: () => void actions.undoComplete().then(() => page.refresh()),
    onPriority: (task, priority) => {
      void actions.setPriority(task, priority).then(() => page.refresh());
    },
  });

  const loading = todayQuery.isLoading || tasksQuery.isLoading || listsQuery.isLoading;
  const error = todayQuery.error ?? tasksQuery.error ?? listsQuery.error;
  const openCount = tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled')
    .length;
  const overdueTasks = tasks.filter((task) => isOverdue(task, timeZone));
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(new Date());
  const weekdayLabel = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    timeZone,
  }).format(new Date());

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <main
        id="main"
        data-region="today-canvas"
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[880px] px-6 pb-16 md:px-8">
          <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-1 pb-2 pt-6">
            <div className="flex items-baseline gap-3">
              <h1 className="font-display text-[30px] font-bold leading-[38px]">
                {t.today.title}
              </h1>
              <span className="text-[length:var(--text-meta)] tabular-nums text-tertiary">
                {dateLabel} · {weekdayLabel}
              </span>
            </div>
            {dashboard ? <PulseStrip pulse={dashboard.pulse} /> : null}
          </header>

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
                <TodaySectionHead title={t.today.tasksSection} count={openCount} />

                {overdueTasks.length > 0 ? (
                  <div
                    data-region="overdue-banner"
                    className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-due bg-[var(--amber-100)] px-4 py-2.5"
                  >
                    <span className="font-bold text-due">!</span>
                    <p className="min-w-0 flex-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg">
                      <b className="tabular-nums">{t.today.overdueBanner.replace('{n}', String(overdueTasks.length))}</b>
                    </p>
                    <button
                      type="button"
                      onClick={() => page.postponeOverdue(overdueTasks)}
                      className="inline-flex h-7 shrink-0 items-center rounded-full border border-due px-3 text-[length:var(--text-caption)] font-semibold text-due transition-[color,background-color] duration-[var(--ease-out)] hover:bg-due hover:text-on-accent"
                    >
                      {t.today.postponeAll}
                    </button>
                  </div>
                ) : null}

                <div className="rounded-[18px] border border-border bg-surface px-2 py-1 shadow-[var(--shadow-xs)]">
                  <TodayTaskList
                    tasks={tasks}
                    habits={habits}
                    tags={tags}
                    lists={lists}
                    timeZone={timeZone}
                    onComplete={(task) => void handleComplete(task)}
                    onReorder={(input) => actions.reorder.mutate(input)}
                    onPostpone={(overdue) => page.postponeOverdue(overdue)}
                  />

                  <div className="mt-1 px-1 pb-1">
                    <QuickAdd
                      variant="bar"
                      onSubmit={(name, draft, extras) => page.create(name, draft, extras, inboxId)}
                      disabled={!inboxId}
                      listName={t.lists.today}
                      lists={lists}
                      defaultListId={inboxId}
                      zone={timeZone}
                      weekStartsOn={weekStartsOn}
                      intent={intent}
                    />
                  </div>
                </div>
              </section>

              <AgentProposalsCard />
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
              actions.patch.mutateAsync({ id: detailTask.id, input }).then(() => page.refresh())
            }
            onComplete={(task: Task) => void handleComplete(task)}
            onDelete={() => actions.remove.mutate(detailTask.id, { onSettled: () => void page.refresh() })}
            onAddSubtask={(name) => {
              void actions.create
                .mutateAsync({
                  title: name,
                  listId: detailTask.listId,
                  parentId: detailTask.id,
                  ...(detailTask.outcomeId ? { outcomeId: detailTask.outcomeId } : {}),
                })
                .then(() => page.refresh());
            }}
            onCreateTag={async (name) => actions.createTag.mutateAsync(name)}
          />
        </div>
      ) : null}

      <UndoToast onUndo={() => void actions.undoComplete().then(() => page.refresh())} />
    </div>
  );
}

export const TodayWorkspace: FC = bindServices(TodayWorkspaceContent, [TodayPageService]);
