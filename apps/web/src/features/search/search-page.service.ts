import type { SearchHit } from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { humanError } from '@/lib/errors';

export class SearchPageService extends Service {
  query = '';
  result: { q: string; items: SearchHit[]; error: string | null } | null = null;

  setQuery(value: string): void {
    this.query = value;
  }

  async search(q: string): Promise<void> {
    try {
      const res = await client.search({ q, limit: 20 });
      this.result = { q, items: res.items, error: null };
    } catch (err) {
      this.result = { q, items: [], error: humanError(err) };
    }
  }
}
