import type { SyncChanges, SyncHead } from '@vital/dto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { startSync, stopSync } from '../../../src/features/sync/sync-engine';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      syncChanges: vi.fn(),
      syncHead: vi.fn(),
    },
    tokenStore: { getAccessToken: () => null },
  };
});

vi.mock('@/features/notify/browser-notify.service', () => ({
  browserNotify: () => ({ scan: vi.fn(), showPush: vi.fn() }),
}));

const HEAD: SyncHead = {
  tasksMaxUpdatedAt: null,
  inboxMaxUpdatedAt: null,
  reportsMaxUpdatedAt: null,
  revision: 1,
};

function page(over: Partial<SyncChanges> = {}): SyncChanges {
  return {
    serverTime: '2026-09-02T00:00:00.000Z',
    head: HEAD,
    tasks: [],
    inbox: [],
    reports: [],
    truncated: false,
    nextSince: 's1|2026-09-02T00:00:00.000Z||2026-09-02T00:00:00.000Z||2026-09-02T00:00:00.000Z|',
    ...over,
  };
}

describe('sync-engine cursor', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'WebSocket',
      class {
        addEventListener(): void {}
        close(): void {}
        send(): void {}
        readyState = 1;
      },
    );
  });

  afterEach(() => {
    stopSync();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('bootstraps with an ISO since then continues with server nextSince', async () => {
    const firstCursor =
      's1|2026-09-01T00:00:00.000Z|11111111-1111-4111-8111-111111111111|2026-09-01T00:00:00.000Z||2026-09-01T00:00:00.000Z|';
    const doneCursor =
      's1|2026-09-02T00:00:00.000Z||2026-09-02T00:00:00.000Z||2026-09-02T00:00:00.000Z|';
    vi.mocked(client.syncChanges)
      .mockResolvedValueOnce(page({ truncated: true, nextSince: firstCursor }))
      .mockResolvedValueOnce(page({ truncated: false, nextSince: doneCursor }));
    vi.mocked(client.syncHead).mockResolvedValue(HEAD);

    startSync(new QueryClient({ defaultOptions: { queries: { retry: false } } }));

    await vi.waitFor(() => expect(client.syncChanges).toHaveBeenCalledTimes(2));
    const firstSince = vi.mocked(client.syncChanges).mock.calls[0]?.[0]?.since;
    expect(firstSince).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(vi.mocked(client.syncChanges).mock.calls[1]?.[0]?.since).toBe(firstCursor);
  });
});
