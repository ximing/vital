import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindSync(http: Http): Pick<VitalClient, 'syncHead' | 'syncChanges'> {
  return {
    syncHead: () => http.request('/api/v1/sync/head'),
    syncChanges: (query) => {
      const q: Record<string, string | number | boolean | undefined> = { since: query.since };
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/sync/changes', { query: q });
    },
  };
}
