import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindTokens(
  http: Http,
): Pick<VitalClient, 'listApiTokens' | 'createApiToken' | 'revokeApiToken' | 'listApiTokenAccess'> {
  return {
    listApiTokens: () => http.request('/api/v1/tokens'),
    createApiToken: (input) => http.request('/api/v1/tokens', { method: 'POST', body: input }),
    revokeApiToken: (id) => http.request(`/api/v1/tokens/${id}`, { method: 'DELETE' }),
    listApiTokenAccess: (id, query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.cursor !== undefined) q.cursor = query.cursor;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request(`/api/v1/tokens/${id}/access`, { query: q });
    },
  };
}
