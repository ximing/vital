import { Service } from '@rabjs/react';
import type { InwitTopic } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';

export class InwitSectionService extends Service {
  baseUrl = '';
  accessKey = '';
  accessKeySet = false;
  defaultTopicId: string | null = null;
  topics: InwitTopic[] = [];
  loaded = false;
  testing = false;
  saving = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const config = await client.getInwitConfig();
      this.apply(config);
    } catch {
      // 首屏设置页静默失败，保存时再报错。
    } finally {
      this.loaded = true;
    }
  }

  apply(config: { baseUrl: string; accessKeySet: boolean; defaultTopicId: string | null }): void {
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

  setDefaultTopicId(value: string | null): void {
    this.defaultTopicId = value;
  }

  async test(): Promise<void> {
    this.testing = true;
    try {
      const res = await client.testInwit();
      this.topics = res.topics;
      toast(res.topics.length === 0 ? copy.settings.inwit.noTopics : copy.settings.inwit.testOk);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.testing = false;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    try {
      this.apply(
        await client.putInwitConfig({
          baseUrl: this.baseUrl.trim(),
          ...(this.accessKey.trim() !== '' ? { accessKey: this.accessKey.trim() } : {}),
          defaultTopicId: this.defaultTopicId,
        }),
      );
      toast(copy.settings.inwit.saved);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.saving = false;
    }
  }
}
