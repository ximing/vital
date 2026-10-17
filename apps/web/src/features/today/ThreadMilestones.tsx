import type { OutcomeDetail, Task } from '@vital/dto';
import { t } from '@/copy';

function progressLabel(done: number, total: number): string {
  return t.thread.milestoneProgress.replace('{done}', String(done)).replace('{total}', String(total));
}

export function milestoneTasksOf(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.isMilestone === true && task.status !== 'canceled');
}

/** Milestone list and done/total. Hidden when this outcome has none. */
export function ThreadMilestones({ detail }: { detail: OutcomeDetail }) {
  const milestones = milestoneTasksOf(detail.tasks);
  if (milestones.length === 0) return null;
  const done = milestones.filter((task) => task.status === 'done').length;
  return (
    <section aria-label={t.thread.milestones} className="mt-8" data-testid="outcome-milestones">
      <div className="flex items-center gap-3 px-2">
        <h2 className="eyebrow eyebrow-rule min-w-0 flex-1">{t.thread.milestones}</h2>
        <span className="shrink-0 text-[length:var(--text-meta)] text-muted" data-testid="outcome-milestone-progress">
          {progressLabel(done, milestones.length)}
        </span>
      </div>
      <ul className="mt-2">
        {milestones.map((task) => (
          <li key={task.id} className="flex items-center gap-3 border-b border-border/60 px-2 py-2.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                task.status === 'done' ? 'border-accent bg-accent text-on-accent' : 'border-tertiary'
              }`}
              aria-hidden
            >
              {task.status === 'done' ? '✓' : ''}
            </span>
            <span className={`min-w-0 flex-1 truncate text-[length:var(--text-body)] ${task.status === 'done' ? 'text-muted line-through' : 'text-fg'}`}>
              {task.title}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
