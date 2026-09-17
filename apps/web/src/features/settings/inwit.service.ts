import type { InwitConfigPublic, InwitTopic } from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';

export class InwitSectionService extends Service {
  baseUrl = '';
  accessKey = '';
  accessKeySet = false;
  defaultTopicId: string | null = null;
  topics: InwitTopic[] = [];
  loaded = false;
  testing = false;
  saving = false;
  error: string | null = null;
  notice: string | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const config = await client.getInwitConfig();
      this.apply(config);
    } catch (err) {
      this.error = humanError(err);
    } finally {
      this.loaded = true;
    }
  }

  apply(config: InwitConfigPublic): void {
    this.baseUrl = config.baseUrl;
    this.accessKeySet = config.accessKeySet;
    this.defaultTopicId = config.defaultTopicId;
    this.accessKey = '';
  }

  setBaseUrl(value: string): void {
    this.baseUrl = value;
  }

  setAccessKey(value: string): void {
    this.accessKey = value;
  }

  setDefaultTopicId(value: string): void {
    this.defaultTopicId = value === '' ? null : value;
  }

  setError(value: string | null): void {
    this.error = value;
  }

  /** Verify the key against inwit and populate the topic dropdown. */
  async test(): Promise<void> {
    this.testing = true;
    this.error = null;
    this.notice = null;
    try {
      const res = await client.testInwit();
      this.topics = res.topics;
      this.notice = res.topics.length === 0 ? t.settings.inwit.noTopics : t.settings.inwit.testOk;
    } catch (err) {
      this.error = humanError(err);
    } finally {
      this.testing = false;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    this.error = null;
    this.notice = null;
    try {
      this.apply(
        await client.putInwitConfig({
          baseUrl: this.baseUrl.trim(),
          ...(this.accessKey.trim() !== '' ? { accessKey: this.accessKey.trim() } : {}),
          defaultTopicId: this.defaultTopicId,
        }),
      );
      this.notice = t.settings.inwit.saved;
    } catch (err) {
      this.error = humanError(err);
    } finally {
      this.saving = false;
    }
  }
}
