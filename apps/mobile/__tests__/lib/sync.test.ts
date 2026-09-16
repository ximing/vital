import type { SyncChanges, SyncHead } from '@vital/dto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../../src/lib/api';
import { pullSync, startMobileSync, stopMobileSync } from '../../src/lib/sync';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

vi.mock('../../src/lib/api', () => ({
  apiUrl: 'http://x',
  client: {
    syncChanges: vi.fn(),
  },
}));

vi.mock('../../src/lib/token-store', () => ({
  secureTokenStore: {
    getAccessToken: () => 'tok',
    getRefreshToken: () => null,
    setTokens: async () => undefined,
    clear: async () => undefined,
  },
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

describe('mobile sync cursor', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'WebSocket',
      class {
        onopen: (() => void) | null = null;
        onmessage: ((ev: { data: string }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readyState = 1;
        send(): void {}
        close(): void {}
      },
    );
  });

  afterEach(() => {
    stopMobileSync();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('skips the first pull then advances with server nextSince', async () => {
    const firstCursor =
      's1|2026-09-01T00:00:00.000Z|11111111-1111-4111-8111-111111111111|2026-09-01T00:00:00.000Z||2026-09-01T00:00:00.000Z|';
    const doneCursor =
      's1|2026-09-02T00:00:00.000Z||2026-09-02T00:00:00.000Z||2026-09-02T00:00:00.000Z|';
    vi.mocked(client.syncChanges)
      .mockResolvedValueOnce(page({ truncated: true, nextSince: firstCursor }))
      .mockResolvedValueOnce(page({ truncated: false, nextSince: doneCursor }));

    startMobileSync();
    await pullSync();
    expect(client.syncChanges).not.toHaveBeenCalled();

    await pullSync();
    expect(client.syncChanges).toHaveBeenCalledTimes(2);
    const firstSince = vi.mocked(client.syncChanges).mock.calls[0]?.[0]?.since;
    expect(firstSince).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(vi.mocked(client.syncChanges).mock.calls[1]?.[0]?.since).toBe(firstCursor);
  });
});
