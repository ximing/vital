import { has, register, resolve } from '@rabjs/react';
import type { Habit, Task, TodayDashboard } from '@vital/dto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '../../../src/lib/api';
import { toggleComplete } from '../../../src/features/todos/complete';
import { AuthService } from '../../../src/services/auth.service';
import { TodayService } from '../../../src/features/today/today.service';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  PermissionsAndroid: { PERMISSIONS: {}, RESULTS: {}, request: vi.fn() },
}));

vi.mock('expo', () => ({
  requireOptionalNativeModule: () => null,
}));

vi.mock('expo-notifications', () => ({
  requestPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
  setBadgeCountAsync: vi.fn(async () => true),
}));

vi.mock('../../../src/lib/api', () => ({
  apiUrl: 'http://x',
  client: {
    getToday: vi.fn(),
    listHabits: vi.fn(),
    listLists: vi.fn(),
    listTags: vi.fn(),
    listAgentActions: vi.fn(),
    listTasks: vi.fn(),
    tickHabit: vi.fn(),
    completeTask: vi.fn(),
  },
}));

vi.mock('../../../src/lib/sync', () => ({
  pullSync: vi.fn(async () => null),
  subscribeSync: () => () => undefined,
  subscribeSnapshot: () => () => undefined,
}));

vi.mock('../../../src/lib/token-store', () => ({
  secureTokenStore: {
    getAccessToken: async () => 'tok',
    getRefreshToken: async () => null,
    setTokens: async () => undefined,
    clear: async () => undefined,
  },
  loadUser: async () => null,
  saveUser: async () => undefined,
  onAuthCleared: () => () => undefined,
}));

vi.mock('../../../src/features/todos/complete', () => ({
  toggleComplete: vi.fn(),
}));

const habit: Habit = {
  id: 'h1',
  name: '喝水',
  kind: 'count',
  targetCount: 8,
  windowStart: null,
  windowEnd: null,
  active: true,
  createdBy: 'user',
  sortOrder: 0,
  outcomeId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  todayDone: 0,
  todayTotal: 1,
};

function hang(): Promise<never> {
  return new Promise(() => undefined);
}

function service(): TodayService {
  if (!has(AuthService)) register(AuthService);
  if (!has(TodayService)) register(TodayService);
  return resolve(TodayService);
}

describe('TodayService.tickHabit', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clears the check-in before the today reload finishes', async () => {
    const s = service();
    s.habits = [{ ...habit }];
    s.dashboard = { tasks: [] } as unknown as TodayDashboard;
    vi.mocked(client.tickHabit).mockResolvedValue({ ...habit, todayDone: 1, todayTotal: 1 });
    vi.mocked(client.getToday).mockImplementation(hang);
    vi.mocked(client.listHabits).mockImplementation(hang);
    vi.mocked(client.listLists).mockImplementation(hang);
    vi.mocked(client.listTags).mockImplementation(hang);
    vi.mocked(client.listAgentActions).mockImplementation(hang);
    vi.mocked(client.listTasks).mockImplementation(hang);

    const result = await Promise.race([
      s.tickHabit(s.habits[0]!).then(() => 'done' as const),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 50);
      }),
    ]);

    expect(result).toBe('done');
    expect(s.habits[0]?.todayDone).toBe(1);
    expect(s.refreshing).toBe(false);
  });

  it('does not roll a check-in back when an older reload returns', async () => {
    const s = service();
    s.habits = [{ ...habit, todayDone: 0 }];
    s.dashboard = { tasks: [] } as unknown as TodayDashboard;
    let releaseStale: (rows: Habit[]) => void = () => undefined;
    vi.mocked(client.listHabits).mockImplementationOnce(
      () =>
        new Promise<Habit[]>((resolve) => {
          releaseStale = resolve;
        }),
    );
    vi.mocked(client.getToday).mockResolvedValue({ tasks: [] } as unknown as TodayDashboard);
    vi.mocked(client.listLists).mockResolvedValue({ items: [] });
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });

    const stale = s.load(false);
    vi.mocked(client.tickHabit).mockResolvedValue({ ...habit, todayDone: 1, todayTotal: 1 });
    vi.mocked(client.listHabits).mockImplementation(hang);
    await s.tickHabit({ ...habit });
    releaseStale([{ ...habit, todayDone: 0, todayTotal: 1 }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(s.habits[0]?.todayDone).toBe(1);
    void stale;
  });

  it('checks in an open instance without waiting on the reload', async () => {
    const task = {
      id: 't1',
      habitId: 'h1',
      status: 'todo',
      deletedAt: null,
      createdAt: '2026-09-12T08:00:00.000Z',
    } as Task;
    const s = service();
    s.habits = [{ ...habit }];
    s.dashboard = { tasks: [task] } as unknown as TodayDashboard;
    vi.mocked(toggleComplete).mockImplementation(async (_task, onTask) => {
      onTask({ ...task, status: 'done' });
    });
    vi.mocked(client.getToday).mockImplementation(hang);
    vi.mocked(client.listHabits).mockImplementation(hang);
    vi.mocked(client.listLists).mockImplementation(hang);
    vi.mocked(client.listTags).mockImplementation(hang);
    vi.mocked(client.listAgentActions).mockImplementation(hang);
    vi.mocked(client.listTasks).mockImplementation(hang);

    const result = await Promise.race([
      s.tickHabit(s.habits[0]!).then(() => 'done' as const),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 50);
      }),
    ]);

    expect(result).toBe('done');
    expect(s.habits[0]?.todayDone).toBe(1);
    expect(s.refreshing).toBe(false);
    expect(client.tickHabit).not.toHaveBeenCalled();
  });
});
