import type { Task } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/copy';
import { TaskDetail } from '../../../src/features/todos/TaskDetail';
import { RabRoot } from '../../helpers/rab-root';

const task: Task = {
  id: 'task-1',
  listId: 'list-1',
  parentId: null,
  outcomeId: null,
  estimateMinutes: null,
  deferCount: 0,
  delegable: false,
  habitId: null,
  habitSeq: null,
  title: '发送周报',
  notes: '',
  status: 'todo',
  priority: 3,
  pinned: false,
  dueAt: null,
  startAt: null,
  reminderMode: 'none',
  reminderOffsetMinutes: null,
  reminderAt: null,
  isAllDay: true,
  timezone: 'Asia/Shanghai',
  recurrence: null,
  recurrenceKind: null,
  recurrenceDtstart: null,
  completedAt: null,
  sortOrder: 1,
  tagIds: [],
  deletedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function renderDetail(next: Task, onPatch = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <TaskDetail
          task={next}
          subtasks={[]}
          lists={[]}
          tags={[]}
          timeZone="Asia/Shanghai"
          onPatch={onPatch}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
          onAddSubtask={vi.fn()}
          onCreateTag={vi.fn()}
        />
      </QueryClientProvider>
    </RabRoot>,
  );
  return onPatch;
}

describe('TaskDetail estimate editor', () => {
  it('applies a preset estimate', async () => {
    const user = userEvent.setup();
    const onPatch = renderDetail(task);

    await user.click(screen.getByRole('button', { name: t.todos.estimate }));
    await user.click(
      screen.getByRole('menuitem', { name: t.todos.estimateMinutes.replace('{n}', '30') }),
    );
    expect(onPatch).toHaveBeenLastCalledWith({ estimateMinutes: 30 });
  });

  it('applies a custom estimate', async () => {
    const user = userEvent.setup();
    const onPatch = renderDetail(task);

    await user.click(screen.getByRole('button', { name: t.todos.estimate }));
    await user.type(screen.getByLabelText(t.todos.estimateCustomPlaceholder), '45');
    await user.click(screen.getByRole('button', { name: t.todos.estimateApply }));
    expect(onPatch).toHaveBeenLastCalledWith({ estimateMinutes: 45 });
  });

  it('shows the current estimate and clears it', async () => {
    const user = userEvent.setup();
    const onPatch = renderDetail({ ...task, estimateMinutes: 60 });

    const trigger = screen.getByRole('button', { name: t.todos.estimate });
    expect(trigger).toHaveTextContent(t.todos.estimateMinutes.replace('{n}', '60'));

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: t.todos.estimateClear }));
    expect(onPatch).toHaveBeenLastCalledWith({ estimateMinutes: null });
  });
});
