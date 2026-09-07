import type { Task } from '@vital/dto';
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
  title: '发送周报',
  notes: '',
  status: 'todo',
  priority: 3,
  dueAt: '2026-09-08T01:00:00.000Z',
  startAt: null,
  remindAt: null,
  reminderMode: 'none',
  reminderOffsetMinutes: null,
  reminderAt: null,
  isAllDay: false,
  timezone: 'Asia/Shanghai',
  timeBucket: 'dated',
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

describe('TaskDetail reminder and recurrence controls', () => {
  it('writes semantic reminder offsets and fixed recurrence kinds', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(
      <RabRoot>
        <TaskDetail
          task={task}
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
      </RabRoot>,
    );

    await user.click(screen.getByRole('button', { name: t.todos.remind }));
    await user.click(screen.getByRole('option', { name: t.todos.reminder15m }));
    expect(onPatch).toHaveBeenLastCalledWith({ reminderMode: 'offset', reminderOffsetMinutes: 15 });

    await user.click(screen.getByRole('button', { name: t.todos.recurrence }));
    await user.click(screen.getByRole('option', { name: t.todos.recurrenceLegalWorkdays }));
    expect(onPatch).toHaveBeenLastCalledWith({ recurrence: null, recurrenceKind: 'legal_workdays' });
  });
});
