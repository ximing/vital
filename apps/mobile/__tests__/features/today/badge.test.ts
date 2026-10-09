import { has, register } from '@rabjs/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../../../src/lib/api';
import { BadgeService, badgeService } from '../../../src/services/badge.service';

const { syncListeners, snapshotListeners, taskListeners } = vi.hoisted(() => ({
  syncListeners: new Set<() => void>(),
  snapshotListeners: new Set<() => void>(),
  taskListeners: new Set<() => void>(),
}));

vi.mock('expo-notifications', () => ({
  requestPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
  setBadgeCountAsync: vi.fn(async () => true),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('expo', () => ({
  requireOptionalNativeModule: vi.fn(() => null),
}));

vi.mock('../../../src/lib/api', () => ({
  client: {
    taskCounts: vi.fn(),
  },
}));

vi.mock('../../../src/lib/sync', () => ({
  subscribeSync: (listener: () => void) => {
    syncListeners.add(listener);
    return () => {
      syncListeners.delete(listener);
    };
  },
  subscribeSnapshot: (listener: () => void) => {
    snapshotListeners.add(listener);
    return () => {
      snapshotListeners.delete(listener);
    };
  },
}));

vi.mock('../../../src/lib/task-mutations', () => ({
  subscribeTaskMutations: (listener: () => void) => {
    taskListeners.add(listener);
    return () => {
      taskListeners.delete(listener);
    };
  },
}));

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('mobile badge', () => {
  beforeEach(async () => {
    const { Platform } = await import('react-native');
    Platform.OS = 'ios';
    vi.useFakeTimers();
    syncListeners.clear();
    snapshotListeners.clear();
    taskListeners.clear();
    if (!has(BadgeService)) register(BadgeService);
    vi.mocked(client.taskCounts).mockResolvedValue({ counts: { 'smart:today': 4 } });
  });

  afterEach(() => {
    badgeService().stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('maps smart:today, skips a repeat, and clears on stop', async () => {
    const { setBadgeCountAsync } = await import('expo-notifications');
    await badgeService().start();
    await flush();
    expect(setBadgeCountAsync).toHaveBeenCalledWith(4);

    taskListeners.forEach((listener) => listener());
    await flush(500);
    expect(setBadgeCountAsync).toHaveBeenCalledTimes(1);

    vi.mocked(client.taskCounts).mockResolvedValue({ counts: {} });
    snapshotListeners.forEach((listener) => listener());
    await flush(500);
    expect(setBadgeCountAsync).toHaveBeenCalledTimes(2);
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(0);

    badgeService().stop();
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(0);
    expect(syncListeners.size).toBe(0);
  });

  it('does not set a badge when badge permission is denied', async () => {
    const { requestPermissionsAsync, setBadgeCountAsync } = await import('expo-notifications');
    vi.mocked(requestPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    } as Awaited<ReturnType<typeof requestPermissionsAsync>>);
    await badgeService().start();
    await flush(500);
    syncListeners.forEach((listener) => listener());
    await flush(500);
    expect(setBadgeCountAsync).not.toHaveBeenCalled();
  });

  it('starts once', async () => {
    const badge = badgeService();
    await badge.start();
    await badge.start();
    expect(syncListeners.size).toBe(1);
    expect(snapshotListeners.size).toBe(1);
    expect(taskListeners.size).toBe(1);
  });

  it('does not keep a count when the launcher rejects it', async () => {
    const { setBadgeCountAsync } = await import('expo-notifications');
    vi.mocked(setBadgeCountAsync).mockResolvedValueOnce(false);
    await badgeService().start();
    await flush();
    expect(setBadgeCountAsync).toHaveBeenCalledTimes(1);

    taskListeners.forEach((listener) => listener());
    await flush(500);
    expect(setBadgeCountAsync).toHaveBeenCalledTimes(2);
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(4);
  });

  it('ignores a count that resolves after stop and start', async () => {
    const { setBadgeCountAsync } = await import('expo-notifications');
    let releaseFirst: (value: { counts: { 'smart:today': number } }) => void = () => undefined;
    vi.mocked(client.taskCounts)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValue({ counts: { 'smart:today': 2 } });

    const pending = badgeService().start();
    await flush();
    badgeService().stop();
    await badgeService().start();
    await flush();
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(2);

    releaseFirst({ counts: { 'smart:today': 9 } });
    await pending;
    await flush();
    expect(setBadgeCountAsync).not.toHaveBeenCalledWith(9);
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(2);
  });

  it('does not subscribe twice when permission resolves after a restart', async () => {
    const { requestPermissionsAsync } = await import('expo-notifications');
    let release: (value: Awaited<ReturnType<typeof requestPermissionsAsync>>) => void = () => undefined;
    vi.mocked(requestPermissionsAsync).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = badgeService().start();
    await flush();
    badgeService().stop();
    vi.mocked(requestPermissionsAsync).mockResolvedValue({
      granted: true,
      status: 'granted',
    } as Awaited<ReturnType<typeof requestPermissionsAsync>>);
    await badgeService().start();
    release({
      granted: true,
      status: 'granted',
      expires: 'never',
      canAskAgain: false,
    } as Awaited<ReturnType<typeof requestPermissionsAsync>>);
    await first;
    await flush();
    expect(syncListeners.size).toBe(1);
    expect(snapshotListeners.size).toBe(1);
    expect(taskListeners.size).toBe(1);
  });

  it('clears an Android badge without setBadgeCountAsync(0)', async () => {
    const { Platform } = await import('react-native');
    const { requireOptionalNativeModule } = await import('expo');
    const { requestPermissionsAsync, setBadgeCountAsync } = await import('expo-notifications');
    Platform.OS = 'android';
    const clear = vi.fn(async () => true);
    vi.mocked(requireOptionalNativeModule).mockReturnValue({ clear });
    vi.mocked(client.taskCounts).mockResolvedValue({ counts: {} });

    await badgeService().start();
    await flush();
    badgeService().stop();

    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(setBadgeCountAsync).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    Platform.OS = 'ios';
  });
});
