import { resolve, Service } from '@rabjs/react';
import { requireOptionalNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { client } from '../lib/api';
import { subscribeSnapshot, subscribeSync } from '../lib/sync';
import { subscribeTaskMutations } from '../lib/task-mutations';

const DEBOUNCE_MS = 500;

type BadgePermission = 'granted' | 'denied' | 'retry';

type LauncherBadgeNative = {
  clear(): Promise<boolean>;
};

/** Launcher badge for today's open tasks. Foreground refresh only. */
export class BadgeService extends Service {
  private started = false;
  private allowed = false;
  private epoch = 0;
  private last = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubSync: (() => void) | null = null;
  private unsubSnapshot: (() => void) | null = null;
  private unsubTasks: (() => void) | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const epoch = ++this.epoch;
    const permission = await this.requestBadgePermission();
    if (epoch !== this.epoch || !this.started) return;
    if (permission === 'retry') {
      this.started = false;
      return;
    }
    if (permission !== 'granted') {
      this.allowed = false;
      return;
    }
    this.allowed = true;
    this.bind();
    void this.refresh();
  }

  stop(): void {
    this.started = false;
    this.allowed = false;
    this.epoch += 1;
    this.unsubSync?.();
    this.unsubSync = null;
    this.unsubSnapshot?.();
    this.unsubSnapshot = null;
    this.unsubTasks?.();
    this.unsubTasks = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.last = -1;
    void this.writeCount(0);
  }

  private async requestBadgePermission(): Promise<BadgePermission> {
    // ShortcutBadger does not use POST_NOTIFICATIONS. Asking here races Huawei push on Android 13+.
    if (Platform.OS === 'android') return 'granted';
    try {
      const result = await Notifications.requestPermissionsAsync({
        ios: { allowBadge: true, allowAlert: false, allowSound: false },
      });
      return result.granted === true ? 'granted' : 'denied';
    } catch {
      return 'retry';
    }
  }

  private bind(): void {
    this.unsubSync?.();
    this.unsubSnapshot?.();
    this.unsubTasks?.();
    this.unsubSync = subscribeSync(() => {
      this.schedule();
    });
    this.unsubSnapshot = subscribeSnapshot(() => {
      this.schedule();
    });
    this.unsubTasks = subscribeTaskMutations(() => {
      this.schedule();
    });
  }

  private schedule(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, DEBOUNCE_MS);
  }

  private async refresh(): Promise<void> {
    if (!this.started || !this.allowed) return;
    const epoch = this.epoch;
    try {
      const res = await client.taskCounts();
      if (!this.started || !this.allowed || epoch !== this.epoch) return;
      const count = res.counts['smart:today'] ?? 0;
      if (count === this.last) return;
      const applied = await this.writeCount(count);
      if (!this.started || epoch !== this.epoch) {
        void this.writeCount(0);
        return;
      }
      if (!applied) return;
      this.last = count;
    } catch {
      // Offline keeps the last badge.
    }
  }

  private async writeCount(count: number): Promise<boolean> {
    try {
      if (count <= 0 && Platform.OS === 'android') {
        // setBadgeCountAsync(0) calls NotificationManager.cancelAll() and dismisses pushes.
        const native = requireOptionalNativeModule<LauncherBadgeNative>('LauncherBadge');
        if (!native) return false;
        return (await native.clear()) !== false;
      }
      return (await Notifications.setBadgeCountAsync(count)) !== false;
    } catch {
      return false;
    }
  }
}

export function badgeService(): BadgeService {
  return resolve(BadgeService);
}
