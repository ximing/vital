import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type Outcome,
  type UserProfile,
} from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { ThreadsPage } from '../../../src/pages/ai';
import { setAuthForTest } from '@/services/auth.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listOutcomes: vi.fn(),
      patchOutcome: vi.fn(),
      closeOutcome: vi.fn(),
      reopenOutcome: vi.fn(),
    },
  };
});

const mockUser: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: {},
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function outcome(input: Partial<Outcome> & { id: string }): Outcome {
  return {
    name: '桌面端发布',
    status: 'open',
    createdBy: 'user',
    ruleSignal: null,
    ruleNextStep: null,
    agentHeadline: null,
    agentSuggestion: null,
    agentState: 'idle',
    agentUpdatedAt: null,
    undoUntil: null,
    lastActivityAt: null,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    openTaskCount: 2,
    completedLast7d: 1,
    materialCount: 3,
    ...input,
  };
}

const openItems: Outcome[] = [
  outcome({ id: 'o1' }),
  outcome({ id: 'o2', name: 'Agent 看板', createdBy: 'agent', openTaskCount: 0 }),
];
const closedItems: Outcome[] = [outcome({ id: 'o3', name: 'v0.1 发布', status: 'closed' })];

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/threads" element={<ThreadsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

const copy = t.settings.threads;

describe('threads page', () => {
  beforeEach(() => {
    setAuthForTest(mockUser);
    vi.mocked(client.listOutcomes).mockImplementation((status) =>
      Promise.resolve(status === 'closed' ? closedItems : openItems),
    );
    vi.mocked(client.patchOutcome).mockResolvedValue(openItems[0]!);
    vi.mocked(client.closeOutcome).mockResolvedValue(openItems[0]!);
    vi.mocked(client.reopenOutcome).mockResolvedValue(closedItems[0]!);
  });

  it('renders open and closed groups with stats and agent badge', async () => {
    renderAt('/threads');
    expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelectorAll('[data-outcome-row]')).toHaveLength(3);
    });

    // 组头：标题 + 数量（「进行中」同时出现在概览 stat 里，按 section 断言）。
    const openSection = document.querySelector(`section[aria-label="${copy.openGroup}"]`)!;
    expect(openSection.textContent).toContain(`2 ${copy.stats.openUnit}`);
    const closedSection = document.querySelector(`section[aria-label="${copy.closedGroup}"]`)!;
    expect(closedSection.textContent).toContain(`1 ${copy.stats.openUnit}`);
    expect(screen.getByText(copy.agentBadge)).toBeInTheDocument();
    expect(screen.getAllByText(copy.openTasks.replace('{n}', '2')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(copy.closedAt.replace('{date}', '2026-09-05'))).toBeInTheDocument();
  });

  it('renames an open thread inline', async () => {
    renderAt('/threads');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-outcome-row]')).toHaveLength(3);
    });

    const row = document.querySelector('[data-outcome-row="o1"]')!;
    const buttons = [...row.querySelectorAll('button[type="button"]')];
    fireEvent.click(buttons.find((b) => b.textContent === copy.rename)!);

    fireEvent.change(screen.getByLabelText(copy.nameAria), { target: { value: '桌面端 v0.3' } });
    fireEvent.click(screen.getByText(copy.save));
    await waitFor(() => {
      expect(client.patchOutcome).toHaveBeenCalledWith('o1', { name: '桌面端 v0.3' });
    });
  });

  it('closes an open thread and reopens a closed one', async () => {
    renderAt('/threads');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-outcome-row]')).toHaveLength(3);
    });

    const openRow = document.querySelector('[data-outcome-row="o2"]')!;
    const openButtons = [...openRow.querySelectorAll('button[type="button"]')];
    fireEvent.click(openButtons.find((b) => b.textContent === copy.close)!);
    await waitFor(() => {
      expect(client.closeOutcome).toHaveBeenCalledWith('o2');
    });

    const closedRow = document.querySelector('[data-outcome-row="o3"]')!;
    const closedButtons = [...closedRow.querySelectorAll('button[type="button"]')];
    fireEvent.click(closedButtons.find((b) => b.textContent === copy.reopen)!);
    await waitFor(() => {
      expect(client.reopenOutcome).toHaveBeenCalledWith('o3');
    });
  });
});
