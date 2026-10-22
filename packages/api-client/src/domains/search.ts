import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindSearch(http: Http): Pick<VitalClient, 'search' | 'searchAll'> {
  return {
    search: (input) => http.request('/api/v1/search', { method: 'POST', body: input }),
    searchAll: (q, limit) => http.request('/api/v1/search', { query: { q, limit } }),
  };
}
