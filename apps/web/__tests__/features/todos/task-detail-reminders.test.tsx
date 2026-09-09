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
  reminderMode: 'none',
  reminderOffsetMinutes: null,
  reminderAt: null,
  isAllDay: false,
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

    await user.click(screen.getByRole('button', { name: t.todos.addDate }));
    expect(screen.getByRole('button', { name: t.todos.datePoint })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.todos.dateRange })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.todos.reminderNone }));
    await user.click(screen.getByRole('button', { name: t.todos.reminder15m }));
    expect(onPatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ reminderMode: 'offset', reminderOffsetMinutes: 15 }),
    );

    await user.click(screen.getByRole('button', { name: t.todos.recurrenceNone }));
    await user.click(screen.getByRole('button', { name: t.todos.recurrenceLegalWorkdays }));
    const recurrencePatch = onPatch.mock.lastCall?.[0] as Record<string, unknown>;
    // The API rejects patches that carry both recurrence shapes at once.
    expect(recurrencePatch).not.toHaveProperty('recurrence');
    expect(recurrencePatch).toHaveProperty('recurrenceKind', 'legal_workdays');
  });

  it('keeps on-time and offset reminders for all-day dated tasks', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(
      <RabRoot>
        <TaskDetail
          task={{ ...task, isAllDay: true, dueAt: '2026-09-07T16:00:00.000Z', startAt: '2026-09-06T16:00:00.000Z' }}
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

    await user.click(screen.getByRole('button', { name: t.todos.addDate }));
    await user.click(screen.getByRole('button', { name: t.todos.reminderNone }));
    expect(screen.getByRole('button', { name: t.todos.reminderDue })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.todos.reminder5m })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.todos.reminder15m })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.todos.reminder30m })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.todos.reminder1d })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.todos.reminderDue }));
    expect(onPatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reminderMode: 'due',
        reminderOffsetMinutes: null,
        reminderAt: null,
      }),
    );
  });
});
