import type { ApiToken, ApiTokenAccessLog, CreatedApiToken } from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { humanError } from '@/lib/errors';

export class TokensSectionService extends Service {
  name = '';
  items: ApiToken[] = [];
  created: CreatedApiToken | null = null;
  copied = false;
  error: string | null = null;
  confirmId: string | null = null;
  accessId: string | null = null;
  accessLogs: ApiTokenAccessLog[] | null = null;

  setName(value: string): void {
    this.name = value;
  }

  async load(): Promise<void> {
    try {
      this.items = (await client.listApiTokens()).items;
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async create(): Promise<void> {
    const next = this.name.trim();
    if (next === '') return;
    this.error = null;
    this.copied = false;
    try {
      this.created = await client.createApiToken({ name: next });
      this.name = '';
      this.items = (await client.listApiTokens()).items;
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async copy(): Promise<void> {
    if (!this.created) return;
    try {
      await navigator.clipboard.writeText(this.created.token);
      this.copied = true;
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async revoke(id: string): Promise<void> {
    if (this.confirmId !== id) {
      this.confirmId = id;
      return;
    }
    this.error = null;
    try {
      await client.revokeApiToken(id);
      this.confirmId = null;
      if (this.created?.id === id) this.created = null;
      if (this.accessId === id) {
        this.accessId = null;
        this.accessLogs = null;
      }
      this.items = (await client.listApiTokens()).items;
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async toggleAccess(id: string): Promise<void> {
    if (this.accessId === id) {
      this.accessId = null;
      this.accessLogs = null;
      return;
    }
    this.accessId = id;
    this.accessLogs = null;
    this.error = null;
    try {
      this.accessLogs = (await client.listApiTokenAccess(id, { limit: 50 })).items;
    } catch (err) {
      this.error = humanError(err);
      this.accessId = null;
    }
  }
}
