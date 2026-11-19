import { IMAGE_MIME_TYPES } from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { isDesktopHost } from '@/host';
import { humanError } from '@/lib/errors';
import { oidcErrorText } from '@/lib/oidc-error-text';
import { AuthService } from '@/services/auth.service';

export class AccountSectionService extends Service {
  displayName = '';
  error: string | null = null;
  avatarFailed = false;
  oidcEnabled = false;
  oidcLinked = false;
  emailSynthetic = false;
  oidcError: string | null = null;
  private primed = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  prime(): void {
    if (this.primed) return;
    this.displayName = this.auth.user?.displayName ?? '';
    this.oidcError = oidcErrorText(new URLSearchParams(window.location.search).get('oidc_error'));
    this.primed = true;
    void this.loadOidc();
  }

  async loadOidc(): Promise<void> {
    if (isDesktopHost()) {
      this.oidcEnabled = false;
      return;
    }
    try {
      const account = await client.getOidcAccount();
      this.oidcEnabled = account.enabled;
      this.oidcLinked = account.linked;
      this.emailSynthetic = account.emailSynthetic;
    } catch {
      this.oidcEnabled = false;
    }
  }

  startOidcBind(): void {
    window.location.assign(`/api/v1/auth/oidc/bind/start?return=${encodeURIComponent('/settings')}`);
  }

  setDisplayName(value: string): void {
    this.displayName = value;
  }

  setAvatarFailed(value: boolean): void {
    this.avatarFailed = value;
  }

  async saveAvatar(file: File): Promise<void> {
    const user = this.auth.user;
    if (!user || !(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return;
    this.error = null;
    try {
      const uploaded = await client.upload({ file, mime: file.type, size: file.size });
      await client.bindUpload(uploaded.id, { ownerType: 'user', ownerId: user.id });
      this.avatarFailed = false;
      this.auth.setUser(await client.updateMe({ avatarAttachmentId: uploaded.id }));
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async saveProfile(): Promise<void> {
    const next = this.displayName.trim();
    if (next === '' || next === this.auth.user?.displayName) return;
    this.error = null;
    try {
      this.auth.setUser(await client.updateMe({ displayName: next }));
    } catch (err) {
      this.error = humanError(err);
    }
  }
}
