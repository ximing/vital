import {
  DEFAULT_NOTIFICATION_PREFS,
  type CalendarInstance,
  type CreateTaskFromTextInput,
  type CreateTaskInput,
  type List,
  type PatchTaskInput,
  type Task,
  type UserProfile,
} from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { startOfWeekYmd, todayYmd, zonedWallTimeIso } from '@/features/todos/model';
import { setAuthForTest } from '@/services/auth.service';
import { SchedulePage } from '../../../src/features/schedule/SchedulePage';
import { QuickCreateOverlay } from '../../../src/features/todos/QuickCreateOverlay';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listLists: vi.fn(),
      calendar: vi.fn(),
      createTask: vi.fn(),
      createTaskFromText: vi.fn(),
      patchTask: vi.fn(),
    },
  };
});

const ZONE = 'Asia/Shanghai';
const DASH = '\u2013';

const world: { instances: CalendarInstance[]; title: string } = { instances: [], title: '' };

const inbox: List = {
  id: 'inbox-1',
  kind: 'inbox',
  name: '收集箱',
  color: null,
  icon: null,
  iconAttachmentId: null,
  iconUrl: null,
  parentId: null,
  sortOrder: 0,
  pinned: false,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockUser: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: ZONE,
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  dailyModelCallLimit: 100,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: { createdTask: true },
  llm: {
    providers: [],
    routing: {},
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const aiUser: UserProfile = {
  ...mockUser,
  llm: {
    providers: [
      {
        id: 'p1',
        providerId: 'openai',
        label: 'OpenAI',
        baseUrl: null,
        models: ['gpt-5-mini'],
        apiKeySet: true,
      },
    ],
    routing: { default: { providerId: 'p1', model: 'gpt-5-mini' } },
  },
};

function Where() {
  const { pathname } = useLocation();
  return <span data-testid="where">{pathname}</span>;
}

function renderSchedule() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/schedule']}>
          <Where />
          <SchedulePage />
          <QuickCreateOverlay />
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

function slotCell(hour: number, minute: number, column: number): HTMLElement {
  const cells = document.querySelectorAll<HTMLElement>(
    `[data-schedule-day][data-schedule-hour="${hour}"][data-schedule-minute="${minute}"]`,
  );
  const cell = cells[column];
  if (cell === undefined) throw new Error(`missing hour ${hour}:${minute} column ${column}`);
  return cell;
}

function selectedSlots(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-schedule-day][data-schedule-selected="true"]')]
    .map(
      (element) =>
        `${element.dataset.scheduleDay}@${element.dataset.scheduleHour}:${element.dataset.scheduleMinute}`,
    )
    .sort();
}

function dayText(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
}

function pointer(target: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp'): void {
  fireEvent[type](target, { button: 0, pointerId: 1, bubbles: true });
}

function drag(from: Element, to: Element): void {
  pointer(from, 'pointerDown');
  pointer(to, 'pointerMove');
  pointer(to, 'pointerUp');
}

function draftLabel(): string {
  return document.querySelector('[data-schedule-draft-range]')?.textContent ?? '';
}

async function readyName(): Promise<HTMLElement> {
  const input = await screen.findByRole('textbox', { name: t.todos.quickAddPlaceholder });
  await waitFor(() => expect(input).toBeEnabled());
  return input;
}

describe('schedule create gesture', () => {
  beforeEach(() => {
    world.instances = [];
    world.title = '';
    setAuthForTest(aiUser);
    vi.mocked(client.listLists).mockResolvedValue({ items: [inbox] });
    vi.mocked(client.calendar).mockImplementation(async () => ({
      instances: world.instances.map((item) => ({ ...item })),
    }));
    vi.mocked(client.createTask).mockImplementation(async (input) => {
      world.instances.push({
        taskId: 'task-new',
        listId: input.listId,
        title: input.title,
        occurrenceAt: input.startAt ?? input.dueAt ?? '',
        isAllDay: input.isAllDay === true,
        status: 'todo',
        priority: 3,
        pinned: false,
      });
      return { id: 'task-new', title: input.title, similarOpenTasks: [] } as unknown as Task;
    });
    vi.mocked(client.createTaskFromText).mockImplementation(async (input: CreateTaskFromTextInput) => {
      world.title = input.text.includes('高优') ? '开会' : input.text.trim();
      return { id: 'task-new', title: world.title, similarOpenTasks: [] } as unknown as Task;
    });
    vi.mocked(client.patchTask).mockImplementation(async (id: string, patch: PatchTaskInput) => {
      const startAt = typeof patch.startAt === 'string' ? patch.startAt : null;
      const dueAt = typeof patch.dueAt === 'string' ? patch.dueAt : null;
      world.instances.push({
        taskId: id,
        listId: 'inbox-1',
        title: world.title,
        occurrenceAt: startAt ?? dueAt ?? '',
        isAllDay: patch.isAllDay === true,
        status: 'todo',
        priority: 3,
        pinned: false,
      });
      return { id, title: world.title, similarOpenTasks: [] } as unknown as Task;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates one timed inbox task from a quarter-hour click through the AI dialog', async () => {
    const user = userEvent.setup();
    renderSchedule();
    await screen.findByText('09:00');
    const cell = slotCell(9, 0, 3);
    const ymd = cell.dataset.scheduleDay ?? '';
    drag(cell, cell);

    expect(await screen.findByRole('dialog', { name: t.todos.quickCreate.title })).toBeInTheDocument();
    expect(draftLabel()).toBe(`${dayText(ymd)} 09:00 ${DASH} 09:15`);
    expect(selectedSlots()).toEqual([`${ymd}@9:0`]);
    expect(document.querySelectorAll('[data-schedule-all-day][data-schedule-selected]')).toHaveLength(0);
    expect(screen.getByTestId('where')).toHaveTextContent('/schedule');

    await user.type(await readyName(), '高优 明天下午三点开会{Enter}');

    await waitFor(() => expect(client.createTaskFromText).toHaveBeenCalledTimes(1));
    expect(client.createTaskFromText).toHaveBeenCalledWith({
      text: '高优 明天下午三点开会',
      listId: 'inbox-1',
      timezone: ZONE,
      smartListId: 'smart:today',
    });
    const pin = {
      startAt: new Date(`${ymd}T09:00:00+08:00`).toISOString(),
      dueAt: new Date(`${ymd}T09:15:00+08:00`).toISOString(),
      isAllDay: false,
    };
    expect(client.patchTask).toHaveBeenCalledWith('task-new', pin);
    expect(pin.startAt).not.toBe(`${ymd}T09:00:00.000Z`);
    expect(client.createTask).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
    });
    const start = document.querySelector(
      `[data-schedule-day="${ymd}"][data-schedule-hour="9"][data-schedule-minute="0"]`,
    );
    expect(start?.textContent).toContain('开会');
    const nextSlot = document.querySelector(
      `[data-schedule-day="${ymd}"][data-schedule-hour="9"][data-schedule-minute="15"]`,
    );
    expect(nextSlot?.textContent).not.toContain('开会');
    expect(document.querySelector('[data-schedule-selected]')).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/schedule');
  });

  it('keeps the pressed column when an hour drag slides into another day, and Escape creates nothing', async () => {
    renderSchedule();
    await screen.findByText('14:00');
    const down = slotCell(14, 0, 0);
    const up = slotCell(10, 0, 2);
    const ymd = down.dataset.scheduleDay ?? '';
    expect(up.dataset.scheduleDay).not.toBe(ymd);
    drag(down, up);

    expect(await screen.findByRole('dialog', { name: t.todos.quickCreate.title })).toBeInTheDocument();
    expect(draftLabel()).toBe(`${dayText(ymd)} 10:00 ${DASH} 14:15`);
    const expected: string[] = [];
    for (let minute = 10 * 60; minute <= 14 * 60; minute += 15) {
      expected.push(`${ymd}@${Math.floor(minute / 60)}:${minute % 60}`);
    }
    expect(selectedSlots()).toEqual(expected.sort());
    expect(document.querySelector(`[data-schedule-day="${up.dataset.scheduleDay}"][data-schedule-selected]`)).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(client.createTask).not.toHaveBeenCalled();
    expect(client.createTaskFromText).not.toHaveBeenCalled();
    expect(client.patchTask).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
    expect(document.querySelector('[data-schedule-selected]')).toBeNull();
  });

  it('creates one all-day task across the closed date interval from the all-day band', async () => {
    const user = userEvent.setup();
    renderSchedule();
    const cells = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[data-schedule-all-day]')];
      expect(found.length).toBe(7);
      return found;
    });
    const picked = cells.slice(1, 4);
    const from = picked[2];
    const to = picked[0];
    if (from === undefined || to === undefined) throw new Error('all-day cells');
    drag(from, to);

    const ymds = picked.map((cell) => cell.dataset.scheduleAllDay ?? '').sort();
    const start = ymds[0] ?? '';
    const end = ymds[2] ?? '';
    expect(await screen.findByRole('dialog', { name: t.todos.quickCreate.title })).toBeInTheDocument();
    expect(draftLabel()).toBe(`${dayText(start)} ${DASH} ${dayText(end)}`);
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-schedule-all-day][data-schedule-selected="true"]')]
        .map((cell) => cell.dataset.scheduleAllDay)
        .sort(),
    ).toEqual(ymds);
    expect(cells[0]?.hasAttribute('data-schedule-selected')).toBe(false);
    expect(cells[4]?.hasAttribute('data-schedule-selected')).toBe(false);
    expect(document.querySelector('[data-schedule-day][data-schedule-selected]')).toBeNull();

    await user.type(await readyName(), '读书{Enter}');
    await waitFor(() => expect(client.createTaskFromText).toHaveBeenCalledTimes(1));
    expect(client.createTaskFromText).toHaveBeenCalledWith({
      text: '读书',
      listId: 'inbox-1',
      timezone: ZONE,
      smartListId: 'smart:today',
    });
    expect(client.patchTask).toHaveBeenCalledWith('task-new', {
      startAt: new Date(`${start}T00:00:00+08:00`).toISOString(),
      dueAt: new Date(`${end}T00:00:00+08:00`).toISOString(),
      isAllDay: true,
    });
    expect(client.createTask).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
    });
    expect(
      document.querySelector(`[data-schedule-all-day="${start}"]`)?.textContent,
    ).toContain('读书');
    expect(
      document.querySelector(`[data-schedule-all-day="${end}"]`)?.textContent,
    ).not.toContain('读书');
    expect(document.querySelector('[data-schedule-selected]')).toBeNull();
  });

  it('uses an out-of-month cell’s own date when the month drag crosses the month edge', async () => {
    const user = userEvent.setup();
    renderSchedule();
    await user.click(screen.getByRole('button', { name: t.schedule.month }));
    const period = document.querySelector('[data-region="schedule"]')?.getAttribute('data-schedule-period');
    expect(period).toMatch(/^\d{4}-\d{2}$/);
    const cells = [...document.querySelectorAll<HTMLElement>('[data-schedule-date]')];
    let lastInside = -1;
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index]?.dataset.scheduleDate?.startsWith(period ?? '')) lastInside = index;
    }
    const inside = cells[lastInside];
    const outside = cells[lastInside + 1];
    if (inside === undefined || outside === undefined) throw new Error('month edge');
    expect(outside.dataset.scheduleDate?.startsWith(period ?? 'x')).toBe(false);
    drag(outside, inside);

    const ymds = [inside.dataset.scheduleDate ?? '', outside.dataset.scheduleDate ?? ''].sort();
    expect(await screen.findByRole('dialog', { name: t.todos.quickCreate.title })).toBeInTheDocument();
    expect(draftLabel()).toBe(`${dayText(ymds[0] ?? '')} ${DASH} ${dayText(ymds[1] ?? '')}`);
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-schedule-date][data-schedule-selected="true"]')]
        .map((cell) => cell.dataset.scheduleDate)
        .sort(),
    ).toEqual(ymds);
    expect(cells[lastInside - 1]?.hasAttribute('data-schedule-selected')).toBe(false);
    expect(cells[lastInside + 2]?.hasAttribute('data-schedule-selected')).toBe(false);

    await user.type(await readyName(), '跨月{Enter}');
    await waitFor(() => expect(client.createTaskFromText).toHaveBeenCalledTimes(1));
    expect(client.patchTask).toHaveBeenCalledWith('task-new', {
      startAt: new Date(`${ymds[0]}T00:00:00+08:00`).toISOString(),
      dueAt: new Date(`${ymds[1]}T00:00:00+08:00`).toISOString(),
      isAllDay: true,
    });
    expect(client.createTask).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
    });
    expect(document.querySelector(`[data-schedule-date="${ymds[0]}"]`)?.textContent).toContain('跨月');
    expect(document.querySelector(`[data-schedule-date="${ymds[1]}"]`)?.textContent).not.toContain('跨月');
    expect(screen.getByTestId('where')).toHaveTextContent('/schedule');
  });

  it('does not create for a blank title or Escape, and Escape drops the selection', async () => {
    const user = userEvent.setup();
    renderSchedule();
    await screen.findByText('11:00');
    const cell = slotCell(11, 0, 1);
    const ymd = cell.dataset.scheduleDay ?? '';
    drag(cell, cell);
    await screen.findByRole('dialog', { name: t.todos.quickCreate.title });
    await user.type(await readyName(), '   ');
    await user.click(screen.getByRole('button', { name: t.todos.add }));
    expect(client.createTask).not.toHaveBeenCalled();
    expect(client.createTaskFromText).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: t.todos.quickCreate.title })).toBeInTheDocument();
    expect(selectedSlots()).toEqual([`${ymd}@11:0`]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(client.createTask).not.toHaveBeenCalled();
    expect(client.createTaskFromText).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
    expect(document.querySelector('[data-schedule-selected]')).toBeNull();
  });

  it('does not open a draft when the pointer goes down on an existing title', async () => {
    const ymd = startOfWeekYmd(todayYmd(ZONE), 1, ZONE);
    world.instances = [
      {
        taskId: 'old',
        listId: 'inbox-1',
        title: '已有安排',
        occurrenceAt: zonedWallTimeIso(ymd, '10:00:00', ZONE),
        isAllDay: false,
        status: 'todo',
        priority: 3,
        pinned: false,
      },
    ];
    renderSchedule();
    const chip = await waitFor(() => {
      const found = document.querySelector('[data-schedule-title="已有安排"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    drag(chip, chip);
    expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
    expect(document.querySelector('[data-schedule-selected]')).toBeNull();
    expect(client.createTask).not.toHaveBeenCalled();
    expect(client.createTaskFromText).not.toHaveBeenCalled();

    const host = chip.closest('[data-schedule-day]');
    if (host === null) throw new Error('chip cell');
    drag(host, host);
    expect(await screen.findByRole('dialog', { name: t.todos.quickCreate.title })).toBeInTheDocument();
    expect(draftLabel()).toBe(`${dayText(ymd)} 10:00 ${DASH} 10:15`);
  });

  it('falls back to one plain create with the dragged slot when no model is configured', async () => {
    setAuthForTest(mockUser);
    const user = userEvent.setup();
    renderSchedule();
    await screen.findByText('09:00');
    const cell = slotCell(9, 15, 3);
    const ymd = cell.dataset.scheduleDay ?? '';
    drag(cell, cell);
    await user.type(await readyName(), '买牛奶{Enter}');

    await waitFor(() => expect(client.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.createTask).mock.calls[0]?.[0]).toEqual({
      title: '买牛奶',
      listId: 'inbox-1',
      timezone: ZONE,
      isAllDay: false,
      startAt: new Date(`${ymd}T09:15:00+08:00`).toISOString(),
      dueAt: new Date(`${ymd}T09:30:00+08:00`).toISOString(),
    } satisfies CreateTaskInput);
    expect(client.createTaskFromText).not.toHaveBeenCalled();
    expect(client.patchTask).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        document.querySelector(
          `[data-schedule-day="${ymd}"][data-schedule-hour="9"][data-schedule-minute="15"]`,
        )?.textContent,
      ).toContain('买牛奶');
    });
  });
});
