import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asStickyAlertPayload,
  encodeStickyAlertHash,
  isNotifyAlertRuntime,
  parseStickyAlertHash,
  readStickyAlertPref,
  resetStickyAlertForTest,
  setStickyAlertTauriForTest,
  showStickyAlert,
  STICKY_ALERT_EVENT,
  STICKY_ALERT_LABEL,
  STICKY_ALERT_PREF_KEY,
  stickyAlertPosition,
  writeStickyAlertPref,
  type StickyAlertWindow,
} from '../../../src/features/notify/sticky-alert';

afterEach(() => {
  resetStickyAlertForTest();
});

describe('sticky alert local pref', () => {
  it('defaults off and round-trips through localStorage', () => {
    expect(readStickyAlertPref()).toBe(false);
    writeStickyAlertPref(true);
    expect(localStorage.getItem(STICKY_ALERT_PREF_KEY)).toBe('1');
    expect(readStickyAlertPref()).toBe(true);
    writeStickyAlertPref(false);
    expect(localStorage.getItem(STICKY_ALERT_PREF_KEY)).toBeNull();
    expect(readStickyAlertPref()).toBe(false);
  });
});

describe('sticky alert payload', () => {
  it('round-trips through the window hash and rejects junk', () => {
    const payload = { id: 'n1', title: '任务提醒', body: '到期了', url: '/today' };
    const hash = encodeStickyAlertHash(payload);
    expect(hash.startsWith('#vital-alert=')).toBe(true);
    expect(parseStickyAlertHash(hash)).toEqual(payload);
    expect(parseStickyAlertHash('#nope')).toBeNull();
    expect(asStickyAlertPayload({ title: 'x' })).toBeNull();
    expect(isNotifyAlertRuntime({ location: { hash } })).toBe(true);
    expect(isNotifyAlertRuntime({ location: { hash: '' } })).toBe(false);
  });

  it('pins the card to the top-right of the work area', () => {
    expect(stickyAlertPosition({ x: 0, y: 25, width: 1440, height: 900 }, 400, 196, 16)).toEqual({
      x: 1024,
      y: 41,
    });
  });
});

describe('showStickyAlert', () => {
  it('creates one always-on-top window and flushes queued payloads after it exists', async () => {
    const created: StickyAlertWindow[] = [];
    const emitTo = vi.fn<(target: string, event: string, payload: unknown) => Promise<void>>(
      async () => undefined,
    );
    const handlers = new Map<string, () => void>();

    function fakeWindow(): StickyAlertWindow {
      const win: StickyAlertWindow = {
        once(event, handler) {
          handlers.set(event, () => handler());
        },
        show: vi.fn(async () => undefined),
        unminimize: vi.fn(async () => undefined),
        setFocus: vi.fn(async () => undefined),
        setAlwaysOnTop: vi.fn(async () => undefined),
        requestUserAttention: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      };
      created.push(win);
      return win;
    }

    setStickyAlertTauriForTest(
      async () =>
        ({
          WebviewWindow: Object.assign(
            function WebviewWindow() {
              return fakeWindow();
            },
            {
              getByLabel: async () => null,
              getCurrent: () => created[0] ?? fakeWindow(),
            },
          ),
          currentMonitor: async () => null,
          UserAttentionType: { Critical: 1 },
          emitTo,
          listen: async () => () => undefined,
        }) as never,
    );

    const first = showStickyAlert({ id: 'a', title: '任务提醒', body: '一', url: '/today' });
    const second = showStickyAlert({ id: 'b', title: '任务到期', body: '二', url: '/todos' });
    await first;
    await second;
    expect(created).toHaveLength(1);
    handlers.get('tauri://created')?.();
    await vi.waitFor(() => expect(emitTo).toHaveBeenCalled());
    const ids = emitTo.mock.calls.map((call) => (call[2] as { id: string }).id);
    expect(ids).toEqual(['a', 'b']);
    expect(emitTo.mock.calls[0]?.[0]).toBe(STICKY_ALERT_LABEL);
    expect(emitTo.mock.calls[0]?.[1]).toBe(STICKY_ALERT_EVENT);
  });
});
