import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type Habit,
  type UserProfile,
} from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { HabitsPage } from '../../../src/pages/ai';
import { setAuthForTest } from '@/services/auth.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listHabits: vi.fn(),
      listHabitCheckins: vi.fn(),
      listOutcomes: vi.fn(),
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
    outcomeId: null,
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
            <Route path="/habits" element={<HabitsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

const copy = t.settings.habits;

function shanghaiMonthDay(day: string): string {
  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return `${stamp.slice(0, 8)}${day}`;
}

describe('habits page', () => {
  beforeEach(() => {
    setAuthForTest(mockUser);
    vi.mocked(client.listHabits).mockResolvedValue(items);
    vi.mocked(client.listHabitCheckins).mockResolvedValue({
      items: [{ habitId: 'h1', days: [{ date: shanghaiMonthDay('15'), done: 8 }] }],
    });
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
    vi.mocked(client.createHabit).mockResolvedValue(items[0]!);
    vi.mocked(client.patchHabit).mockResolvedValue(items[0]!);
    vi.mocked(client.deleteHabit).mockResolvedValue(undefined);
  });

  it('shows count progress against the daily target, not spawned instances', async () => {
    vi.mocked(client.listHabits).mockResolvedValue([
      habit({ id: 'h1', todayDone: 6, todayTotal: 6, targetCount: 8 }),
    ]);
    renderAt('/habits');
    expect(
      await screen.findByText(copy.todayProgress.replace('{done}', '6').replace('{total}', '8')),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(copy.todayProgress.replace('{done}', '6').replace('{total}', '6')),
    ).not.toBeInTheDocument();
  });

  it('renders rows with kind/window/progress chips, agent badge and inactive state', async () => {
    renderAt('/habits');
    expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelectorAll('[data-habit-row]')).toHaveLength(3);
    });

    expect(screen.getByText(copy.countChip.replace('{n}', '8'))).toBeInTheDocument();
    expect(screen.getByText('08:00–22:00')).toBeInTheDocument();
    expect(screen.getByText(copy.agentBadge)).toBeInTheDocument();
    // '已停用' also labels a filter pill; scope the badge assertion to the paused row.
    const pausedRow = document.querySelector('[data-habit-row="h3"]') as HTMLElement;
    expect(within(pausedRow).getByText(copy.inactive)).toBeInTheDocument();
    expect(pausedRow).toHaveAttribute(
      'data-habit-active',
      'false',
    );
  });

  it('renders a check-in calendar per habit', async () => {
    renderAt('/habits');
    const day = shanghaiMonthDay('15');
    await waitFor(() => {
      expect(
        document.querySelector(`[data-habit-calendar="h1"] [data-checkin="${day}"]`),
      ).toHaveAttribute('data-checkin-done', '8');
    });
    expect(document.querySelectorAll('[data-habit-calendar]')).toHaveLength(3);
    expect(screen.getByLabelText(copy.calendarAria.replace('{name}', '喝水'))).toBeInTheDocument();
  });

  it('creates a count habit through the add form', async () => {
    renderAt('/habits');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-habit-row]')).toHaveLength(3);
    });

    fireEvent.click(screen.getByText(`+ ${copy.add}`));
    const form = document.querySelector<HTMLElement>('[data-region="habit-add"]')!;
    fireEvent.change(screen.getByLabelText(copy.name), { target: { value: '冥想' } });
    // Kind is a segmented chip group now, not a select.
    fireEvent.click(
      [...form.querySelectorAll('button[type="button"]')].find(
        (b) => b.textContent === copy.kindCount,
      )!,
    );
    fireEvent.change(screen.getByLabelText(copy.target), { target: { value: '5' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(client.createHabit).toHaveBeenCalledWith({ name: '冥想', kind: 'count', targetCount: 5 });
    });
  });

  it('toggles active through the switch', async () => {
    renderAt('/habits');
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
    renderAt('/habits');
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
        outcomeId: null,
      });
    });
  });

  it('deletes only after the confirm step', async () => {
    renderAt('/habits');
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
