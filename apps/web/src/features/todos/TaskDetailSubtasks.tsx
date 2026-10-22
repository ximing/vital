import type { Task } from '@vital/dto';
import { Plus } from 'lucide-react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import { TaskCheckbox } from './TaskRow';

export function TaskDetailSubtasks({
  subtasks,
  zone,
  onComplete,
  subTitle,
  setSubTitle,
  onAddSubtask,
  openDetail,
}: {
  subtasks: Task[];
  zone: string;
  onComplete: (task: Task) => void;
  subTitle: string;
  setSubTitle: (next: string) => void;
  onAddSubtask: (title: string) => void;
  openDetail: (id: string) => void;
}) {
  return (
    <div className="mt-7">
      <p className="eyebrow eyebrow-rule mb-2.5">
        {t.todos.subtasks}
        {subtasks.length > 0 ? (
          <span className="font-mono normal-case tracking-normal tabular-nums opacity-80">
            {subtasks.filter((child) => child.status === 'done').length}/{subtasks.length}
          </span>
        ) : null}
      </p>
      <div className="field-shell rounded-[14px] border border-border bg-canvas px-3 py-1.5">
        <ul className="flex flex-col">
          {subtasks.map((child) => (
            <li
              key={child.id}
              className="flex min-h-10 items-center gap-2.5 border-b border-border/60 last:border-b-0"
            >
              <TaskCheckbox task={child} timeZone={zone} onToggle={() => onComplete(child)} />
              <button
                type="button"
                className={`min-w-0 flex-1 truncate py-1.5 text-left text-[length:var(--text-body)] ${
                  child.status === 'done' ? 'text-muted line-through' : 'text-fg'
                }`}
                onClick={() => openDetail(child.id)}
              >
                {child.title}
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = subTitle.trim();
            if (next === '') return;
            onAddSubtask(next);
            setSubTitle('');
          }}
        >
          <label className="flex h-10 items-center gap-2 text-accent">
            <Icon icon={Plus} size={15} className="shrink-0" />
            <input
              className="h-full min-w-0 flex-1 bg-transparent text-[length:var(--text-meta)] text-fg placeholder:text-accent/70 outline-none"
              value={subTitle}
              onChange={(e) => setSubTitle(e.target.value)}
              placeholder={t.todos.addSubtask}
              aria-label={t.todos.addSubtask}
              maxLength={500}
            />
          </label>
        </form>
      </div>
    </div>
  );
}
