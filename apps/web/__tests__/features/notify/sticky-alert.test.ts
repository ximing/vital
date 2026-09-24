import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VitalHost } from '../../../src/host';
import {
  asStickyAlertPayload,
  dismissStickyAlertWindow,
  encodeStickyAlertHash,
  isNotifyAlertRuntime,
  listenStickyAlerts,
  openStickyAlertTarget,
  parseStickyAlertHash,
  readStickyAlertPref,
  resetStickyAlertForTest,
  showStickyAlert,
  STICKY_ALERT_PREF_KEY,
  stickyAlertPosition,
  writeStickyAlertPref,
  type StickyAlertPayload,
} from '../../../src/features/notify/sticky-alert';

function installHost(overrides: Partial<VitalHost> = {}): VitalHost {
  const host: VitalHost = {
    kind: 'desktop',
    applyChrome() {},
    showStickyAlert() {},
    listenStickyAlerts: async () => () => undefined,
    closeStickyAlert() {},
    openInMain() {},
    ...overrides,
  };
  Object.defineProperty(window, '__VITAL_HOST__', { configurable: true, value: host });
  return host;
}

afterEach(() => {
  resetStickyAlertForTest();
  Reflect.deleteProperty(window, '__VITAL_HOST__');
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
  it('asks the desktop host and does nothing in the browser', async () => {
    await showStickyAlert({ id: 'a', title: '任务提醒', body: '一', url: '/today' });
    const show = vi.fn();
    installHost({ showStickyAlert: show });
    await showStickyAlert({ id: 'a', title: '任务提醒', body: '一', url: '/today' });
    await showStickyAlert({ id: 'b', title: '任务到期', body: '二', url: '/todos' });
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenNthCalledWith(1, {
      id: 'a',
      title: '任务提醒',
      body: '一',
      url: '/today',
    });
    expect(show).toHaveBeenNthCalledWith(2, {
      id: 'b',
      title: '任务到期',
      body: '二',
      url: '/todos',
    });
  });

  it('closes the shell window and opens the target in the main window', () => {
    const closeStickyAlert = vi.fn();
    const openInMain = vi.fn();
    installHost({ closeStickyAlert, openInMain });
    dismissStickyAlertWindow();
    openStickyAlertTarget('/today');
    expect(closeStickyAlert).toHaveBeenCalledTimes(1);
    expect(openInMain).toHaveBeenCalledWith('/today');
  });

  it('subscribes to later alerts through the host', async () => {
    const seen: StickyAlertPayload[] = [];
    installHost({
      listenStickyAlerts: async (onItem) => {
        onItem({ id: 'a', title: '任务提醒', body: '一', url: '/today' });
        onItem({ id: '', title: 'junk', body: '', url: '/today' });
        return () => undefined;
      },
    });
    const stop = await listenStickyAlerts((item) => seen.push(item));
    expect(seen).toEqual([{ id: 'a', title: '任务提醒', body: '一', url: '/today' }]);
    stop();
  });
});
