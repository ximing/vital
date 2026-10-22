import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindLists(
  http: Http,
): Pick<VitalClient, 'listLists' | 'createList' | 'reorderLists' | 'patchList' | 'deleteList'> {
  return {
    listLists: () => http.request('/api/v1/lists'),
    createList: (input) => http.request('/api/v1/lists', { method: 'POST', body: input }),
    reorderLists: (input) => http.request('/api/v1/lists/reorder', { method: 'PUT', body: input }),
    patchList: (id, input) => http.request(`/api/v1/lists/${id}`, { method: 'PATCH', body: input }),
    deleteList: (id) => http.request(`/api/v1/lists/${id}`, { method: 'DELETE' }),
  };
}
