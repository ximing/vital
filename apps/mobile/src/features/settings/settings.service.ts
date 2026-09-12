import { Service } from '@rabjs/react';
import {
  DEFAULT_NOTIFICATION_PREFS,
  IMAGE_MIME_TYPES,
  type NotificationChannel,
  type NotificationPrefs,
} from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';

export class SettingsService extends Service {
  displayName = '';
  error: string | null = null;
  busy = false;
  avatarFailed = false;
  channels: NotificationChannel[] = [];
  nickname = '';
  enabled = true;
  todayExecs: number | null = null;
  prefPicker: 'timezone' | 'week' | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get prefs() {
    return this.auth.user?.notifications ?? DEFAULT_NOTIFICATION_PREFS;
  }

  get meow(): NotificationChannel | undefined {
    return this.channels.find((c) => c.type === 'meow');
  }

  constructor() {
    super();
    this.displayName = this.auth.user?.displayName ?? '';
  }

  setDisplayName(value: string): void {
    this.displayName = value;
  }

  setNickname(value: string): void {
    this.nickname = value;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  setAvatarFailed(value: boolean): void {
    this.avatarFailed = value;
  }

  openPrefPicker(kind: 'timezone' | 'week'): void {
    this.prefPicker = kind;
  }

  closePrefPicker(): void {
    this.prefPicker = null;
  }

  async load(): Promise<void> {
    try {
      const res = await client.listNotificationChannels();
      this.channels = res.items;
      const hit = res.items.find((c) => c.type === 'meow');
      if (hit) {
        this.nickname = hit.config.nickname;
        this.enabled = hit.enabled;
      }
    } catch (err) {
      this.error = humanError(err);
    }
    try {
      const execs = await client.listAgentExecutions(1);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      this.todayExecs = execs.filter((e) => new Date(e.createdAt) >= start).length;
    } catch {
      this.todayExecs = null;
    }
  }

  async saveProfile(): Promise<void> {
    const next = this.displayName.trim();
    if (next === '') return;
    this.busy = true;
    try {
      const user = await client.updateMe({ displayName: next });
      this.auth.refreshUser(user);
      toast(copy.toast.saved);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.busy = false;
    }
  }

  async patchPrefs(input: {
    timezone?: string;
    weekStartsOn?: 0 | 1;
    notifications?: NotificationPrefs;
    avatarAttachmentId?: string;
  }): Promise<void> {
    try {
      const user = await client.updateMe(input);
      this.auth.refreshUser(user);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async pickAvatar(): Promise<void> {
    if (!this.auth.user) return;
    try {
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const mime = asset.mimeType ?? 'image/jpeg';
      if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return;
      const { File } = await import('expo-file-system');
      const size = asset.fileSize ?? new File(asset.uri).size;
      if (!size) return;
      this.busy = true;
      const uploaded = await client.upload({ file: new File(asset.uri), mime, size });
      await client.bindUpload(uploaded.id, { ownerType: 'user', ownerId: this.auth.user.id });
      this.avatarFailed = false;
      this.auth.refreshUser(await client.updateMe({ avatarAttachmentId: uploaded.id }));
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.busy = false;
    }
  }

  async saveChannel(): Promise<void> {
    this.busy = true;
    try {
      const meow = this.meow;
      if (meow) {
        const updated = await client.patchNotificationChannel(meow.id, {
          enabled: this.enabled,
          config: { nickname: this.nickname },
        });
        this.channels = this.channels.map((c) => (c.id === updated.id ? updated : c));
      } else {
        const created = await client.createNotificationChannel({
          type: 'meow',
          enabled: this.enabled,
          config: { nickname: this.nickname },
        });
        this.channels = [...this.channels, created];
      }
      toast(copy.toast.saved);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.busy = false;
    }
  }

  async testChannel(): Promise<void> {
    const meow = this.meow;
    if (!meow) return;
    try {
      await client.testNotificationChannel(meow.id);
      toast(copy.settings.notify.testOk);
    } catch (err) {
      toast(humanError(err));
    }
  }
}
