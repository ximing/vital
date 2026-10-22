import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindTags(
  http: Http,
): Pick<VitalClient, 'listTags' | 'createTag' | 'patchTag' | 'deleteTag'> {
  return {
    listTags: () => http.request('/api/v1/tags'),
    createTag: (input) => http.request('/api/v1/tags', { method: 'POST', body: input }),
    patchTag: (id, input) => http.request(`/api/v1/tags/${id}`, { method: 'PATCH', body: input }),
    deleteTag: (id) => http.request(`/api/v1/tags/${id}`, { method: 'DELETE' }),
  };
}
