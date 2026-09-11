import type { AgentAction, Task } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { TaskDetail } from '../../../src/features/todos/TaskDetail';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      createTask: vi.fn(),
      sendAgentActionFeedback: vi.fn(),
    },
  };
});

const task: Task = {
  id: 'task-1',
  listId: 'list-1',
  parentId: null,
  outcomeId: 'outcome-1',
  estimateMinutes: 120,
  deferCount: 3,
  delegable: false,
  habitId: null,
  habitSeq: null,
  title: '写季度总结',
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

const action: AgentAction = {
  id: 'action-1',
  actionType: 'task.decompose',
  targetType: 'task',
  targetId: 'task-1',
  payload: {
    subtasks: [
      { title: '列大纲', estimateMinutes: 15 },
      { title: '填数据', estimateMinutes: 30 },
      { title: '写初稿' },
    ],
    deferCount: 3,
  },
  feedback: 'pending',
  feedbackPayload: null,
  feedbackAt: null,
  createdAt: '2026-09-09T00:00:00.000Z',
};

function renderDetail(decomposeAction: AgentAction | null) {
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
          decomposeAction={decomposeAction}
          timeZone="Asia/Shanghai"
          onPatch={vi.fn()}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
          onAddSubtask={vi.fn()}
          onCreateTag={vi.fn()}
        />
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('DecomposeBanner', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the proposed subtasks with estimates and the defer count', () => {
    renderDetail(action);
    expect(screen.getByText(t.today.decomposeTitle.replace('{n}', '3'))).toBeInTheDocument();
    expect(screen.getByText(/列大纲/)).toBeInTheDocument();
    expect(screen.getByText(/填数据/)).toBeInTheDocument();
    expect(screen.getByText(/写初稿/)).toBeInTheDocument();
    expect(screen.getByText(t.todos.estimateMinutes.replace('{n}', '15'))).toBeInTheDocument();
    expect(screen.getByText(t.todos.estimateMinutes.replace('{n}', '30'))).toBeInTheDocument();
  });

  it('renders nothing without a pending action', () => {
    renderDetail(null);
    expect(screen.queryByText(t.today.decomposeHint)).not.toBeInTheDocument();
  });

  it('accept sends exactly one feedback request — the server materializes the subtasks', async () => {
    vi.mocked(client.sendAgentActionFeedback).mockResolvedValue({
      ...action,
      feedback: 'accepted',
    });
    const user = userEvent.setup();
    renderDetail(action);

    await user.click(screen.getByRole('button', { name: t.today.decomposeAccept }));

    await waitFor(() => {
      expect(client.sendAgentActionFeedback).toHaveBeenCalledTimes(1);
      expect(client.sendAgentActionFeedback).toHaveBeenCalledWith('action-1', {
        feedback: 'accepted',
      });
    });
    // Materialization moved to the server: the client creates nothing itself.
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('dismiss only records feedback and creates nothing', async () => {
    vi.mocked(client.sendAgentActionFeedback).mockResolvedValue({
      ...action,
      feedback: 'dismissed',
    });
    const user = userEvent.setup();
    renderDetail(action);

    await user.click(screen.getByRole('button', { name: t.today.decomposeDismiss }));

    await waitFor(() => {
      expect(client.sendAgentActionFeedback).toHaveBeenCalledWith('action-1', {
        feedback: 'dismissed',
      });
    });
    expect(client.createTask).not.toHaveBeenCalled();
  });
});
