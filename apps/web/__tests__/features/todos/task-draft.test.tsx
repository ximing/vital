import type { AgentAction, AgentActionLogItem, Task } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { usePendingDecomposeQuery } from '../../../src/features/today/queries';
import { TaskDetail } from '../../../src/features/todos/TaskDetail';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      draftTask: vi.fn(),
      listAgentActions: vi.fn(),
      sendAgentActionFeedback: vi.fn(),
    },
  };
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    listId: 'list-1',
    parentId: null,
    outcomeId: null,
    estimateMinutes: null,
    deferCount: 0,
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
    ...overrides,
  };
}

const draftAction: AgentActionLogItem = {
  id: 'action-1',
  actionType: 'task.draft',
  targetType: 'task',
  targetId: 'task-1',
  payload: { draft: '1. 列大纲\n2. 收集数据\n3. 约评审' },
  feedback: 'pending',
  feedbackPayload: null,
  feedbackAt: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  targetName: '写季度总结',
  payloadSummary: '1. 列大纲',
};

function renderDetail(task: Task, action: AgentAction | null, onPatch = vi.fn()) {
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
          draftAction={action}
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

describe('draft polling', () => {
  beforeEach(() => {
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Mirrors the workspace wiring: the pending-actions query is mounted next to
   * TaskDetail and its result is passed down as draftAction, so a poll refetch
   * is the only way the card can appear while the drawer stays open.
   */
  function renderDetailWithQuery(task: Task) {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Harness() {
      const query = usePendingDecomposeQuery(task.id);
      const draft =
        (query.data ?? []).find((item) => item.actionType === 'task.draft') ?? null;
      return (
        <TaskDetail
          task={task}
          subtasks={[]}
          lists={[]}
          tags={[]}
          draftAction={draft}
          timeZone="Asia/Shanghai"
          onPatch={vi.fn()}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
          onAddSubtask={vi.fn()}
          onCreateTag={vi.fn()}
        />
      );
    }
    render(
      <RabRoot>
        <QueryClientProvider client={qc}>
          <Harness />
        </QueryClientProvider>
      </RabRoot>,
    );
  }

  it('brings up the draft card when the proposal lands mid-poll', async () => {
    vi.useFakeTimers();
    try {
      let landed = false;
      vi.mocked(client.listAgentActions).mockImplementation(() =>
        Promise.resolve(landed ? [draftAction] : []),
      );
      vi.mocked(client.draftTask).mockResolvedValue({ status: 'queued', action: null });
      renderDetailWithQuery(makeTask({ delegable: true }));
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: t.todos.draftTrigger }));
      await act(async () => {});
      expect(client.draftTask).toHaveBeenCalledWith('task-1');

      // The worker writes the draft while the drawer is polling.
      landed = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(screen.getByText(t.todos.draftTitle)).toBeInTheDocument();
      expect(screen.getByText(/列大纲/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling past a slow refetch instead of giving up early', async () => {
    vi.useFakeTimers();
    try {
      let landed = false;
      vi.mocked(client.listAgentActions).mockImplementation(() =>
        Promise.resolve(landed ? [draftAction] : []),
      );
      vi.mocked(client.draftTask).mockResolvedValue({ status: 'queued', action: null });
      renderDetailWithQuery(makeTask({ delegable: true }));
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: t.todos.draftTrigger }));
      await act(async () => {});

      // The draft only shows up after several poll rounds.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9_000);
      });
      expect(screen.queryByText(t.todos.draftTitle)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: t.todos.draftWaiting })).toBeDisabled();

      landed = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(screen.getByText(t.todos.draftTitle)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a visible timeout notice with retry instead of silently reverting', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(client.listAgentActions).mockResolvedValue([]);
      vi.mocked(client.draftTask).mockResolvedValue({ status: 'queued', action: null });
      renderDetailWithQuery(makeTask({ delegable: true }));
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: t.todos.draftTrigger }));
      await act(async () => {});

      await act(async () => {
        await vi.advanceTimersByTimeAsync(66_000);
      });

      expect(screen.getByText(t.todos.draftTimeout)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: t.todos.draftRetry })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries after a timeout and picks up the late draft', async () => {
    vi.useFakeTimers();
    try {
      let landed = false;
      vi.mocked(client.listAgentActions).mockImplementation(() =>
        Promise.resolve(landed ? [draftAction] : []),
      );
      vi.mocked(client.draftTask).mockResolvedValue({ status: 'queued', action: null });
      renderDetailWithQuery(makeTask({ delegable: true }));
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: t.todos.draftTrigger }));
      await act(async () => {});
      await act(async () => {
        await vi.advanceTimersByTimeAsync(66_000);
      });
      expect(screen.getByText(t.todos.draftTimeout)).toBeInTheDocument();

      // Retry re-arms the wait; the worker's draft finally lands.
      landed = true;
      fireEvent.click(screen.getByRole('button', { name: t.todos.draftRetry }));
      await act(async () => {});
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(screen.getByText(t.todos.draftTitle)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TaskDetail delegable + agent draft', () => {
  beforeEach(() => {
    // Default: no pending proposals; individual tests override as needed.
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the delegable switch on open tasks and persists toggles via onPatch', async () => {
    const user = userEvent.setup();
    const onPatch = renderDetail(makeTask(), null, vi.fn().mockResolvedValue(undefined));

    const toggle = screen.getByRole('switch', { name: t.todos.delegable });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(onPatch).toHaveBeenCalledWith({ delegable: true });
  });

  it('hides the switch and trigger for completed tasks', () => {
    renderDetail(makeTask({ status: 'done', delegable: true }), null);
    expect(screen.queryByRole('switch', { name: t.todos.delegable })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.todos.draftTrigger })).not.toBeInTheDocument();
  });

  it('offers the draft trigger once delegable, with a loading state while queued', async () => {
    vi.mocked(client.draftTask).mockResolvedValue({ status: 'queued', action: null });
    const user = userEvent.setup();
    renderDetail(makeTask({ delegable: true }), null);

    await user.click(screen.getByRole('button', { name: t.todos.draftTrigger }));

    await waitFor(() => {
      expect(client.draftTask).toHaveBeenCalledWith('task-1');
    });
    // The worker needs a moment — the button switches to the waiting label.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.todos.draftWaiting })).toBeDisabled();
    });
  });

  it('shows the trigger again after the trigger call fails', async () => {
    vi.mocked(client.draftTask).mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderDetail(makeTask({ delegable: true }), null);

    await user.click(screen.getByRole('button', { name: t.todos.draftTrigger }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.todos.draftTrigger })).toBeEnabled();
    });
  });

  it('renders the pending draft card with the plan text', () => {
    renderDetail(makeTask({ delegable: true }), draftAction);
    expect(screen.getByText(t.todos.draftTitle)).toBeInTheDocument();
    expect(screen.getByText(/列大纲/)).toBeInTheDocument();
    expect(screen.getByText(/约评审/)).toBeInTheDocument();
    // The trigger button is replaced by the card while a draft is pending.
    expect(screen.queryByRole('button', { name: t.todos.draftTrigger })).not.toBeInTheDocument();
  });

  it('写进备注 records accepted feedback; the server appends the draft to notes', async () => {
    vi.mocked(client.sendAgentActionFeedback).mockResolvedValue({
      ...draftAction,
      feedback: 'accepted',
    });
    const user = userEvent.setup();
    renderDetail(makeTask({ delegable: true }), draftAction);

    await user.click(screen.getByRole('button', { name: t.todos.draftApply }));

    await waitFor(() => {
      expect(client.sendAgentActionFeedback).toHaveBeenCalledWith('action-1', {
        feedback: 'accepted',
      });
    });
  });

  it('忽略 records dismissed feedback', async () => {
    vi.mocked(client.sendAgentActionFeedback).mockResolvedValue({
      ...draftAction,
      feedback: 'dismissed',
    });
    const user = userEvent.setup();
    renderDetail(makeTask({ delegable: true }), draftAction);

    await user.click(screen.getByRole('button', { name: t.todos.draftDismiss }));

    await waitFor(() => {
      expect(client.sendAgentActionFeedback).toHaveBeenCalledWith('action-1', {
        feedback: 'dismissed',
      });
    });
  });
});
