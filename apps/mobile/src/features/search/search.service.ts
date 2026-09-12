import { Service } from '@rabjs/react';
import type { SearchHit } from '@vital/dto';
import { client } from '../../lib/api';
import { humanError } from '../../lib/errors';

export class SearchService extends Service {
  q = '';
  items: SearchHit[] | null = null;
  error: string | null = null;
  busy = false;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  setQuery(q: string): void {
    this.q = q;
    if (this.timer) clearTimeout(this.timer);
    const trimmed = q.trim();
    if (trimmed === '') {
      this.items = null;
      this.error = null;
      this.busy = false;
      return;
    }
    this.timer = setTimeout(() => {
      void this.run(trimmed);
    }, 160);
  }

  private async run(trimmed: string): Promise<void> {
    const gen = ++this.generation;
    this.busy = true;
    try {
      const res = await client.search({ q: trimmed, limit: 20 });
      if (gen !== this.generation) return;
      this.items = res.items;
      this.error = null;
    } catch (err) {
      if (gen !== this.generation) return;
      this.error = humanError(err);
      this.items = [];
    } finally {
      if (gen === this.generation) this.busy = false;
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.generation += 1;
  }
}
