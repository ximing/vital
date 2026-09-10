import type { Task } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function renderDetail(onPatch: (input: unknown) => Promise<unknown>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <RabRoot>
      <QueryClientProvider client={qc}>
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
      </QueryClientProvider>
    </RabRoot>,
  );
}

function saveStatus(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-region="save-status"]')!;
}

async function editTitleAndBlur(user: ReturnType<typeof userEvent.setup>) {
  const title = screen.getByLabelText(t.todos.title);
  await user.type(title, '改');
  await user.tab();
}

describe('TaskDetail save status', () => {
  it('saves the title on Enter without inserting a hidden newline', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(onPatch);
    const title = screen.getByLabelText(t.todos.title);
    await user.type(title, '改{Enter}');
    expect(title).toHaveValue('发送周报改');
    expect(onPatch).toHaveBeenCalledExactlyOnceWith({ title: '发送周报改' });
    expect(title).not.toHaveFocus();
  });

  it('does not submit Enter while the input method is composing', () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(onPatch);
    const title = screen.getByLabelText(t.todos.title);
    title.focus();
    fireEvent.change(title, { target: { value: '输入中' } });
    fireEvent.keyDown(title, { key: 'Enter', isComposing: true });
    expect(title).toHaveFocus();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('is hidden before any edit', () => {
    renderDetail(vi.fn().mockResolvedValue(undefined));
    expect(document.querySelector('[data-region="save-status"]')).toBeNull();
  });

  it('shows 保存中… then 已保存 when the patch resolves', async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: unknown) => void;
    renderDetail(vi.fn(() => new Promise((resolve) => (resolvePatch = resolve))));

    await editTitleAndBlur(user);
    expect(saveStatus()).toHaveTextContent(t.todos.saveSaving);

    resolvePatch(undefined);
    await waitFor(() => {
      expect(saveStatus()).toHaveTextContent(t.todos.saveSaved);
      expect(saveStatus()).toHaveAttribute('data-state', 'saved');
    });
  });

  it('shows 保存失败 and retries with the latest content on click', async () => {
    const user = userEvent.setup();
    const onPatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    renderDetail(onPatch);

    await editTitleAndBlur(user);
    await waitFor(() => {
      expect(saveStatus()).toHaveTextContent(t.todos.saveFailed);
      expect(saveStatus()).toHaveAttribute('data-state', 'error');
    });

    await user.click(saveStatus());
    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledTimes(2);
      expect(saveStatus()).toHaveAttribute('data-state', 'saved');
    });
  });
});
