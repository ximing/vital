import type { OutcomeDetail } from '@vital/dto';
import { useService } from '@rabjs/react';
import { t } from '@/copy';
import { TodosUiService } from '@/features/todos';
import { Button } from '@/ui/button';
import { taskMeta } from './thread-format';

export function ThreadNextStep({
  detail,
  timeZone,
  onNewTask,
}: {
  detail: OutcomeDetail;
  timeZone: string;
  onNewTask: () => void;
}) {
  const todos = useService(TodosUiService);
  const closed = detail.outcome.status === 'closed';
  const nextTask = detail.tasks.find((task) => task.status === 'todo' || task.status === 'doing');
  const text = detail.outcome.ruleNextStep ?? detail.outcome.agentSuggestion;

  return (
    <section
      data-region="thread-next"
      className="mt-6 rounded-xl border border-transparent bg-accent-subtle p-5 shadow-[var(--shadow-xs)]"
    >
      <div className="text-[length:var(--text-caption)] text-tertiary">
        {closed ? t.thread.recentNextStep : t.thread.nextStep}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        {nextTask ? (
          <>
            <div className="min-w-0">
              <h3 className="text-[length:var(--text-section)] font-semibold">{nextTask.title}</h3>
              <p className="mt-1 text-[length:var(--text-meta)] text-muted">
                {taskMeta(nextTask, timeZone)}
              </p>
            </div>
            <Button
              variant="quiet"
              className="border border-border bg-elevated"
              onClick={() => todos.openDetail(nextTask.id)}
            >
              {t.thread.viewTask}
            </Button>
          </>
        ) : text !== null ? (
          <h3 className="text-[length:var(--text-section)] font-semibold">{text}</h3>
        ) : (
          <>
            <div className="min-w-0">
              <h3 className="text-[length:var(--text-section)] font-semibold">
                {t.thread.addFirst}
              </h3>
              <p className="mt-1 text-[length:var(--text-meta)] text-muted">
                {t.thread.addFirstHint}
              </p>
            </div>
            <Button onClick={onNewTask}>{t.thread.newTask}</Button>
          </>
        )}
      </div>
    </section>
  );
}
