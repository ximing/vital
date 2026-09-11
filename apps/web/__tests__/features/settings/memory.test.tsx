import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type AgentMemoryItem,
  type UserProfile,
} from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { SettingsPage } from '../../../src/pages/settings';
import { MemoryPage } from '../../../src/pages/ai';
import { setAuthForTest } from '@/services/auth.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listAgentMemory: vi.fn(),
      createAgentMemory: vi.fn(),
      patchAgentMemory: vi.fn(),
      deleteAgentMemory: vi.fn(),
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

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/memory" element={<MemoryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

function mem(input: Partial<AgentMemoryItem> & { id: string }): AgentMemoryItem {
  return {
    kind: 'preference',
    content: '内容',
    scope: ['all'],
    sourceCount: 1,
    manual: false,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    ...input,
  };
}

const items: AgentMemoryItem[] = [
  mem({ id: 'm1', kind: 'preference', content: '估时不超过 30 分钟', manual: true }),
  mem({
    id: 'm2',
    kind: 'preference',
    content: '周末不排任务',
    scope: ['cluster', 'decompose'],
    sourceCount: 3,
  }),
  mem({ id: 'm3', kind: 'pattern', content: '喜欢拆成小步' }),
  mem({ id: 'm4', kind: 'correction', content: '不要用「冲刺」' }),
];

describe('memory page', () => {
  beforeEach(() => {
    setAuthForTest(mockUser);
    vi.mocked(client.listAgentMemory).mockResolvedValue(items);
    vi.mocked(client.createAgentMemory).mockResolvedValue(items[0]!);
    vi.mocked(client.patchAgentMemory).mockResolvedValue(items[0]!);
    vi.mocked(client.deleteAgentMemory).mockResolvedValue(undefined);
  });

  it('guards unknown tab values back to account', () => {
    renderAt('/settings?tab=bogus');
    expect(screen.getByRole('tab', { name: t.settings.tabs.account })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('renders the page and groups items by kind with scope, manual badge and source count', async () => {
    renderAt('/memory');
    expect(screen.getByRole('heading', { name: t.settings.memory.title })).toBeInTheDocument();

    await waitFor(() => {
      expect(client.listAgentMemory).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-memory-row]')).toHaveLength(4);
    });

    const copy = t.settings.memory;
    // Three kind groups, each with its count.
    for (const kind of ['preference', 'pattern', 'correction'] as const) {
      const group = document.querySelector(`[data-memory-group="${kind}"]`);
      expect(group).not.toBeNull();
      const expected = items.filter((item) => item.kind === kind).length;
      expect(group!.textContent).toContain(`${copy.kinds[kind]} · ${expected}`);
    }

    // Contents are painted.
    expect(screen.getByText('估时不超过 30 分钟')).toBeInTheDocument();
    expect(screen.getByText('不要用「冲刺」')).toBeInTheDocument();

    // Manual badge only on the manual row.
    expect(document.querySelectorAll('[data-memory-manual-badge]')).toHaveLength(1);
    const manualRow = document.querySelector('[data-memory-row="m1"]');
    expect(manualRow).toHaveAttribute('data-memory-manual', 'true');

    // Scope chips: 'all' renders as 全部, multi-scope lists each capability.
    expect(document.querySelector('[data-memory-row="m2"] [data-memory-scope]')).toHaveAttribute(
      'data-memory-scope',
      'cluster,decompose',
    );
    expect(screen.getAllByText(copy.scopes.all).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(copy.scopes.cluster)).toBeInTheDocument();
    expect(screen.getByText(copy.scopes.decompose)).toBeInTheDocument();

    // Source count.
    expect(screen.getByText(`${copy.sourceCount} 3`)).toBeInTheDocument();
  });

  it('creates a manual memory through the add form', async () => {
    renderAt('/memory');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-memory-row]')).toHaveLength(4);
    });

    fireEvent.click(screen.getByText(`+ ${t.settings.memory.add}`));

    const copy = t.settings.memory;
    fireEvent.change(screen.getByLabelText(copy.kind), { target: { value: 'correction' } });
    fireEvent.change(screen.getByLabelText(copy.content), {
      target: { value: '手写的新记忆' },
    });
    // Narrow the scope from 全部 to 线程聚类 (the list rows show the same label, so scope to the form).
    const form = document.querySelector<HTMLElement>('[data-region="memory-add"]')!;
    fireEvent.click(within(form).getByText(copy.scopes.cluster));

    fireEvent.click(screen.getByText(copy.submit));
    await waitFor(() => {
      expect(client.createAgentMemory).toHaveBeenCalledWith({
        kind: 'correction',
        content: '手写的新记忆',
        scope: ['cluster'],
      });
    });
  });

  it('patches content and scope through the inline editor', async () => {
    renderAt('/memory');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-memory-row]')).toHaveLength(4);
    });

    const copy = t.settings.memory;
    // The edit button lives inside m3's row (scope defaults to ['all']).
    const row = document.querySelector('[data-memory-row="m3"]')!;
    const buttons = [...row.querySelectorAll('button[type="button"]')];
    fireEvent.click(buttons.find((b) => b.textContent === copy.edit)!);

    fireEvent.change(screen.getByLabelText(copy.content), {
      target: { value: '改成小步快走' },
    });
    fireEvent.click(screen.getByText(copy.save));

    await waitFor(() => {
      expect(client.patchAgentMemory).toHaveBeenCalledWith('m3', {
        content: '改成小步快走',
        scope: ['all'],
      });
    });
  });

  it('deletes a memory row', async () => {
    renderAt('/memory');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-memory-row]')).toHaveLength(4);
    });

    const row = document.querySelector('[data-memory-row="m4"]')!;
    const buttons = [...row.querySelectorAll('button[type="button"]')];
    fireEvent.click(buttons.find((b) => b.textContent === t.settings.memory.del)!);

    await waitFor(() => {
      expect(client.deleteAgentMemory).toHaveBeenCalledWith('m4');
    });
  });

  it('shows a friendly empty state', async () => {
    vi.mocked(client.listAgentMemory).mockResolvedValue([]);
    renderAt('/memory');
    await waitFor(() => {
      expect(screen.getByText(t.settings.memory.empty)).toBeInTheDocument();
    });
    expect(document.querySelector('[data-memory-group]')).toBeNull();
    // The hand-write entry point stays available even when empty.
    expect(screen.getByText(`+ ${t.settings.memory.add}`)).toBeInTheDocument();
  });
});
