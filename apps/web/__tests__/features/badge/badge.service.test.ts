import type { UserProfile } from '@vital/dto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { resetBadgeOverlayCache, renderBadgeOverlay } from '@/features/badge/badge-icon';
import { badgeService } from '@/features/badge/badge.service';
import type { VitalHost } from '@/host';
import { setAuthForTest } from '@/services/auth.service';
import { appQueryClient } from '@/services/query.service';
import { todoKeys } from '@/features/todos/query-keys';

const user = { id: 'u1' } as UserProfile;

function installHost(setBadge: NonNullable<VitalHost['setBadge']> = vi.fn()): NonNullable<VitalHost['setBadge']> {
  const host: VitalHost = {
    kind: 'desktop',
    applyChrome() {},
    showStickyAlert() {},
    listenStickyAlerts: async () => () => undefined,
    closeStickyAlert() {},
    openInMain() {},
    hideMain() {},
    setBadge,
  };
  Object.defineProperty(window, '__VITAL_HOST__', { configurable: true, value: host });
  return setBadge;
}

async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('badge service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    resetBadgeOverlayCache();
    appQueryClient.removeQueries({ queryKey: todoKeys.counts });
    vi.spyOn(client, 'taskCounts').mockResolvedValue({ counts: { 'smart:today': 4 } });
    setAuthForTest(user);
  });

  afterEach(() => {
    badgeService().stop();
    appQueryClient.removeQueries({ queryKey: todoKeys.counts });
    setAuthForTest(null);
    resetBadgeOverlayCache();
    Reflect.deleteProperty(window, '__VITAL_HOST__');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pushes smart:today and does not repeat the same count', async () => {
    const setBadge = installHost();
    badgeService().start();
    await settle(60_000);

    expect(setBadge).toHaveBeenCalledTimes(1);
    expect(setBadge).toHaveBeenCalledWith(4, undefined);
    // Initial fetch plus one 60s fallback. Cache events must not refetch in a loop.
    expect(client.taskCounts).toHaveBeenCalledTimes(2);

    appQueryClient.setQueryData(todoKeys.counts, { 'smart:today': 4 });
    await settle(300);
    expect(setBadge).toHaveBeenCalledTimes(1);

    appQueryClient.setQueryData(todoKeys.counts, { 'smart:today': 9 });
    await settle(300);
    expect(setBadge).toHaveBeenCalledTimes(2);
    expect(setBadge).toHaveBeenLastCalledWith(9, undefined);

    appQueryClient.setQueryData(todoKeys.counts, { inbox: 2 });
    await settle(300);
    expect(setBadge).toHaveBeenLastCalledWith(0, undefined);
  });

  it('clears the badge on stop', async () => {
    const setBadge = installHost();
    badgeService().start();
    await settle();
    expect(setBadge).toHaveBeenCalledWith(4, undefined);

    badgeService().stop();
    expect(setBadge).toHaveBeenLastCalledWith(0);
  });

  it('does nothing in the browser when the host is missing', async () => {
    badgeService().start();
    await settle(1_000);
    expect(client.taskCounts).toHaveBeenCalled();
  });

  it('ignores a host that is not the desktop shell', async () => {
    const setBadge = vi.fn();
    Object.defineProperty(window, '__VITAL_HOST__', {
      configurable: true,
      value: { kind: 'browser', setBadge },
    });
    badgeService().start();
    await settle();
    expect(setBadge).not.toHaveBeenCalled();
  });

  it('clears the badge when logged out', async () => {
    const setBadge = installHost();
    setAuthForTest(null);
    badgeService().start();
    await settle(60_000);
    expect(setBadge).toHaveBeenCalledTimes(1);
    expect(setBadge).toHaveBeenCalledWith(0, undefined);
    expect(client.taskCounts).not.toHaveBeenCalled();
  });

  it('keeps the last badge when counts fail', async () => {
    const setBadge = installHost();
    badgeService().start();
    await settle();
    expect(setBadge).toHaveBeenCalledTimes(1);

    vi.mocked(client.taskCounts).mockRejectedValue(new Error('offline'));
    appQueryClient.invalidateQueries({ queryKey: todoKeys.counts });
    await settle(5_000);
    expect(setBadge).toHaveBeenCalledTimes(1);
    // retry: 1 on the failed refresh, then backoff. Not a 300ms loop.
    expect(vi.mocked(client.taskCounts).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('does not refetch in a loop when the first counts fetch fails', async () => {
    installHost();
    vi.mocked(client.taskCounts).mockRejectedValue(new Error('offline'));
    badgeService().start();
    await settle(3_000);
    expect(vi.mocked(client.taskCounts).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('drops a count that resolves after stop and start', async () => {
    const setBadge = installHost();
    let release: (value: { counts: { 'smart:today': number } }) => void = () => undefined;
    vi.mocked(client.taskCounts).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    badgeService().start();
    await settle();
    badgeService().stop();
    vi.mocked(client.taskCounts).mockResolvedValue({ counts: { 'smart:today': 2 } });
    badgeService().start();
    release({ counts: { 'smart:today': 9 } });
    await settle();
    expect(setBadge).not.toHaveBeenCalledWith(9, expect.anything());
    expect(setBadge).toHaveBeenLastCalledWith(2, undefined);
  });
});

describe('badge overlay', () => {
  afterEach(() => {
    resetBadgeOverlayCache();
    vi.restoreAllMocks();
  });

  it('returns an empty string when canvas has no 2d context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(renderBadgeOverlay(3)).toBe('');
    expect(renderBadgeOverlay(3)).toBe('');
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(1);
  });

  it('draws a red circle and caches 99+', () => {
    const ctx = {
      fillStyle: '',
      font: '',
      textAlign: '' as CanvasTextAlign,
      textBaseline: '' as CanvasTextBaseline,
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toDataURL: vi.fn(() => 'data:image/png;base64,QUJD'),
    };
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement;
      return real(tag);
    });

    expect(renderBadgeOverlay(2)).toBe('QUJD');
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(32);
    expect(ctx.arc).toHaveBeenCalledWith(16, 16, 16, 0, Math.PI * 2);
    expect(ctx.fillText).toHaveBeenCalledWith('2', 16, 16);
    expect(ctx.font).toContain('18px');
    expect(ctx.fillStyle).toBe('#FFFFFF');

    ctx.fillText.mockClear();
    expect(renderBadgeOverlay(2)).toBe('QUJD');
    expect(ctx.fillText).not.toHaveBeenCalled();

    expect(renderBadgeOverlay(120)).toBe('QUJD');
    expect(ctx.fillText).toHaveBeenCalledWith('99+', 16, 16);
    expect(ctx.font).toContain('13px');
  });
});
