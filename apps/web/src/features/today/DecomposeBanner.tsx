import type { AgentAction, Task } from '@vital/dto';
import { useQueryClient } from '@tanstack/react-query';
import { Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { todoKeys } from '@/features/todos/queries';
import { decomposeDeferCount, decomposeSubtasks } from './model';
import { todayKeys } from './queries';

/**
 * TaskDetail banner for a pending task.decompose proposal: the agent suggests
 * splitting a repeatedly-deferred task. Accept keeps the original task as the
 * parent and materializes the suggestions through the normal task create API
 * (inheriting outcomeId), then records 'accepted'; dismiss records 'dismissed'.
 */
export function DecomposeBanner({ task, action }: { task: Task; action: AgentAction }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const subtasks = decomposeSubtasks(action);
  const deferCount = decomposeDeferCount(action);

  if (subtasks.length === 0) return null;

  async function settle(feedback: 'accepted' | 'dismissed') {
    await client.sendAgentActionFeedback(action.id, { feedback });
    await qc.invalidateQueries({ queryKey: todayKeys.decompose(task.id) });
  }

  async function accept() {
    setBusy('accept');
    try {
      for (const subtask of subtasks) {
        await client.createTask({
          title: subtask.title,
          listId: task.listId,
          parentId: task.id,
          ...(task.outcomeId ? { outcomeId: task.outcomeId } : {}),
          ...(subtask.estimateMinutes !== null
            ? { estimateMinutes: subtask.estimateMinutes }
            : {}),
        });
      }
      await settle('accepted');
      await qc.invalidateQueries({ queryKey: todoKeys.all });
      await qc.invalidateQueries({ queryKey: todayKeys.all });
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    setBusy('dismiss');
    try {
      await settle('dismissed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      data-region="decompose-banner"
      className="rounded-[14px] border border-accent/25 bg-accent-subtle/50 px-3.5 py-3"
    >
      <p className="flex items-center gap-1.5 text-[length:var(--text-meta)] font-medium text-fg">
        <Icon icon={Lightbulb} size={14} className="shrink-0 text-accent" />
        {deferCount !== null
          ? t.today.decomposeTitle.replace('{n}', String(deferCount))
          : t.today.decomposeTitle.replace('{n}', '3')}
      </p>
      <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
        {t.today.decomposeHint}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {subtasks.map((subtask, index) => (
          <li
            key={`${String(index)}-${subtask.title}`}
            className="flex items-center gap-2 text-[length:var(--text-meta)] text-fg"
          >
            <span className="min-w-0 flex-1 truncate">
              {String(index + 1)}. {subtask.title}
            </span>
            {subtask.estimateMinutes !== null ? (
              <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-tertiary">
                {t.todos.estimateMinutes.replace('{n}', String(subtask.estimateMinutes))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center gap-2">
        <Button
          className="h-7 min-h-7 px-3 text-[length:var(--text-caption)]"
          loading={busy === 'accept'}
          disabled={busy !== null}
          onClick={() => void accept()}
        >
          {t.today.decomposeAccept}
        </Button>
        <Button
          variant="quiet"
          className="h-7 min-h-7 px-2.5 text-[length:var(--text-caption)]"
          loading={busy === 'dismiss'}
          disabled={busy !== null}
          onClick={() => void dismiss()}
        >
          {t.today.decomposeDismiss}
        </Button>
      </div>
    </div>
  );
}
