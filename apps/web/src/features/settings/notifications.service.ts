import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationChannel,
  type NotificationPrefs,
} from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';

export class NotificationsSectionService extends Service {
  channels: NotificationChannel[] = [];
  nickname = '';
  enabled = true;
  error: string | null = null;
  notice: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get prefs(): NotificationPrefs {
    return this.auth.user?.notifications ?? DEFAULT_NOTIFICATION_PREFS;
  }

  get meow(): NotificationChannel | undefined {
    return this.channels.find((channel) => channel.type === 'meow');
  }

  async load(): Promise<void> {
    try {
      const res = await client.listNotificationChannels();
      this.channels = res.items;
      const meow = res.items.find((channel) => channel.type === 'meow');
      if (meow) {
        this.nickname = meow.config.nickname;
        this.enabled = meow.enabled;
      }
    } catch (err) {
      this.error = humanError(err);
    }
  }

  setNickname(value: string): void {
    this.nickname = value;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  async savePrefs(next: NotificationPrefs): Promise<void> {
    this.auth.setUser(await client.updateMe({ notifications: next }));
  }

  async saveChannel(): Promise<void> {
    this.error = null;
    this.notice = null;
    try {
      const meow = this.meow;
      if (meow) {
        const updated = await client.patchNotificationChannel(meow.id, {
          enabled: this.enabled,
          config: { nickname: this.nickname },
        });
        this.channels = this.channels.map((channel) => (channel.id === updated.id ? updated : channel));
      } else {
        const created = await client.createNotificationChannel({
          type: 'meow',
          enabled: this.enabled,
          config: { nickname: this.nickname },
        });
        this.channels = [...this.channels, created];
      }
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async sendTest(): Promise<void> {
    const meow = this.meow;
    if (!meow) return;
    this.error = null;
    this.notice = null;
    try {
      await client.testNotificationChannel(meow.id);
      this.notice = t.settings.notify.testOk;
    } catch (err) {
      this.error = humanError(err);
    }
  }
}
