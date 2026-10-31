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
      listTags: vi.fn(),
      listTasks: vi.fn(),
      listOutcomes: vi.fn(),
      listAgentActions: vi.fn(),
      getTask: vi.fn(),
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

const detailTask = {
  id: 'old',
  listId: 'inbox-1',
  parentId: null,
  outcomeId: null,
  estimateMinutes: null,
  deferCount: 0,
  delegable: false,
  habitId: null,
  habitSeq: null,
  title: '已有安排',
  notes: '',
  status: 'todo',
  priority: 3,
  pinned: false,
  dueAt: null,
  startAt: null,
  reminderMode: 'none',
  reminderOffsetMinutes: null,
  reminderAt: null,
  isAllDay: false,
  timezone: ZONE,
  recurrence: null,
  recurrenceKind: null,
  recurrenceDtstart: null,
  completedAt: null,
  sortOrder: 1,
  tagIds: [],
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Task;

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

/** jsdom does not implement this. Blocks sit above the hour cells, so the gesture reads the stack. */
function stubElementsFromPoint(stack: () => Element[]): () => void {
  const previous = document.elementsFromPoint;
  document.elementsFromPoint = () => stack();
  return () => {
    document.elementsFromPoint = typeof previous === 'function' ? previous : () => [];
  };
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
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.getTask).mockResolvedValue(detailTask);
    vi.mocked(client.calendar).mockImplementation(async () => ({
      instances: world.instances.map((item) => ({ ...item })),
    }));
    vi.mocked(client.createTask).mockImplementation(async (input) => {
      world.instances.push({
        taskId: 'task-new',
        listId: input.listId,
        title: input.title,
        occurrenceAt: input.startAt ?? input.dueAt ?? '',
        endsAt: null,
        habitId: null,
        calendarKey: null,
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
        endsAt: null,
        habitId: null,
        calendarKey: null,
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
        endsAt: null,
        habitId: null,
        calendarKey: null,
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
    expect(client.patchTask).not.toHaveBeenCalled();

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

  it('opens the task detail when a title is clicked', async () => {
    const user = userEvent.setup();
    const ymd = startOfWeekYmd(todayYmd(ZONE), 1, ZONE);
    world.instances = [
      {
        taskId: 'old',
        listId: 'inbox-1',
        title: '已有安排',
        occurrenceAt: zonedWallTimeIso(ymd, '10:00:00', ZONE),
        endsAt: null,
        habitId: null,
        calendarKey: null,
        isAllDay: false,
        status: 'todo',
        priority: 3,
        pinned: false,
      },
    ];
    renderSchedule();
    await user.click(await screen.findByRole('button', { name: '10:00 已有安排' }));
    expect(await screen.findByRole('complementary', { name: '已有安排' })).toBeInTheDocument();
    expect(client.getTask).toHaveBeenCalledWith('old');
  });

  it('draws a start-to-end block instead of a start chip', async () => {
    const ymd = startOfWeekYmd(todayYmd(ZONE), 1, ZONE);
    world.instances = [
      {
        taskId: 'span',
        listId: 'inbox-1',
        title: '评审',
        occurrenceAt: zonedWallTimeIso(ymd, '14:00:00', ZONE),
        endsAt: zonedWallTimeIso(ymd, '16:00:00', ZONE),
        habitId: null,
        calendarKey: null,
        isAllDay: false,
        status: 'todo',
        priority: 3,
        pinned: false,
      },
    ];
    renderSchedule();
    const block = await screen.findByRole('button', { name: '14:00–16:00 评审' });
    expect(block).toHaveAttribute('data-schedule-span', `${14 * 60}-${16 * 60}`);
    expect(
      document.querySelector(
        `[data-schedule-day="${ymd}"][data-schedule-hour="14"][data-schedule-minute="0"]`,
      )?.textContent,
    ).not.toContain('评审');
  });

  it('keeps the month overflow behind 查看更多', async () => {
    const user = userEvent.setup();
    const ymd = todayYmd(ZONE);
    world.instances = ['甲', '乙', '丙', '丁'].map((title, index) => ({
      taskId: title,
      listId: 'inbox-1',
      title,
      occurrenceAt: zonedWallTimeIso(ymd, `${String(9 + index).padStart(2, '0')}:00:00`, ZONE),
      endsAt: null,
      habitId: title === '丁' ? 'habit-1' : null,
      calendarKey: null,
      isAllDay: false,
      status: 'todo' as const,
      priority: 3 as const,
      pinned: false,
    }));
    renderSchedule();
    await user.click(await screen.findByRole('button', { name: t.schedule.month }));
    const cell = document.querySelector(`[data-schedule-date="${ymd}"]`);
    expect(cell?.textContent).toContain('甲');
    expect(cell?.textContent).toContain('乙');
    expect(cell?.textContent).not.toContain('丙');
    expect(cell?.textContent).not.toContain('丁');
    await user.click(screen.getByRole('button', { name: t.schedule.more }));
    const more = document.querySelector('[data-region="schedule-more"]');
    expect(more?.textContent).toContain('丙');
    expect(more?.textContent).toContain('丁');
    expect(more?.textContent).not.toContain('甲');
  });

  it('moves a timed chip onto another quarter without creating', async () => {
    const ymd = startOfWeekYmd(todayYmd(ZONE), 1, ZONE);
    world.instances = [
      {
        taskId: 'old',
        listId: 'inbox-1',
        title: '已有安排',
        occurrenceAt: zonedWallTimeIso(ymd, '10:00:00', ZONE),
        endsAt: null,
        habitId: null,
        calendarKey: null,
        isAllDay: false,
        status: 'todo',
        priority: 3,
        pinned: false,
      },
    ];
    renderSchedule();
    const chip = await screen.findByRole('button', { name: '10:00 已有安排' });
    const dest = document.querySelector(
      `[data-schedule-day="${ymd}"][data-schedule-hour="11"][data-schedule-minute="15"]`,
    );
    if (dest === null) throw new Error('dest cell');
    drag(chip, dest);
    expect(client.createTask).not.toHaveBeenCalled();
    expect(client.createTaskFromText).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
    // patchTask runs in the mutation microtask, after the pointer handler returns.
    await waitFor(() => {
      expect(client.patchTask).toHaveBeenCalledWith('old', {
        startAt: zonedWallTimeIso(ymd, '11:15:00', ZONE),
        dueAt: zonedWallTimeIso(ymd, '11:15:00', ZONE),
        isAllDay: false,
      });
    });
  });

  it('moves a block to another day and resizes one edge', async () => {
    const ymd = startOfWeekYmd(todayYmd(ZONE), 1, ZONE);
    world.instances = [
      {
        taskId: 'span',
        listId: 'inbox-1',
        title: '评审',
        occurrenceAt: zonedWallTimeIso(ymd, '14:00:00', ZONE),
        endsAt: zonedWallTimeIso(ymd, '16:00:00', ZONE),
        habitId: null,
        calendarKey: null,
        isAllDay: false,
        status: 'todo',
        priority: 3,
        pinned: false,
      },
    ];
    renderSchedule();
    const block = await screen.findByRole('button', { name: '14:00–16:00 评审' });
    const origin = slotCell(14, 0, 0);
    const dest = slotCell(15, 30, 1);
    const next = dest.dataset.scheduleDay ?? '';
    let stack: Element[] = [origin];
    const restore = stubElementsFromPoint(() => stack);
    pointer(block, 'pointerDown');
    stack = [dest];
    pointer(dest, 'pointerMove');
    pointer(dest, 'pointerUp');
    restore();
    await waitFor(() => {
      expect(client.patchTask).toHaveBeenCalledWith('span', {
        startAt: zonedWallTimeIso(next, '15:30:00', ZONE),
        dueAt: zonedWallTimeIso(next, '17:30:00', ZONE),
        isAllDay: false,
      });
    });
    expect(client.createTask).not.toHaveBeenCalled();

    vi.mocked(client.patchTask).mockClear();
    const handle = document.querySelector('[data-schedule-resize="end"]');
    if (handle === null) throw new Error('resize handle');
    const endCell = slotCell(16, 45, 0);
    const hideCells = stubElementsFromPoint(() => []);
    pointer(handle, 'pointerDown');
    pointer(endCell, 'pointerMove');
    pointer(endCell, 'pointerUp');
    hideCells();
    await waitFor(() => {
      expect(client.patchTask).toHaveBeenCalledWith('span', {
        startAt: zonedWallTimeIso(ymd, '14:00:00', ZONE),
        dueAt: zonedWallTimeIso(ymd, '17:00:00', ZONE),
        isAllDay: false,
      });
    });
  });

  it('does not move a device-calendar mirror', async () => {
    const ymd = startOfWeekYmd(todayYmd(ZONE), 1, ZONE);
    world.instances = [
      {
        taskId: 'mirror',
        listId: 'inbox-1',
        title: '日历会议',
        occurrenceAt: zonedWallTimeIso(ymd, '10:00:00', ZONE),
        endsAt: null,
        habitId: null,
        calendarKey: 'mac:event-1',
        isAllDay: false,
        status: 'todo',
        priority: 3,
        pinned: false,
      },
    ];
    renderSchedule();
    const chip = await screen.findByRole('button', { name: '10:00 日历会议' });
    const dest = document.querySelector(
      `[data-schedule-day="${ymd}"][data-schedule-hour="11"][data-schedule-minute="0"]`,
    );
    if (dest === null) throw new Error('dest cell');
    drag(chip, dest);
    expect(client.patchTask).not.toHaveBeenCalled();
    expect(client.createTask).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
  });

  it('moves an all-day chip by a day', async () => {
    const ymd = startOfWeekYmd(todayYmd(ZONE), 1, ZONE);
    world.instances = [
      {
        taskId: 'day',
        listId: 'inbox-1',
        title: '读书',
        occurrenceAt: new Date(`${ymd}T00:00:00+08:00`).toISOString(),
        endsAt: null,
        habitId: null,
        calendarKey: null,
        isAllDay: true,
        status: 'todo',
        priority: 3,
        pinned: false,
      },
    ];
    renderSchedule();
    const chip = await screen.findByRole('button', { name: '读书' });
    const from = chip.closest('[data-schedule-all-day]');
    const cells = [...document.querySelectorAll<HTMLElement>('[data-schedule-all-day]')];
    const index = from === null ? -1 : cells.indexOf(from as HTMLElement);
    const to = cells[index + 1];
    if (to === undefined) throw new Error('next all-day cell');
    drag(chip, to);
    const next = to.dataset.scheduleAllDay ?? '';
    await waitFor(() => {
      expect(client.patchTask).toHaveBeenCalledWith('day', {
        startAt: new Date(`${next}T00:00:00+08:00`).toISOString(),
        dueAt: new Date(`${next}T00:00:00+08:00`).toISOString(),
        isAllDay: true,
      });
    });
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('opens the day view from a month date', async () => {
    const user = userEvent.setup();
    renderSchedule();
    await user.click(await screen.findByRole('button', { name: t.schedule.month }));
    const ymd = todayYmd(ZONE);
    const link = document.querySelector<HTMLElement>(`[data-schedule-day-link="${ymd}"]`);
    if (link === null) throw new Error('day link');
    await user.click(link);
    expect(document.querySelector('[data-region="schedule"]')).toHaveAttribute('data-schedule-view', 'day');
    expect(document.querySelector('[data-region="schedule-day"]')).not.toBeNull();
    const columns = document.querySelectorAll(
      `[data-schedule-hour="9"][data-schedule-minute="0"][data-schedule-day="${ymd}"]`,
    );
    expect(columns).toHaveLength(1);
    expect(screen.getByRole('button', { name: t.schedule.day })).toHaveAttribute('aria-pressed', 'true');
  });
});
