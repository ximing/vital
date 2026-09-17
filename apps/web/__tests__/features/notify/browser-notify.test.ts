import { afterEach, describe, expect, it, vi } from 'vitest';
import { appPathFromNotifyUrl } from '../../../src/features/notify/app-path';
import {
  browserNotify,
  resetBrowserNotify,
} from '../../../src/features/notify/browser-notify.service';
import {
  resetStickyAlertForTest,
  setStickyAlertTauriForTest,
  STICKY_ALERT_LABEL,
} from '../../../src/features/notify/sticky-alert';

const originalNotification = globalThis.Notification;

type FakePopup = {
  onclick: ((this: Notification, ev: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
  options?: NotificationOptions;
};

function installBrowserNotification(permission: NotificationPermission = 'granted') {
  const instances: FakePopup[] = [];
  const Ctor = function FakeNotification(
    this: FakePopup,
    _title: string,
    options?: NotificationOptions,
  ) {
    this.onclick = null;
    this.close = vi.fn();
    this.options = options;
    instances.push(this);
  } as unknown as typeof Notification & { instances: FakePopup[] };
  Object.defineProperty(Ctor, 'permission', {
    configurable: true,
    writable: true,
    value: permission,
  });
  Ctor.requestPermission = vi.fn(async () => permission);
  (Ctor as { instances: FakePopup[] }).instances = instances;
  vi.stubGlobal('Notification', Ctor);
  return { Ctor, instances };
}

function installTauriPatchedNotification() {
  const calls: Array<{ title: string; options?: NotificationOptions }> = [];
  const Ctor = function TauriNotification(title: string, options?: NotificationOptions) {
    calls.push({ title, options });
  } as unknown as typeof Notification;
  Object.defineProperty(Ctor, 'permission', {
    configurable: true,
    writable: true,
    value: 'granted',
  });
  Ctor.requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  vi.stubGlobal('Notification', Ctor);
  return { calls };
}

afterEach(() => {
  resetBrowserNotify();
  resetStickyAlertForTest();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  vi.unstubAllGlobals();
  if (originalNotification) {
    vi.stubGlobal('Notification', originalNotification);
  } else {
    Reflect.deleteProperty(globalThis, 'Notification');
  }
});

describe('appPathFromNotifyUrl', () => {
  it('keeps in-app paths and strips WEB_ORIGIN from push URLs', () => {
    expect(appPathFromNotifyUrl('/todos/lists/l1?task=t1')).toBe('/todos/lists/l1?task=t1');
    expect(appPathFromNotifyUrl('https://vital.aimo.plus/todos/lists/l1?task=t1')).toBe(
      '/todos/lists/l1?task=t1',
    );
    expect(appPathFromNotifyUrl('https://vital.aimo.plus/today')).toBe('/today');
    expect(appPathFromNotifyUrl('')).toBe('/today');
  });
});

describe('BrowserNotifyService', () => {
  it('shows a browser Notification and opens the in-app path on click', () => {
    const { instances } = installBrowserNotification('granted');
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    const notify = browserNotify();
    notify.showPush({
      type: 'notify',
      id: 'n1',
      title: '任务提醒',
      body: '「交报告」提醒到了',
      url: 'https://vital.aimo.plus/todos/lists/l1?task=t1',
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]?.options?.requireInteraction).toBe(true);
    instances[0]?.onclick?.call(instances[0] as unknown as Notification, new Event('click'));
    expect(assign).toHaveBeenCalledWith('/todos/lists/l1?task=t1');
    expect(instances[0]?.close).toHaveBeenCalled();
  });

  it('does not throw or drop the shown key when Tauri patches Notification to a void constructor', () => {
    const { calls } = installTauriPatchedNotification();
    const notify = browserNotify();
    notify.showPush({ type: 'notify', id: 'n2', title: '任务到期', body: '到期了', url: '/today' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBe('任务到期');
    notify.showPush({ type: 'notify', id: 'n2', title: '任务到期', body: '到期了', url: '/today' });
    expect(calls).toHaveLength(1);
  });

  it('maps prompt-style permission results to default', async () => {
    const { Ctor } = installBrowserNotification('default');
    Ctor.requestPermission = vi.fn(async () => 'prompt' as NotificationPermission);
    const permission = await browserNotify().requestPermission();
    expect(permission).toBe('default');
  });

  it('does not open the sticky overlay on Tauri unless the local flag is on', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    const { calls } = installTauriPatchedNotification();
    const created: unknown[] = [];
    setStickyAlertTauriForTest(
      async () =>
        ({
          WebviewWindow: Object.assign(
            class {
              constructor() {
                created.push('created');
              }
              once() {
                return undefined;
              }
              show = async () => undefined;
              unminimize = async () => undefined;
              setFocus = async () => undefined;
              setAlwaysOnTop = async () => undefined;
              requestUserAttention = async () => undefined;
              close = async () => undefined;
            },
            { getByLabel: async () => null, getCurrent: () => null },
          ),
          currentMonitor: async () => null,
          UserAttentionType: { Critical: 1 },
          emitTo: async () => undefined,
          listen: async () => () => undefined,
        }) as never,
    );
    browserNotify().showPush({
      type: 'notify',
      id: 'n3',
      title: '任务提醒',
      body: '「交报告」提醒到了',
      url: '/today',
    });
    await Promise.resolve();
    expect(created).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it('opens a sticky overlay on Tauri when the local flag is on, even without OS permission', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    installBrowserNotification('default');
    const created: Array<{ label: string; options: Record<string, unknown> }> = [];
    const emitTo = vi.fn(async () => undefined);
    setStickyAlertTauriForTest(
      async () =>
        ({
          WebviewWindow: Object.assign(
            class {
              constructor(label: string, options: Record<string, unknown>) {
                created.push({ label, options });
              }
              once(event: string, handler: () => void) {
                if (event === 'tauri://created') handler();
              }
              show = async () => undefined;
              unminimize = async () => undefined;
              setFocus = async () => undefined;
              setAlwaysOnTop = async () => undefined;
              requestUserAttention = async () => undefined;
              close = async () => undefined;
            },
            {
              getByLabel: async () => null,
              getCurrent: () => {
                throw new Error('unused');
              },
            },
          ),
          currentMonitor: async () => null,
          UserAttentionType: { Critical: 1 },
          emitTo,
          listen: async () => () => undefined,
        }) as never,
    );
    const notify = browserNotify();
    notify.setStickyEnabled(true);
    notify.showPush({
      type: 'notify',
      id: 'n4',
      title: '任务提醒',
      body: '「交报告」提醒到了',
      url: '/today',
    });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.label).toBe(STICKY_ALERT_LABEL);
    expect(String(created[0]?.options.url)).toContain('vital-alert=');
    expect(created[0]?.options.alwaysOnTop).toBe(true);
    expect(created[0]?.options.visibleOnAllWorkspaces).toBe(true);
    expect(created[0]?.options.decorations).toBe(false);
  });
});
