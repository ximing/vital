import { resolve, Service } from '@rabjs/react';
import type { NotificationPrefs, Task } from '@vital/dto';
import { DEFAULT_NOTIFICATION_PREFS } from '@vital/dto';
import { t } from '@/copy';
import { AuthService } from '@/services/auth.service';
import { appQueryClient } from '@/services/query.service';
import { appPathFromNotifyUrl } from './app-path';
import { notifyKey, planDueNow } from './plan';

const SHOWN_KEY = 'vital.browser-notify.shown';
const SHOWN_CAP = 200;
const SCAN_MS = 20_000;
const PERMISSION_PROBE_MS = 400;

export type BrowserNotifyPermission = NotificationPermission | 'unsupported';

type PushPayload = {
  type?: unknown;
  id?: unknown;
  title?: unknown;
  body?: unknown;
  url?: unknown;
};

function notificationCtor(): typeof Notification | null {
  return typeof Notification === 'undefined' ? null : Notification;
}

function mapPermission(value: string): Exclude<BrowserNotifyPermission, 'unsupported'> {
  if (value === 'granted' || value === 'denied') return value;
  return 'default';
}

function openNotifyUrl(url: string): void {
  window.focus();
  window.location.assign(appPathFromNotifyUrl(url));
}

function loadShown(): string[] {
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveShown(keys: string[]): void {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(keys.slice(-SHOWN_CAP)));
  } catch {
    // Quota / private mode.
  }
}

function taskUrl(task: Task): string {
  return `/todos/lists/${task.listId}?task=${task.id}`;
}

/**
 * Local OS toasts for the isomorphic web shell.
 * Browser: `window.Notification`. Tauri: plugin-notification patches that
 * constructor onto native banners, so this service does not branch.
 */
export class BrowserNotifyService extends Service {
  permission: BrowserNotifyPermission = 'unsupported';
  private shown = new Set<string>(loadShown());
  private timer: ReturnType<typeof setInterval> | null = null;
  private probe: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  refreshPermission(): void {
    const Ctor = notificationCtor();
    this.permission = Ctor ? mapPermission(Ctor.permission) : 'unsupported';
  }

  async requestPermission(): Promise<BrowserNotifyPermission> {
    const Ctor = notificationCtor();
    if (!Ctor) {
      this.permission = 'unsupported';
      return this.permission;
    }
    try {
      this.permission = mapPermission(await Ctor.requestPermission());
    } catch {
      this.permission = mapPermission(Ctor.permission);
    }
    if (this.permission === 'granted') this.scan();
    return this.permission;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.refreshPermission();
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_MS);
    // Tauri's plugin probes OS permission asynchronously after patching Notification.
    this.probe = setTimeout(() => {
      this.probe = null;
      if (!this.started) return;
      this.refreshPermission();
      this.scan();
    }, PERMISSION_PROBE_MS);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.probe) clearTimeout(this.probe);
    this.probe = null;
  }

  showPush(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const payload = raw as PushPayload;
    if (payload.type !== 'notify') return;
    const id = typeof payload.id === 'string' ? payload.id : null;
    const title = typeof payload.title === 'string' ? payload.title : null;
    const body = typeof payload.body === 'string' ? payload.body : '';
    const url = typeof payload.url === 'string' ? payload.url : '/today';
    if (id === null || title === null) return;
    this.display(id, title, body, url);
  }

  scan(now = new Date()): void {
    this.refreshPermission();
    if (this.permission !== 'granted') return;
    const user = this.auth.user;
    if (!user) return;
    const prefs: NotificationPrefs = user.notifications ?? DEFAULT_NOTIFICATION_PREFS;
    const zone = user.timezone ?? 'UTC';
    for (const task of this.cachedTasks()) {
      const plan = planDueNow(task, prefs, zone, now);
      if (!plan) continue;
      const key = notifyKey(plan.eventType, task.id, plan.occurrenceAt);
      const title =
        plan.eventType === 'task.remind' ? t.settings.notify.remindTitle : t.settings.notify.dueTitle;
      const template =
        plan.eventType === 'task.remind' ? t.settings.notify.remindBody : t.settings.notify.dueBody;
      this.display(key, title, template.replace('{title}', task.title), taskUrl(task));
    }
  }

  private cachedTasks(): Task[] {
    const byId = new Map<string, Task>();
    for (const [, data] of appQueryClient.getQueriesData<Task[]>({ queryKey: ['todos'] })) {
      if (!Array.isArray(data)) continue;
      for (const task of data) {
        if (task && typeof task.id === 'string') byId.set(task.id, task);
      }
    }
    return [...byId.values()];
  }

  private display(key: string, title: string, body: string, url: string): void {
    if (this.shown.has(key)) return;
    const Ctor = notificationCtor();
    if (!Ctor || Ctor.permission !== 'granted') return;
    this.shown.add(key);
    saveShown([...this.shown]);
    try {
      const popup = new Ctor(title, { body, tag: key });
      // Tauri's patched constructor does not return a Notification instance.
      if (popup && typeof popup.close === 'function') {
        popup.onclick = () => {
          openNotifyUrl(url);
          popup.close();
        };
      }
    } catch {
      this.shown.delete(key);
      saveShown([...this.shown]);
    }
  }

  resetForTest(): void {
    this.stop();
    this.permission = 'unsupported';
    this.shown.clear();
    saveShown([]);
  }
}

export function browserNotify(): BrowserNotifyService {
  return resolve(BrowserNotifyService);
}

export function resetBrowserNotify(): void {
  browserNotify().resetForTest();
}
