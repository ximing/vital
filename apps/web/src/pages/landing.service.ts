import { Service } from '@rabjs/react';
import type { AppLatestRelease } from '@vital/dto';
import { client } from '@/api/client';
import { humanError } from '@/lib/errors';

export class LandingPageService extends Service {
  catalog: AppLatestRelease | null = null;
  loading = true;
  error: string | null = null;
  private started = false;

  load(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const res = await client.getAppLatest();
      this.catalog = res.latest;
    } catch (err) {
      this.catalog = null;
      this.error = humanError(err);
    } finally {
      this.loading = false;
    }
  }
}
