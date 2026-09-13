import { afterEach, describe, expect, it, vi } from 'vitest';
import { appPathFromNotifyUrl } from '../../../src/features/notify/app-path';
import { browserNotify, resetBrowserNotify } from '../../../src/features/notify/browser-notify.service';

const originalNotification = globalThis.Notification;

type FakePopup = {
  onclick: ((this: Notification, ev: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
};

function installBrowserNotification(permission: NotificationPermission = 'granted') {
  const instances: FakePopup[] = [];
  const Ctor = function FakeNotification(
    this: FakePopup,
    _title: string,
    _options?: NotificationOptions,
  ) {
    this.onclick = null;
    this.close = vi.fn();
    instances.push(this);
  } as unknown as typeof Notification & { instances: FakePopup[] };
  Object.defineProperty(Ctor, 'permission', { configurable: true, writable: true, value: permission });
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
  Object.defineProperty(Ctor, 'permission', { configurable: true, writable: true, value: 'granted' });
  Ctor.requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  vi.stubGlobal('Notification', Ctor);
  return { calls };
}

afterEach(() => {
  resetBrowserNotify();
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
});
