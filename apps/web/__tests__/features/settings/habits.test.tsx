import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type Habit,
  type UserProfile,
} from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { SettingsPage } from '../../../src/pages/settings';
import { setAuthForTest } from '@/services/auth.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listHabits: vi.fn(),
      createHabit: vi.fn(),
      patchHabit: vi.fn(),
      deleteHabit: vi.fn(),
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

function habit(input: Partial<Habit> & { id: string }): Habit {
  return {
    name: '喝水',
    kind: 'count',
    targetCount: 8,
    windowStart: '08:00',
    windowEnd: '22:00',
    active: true,
    createdBy: 'user',
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    todayDone: 3,
    todayTotal: 8,
    ...input,
  };
}

const items: Habit[] = [
  habit({ id: 'h1' }),
  habit({
    id: 'h2',
    name: '阅读',
    kind: 'daily',
    targetCount: null,
    windowStart: null,
    windowEnd: null,
    createdBy: 'agent',
    todayDone: 0,
    todayTotal: 1,
  }),
  habit({
    id: 'h3',
    name: '早起',
    kind: 'daily',
    targetCount: null,
    active: false,
    windowStart: null,
    windowEnd: null,
  }),
];

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
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

const copy = t.settings.habits;

describe('settings habits tab', () => {
  beforeEach(() => {
    setAuthForTest(mockUser);
    vi.mocked(client.listHabits).mockResolvedValue(items);
    vi.mocked(client.createHabit).mockResolvedValue(items[0]!);
    vi.mocked(client.patchHabit).mockResolvedValue(items[0]!);
    vi.mocked(client.deleteHabit).mockResolvedValue(undefined);
  });

  it('renders rows with kind/window/progress chips, agent badge and inactive state', async () => {
    renderAt('/settings?tab=habits');
    expect(screen.getByRole('tab', { name: t.settings.tabs.habits })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => {
      expect(document.querySelectorAll('[data-habit-row]')).toHaveLength(3);
    });

    expect(screen.getByText(copy.countChip.replace('{n}', '8'))).toBeInTheDocument();
    expect(screen.getByText('08:00–22:00')).toBeInTheDocument();
    expect(screen.getByText(copy.agentBadge)).toBeInTheDocument();
    expect(screen.getByText(copy.inactive)).toBeInTheDocument();
    expect(document.querySelector('[data-habit-row="h3"]')).toHaveAttribute(
      'data-habit-active',
      'false',
    );
  });

  it('creates a count habit through the add form', async () => {
    renderAt('/settings?tab=habits');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-habit-row]')).toHaveLength(3);
    });

    fireEvent.click(screen.getByText(`+ ${copy.add}`));
    const form = document.querySelector<HTMLElement>('[data-region="habit-add"]')!;
    fireEvent.change(screen.getByLabelText(copy.name), { target: { value: '冥想' } });
    fireEvent.change(screen.getByLabelText(copy.kind), { target: { value: 'count' } });
    fireEvent.change(screen.getByLabelText(copy.target), { target: { value: '5' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(client.createHabit).toHaveBeenCalledWith({ name: '冥想', kind: 'count', targetCount: 5 });
    });
  });

  it('toggles active through the switch', async () => {
    renderAt('/settings?tab=habits');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-habit-row]')).toHaveLength(3);
    });

    const row = document.querySelector('[data-habit-row="h1"]')!;
    fireEvent.click(row.querySelector('button[role="switch"]')!);
    await waitFor(() => {
      expect(client.patchHabit).toHaveBeenCalledWith('h1', { active: false });
    });
  });

  it('edits a habit inline', async () => {
    renderAt('/settings?tab=habits');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-habit-row]')).toHaveLength(3);
    });

    const row = document.querySelector('[data-habit-row="h1"]')!;
    const buttons = [...row.querySelectorAll('button[type="button"]')];
    fireEvent.click(buttons.find((b) => b.textContent === copy.edit)!);

    fireEvent.change(screen.getByLabelText(copy.name), { target: { value: '多喝水' } });
    fireEvent.click(screen.getByText(copy.save));
    await waitFor(() => {
      expect(client.patchHabit).toHaveBeenCalledWith('h1', {
        name: '多喝水',
        targetCount: 8,
        windowStart: '08:00',
        windowEnd: '22:00',
      });
    });
  });

  it('deletes only after the confirm step', async () => {
    renderAt('/settings?tab=habits');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-habit-row]')).toHaveLength(3);
    });

    const row = document.querySelector('[data-habit-row="h3"]')!;
    const buttons = [...row.querySelectorAll('button[type="button"]')];
    fireEvent.click(buttons.find((b) => b.textContent === copy.del)!);
    expect(client.deleteHabit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(copy.confirmDelete));
    await waitFor(() => {
      expect(client.deleteHabit).toHaveBeenCalledWith('h3');
    });
  });
});
